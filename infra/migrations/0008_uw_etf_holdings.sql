-- Capital Flow Predictor — Full ETF holdings via Unusual Whales
--
-- Replaces the yfinance top-10 stub with the full constituent list. UW returns
-- per-holding pricing + options sentiment, so the sector detail page can
-- show every name in the ETF sortable by daily return / 5d return / call-put
-- premium ratio / weight, etc.
--
-- Endpoint: /etfs/{etf}/holdings — refresh nightly per sector ETF.

CREATE TABLE IF NOT EXISTS uw_etf_holdings (
    etf                  TEXT NOT NULL,
    ticker               TEXT NOT NULL,
    -- snapshot from UW (most recent close)
    short_name           TEXT,
    sector               TEXT,
    weight               DOUBLE PRECISION,           -- % of ETF
    shares               BIGINT,                     -- held by ETF
    -- price snapshot
    close                DOUBLE PRECISION,
    prev_price           DOUBLE PRECISION,
    open                 DOUBLE PRECISION,
    high                 DOUBLE PRECISION,
    low                  DOUBLE PRECISION,
    volume               BIGINT,
    avg30_volume         DOUBLE PRECISION,
    week52_high          DOUBLE PRECISION,
    week52_low           DOUBLE PRECISION,
    -- options sentiment (one-line summary; full flow stays in uw_flow_alerts)
    call_volume          BIGINT,
    put_volume           BIGINT,
    call_premium         DOUBLE PRECISION,
    put_premium          DOUBLE PRECISION,
    bullish_premium      DOUBLE PRECISION,
    bearish_premium      DOUBLE PRECISION,
    has_options          BOOLEAN,
    -- bookkeeping
    updated              DATE,                       -- UW's `updated` field
    last_fetched         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (etf, ticker)
);

CREATE INDEX IF NOT EXISTS idx_uw_etf_holdings_etf
    ON uw_etf_holdings (etf, weight DESC);
CREATE INDEX IF NOT EXISTS idx_uw_etf_holdings_ticker
    ON uw_etf_holdings (ticker);
