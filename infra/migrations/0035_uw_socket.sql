-- 0035_uw_socket.sql
--
-- Phase C: tables for the WebSocket subscriber service (apps/uw_socket).
-- Only adds tables that aren't already covered by previous migrations.
--
-- Channel → table mapping:
--   flow_alerts     -> uw_flow_alerts                (already exists, 0004)
--   option_trades   -> uw_option_trades_stream       (NEW — the live tape)
--   gex             -> uw_greek_exposure_intraday    (NEW — high-frequency snapshots)
--   market_tide     -> uw_market_tide                (already exists, 0014)
--   trading_halts   -> uw_trading_halts              (NEW)
--
-- The subscriber writes raw events as they arrive. Batched inserts where
-- the volume warrants (option_trades is the firehose; halts are rare).

BEGIN;

-- ----------------------------------------------------------------------------
-- Option trades stream — the live option tape via WebSocket.
-- High write volume; expect 50k-500k rows per session. Time-bucketed
-- index lets the Pulse tape pull "last N minutes" efficiently. Old rows
-- are pruned by a separate retention job (not in this migration).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_option_trades_stream (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    option_symbol       TEXT,
    option_type         TEXT,                       -- 'call' | 'put'
    strike              DOUBLE PRECISION,
    expiry              DATE,
    price               DOUBLE PRECISION,
    size                INTEGER,
    premium             DOUBLE PRECISION,           -- price * size * 100
    bid_at_trade        DOUBLE PRECISION,
    ask_at_trade        DOUBLE PRECISION,
    side                TEXT,                       -- 'bid' | 'ask' | 'mid' | 'between'
    sweep               BOOLEAN DEFAULT FALSE,
    cross_market        BOOLEAN DEFAULT FALSE,
    trade_id            TEXT NOT NULL,
    payload             JSONB,
    PRIMARY KEY (ts, trade_id)
);
CREATE INDEX IF NOT EXISTS idx_option_trades_stream_ticker_ts
    ON uw_option_trades_stream (ticker, ts DESC);
CREATE INDEX IF NOT EXISTS idx_option_trades_stream_ts
    ON uw_option_trades_stream (ts DESC);

-- ----------------------------------------------------------------------------
-- Intraday GEX snapshots from the WebSocket gex channel. Much finer
-- granularity than the per-day uw_greek_exposure rollup; complements
-- uw_spot_gex_intraday (which is a 1-minute poll) by capturing tick-level
-- changes pushed by UW.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_greek_exposure_intraday (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    net_gamma           DOUBLE PRECISION,
    net_delta           DOUBLE PRECISION,
    net_vega            DOUBLE PRECISION,
    net_theta           DOUBLE PRECISION,
    call_gamma          DOUBLE PRECISION,
    put_gamma           DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_gex_intraday_ticker_ts
    ON uw_greek_exposure_intraday (ticker, ts DESC);

-- ----------------------------------------------------------------------------
-- Trading halts — LULD pauses, news pending, regulatory halts. Each halt
-- is a strong real-time event injector: surfaces tickers we don't have on
-- our universe yet.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uw_trading_halts (
    ts                  TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    halt_code           TEXT,                       -- 'LUDP' | 'T1' | 'M' | 'H10' | ...
    halt_reason         TEXT,                       -- human-readable
    market              TEXT,                       -- 'NYSE' | 'NASDAQ' | 'ARCA'
    resumption_ts       TIMESTAMPTZ,                -- NULL until resume event arrives
    resumption_quote_ts TIMESTAMPTZ,
    resumption_trade_ts TIMESTAMPTZ,
    payload             JSONB,
    PRIMARY KEY (ts, ticker, COALESCE(halt_code, ''))
);
CREATE INDEX IF NOT EXISTS idx_trading_halts_ts
    ON uw_trading_halts (ts DESC);
CREATE INDEX IF NOT EXISTS idx_trading_halts_ticker_ts
    ON uw_trading_halts (ticker, ts DESC);

COMMIT;
