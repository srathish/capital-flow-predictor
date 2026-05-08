-- Capital Flow Predictor — single-name layer (Phase 4)
-- Adds the data needed for the agent ensemble (top-down -> bottom-up watchlist).

-- ETF -> constituent stock holdings (refreshed quarterly-ish)
CREATE TABLE IF NOT EXISTS sector_holdings (
    sector_etf    TEXT NOT NULL,
    constituent   TEXT NOT NULL,
    weight        DOUBLE PRECISION,        -- portfolio weight %, may be NULL
    last_updated  TIMESTAMPTZ NOT NULL,
    source        TEXT NOT NULL,           -- 'fmp', 'yfinance'
    PRIMARY KEY (sector_etf, constituent)
);

CREATE INDEX IF NOT EXISTS idx_sector_holdings_constituent
    ON sector_holdings (constituent);

-- Stock fundamentals (income, balance, cash flow, ratios)
-- One row per (ticker, fiscal_period, period_type, metric, source) — flexible "long" schema.
CREATE TABLE IF NOT EXISTS fundamentals (
    ticker         TEXT NOT NULL,
    fiscal_period  DATE NOT NULL,           -- end-of-period date
    period_type    TEXT NOT NULL,           -- 'Q' (quarterly) or 'A' (annual) or 'TTM'
    metric         TEXT NOT NULL,           -- e.g. 'revenue', 'net_income', 'fcf'
    value          DOUBLE PRECISION,
    source         TEXT NOT NULL,           -- 'fmp', 'yfinance'
    last_fetched   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (ticker, fiscal_period, period_type, metric, source)
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_ticker_metric
    ON fundamentals (ticker, metric, fiscal_period DESC);

-- Per-agent signals on individual stocks
CREATE TABLE IF NOT EXISTS agent_signals (
    run_ts      TIMESTAMPTZ NOT NULL,
    ticker      TEXT NOT NULL,
    agent       TEXT NOT NULL,             -- 'buffett', 'druckenmiller', 'technicals', etc.
    signal      TEXT NOT NULL,             -- 'bullish', 'bearish', 'neutral'
    confidence  DOUBLE PRECISION,          -- 0..1
    rationale   TEXT,                      -- short human-readable reason
    payload     JSONB,                     -- agent-specific structured details
    PRIMARY KEY (run_ts, ticker, agent)
);

CREATE INDEX IF NOT EXISTS idx_agent_signals_ticker
    ON agent_signals (ticker, run_ts DESC);

-- Final watchlists per (run, sector, ticker), synthesized by the Portfolio Manager
CREATE TABLE IF NOT EXISTS watchlists (
    run_ts            TIMESTAMPTZ NOT NULL,
    sector            TEXT NOT NULL,
    ticker            TEXT NOT NULL,
    rank              INT NOT NULL,         -- within sector
    final_signal      TEXT NOT NULL,        -- 'long', 'short', 'avoid'
    final_confidence  DOUBLE PRECISION,
    target_weight     DOUBLE PRECISION,     -- from RiskManager
    rationale         JSONB,                -- per-agent breakdown
    PRIMARY KEY (run_ts, sector, ticker)
);

CREATE INDEX IF NOT EXISTS idx_watchlists_run_sector
    ON watchlists (run_ts DESC, sector, rank);
