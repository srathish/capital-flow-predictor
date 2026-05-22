-- Catalyst feeds — feed the explosive scanner with a real catalyst calendar.
-- Existing uw_earnings (0004) is per-ticker historical reports; this migration
-- adds the *upcoming* / market-wide calendars + analyst events that the
-- scoring engine actually wants as confirmation signals.
--
-- Endpoints (UW):
--   /earnings/afterhours                          -> uw_earnings_calendar_daily(session='post')
--   /earnings/premarket                           -> uw_earnings_calendar_daily(session='pre')
--   /companies/{ticker}/dividends                 -> uw_dividends
--   /companies/{ticker}/stock-splits              -> uw_stock_splits
--   /screener/analyst-ratings                     -> uw_analyst_ratings
--   /market/economic-calendar                     -> uw_economic_calendar
--   /market/economic-indicators                   -> uw_economic_indicators (optional)
--
-- The /flow tab also reads from these (upcoming earnings chip) and the
-- /explosive scorer adds two new sub-scores: earnings_window_score and
-- analyst_score. See score_explosive.py.

-- ----------------------------------------------------------------------------
-- Earnings calendar — *upcoming* reporters by session (pre / post market).
-- One row per (report_date, session, ticker). Idempotent on that key.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_earnings_calendar_daily (
    report_date         DATE NOT NULL,
    session             TEXT NOT NULL,           -- 'pre' | 'post' | 'amc' | 'bmo' | 'unknown'
    ticker              TEXT NOT NULL,
    company_name        TEXT,
    eps_estimate        DOUBLE PRECISION,
    eps_actual          DOUBLE PRECISION,
    revenue_estimate    DOUBLE PRECISION,
    revenue_actual      DOUBLE PRECISION,
    expected_move_pct   DOUBLE PRECISION,        -- straddle-implied move if UW provides
    market_cap          DOUBLE PRECISION,
    sector              TEXT,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload             JSONB,
    PRIMARY KEY (report_date, session, ticker)
);
CREATE INDEX IF NOT EXISTS idx_earnings_cal_ticker_date
    ON uw_earnings_calendar_daily (ticker, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_cal_date_session
    ON uw_earnings_calendar_daily (report_date DESC, session);

-- ----------------------------------------------------------------------------
-- Dividends — per-ticker historical + upcoming. ex_date is the discriminator
-- the market actually reacts to; cash_amount drives the price drop.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_dividends (
    ticker              TEXT NOT NULL,
    ex_date             DATE NOT NULL,
    record_date         DATE,
    payment_date        DATE,
    declared_date       DATE,
    cash_amount         DOUBLE PRECISION,
    frequency           TEXT,                    -- 'quarterly' | 'monthly' | 'special' | etc.
    dividend_type       TEXT,                    -- 'cash' | 'stock' | 'special'
    yield_percent       DOUBLE PRECISION,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, ex_date)
);
CREATE INDEX IF NOT EXISTS idx_dividends_ex_date
    ON uw_dividends (ex_date DESC);

-- ----------------------------------------------------------------------------
-- Stock splits — straightforward calendar feed. Splits drive option chain
-- adjustments so the scanner should de-prioritize tickers right after one.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_stock_splits (
    ticker              TEXT NOT NULL,
    ex_date             DATE NOT NULL,
    split_from          DOUBLE PRECISION,        -- e.g. 1 for a 1→4 split
    split_to            DOUBLE PRECISION,        -- e.g. 4 for a 1→4 split
    split_ratio         DOUBLE PRECISION,        -- split_to / split_from
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, ex_date)
);
CREATE INDEX IF NOT EXISTS idx_splits_ex_date
    ON uw_stock_splits (ex_date DESC);

-- ----------------------------------------------------------------------------
-- Analyst ratings — upgrade / downgrade / price-target changes. Each event is
-- distinct, but UW sometimes re-publishes the same event with corrections, so
-- we key on (ticker, event_date, firm, action) and on conflict refresh prices.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_analyst_ratings (
    ticker              TEXT NOT NULL,
    event_date          DATE NOT NULL,
    firm                TEXT NOT NULL,           -- 'Goldman Sachs', 'Morgan Stanley', etc.
    action              TEXT NOT NULL,           -- 'upgrade' | 'downgrade' | 'initiated' | 'target'
    rating_prior        TEXT,
    rating_new          TEXT,
    price_target_prior  DOUBLE PRECISION,
    price_target_new    DOUBLE PRECISION,
    notes               TEXT,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload             JSONB,
    PRIMARY KEY (ticker, event_date, firm, action)
);
CREATE INDEX IF NOT EXISTS idx_analyst_ticker_date
    ON uw_analyst_ratings (ticker, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_analyst_recent
    ON uw_analyst_ratings (event_date DESC);

-- ----------------------------------------------------------------------------
-- Economic calendar — Fed events, CPI, NFP, etc. Macro catalysts that move
-- the broad tape; the scanner uses them as a "weight everything down" gate on
-- catalyst days (cash chases macro, not single names).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_economic_calendar (
    event_ts            TIMESTAMPTZ NOT NULL,
    event_name          TEXT NOT NULL,
    country             TEXT,
    importance          TEXT,                    -- 'low' | 'medium' | 'high'
    actual              TEXT,                    -- raw string; can be a percentage, an index level, etc.
    forecast            TEXT,
    previous            TEXT,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload             JSONB,
    PRIMARY KEY (event_ts, event_name, country)
);
CREATE INDEX IF NOT EXISTS idx_econ_cal_ts
    ON uw_economic_calendar (event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_econ_cal_importance
    ON uw_economic_calendar (importance, event_ts DESC);

-- ----------------------------------------------------------------------------
-- New explosive_scores columns: earnings_window_score (peaks 1-3d before
-- report) and analyst_score (recent upgrade + price-target raise).
-- NULL-safe ALTERs so existing rows stay valid until the next scorer run.
-- ----------------------------------------------------------------------------
ALTER TABLE explosive_scores
    ADD COLUMN IF NOT EXISTS earnings_window_score DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS analyst_score          DOUBLE PRECISION;
