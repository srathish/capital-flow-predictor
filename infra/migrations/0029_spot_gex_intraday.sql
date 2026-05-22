-- Intraday spot-GEX (1-minute resolution).
-- Endpoint: /stock/{ticker}/spot-exposures with interval=1m
--
-- Existing apps/gex pulls SPY/QQQ/SPX from Heatseeker on a custom polling
-- cadence. This table layers UW's official 1-min spot-GEX series in next to
-- it so:
--   1. We get a verifiable second source for the apps/gex monitor's bias.
--   2. The /explosive scanner can use intraday GEX *for any ticker* (not just
--      the three Heatseeker covers) — turning spot-GEX into a per-ticker
--      confirmation signal instead of an SPY/QQQ/SPX-only one.
--
-- Shape: one row per (ticker, ts) at 1-min granularity, with the per-strike
-- breakdown kept compact in JSONB rather than fan-out to a wide table.
-- payload is the full UW row so backfills don't lose precision.

CREATE TABLE IF NOT EXISTS uw_spot_gex_intraday (
    ticker              TEXT NOT NULL,
    ts                  TIMESTAMPTZ NOT NULL,
    underlying_price    DOUBLE PRECISION,
    total_gamma         DOUBLE PRECISION,        -- $ per 1pt move; signed (dealer perspective)
    total_delta         DOUBLE PRECISION,        -- $ delta exposure
    total_charm         DOUBLE PRECISION,        -- d delta / d t
    total_vanna         DOUBLE PRECISION,        -- d delta / d IV
    call_gamma          DOUBLE PRECISION,
    put_gamma           DOUBLE PRECISION,
    call_delta          DOUBLE PRECISION,
    put_delta           DOUBLE PRECISION,
    -- per-strike breakdown UW returns — keep compact, query rarely
    strike_breakdown    JSONB,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, ts)
);

-- Hot path: "give me today's series for ticker X"
CREATE INDEX IF NOT EXISTS idx_spot_gex_ticker_ts
    ON uw_spot_gex_intraday (ticker, ts DESC);

-- Cross-ticker scan: "which names have biggest GEX swings in the last hour"
CREATE INDEX IF NOT EXISTS idx_spot_gex_recent
    ON uw_spot_gex_intraday (ts DESC)
    WHERE ts > NOW() - INTERVAL '6 hours';

-- Add intraday-GEX sub-score column on explosive_scores. Captures whether
-- the ticker is in a short-gamma / unstable regime (per-ticker, not just
-- SPY/QQQ/SPX). Replaces the existing gex_bonus_score's "in coverage" check
-- with an actual computed signal.
ALTER TABLE explosive_scores
    ADD COLUMN IF NOT EXISTS spot_gex_score DOUBLE PRECISION;
