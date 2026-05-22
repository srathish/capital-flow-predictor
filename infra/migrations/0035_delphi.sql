-- 0035_delphi.sql
--
-- Delphi: market-foresight tab that runs on top of the existing UW funnel.
--
-- The existing scanner/explosive tables tell us *what is hot right now*.
-- Delphi adds the prediction layer: for each candidate, store the forecast
-- as a frozen hypothesis (target range / probability / invalidation / reason
-- codes), then evaluate it after the horizon closes. The memory loop is the
-- product — without persisted predictions + outcomes, Delphi is just another
-- ranker. Schema is built around that loop first.
--
-- Source funnel: uw_screener_stocks (Stage 1+2) +
-- uw_greek_exposure_strike/expiry + uw_greek_flow (Stage 3). No new ingestion
-- tables in this migration — Delphi consumes what Phase A already writes.

BEGIN;

-- ----------------------------------------------------------------------------
-- delphi_predictions — every forecast ever issued, frozen at prediction time.
--
-- Never update a row after creation; outcomes go in delphi_outcomes (1:1 by
-- prediction_id). prediction_id is a deterministic slug so a re-run for the
-- same {ticker, signal_tf, horizon, snapshot_ts} is idempotent.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_predictions (
    prediction_id       TEXT PRIMARY KEY,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ticker              TEXT NOT NULL,
    signal_timeframe    TEXT NOT NULL,                -- '5m','15m','1h','4h','1d','1w'
    forecast_horizon    TEXT NOT NULL,                -- 'EOD','1w','1mo','3mo','6mo','12mo','24mo'
    horizon_ends_at     TIMESTAMPTZ NOT NULL,         -- when delphi_evaluate should score this
    current_price       DOUBLE PRECISION NOT NULL,
    bias                TEXT NOT NULL,                -- 'bullish','bearish','vol_expansion'
    target_range_low    DOUBLE PRECISION NOT NULL,
    target_range_high   DOUBLE PRECISION NOT NULL,
    primary_target      DOUBLE PRECISION NOT NULL,
    expected_return     DOUBLE PRECISION NOT NULL,    -- signed; bear = negative upside
    probability         DOUBLE PRECISION NOT NULL,    -- raw 0..1 (calibrated lives in calibration_buckets)
    downside_risk       DOUBLE PRECISION NOT NULL,    -- 0..1, expected loss if invalidated
    risk_reward         DOUBLE PRECISION,
    invalidation        DOUBLE PRECISION NOT NULL,
    confidence          TEXT NOT NULL,                -- 'low','medium','medium-high','high'
    delphi_score        DOUBLE PRECISION NOT NULL,    -- 0..100 final EV-weighted score
    reason_codes        TEXT[] NOT NULL DEFAULT '{}',
    regime              TEXT,                         -- detected at prediction time
    model_version       TEXT NOT NULL,
    explanation         TEXT,
    features            JSONB                         -- snapshot of feature vector for replay
);

CREATE INDEX IF NOT EXISTS idx_delphi_pred_created
    ON delphi_predictions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delphi_pred_horizon_score
    ON delphi_predictions (forecast_horizon, delphi_score DESC);
CREATE INDEX IF NOT EXISTS idx_delphi_pred_ticker_horizon
    ON delphi_predictions (ticker, forecast_horizon, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delphi_pred_pending_eval
    ON delphi_predictions (horizon_ends_at)
    WHERE horizon_ends_at IS NOT NULL;


-- ----------------------------------------------------------------------------
-- delphi_outcomes — what actually happened after the horizon ended.
--
-- One row per prediction_id, written by delphi_evaluate once the horizon
-- closes. `result` rolls up the booleans into a single category for fast
-- rollups on the memory dashboard.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_outcomes (
    prediction_id           TEXT PRIMARY KEY
        REFERENCES delphi_predictions(prediction_id) ON DELETE CASCADE,
    evaluation_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actual_high             DOUBLE PRECISION NOT NULL,
    actual_low              DOUBLE PRECISION NOT NULL,
    actual_close            DOUBLE PRECISION NOT NULL,
    hit_target_range        BOOLEAN NOT NULL,
    hit_primary_target      BOOLEAN NOT NULL,
    hit_invalidation        BOOLEAN NOT NULL,
    hit_invalidation_first  BOOLEAN NOT NULL,
    max_favorable_return    DOUBLE PRECISION NOT NULL,
    max_adverse_return      DOUBLE PRECISION NOT NULL,
    time_to_target_hours    DOUBLE PRECISION,
    result                  TEXT NOT NULL                  -- 'win','loss','breakeven','invalidated'
);
CREATE INDEX IF NOT EXISTS idx_delphi_outcomes_eval
    ON delphi_outcomes (evaluation_at DESC);


-- ----------------------------------------------------------------------------
-- delphi_reason_code_performance — which signals actually produce edge.
--
-- Rolled up from (delphi_predictions JOIN delphi_outcomes) on a schedule.
-- Updated in place; older rollups overwrite older state per segment.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_reason_code_performance (
    reason_code             TEXT NOT NULL,
    signal_timeframe        TEXT NOT NULL,
    forecast_horizon        TEXT NOT NULL,
    regime                  TEXT NOT NULL DEFAULT 'any',
    times_used              INTEGER NOT NULL DEFAULT 0,
    target_hit_rate         DOUBLE PRECISION,
    target_before_invalidation_rate DOUBLE PRECISION,
    average_return          DOUBLE PRECISION,
    average_drawdown        DOUBLE PRECISION,
    weight_modifier         DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    sample_size             INTEGER NOT NULL DEFAULT 0,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reason_code, signal_timeframe, forecast_horizon, regime)
);


-- ----------------------------------------------------------------------------
-- delphi_calibration_buckets — does a stated 70% mean a real 70%?
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_calibration_buckets (
    forecast_horizon        TEXT NOT NULL,
    regime                  TEXT NOT NULL DEFAULT 'any',
    probability_bucket      TEXT NOT NULL,             -- '50-55','55-60',...,'95-100'
    prediction_count        INTEGER NOT NULL DEFAULT 0,
    actual_hit_rate         DOUBLE PRECISION,
    calibration_gap         DOUBLE PRECISION,          -- predicted_mid - actual_hit_rate
    adjusted_probability    DOUBLE PRECISION,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (forecast_horizon, regime, probability_bucket)
);


-- ----------------------------------------------------------------------------
-- delphi_adaptive_weights — per-segment scoring weights, learned from outcomes.
--
-- Defaults are seeded once with regime='any' and feature_group covering the
-- score formula's W1..W9. The jobs/learning loop only mutates rows whose
-- sample_size crosses a confidence threshold; everything else falls back to
-- defaults at scoring time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_adaptive_weights (
    ticker                  TEXT NOT NULL DEFAULT '*',  -- '*' = global
    signal_timeframe        TEXT NOT NULL,
    forecast_horizon        TEXT NOT NULL,
    regime                  TEXT NOT NULL DEFAULT 'any',
    feature_group           TEXT NOT NULL,              -- 'expected_value','probability','gex_vex','flow','velocity','regime','liquidity','ticker_memory','data_quality'
    current_weight          DOUBLE PRECISION NOT NULL,
    default_weight          DOUBLE PRECISION NOT NULL,
    sample_size             INTEGER NOT NULL DEFAULT 0,
    performance_score       DOUBLE PRECISION,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, signal_timeframe, forecast_horizon, regime, feature_group)
);


-- ----------------------------------------------------------------------------
-- delphi_ticker_memory — per-ticker profile of what works.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_ticker_memory (
    ticker                  TEXT PRIMARY KEY,
    best_horizon            TEXT,
    best_reason_codes       TEXT[] NOT NULL DEFAULT '{}',
    weak_reason_codes       TEXT[] NOT NULL DEFAULT '{}',
    prediction_count        INTEGER NOT NULL DEFAULT 0,
    average_hit_rate        DOUBLE PRECISION,
    average_return          DOUBLE PRECISION,
    data_quality_score      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    notes                   TEXT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- delphi_model_performance — top-level "is the model getting better?" panel.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_model_performance (
    model_version           TEXT NOT NULL,
    signal_timeframe        TEXT NOT NULL,
    forecast_horizon        TEXT NOT NULL,
    prediction_count        INTEGER NOT NULL DEFAULT 0,
    target_hit_rate         DOUBLE PRECISION,
    average_realized_return DOUBLE PRECISION,
    profit_factor           DOUBLE PRECISION,
    brier_score             DOUBLE PRECISION,
    calibration_error       DOUBLE PRECISION,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (model_version, signal_timeframe, forecast_horizon)
);

COMMIT;
