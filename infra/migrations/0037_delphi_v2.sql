-- 0037_delphi_v2.sql
--
-- Delphi v2: accuracy push.
--
-- Today Delphi reads 3 tables (uw_screener_stocks, uw_greek_exposure_strike,
-- uw_greek_flow) out of the ~50 UW tables we ingest. This migration wires the
-- rest. It is purely additive — v0.1-rules predictions and outcomes keep
-- flowing; v0.2-features predictions are pinned via model_version so the two
-- can be A/B compared from delphi_model_performance directly.
--
-- New surface, in dependency order:
--   1. delphi_features          composed feature row per (ticker, snapshot)
--   2. macro_regime             daily macro/vol/trend regime tags
--   3. uw_predictions_api       UW's own prediction endpoints (smart_money,
--                                whales, market) — used as additional voters
--   4. delphi_intraday_outcomes intraday touch-order overlay (fixes
--                                hit_invalidation_first ordering bug)
--   5. delphi_ml_models         persisted LightGBM blobs + metadata
--   6. delphi_ml_predictions    per-prediction ML scores
--   7. delphi_holdout_set       reserved holdout for honest eval (no training)
--   8. delphi_backtest_runs     walk-forward replay results
--   9. delphi_model_versions    one row per shipped model_version for A/B
--
-- Held-out-set design: when a prediction is created, a deterministic hash
-- decides if it's in the holdout (15%). Holdout rows are never seen during
-- training or learning rollups, so Brier on holdout is an honest measure of
-- out-of-sample accuracy. The overfitting tripwire fires when
-- |train_brier - holdout_brier| > DELPHI_ML_OVERFIT_GAP (default 0.05).

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. delphi_features — one composed feature row per (ticker, snapshot_ts).
--
-- Written by delphi-features job. Joins ~20 UW tables into a single row that
-- delphi_rank reads. JSONB so adding columns doesn't need a migration; the
-- top-level keys are documented in cfp_jobs/delphi_features.py.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_features (
    ticker              TEXT NOT NULL,
    snapshot_ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Promoted scalars (hot path; rest lives in features JSONB)
    spot_price          DOUBLE PRECISION,
    iv_rank             DOUBLE PRECISION,
    iv30                DOUBLE PRECISION,
    rv30                DOUBLE PRECISION,

    -- Dark pool: 24h net premium + ratio of late-day prints
    dp_net_premium_24h  DOUBLE PRECISION,
    dp_print_count_24h  INTEGER,
    dp_late_day_share   DOUBLE PRECISION,   -- fraction of prints after 19:30 UTC

    -- Insider: 30d net buy $ (positive = buying), cluster count
    insider_net_30d     DOUBLE PRECISION,
    insider_buyers_30d  INTEGER,
    insider_sellers_30d INTEGER,

    -- Congress + Trump: 14d buy/sell counts
    congress_buys_14d   INTEGER,
    congress_sells_14d  INTEGER,

    -- Open interest delta on the front month (opening vs closing flow signal)
    oi_delta_call_1d    BIGINT,
    oi_delta_put_1d     BIGINT,
    oi_opening_ratio    DOUBLE PRECISION,   -- (oi gain) / (volume) — high = opening

    -- Max pain: distance from current price (signed; negative = below)
    max_pain_distance   DOUBLE PRECISION,   -- (max_pain - spot) / spot
    max_pain_expiry     DATE,

    -- Short interest + utilization
    short_pct_float     DOUBLE PRECISION,
    short_fee_rate      DOUBLE PRECISION,
    short_utilization   DOUBLE PRECISION,

    -- Earnings proximity: days until next report; null when none scheduled
    days_to_earnings    INTEGER,
    earnings_in_horizon BOOLEAN,            -- true if earnings inside any tracked horizon

    -- Analyst: revisions count + net upgrade-downgrade in 30d
    analyst_revisions_30d INTEGER,
    analyst_net_upgrade   INTEGER,

    -- 13F: net institutional add/drop in latest filing window
    inst_net_delta_shares BIGINT,

    -- GEX expiry — gamma cliff on the front weekly (call - put gex)
    gex_expiry_front    DOUBLE PRECISION,

    -- Skew + NOPE + RV term
    rr_skew_25d         DOUBLE PRECISION,
    nope_score          DOUBLE PRECISION,

    -- UW predictions API (when present)
    uw_smart_money_score DOUBLE PRECISION,  -- 0..1, bullish prob from UW
    uw_whales_score      DOUBLE PRECISION,  -- 0..1

    -- News volume + sentiment (24h)
    news_count_24h      INTEGER,
    news_sentiment_24h  DOUBLE PRECISION,   -- -1..+1

    -- Seasonality baseline (this calendar month, last 5y avg return)
    seasonality_avg_ret DOUBLE PRECISION,

    -- Regime tags (denormalized from macro_regime for fast read)
    vol_regime          TEXT,               -- 'low','normal','high','crisis'
    trend_regime        TEXT,               -- 'uptrend','rangebound','downtrend'
    macro_regime        TEXT,               -- 'risk_on','neutral','risk_off'

    -- Conflict signals (composer flags when sources disagree)
    has_conflict        BOOLEAN NOT NULL DEFAULT FALSE,
    conflict_codes      TEXT[] NOT NULL DEFAULT '{}',

    -- Raw feature payload (everything not promoted above, for ML training)
    features            JSONB NOT NULL DEFAULT '{}'::jsonb,

    PRIMARY KEY (ticker, snapshot_ts)
);

CREATE INDEX IF NOT EXISTS idx_delphi_features_ts
    ON delphi_features (snapshot_ts DESC);
CREATE INDEX IF NOT EXISTS idx_delphi_features_ticker_ts
    ON delphi_features (ticker, snapshot_ts DESC);


-- ----------------------------------------------------------------------------
-- 2. macro_regime — daily regime tagging.
--
-- Written by regime-tag job. Joins macro_daily (FRED yield curve, VIX, DXY)
-- + prices_daily (SPY 20d/50d/200d MAs, ATR) to produce composite regime
-- labels Delphi stratifies by. Single row per date.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS macro_regime (
    asof_date           DATE PRIMARY KEY,

    -- Vol regime: based on VIX absolute + 1mo Z-score
    vix_close           DOUBLE PRECISION,
    vix_z_30d           DOUBLE PRECISION,
    vol_regime          TEXT NOT NULL,       -- 'low','normal','high','crisis'

    -- Trend regime: based on SPY vs 20d/50d/200d MAs
    spy_close           DOUBLE PRECISION,
    spy_above_20d       BOOLEAN,
    spy_above_50d       BOOLEAN,
    spy_above_200d      BOOLEAN,
    trend_regime        TEXT NOT NULL,       -- 'uptrend','rangebound','downtrend'

    -- Macro regime: based on yield curve slope + DXY + Fed rate
    yield_curve_2_10    DOUBLE PRECISION,    -- 10y - 2y
    dxy_close           DOUBLE PRECISION,
    fed_funds_rate      DOUBLE PRECISION,
    macro_regime        TEXT NOT NULL,       -- 'risk_on','neutral','risk_off'

    -- Composite regime label (used as the single 'regime' string in Delphi tables)
    composite_regime    TEXT NOT NULL,       -- e.g. 'uptrend_normal_risk_on'

    payload             JSONB,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_macro_regime_date
    ON macro_regime (asof_date DESC);


-- ----------------------------------------------------------------------------
-- 3. uw_predictions_api — UW's own prediction endpoints.
--
-- UW exposes prediction_market, prediction_smart_money, prediction_whales,
-- prediction_insiders, prediction_unusual_markets. These are voters in the
-- Delphi ensemble — they reflect UW's view from their full data warehouse.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_predictions_api (
    snapshot_ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ticker              TEXT NOT NULL,
    source              TEXT NOT NULL,       -- 'smart_money','whales','market','insiders','unusual_markets'
    direction           TEXT,                -- 'bullish','bearish','neutral'
    confidence          DOUBLE PRECISION,    -- 0..1
    horizon             TEXT,                -- 'EOD','1w','1mo' etc when UW provides one
    payload             JSONB,

    PRIMARY KEY (snapshot_ts, ticker, source)
);

CREATE INDEX IF NOT EXISTS idx_uw_predictions_ticker
    ON uw_predictions_api (ticker, snapshot_ts DESC);


-- ----------------------------------------------------------------------------
-- 4. delphi_intraday_outcomes — corrects hit_invalidation_first ordering.
--
-- delphi_outcomes uses daily bars and can't tell whether target was hit
-- before invalidation when both touched the same day. This table holds the
-- intraday-resolved overlay: for predictions where both touched, which one
-- happened first. delphi-evaluate-intraday writes this; rank consumers join
-- it back to delphi_outcomes for the corrected `result`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_intraday_outcomes (
    prediction_id            TEXT PRIMARY KEY
        REFERENCES delphi_predictions(prediction_id) ON DELETE CASCADE,
    evaluation_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    intraday_source          TEXT NOT NULL,    -- 'uw_candles_5m','polygon','yf_intraday'
    bar_interval_minutes     INTEGER NOT NULL,

    first_touch_target_ts    TIMESTAMPTZ,
    first_touch_invalidation_ts TIMESTAMPTZ,
    hit_target_first         BOOLEAN,
    hit_invalidation_first   BOOLEAN,
    time_to_target_hours     DOUBLE PRECISION,
    time_to_invalidation_h   DOUBLE PRECISION,

    -- Corrected result that supersedes delphi_outcomes.result when available
    corrected_result         TEXT              -- 'win','loss','breakeven','invalidated'
);


-- ----------------------------------------------------------------------------
-- 5. delphi_ml_models — persisted LightGBM + isotonic blobs.
--
-- Each train run writes a row. model_blob is the pickled estimator;
-- calibrator_blob is the isotonic regressor wrapped on top. Production reads
-- the row with status='active'; older rows become 'archived' on rotation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_ml_models (
    model_version       TEXT PRIMARY KEY,    -- e.g. 'v0.3-lgbm-2026-05-24'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              TEXT NOT NULL DEFAULT 'training',  -- 'training','active','archived','rejected'

    n_train             INTEGER NOT NULL,
    n_val               INTEGER NOT NULL,
    n_holdout           INTEGER NOT NULL,

    -- Train/val/holdout metrics (no separate "test" — holdout IS test)
    train_brier         DOUBLE PRECISION,
    val_brier           DOUBLE PRECISION,
    holdout_brier       DOUBLE PRECISION,
    train_auc           DOUBLE PRECISION,
    val_auc             DOUBLE PRECISION,
    holdout_auc         DOUBLE PRECISION,
    holdout_hit_rate    DOUBLE PRECISION,
    calibration_error   DOUBLE PRECISION,

    -- Overfitting tripwire — if |train - holdout| > gap, status='rejected'
    overfit_gap         DOUBLE PRECISION,
    overfit_threshold   DOUBLE PRECISION,
    tripwire_fired      BOOLEAN NOT NULL DEFAULT FALSE,

    -- LightGBM hyperparams + feature importance
    hyperparams         JSONB NOT NULL DEFAULT '{}'::jsonb,
    feature_importance  JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Blobs (pickle bytes). Small — LightGBM models for our feature count
    -- are typically <500KB and isotonic <10KB.
    model_blob          BYTEA,
    calibrator_blob     BYTEA,

    -- Synthetic backfill metadata
    used_synthetic      BOOLEAN NOT NULL DEFAULT FALSE,
    n_synthetic         INTEGER NOT NULL DEFAULT 0,
    synthetic_window    TEXT
);


-- ----------------------------------------------------------------------------
-- 6. delphi_ml_predictions — per-prediction ML scores from the active model.
--
-- Written by delphi-rank (Layer 4) when DELPHI_USE_ML_OVERLAY=true and an
-- active model exists. ML probability is blended with rules probability in
-- the final score (60/40 by default, configurable per model_version).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_ml_predictions (
    prediction_id       TEXT PRIMARY KEY
        REFERENCES delphi_predictions(prediction_id) ON DELETE CASCADE,
    model_version       TEXT NOT NULL REFERENCES delphi_ml_models(model_version),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    raw_ml_proba        DOUBLE PRECISION NOT NULL,    -- pre-calibration
    calibrated_ml_proba DOUBLE PRECISION NOT NULL,    -- post-isotonic
    rules_proba         DOUBLE PRECISION,             -- from delphi_predictions for join
    blended_proba       DOUBLE PRECISION NOT NULL,    -- final published probability
    blend_weight_ml     DOUBLE PRECISION NOT NULL,    -- e.g. 0.6 (ML) / 0.4 (rules)

    feature_snapshot    JSONB                         -- what the model actually saw
);


-- ----------------------------------------------------------------------------
-- 7. delphi_holdout_set — reserved-for-eval prediction ids.
--
-- A prediction_id is in the holdout iff hash(prediction_id) % 100 < holdout_pct.
-- The hash is deterministic so the membership of a prediction is stable across
-- runs. Training and learning rollups EXCLUDE these rows; only the holdout
-- evaluator reads them. This is what makes "4× more accurate" claims honest.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_holdout_set (
    prediction_id       TEXT PRIMARY KEY
        REFERENCES delphi_predictions(prediction_id) ON DELETE CASCADE,
    holdout_bucket      INTEGER NOT NULL,    -- 0..9 for k-fold-like analysis
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- 8. delphi_backtest_runs — walk-forward replay results.
--
-- Each row is one named run (e.g. "v0.2 vs v0.1, 2025-01 → 2026-05"). The
-- replay job rebuilds predictions on historical snapshots, evaluates them
-- against real OHLC, and records aggregate metrics here. Powers the
-- Backtest Lab tab and is the gate the "4× accuracy" claim has to clear.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_backtest_runs (
    run_id              TEXT PRIMARY KEY,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    model_version       TEXT NOT NULL,
    window_start        DATE NOT NULL,
    window_end          DATE NOT NULL,
    walk_forward_step_days INTEGER NOT NULL DEFAULT 7,

    -- Aggregate metrics across the full window
    n_predictions       INTEGER NOT NULL,
    n_scored            INTEGER NOT NULL,
    hit_rate            DOUBLE PRECISION,
    brier_score         DOUBLE PRECISION,
    log_loss            DOUBLE PRECISION,
    profit_factor       DOUBLE PRECISION,
    avg_realized_return DOUBLE PRECISION,
    calibration_error   DOUBLE PRECISION,

    -- Per-segment breakdowns (JSONB so we can ship breakdowns without DDL)
    by_horizon          JSONB NOT NULL DEFAULT '{}'::jsonb,
    by_regime           JSONB NOT NULL DEFAULT '{}'::jsonb,
    by_reason_code      JSONB NOT NULL DEFAULT '{}'::jsonb,

    notes               TEXT
);


-- ----------------------------------------------------------------------------
-- 9. delphi_model_versions — registry of every model_version ever shipped.
--
-- One row per (model_version). Powers the A/B view by giving each version
-- a description, an "is_default" flag (only one true at a time), and a
-- pointer to the migration / commit that introduced it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_model_versions (
    model_version       TEXT PRIMARY KEY,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    family              TEXT NOT NULL,          -- 'rules','features','ml','ensemble'
    description         TEXT,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    notes               JSONB
);

-- Enforce single default
CREATE UNIQUE INDEX IF NOT EXISTS idx_delphi_model_versions_default
    ON delphi_model_versions ((is_default))
    WHERE is_default = TRUE;

-- Seed the two known versions
INSERT INTO delphi_model_versions (model_version, family, description, is_default)
VALUES
    ('v0.1-rules',    'rules',    'Rules-based with adaptive weights + calibration (pre-v2)', FALSE),
    ('v0.2-features', 'features', 'Adds delphi_features composer + composite regime + conflict detection', TRUE)
ON CONFLICT (model_version) DO NOTHING;


-- ----------------------------------------------------------------------------
-- View: delphi_model_performance_compare — A/B head-to-head.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_delphi_model_compare AS
SELECT
    mp.model_version,
    mv.family,
    mv.description,
    mv.is_default,
    mp.signal_timeframe,
    mp.forecast_horizon,
    mp.prediction_count,
    mp.target_hit_rate,
    mp.brier_score,
    mp.calibration_error,
    mp.profit_factor,
    mp.average_realized_return,
    mp.updated_at
FROM delphi_model_performance mp
LEFT JOIN delphi_model_versions mv USING (model_version);


COMMIT;
