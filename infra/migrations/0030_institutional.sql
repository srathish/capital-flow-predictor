-- Institutional flow & ownership — smart-money confirmation layer for the
-- explosive scanner (and a standalone Institutional view on the /flow tab).
--
-- Endpoints (UW):
--   /institution/activity                       -> uw_institution_activity
--   /institution/{name}/holdings                -> uw_institution_holdings
--   /institution/latest-filings                 -> uw_institution_latest_filings
--   /stock/{ticker}/ownership                   -> uw_stock_ownership
--   /market/insider-buy-sells                   -> uw_market_insider_buy_sells
--   /stock/{ticker}/insider-buy-sells           -> uw_stock_insider_buy_sells
--
-- The existing uw_insider_ticker_flow (0025_explosive_v2) is a *net* number
-- from /insiders/ticker-flow. The two insider-buy-sells endpoints below give
-- the *raw* per-side counts, which we need for confidence ("net buy of $1M on
-- 8 buyers vs 1 seller" is a different signal than "net buy of $1M on 1 buyer
-- vs 7 sellers" — both clear the existing score's bar).

-- ----------------------------------------------------------------------------
-- Institution activity — recent trades / position changes across all
-- institutions. We capture the most recent N events; older detail lives in
-- institution_holdings + latest_filings.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_institution_activity (
    activity_id         TEXT NOT NULL,           -- UW-provided event id (filing+ticker+date hash if missing)
    institution_name    TEXT NOT NULL,
    ticker              TEXT NOT NULL,
    action              TEXT,                    -- 'buy' | 'sell' | 'new' | 'closed' | 'increased' | 'reduced'
    shares              BIGINT,
    shares_change       BIGINT,                  -- signed; positive = added, negative = trimmed
    value_usd           DOUBLE PRECISION,        -- shares × price at filing
    price               DOUBLE PRECISION,
    filing_date         DATE,
    report_date         DATE,                    -- the period the filing covers (quarter end)
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload             JSONB,
    PRIMARY KEY (activity_id)
);
CREATE INDEX IF NOT EXISTS idx_inst_activity_ticker_date
    ON uw_institution_activity (ticker, filing_date DESC);
CREATE INDEX IF NOT EXISTS idx_inst_activity_recent
    ON uw_institution_activity (filing_date DESC);

-- ----------------------------------------------------------------------------
-- Institution holdings — the full position list for a given institution,
-- snapshotted at filing time. Updated when a fresh 13F lands. Key on
-- (institution, ticker, report_date) so we can track add/trim over quarters.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_institution_holdings (
    institution_name    TEXT NOT NULL,
    ticker              TEXT NOT NULL,
    report_date         DATE NOT NULL,           -- quarter end of the 13F
    shares              BIGINT,
    value_usd           DOUBLE PRECISION,
    portfolio_pct       DOUBLE PRECISION,        -- % of institution's portfolio
    shares_change       BIGINT,                  -- delta vs prior filing
    shares_change_pct   DOUBLE PRECISION,        -- shares_change / prior shares
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_name, ticker, report_date)
);
CREATE INDEX IF NOT EXISTS idx_inst_holdings_ticker
    ON uw_institution_holdings (ticker, report_date DESC);

-- ----------------------------------------------------------------------------
-- Stock ownership — per-ticker rollup. % held by institutions, top holders,
-- insider %. Refreshed daily; one row per (ticker, snapshot_date).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_stock_ownership (
    ticker                  TEXT NOT NULL,
    snapshot_date           DATE NOT NULL,
    institutional_pct       DOUBLE PRECISION,
    insider_pct             DOUBLE PRECISION,
    float_pct               DOUBLE PRECISION,
    institution_count       INTEGER,
    top_holders             JSONB,                  -- [{name, shares, pct, change}, ...]
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_ownership_ticker
    ON uw_stock_ownership (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Latest filings — the firehose. Mostly used to know which tickers to
-- re-pull holdings for. Lightweight pointer rows.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_institution_latest_filings (
    institution_name    TEXT NOT NULL,
    filing_date         DATE NOT NULL,
    report_date         DATE NOT NULL,
    filing_type         TEXT,                    -- '13F-HR', '13F-NT', etc.
    total_value_usd     DOUBLE PRECISION,
    position_count      INTEGER,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_name, filing_date)
);
CREATE INDEX IF NOT EXISTS idx_latest_filings_recent
    ON uw_institution_latest_filings (filing_date DESC);

-- ----------------------------------------------------------------------------
-- Insider buy-sell rollups — raw per-side counts. Two endpoints, two tables.
-- Market-wide rollup is one row per (snapshot_date), per-ticker is one row
-- per (ticker, snapshot_date, window_days).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_market_insider_buy_sells (
    snapshot_date       DATE NOT NULL,
    window_days         INTEGER NOT NULL,        -- 7 | 30 | 90 | 180
    buy_count           INTEGER,
    sell_count          INTEGER,
    buy_value_usd       DOUBLE PRECISION,
    sell_value_usd      DOUBLE PRECISION,
    net_value_usd       DOUBLE PRECISION,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, window_days)
);

CREATE TABLE IF NOT EXISTS uw_stock_insider_buy_sells (
    ticker              TEXT NOT NULL,
    snapshot_date       DATE NOT NULL,
    window_days         INTEGER NOT NULL,        -- 7 | 30 | 90 | 180
    buy_count           INTEGER,
    sell_count          INTEGER,
    buy_value_usd       DOUBLE PRECISION,
    sell_value_usd      DOUBLE PRECISION,
    net_value_usd       DOUBLE PRECISION,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, snapshot_date, window_days)
);
CREATE INDEX IF NOT EXISTS idx_stock_insider_bs_ticker
    ON uw_stock_insider_buy_sells (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- New explosive_scores column: institutional_score (recent 13F adds + high
-- institutional ownership + multi-buyer insider activity). See score_explosive.
-- ----------------------------------------------------------------------------
ALTER TABLE explosive_scores
    ADD COLUMN IF NOT EXISTS institutional_score DOUBLE PRECISION;
