-- Capital Flow Predictor — ETF constituent breadth snapshots
--
-- uw_etf_holdings stores the *current* holdings snapshot (PK overwrites on
-- refresh), so it has no time series. This table accumulates one breadth row
-- per (ETF, snapshot_date) so we can:
--
--   1. Compute a `breadth_v1` feature set per (ts, ETF) for the ranker
--   2. Backtest the model with a feature that actually varies per sector AND
--      across time, not a snapshot used only on the live page
--
-- One row per (etf, snapshot_date) — the UW/yfinance holdings job calls
-- `record_breadth_snapshot()` after each refresh.

CREATE TABLE IF NOT EXISTS etf_breadth_snapshots (
    etf                          TEXT NOT NULL,
    snapshot_date                DATE NOT NULL,
    n_constituents               INT  NOT NULL,
    -- 1D directional breadth
    pct_up_1d                    DOUBLE PRECISION,   -- % of constituents where close > prev_price
    weighted_ret_1d              DOUBLE PRECISION,   -- weight-weighted (close/prev - 1)
    -- 52-week extension
    pct_within_5pct_52w_high     DOUBLE PRECISION,
    pct_within_5pct_52w_low      DOUBLE PRECISION,
    median_dist_52w_high         DOUBLE PRECISION,   -- median (close/week52_high - 1), <=0
    -- Options-flow tilt aggregated across constituents
    bullish_premium_share        DOUBLE PRECISION,   -- bullish / (bullish + bearish), [0,1]
    call_put_premium_ratio       DOUBLE PRECISION,   -- sum(call_premium) / sum(put_premium)
    -- Bookkeeping
    last_fetched                 TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (etf, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_etf_breadth_snapshots_date
    ON etf_breadth_snapshots (snapshot_date DESC);
