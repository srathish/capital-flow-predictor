-- Flow tab additions — 5 net-new UW endpoints that the explosive feature
-- doesn't already cover. Migration 0024 (explosive options) defines the
-- overlapping per-ticker tables (uw_flow_per_strike, uw_flow_per_expiry,
-- uw_max_pain, uw_short_screener, uw_contract_screener); the flow tab reads
-- from those *soft* — it doesn't own their ingestion or schema.
--
-- This migration adds the 5 endpoints the flow tab needs and explosive does not:
--   /api/market/movers                           -> uw_movers_snapshot
--   /api/market/{sector}/sector-tide             -> uw_sector_tide
--   /api/market/correlations                     -> uw_correlations
--   /api/stock/{ticker}/iv-rank                  -> uw_iv_rank_history
--   /api/companies/{ticker}/earnings-estimates   -> uw_earnings_estimates
--
-- All column names follow the live UW response shapes from /api/openapi
-- (locked 2026-05-21).


-- ----------------------------------------------------------------------------
-- Market movers — top gainers / losers / most-active. UW only returns
-- ticker + change + price + volume per row (no flow attached). Useful as the
-- discovery panel above the unusual-flow feed.
-- Endpoint: /api/market/movers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_movers_snapshot (
    snapshot_ts         TIMESTAMPTZ NOT NULL,
    bucket              TEXT NOT NULL,         -- 'top_gainers' | 'top_losers' | 'most_active'
    rank                INTEGER NOT NULL,      -- 1..N within the bucket
    ticker              TEXT NOT NULL,
    price               DOUBLE PRECISION,
    change              DOUBLE PRECISION,
    change_percent      DOUBLE PRECISION,
    volume              BIGINT,
    PRIMARY KEY (snapshot_ts, bucket, rank)
);
CREATE INDEX IF NOT EXISTS idx_uw_movers_latest
    ON uw_movers_snapshot (snapshot_ts DESC);
CREATE INDEX IF NOT EXISTS idx_uw_movers_ticker
    ON uw_movers_snapshot (ticker, snapshot_ts DESC);


-- ----------------------------------------------------------------------------
-- Sector tide — net call/put premium tape per S&P sector. Analog of
-- uw_market_tide split by sector. Lets us tag a ticker's flow as
-- "with-sector" or "against-sector". UW supplies one row per minute.
-- Endpoint: /api/market/{sector}/sector-tide
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_sector_tide (
    ts                  TIMESTAMPTZ NOT NULL,
    sector              TEXT NOT NULL,
    net_call_premium    DOUBLE PRECISION,
    net_put_premium     DOUBLE PRECISION,
    net_volume          BIGINT,
    PRIMARY KEY (ts, sector)
);
CREATE INDEX IF NOT EXISTS idx_uw_sector_tide_sector
    ON uw_sector_tide (sector, ts DESC);


-- ----------------------------------------------------------------------------
-- Correlations — pairwise correlation across a basket of tickers over a
-- window. UW returns one row per ordered pair (fst, snd) with the
-- correlation, the window bounds, and the row count.
-- Endpoint: /api/market/correlations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_correlations (
    snapshot_date       DATE NOT NULL,        -- max_date of the window
    fst_ticker          TEXT NOT NULL,
    snd_ticker          TEXT NOT NULL,
    correlation         DOUBLE PRECISION,
    min_date            DATE,
    max_date            DATE,
    sample_rows         INTEGER,
    last_fetched        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, fst_ticker, snd_ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_correlations_fst
    ON uw_correlations (fst_ticker, snapshot_date DESC);


-- ----------------------------------------------------------------------------
-- IV rank history — daily IV30 + 1y IV-rank per ticker (historical series).
-- uw_volatility_stats stores the *current* snapshot; this is the time series
-- so the flow tab can chart "vol regime over time" and answer "are we at the
-- 95th IV percentile right now?".
-- Endpoint: /api/stock/{ticker}/iv-rank
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_iv_rank_history (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    close               DOUBLE PRECISION,
    iv30                DOUBLE PRECISION,         -- UW "volatility" field
    iv_rank_1y          DOUBLE PRECISION,         -- 0..1
    last_fetched        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_iv_rank_history_ticker
    ON uw_iv_rank_history (ticker, snapshot_date DESC);


-- ----------------------------------------------------------------------------
-- Earnings estimates — forward EPS / revenue consensus per upcoming report.
-- Complements uw_earnings (historical actuals + reactions) with what the
-- street is expecting going in.
-- Endpoint: /api/companies/{ticker}/earnings-estimates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_earnings_estimates (
    ticker                          TEXT NOT NULL,
    report_date                     DATE NOT NULL,
    horizon                         TEXT,
    eps_estimate_average            DOUBLE PRECISION,
    eps_estimate_high               DOUBLE PRECISION,
    eps_estimate_low                DOUBLE PRECISION,
    eps_estimate_analyst_count      INTEGER,
    revenue_estimate_average        DOUBLE PRECISION,
    revenue_estimate_high           DOUBLE PRECISION,
    revenue_estimate_low            DOUBLE PRECISION,
    revenue_estimate_analyst_count  INTEGER,
    payload                         JSONB,
    last_fetched                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, report_date)
);
CREATE INDEX IF NOT EXISTS idx_uw_earnings_estimates_date
    ON uw_earnings_estimates (report_date);
