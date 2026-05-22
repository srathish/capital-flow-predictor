-- 0033_uw_screeners.sql
--
-- Phase A of the funnel — net-new UW endpoints powering top-of-funnel
-- universe selection, deep GEX positioning, lit/dark-pool institutional
-- flow, and global news as event injectors.
--
-- Carefully scoped: tables already in the DB that we just under-use
-- (uw_market_tide, uw_movers_snapshot, uw_sector_tide, uw_top_net_impact,
-- uw_news, uw_oi_change, uw_short_screener, uw_screeners, uw_contract_screener)
-- are intentionally NOT recreated here. This migration only adds tables for
-- endpoints we haven't been hitting at all.
--
-- New endpoints / tables:
--   /api/screener/stocks                       -> uw_screener_stocks
--   /api/market/oi-change                      -> uw_market_oi_change
--   /api/stock/{t}/greek-exposure/strike       -> uw_greek_exposure_strike
--   /api/stock/{t}/greek-exposure/expiry       -> uw_greek_exposure_expiry
--   /api/stock/{t}/greek-flow                  -> uw_greek_flow
--   /api/lit-flow/recent                       -> uw_lit_flow_recent
--   /api/lit-flow/{ticker}                     -> uw_lit_flow_ticker
--   /api/darkpool/recent                       -> uw_darkpool_recent
--   /api/news/headlines (global, no ticker)    -> uw_news_global

BEGIN;

-- ----------------------------------------------------------------------------
-- Stock screener — UW's pre-ranked list of stocks with unusual activity.
-- Primary universe seed for /explosive scoring.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_screener_stocks (
    snapshot_ts         TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    rank                INTEGER,
    last_price          DOUBLE PRECISION,
    pct_change          DOUBLE PRECISION,
    volume              BIGINT,
    avg_volume          BIGINT,
    market_cap          DOUBLE PRECISION,
    iv_rank             DOUBLE PRECISION,
    iv30                DOUBLE PRECISION,
    sector              TEXT,
    call_volume         BIGINT,
    put_volume          BIGINT,
    total_premium       DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_screener_stocks_ts
    ON uw_screener_stocks (snapshot_ts DESC);
CREATE INDEX IF NOT EXISTS idx_uw_screener_stocks_ticker_ts
    ON uw_screener_stocks (ticker, snapshot_ts DESC);

-- ----------------------------------------------------------------------------
-- Market-wide OI change — ranking of tickers by largest open-interest delta.
-- Catches institutional positioning overnight (vs the per-ticker uw_oi_change
-- which we already pull only for known tickers).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_market_oi_change (
    snapshot_ts         TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    rank                INTEGER,
    oi_change           BIGINT,
    oi_change_pct       DOUBLE PRECISION,
    call_oi_change      BIGINT,
    put_oi_change       BIGINT,
    payload             JSONB,
    PRIMARY KEY (snapshot_ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_market_oi_change_ts
    ON uw_market_oi_change (snapshot_ts DESC);

-- ----------------------------------------------------------------------------
-- Per-strike GEX — the actual gamma wall locations. Replaces the
-- coarse "net gamma" rollup in uw_greek_exposure for any signal that
-- needs precise strike-level structure (gamma squeeze detection,
-- pin/release levels, dossier visuals).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_greek_exposure_strike (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    strike              DOUBLE PRECISION NOT NULL,
    call_gex            DOUBLE PRECISION,
    put_gex             DOUBLE PRECISION,
    net_gex             DOUBLE PRECISION,
    call_delta          DOUBLE PRECISION,
    put_delta           DOUBLE PRECISION,
    call_charm          DOUBLE PRECISION,
    put_charm           DOUBLE PRECISION,
    call_vanna          DOUBLE PRECISION,
    put_vanna           DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, strike)
);
CREATE INDEX IF NOT EXISTS idx_gex_strike_ticker_date
    ON uw_greek_exposure_strike (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Per-expiry GEX — which weekly carries the gamma cliff.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_greek_exposure_expiry (
    snapshot_date       DATE NOT NULL,
    ticker              TEXT NOT NULL,
    expiry              DATE NOT NULL,
    dte                 INTEGER,
    call_gex            DOUBLE PRECISION,
    put_gex             DOUBLE PRECISION,
    net_gex             DOUBLE PRECISION,
    call_delta          DOUBLE PRECISION,
    put_delta           DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker, expiry)
);
CREATE INDEX IF NOT EXISTS idx_gex_expiry_ticker_date
    ON uw_greek_exposure_expiry (ticker, snapshot_date DESC);

-- ----------------------------------------------------------------------------
-- Greek flow — intraday accumulation of net greek exposure as flow comes in.
-- Captures *change* not snapshot: lets the scorer notice "gamma just shifted
-- hard short above spot" in real time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_greek_flow (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    net_delta_flow      DOUBLE PRECISION,
    net_gamma_flow      DOUBLE PRECISION,
    net_vega_flow       DOUBLE PRECISION,
    net_theta_flow      DOUBLE PRECISION,
    call_delta_flow     DOUBLE PRECISION,
    put_delta_flow      DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_greek_flow_ticker_ts
    ON uw_greek_flow (ticker, ts DESC);

-- ----------------------------------------------------------------------------
-- Lit flow (global) — institutional lit-exchange prints, market-wide ticker
-- by ticker. Complements existing uw_dark_pool_prints (per-ticker dark only).
-- "Lit at-bid" is institutional accumulation; "lit above-ask" is urgency.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_lit_flow_recent (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    price               DOUBLE PRECISION,
    size                BIGINT,
    side                TEXT,                       -- 'bid' | 'ask' | 'mid'
    venue               TEXT,
    trade_id            TEXT,
    payload             JSONB,
    PRIMARY KEY (ts, ticker, trade_id)
);
CREATE INDEX IF NOT EXISTS idx_lit_flow_recent_ts
    ON uw_lit_flow_recent (ts DESC);
CREATE INDEX IF NOT EXISTS idx_lit_flow_recent_ticker
    ON uw_lit_flow_recent (ticker, ts DESC);

-- ----------------------------------------------------------------------------
-- Lit flow (per-ticker) — same shape, indexed for per-ticker lookback.
-- Separate table so we can run the broad recent endpoint on a fast cadence
-- and the per-ticker endpoint only on universe members.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_lit_flow_ticker (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    price               DOUBLE PRECISION,
    size                BIGINT,
    side                TEXT,
    venue               TEXT,
    trade_id            TEXT,
    payload             JSONB,
    PRIMARY KEY (ts, ticker, trade_id)
);
CREATE INDEX IF NOT EXISTS idx_lit_flow_ticker_ticker_ts
    ON uw_lit_flow_ticker (ticker, ts DESC);

-- ----------------------------------------------------------------------------
-- Dark-pool recent (global) — broad off-exchange feed across tickers.
-- We already have per-ticker uw_dark_pool_prints (added in earlier migration);
-- this is the discovery-mode counterpart.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_darkpool_recent (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    price               DOUBLE PRECISION,
    size                BIGINT,
    premium             DOUBLE PRECISION,
    trade_id            TEXT,
    payload             JSONB,
    PRIMARY KEY (ts, ticker, trade_id)
);
CREATE INDEX IF NOT EXISTS idx_darkpool_recent_ts
    ON uw_darkpool_recent (ts DESC);
CREATE INDEX IF NOT EXISTS idx_darkpool_recent_ticker
    ON uw_darkpool_recent (ticker, ts DESC);

-- ----------------------------------------------------------------------------
-- News (global, market-wide feed) — distinct from per-ticker uw_news which
-- requires us to know the ticker first. Used as an event injector: scan for
-- headlines mentioning tickers we don't yet have on our universe.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_news_global (
    published_at        TIMESTAMPTZ NOT NULL,
    article_id          TEXT NOT NULL,
    headline            TEXT,
    source              TEXT,
    url                 TEXT,
    tickers             TEXT[],                     -- extracted by UW
    sentiment           DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (published_at, article_id)
);
CREATE INDEX IF NOT EXISTS idx_news_global_ts
    ON uw_news_global (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_global_tickers
    ON uw_news_global USING GIN (tickers);

COMMIT;
