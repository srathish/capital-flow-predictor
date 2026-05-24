-- 0038_delphi_quant.sql
--
-- Delphi v0.3 quant upgrades.
--
-- Additive columns on delphi_predictions for the quant-grade output: conformal
-- probability intervals, Kelly position size, and full return-distribution
-- quantiles. v0.1 + v0.2 keep writing predictions unchanged (NULL on these
-- columns); v0.3 (delphi-rank-v2 after this migration) populates them.
--
-- Why these specific fields:
--
--   prob_lo, prob_hi:
--     Bootstrap-based 80% confidence interval on the probability. A point
--     estimate of "75%" with [60%, 86%] tells a trader the conviction; "75%"
--     with [55%, 92%] tells them not to size up. Computed from
--     delphi_outcomes matched by (regime, horizon, prob_bucket).
--
--   kelly_fraction:
--     f* = (p * b - (1-p)) / b   where b = expected_return / downside_risk.
--     Stored as fractional Kelly (0.25 * f*) so survivability is built in;
--     UI labels accordingly. Negative or NaN -> NULL (do not trade).
--
--   return_p10, return_p50, return_p90:
--     Quantile-regression heads from the LGBM model. p50 is the median
--     expected return; (p10, p90) is the 80% predictive interval. Lets the
--     UI render a fan chart instead of a single target.
--
-- Also indexed by (model_version, horizon) so the Backtest Lab compare view
-- can pull v0.1 vs v0.2 vs v0.3 rows cheaply.

BEGIN;

ALTER TABLE delphi_predictions
    ADD COLUMN IF NOT EXISTS prob_lo          DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS prob_hi          DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS prob_ci_n        INTEGER,        -- # comparable outcomes used
    ADD COLUMN IF NOT EXISTS kelly_fraction   DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS return_p10       DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS return_p50       DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS return_p90       DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS gex_wall_anchored BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_delphi_pred_mv_horizon
    ON delphi_predictions (model_version, forecast_horizon, created_at DESC);


-- ----------------------------------------------------------------------------
-- delphi_reason_code_promotions — BH FDR-controlled promotion log.
--
-- Reason codes are only allowed to influence the ranker (weight_modifier > 1.05
-- or < 0.95) once their hit-rate edge clears Benjamini-Hochberg FDR-corrected
-- p < 0.05. With ~40 reason codes × ~7 horizons × ~10 regimes, the family
-- size is ~2800 hypotheses; raw p<0.05 would surface ~140 false positives by
-- chance. BH at α=0.05 caps the false-discovery share at 5%.
--
-- delphi-learn writes this table; delphi_reason_code_performance reads it
-- back when computing weight_modifier (codes without a promotion row stay at
-- weight 1.0).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_reason_code_promotions (
    reason_code         TEXT NOT NULL,
    signal_timeframe    TEXT NOT NULL,
    forecast_horizon    TEXT NOT NULL,
    regime              TEXT NOT NULL DEFAULT 'any',
    n_observations      INTEGER NOT NULL,
    edge_vs_base        DOUBLE PRECISION,        -- hit_rate(present) - base_rate
    raw_p_value         DOUBLE PRECISION,        -- one-sided binomial vs base
    bh_q_value          DOUBLE PRECISION,        -- BH-corrected q
    promoted            BOOLEAN NOT NULL DEFAULT FALSE,
    direction           TEXT NOT NULL,           -- 'bullish'|'bearish' (sign of edge)
    promoted_at         TIMESTAMPTZ,
    last_evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reason_code, signal_timeframe, forecast_horizon, regime)
);


-- ----------------------------------------------------------------------------
-- delphi_xs_universe_stats — universe-level percentiles for cross-sectional ranks.
--
-- Written by delphi-features once per snapshot. For each numeric feature in
-- the composer's promoted columns, stores the 10/25/50/75/90 percentile across
-- the active universe. The composer then writes per-ticker xs_rank fields
-- (percentile of this ticker vs universe today) into delphi_features.features.
--
-- Why a separate table: lets the API show "where does NVDA sit vs the rest
-- of today's universe" without re-computing on every request.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delphi_xs_universe_stats (
    snapshot_ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    feature_name        TEXT NOT NULL,
    n_tickers           INTEGER NOT NULL,
    pct10               DOUBLE PRECISION,
    pct25               DOUBLE PRECISION,
    pct50               DOUBLE PRECISION,
    pct75               DOUBLE PRECISION,
    pct90               DOUBLE PRECISION,
    mean_val            DOUBLE PRECISION,
    stddev_val          DOUBLE PRECISION,
    PRIMARY KEY (snapshot_ts, feature_name)
);


-- ----------------------------------------------------------------------------
-- Register the new model version.
-- ----------------------------------------------------------------------------
INSERT INTO delphi_model_versions (model_version, family, description, is_default)
VALUES ('v0.3-quant', 'features', 'Adds GEX wall anchoring, conformal CI, Kelly, quantile heads, BH FDR, xs-ranks, time-decay ML weights, PEAD/momentum/macro-spread features', TRUE)
ON CONFLICT (model_version) DO UPDATE SET
    description = EXCLUDED.description,
    is_default = TRUE;

UPDATE delphi_model_versions SET is_default = FALSE
WHERE model_version <> 'v0.3-quant';

COMMIT;
