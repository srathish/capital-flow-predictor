-- Capital Flow Predictor — Explosive Options Phase 3: drilldown.
-- Adds per-contract history + market-context tables so the
-- /explosive/[ticker] detail page has time-series charts and peer context.
--
-- New UW endpoints wired in this phase:
--   /option-contract/{symbol}/history         -> uw_option_contract_history
--   /option-contract/{symbol}/intraday        -> fetched live (no storage)
--   /option-trades/full-tape                  -> fetched live (no storage)
--   /market/top-net-impact                    -> uw_top_net_impact
--   /market/correlations                      -> uw_correlations

CREATE TABLE IF NOT EXISTS uw_option_contract_history (
    trade_date          DATE NOT NULL,
    option_symbol       TEXT NOT NULL,
    ticker              TEXT NOT NULL,
    open                DOUBLE PRECISION,
    high                DOUBLE PRECISION,
    low                 DOUBLE PRECISION,
    close               DOUBLE PRECISION,
    volume              BIGINT,
    open_interest       BIGINT,
    iv_open             DOUBLE PRECISION,
    iv_close            DOUBLE PRECISION,
    underlying_open     DOUBLE PRECISION,
    underlying_close    DOUBLE PRECISION,
    payload             JSONB,
    PRIMARY KEY (trade_date, option_symbol)
);
CREATE INDEX IF NOT EXISTS idx_uw_option_history_symbol_date
    ON uw_option_contract_history (option_symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_uw_option_history_ticker_date
    ON uw_option_contract_history (ticker, trade_date DESC);

CREATE TABLE IF NOT EXISTS uw_top_net_impact (
    snapshot_ts         TIMESTAMPTZ NOT NULL,
    ticker              TEXT NOT NULL,
    net_delta           DOUBLE PRECISION,
    net_gamma           DOUBLE PRECISION,
    net_premium         DOUBLE PRECISION,
    rank                INTEGER,
    payload             JSONB,
    PRIMARY KEY (snapshot_ts, ticker)
);
CREATE INDEX IF NOT EXISTS idx_uw_top_net_impact_ts
    ON uw_top_net_impact (snapshot_ts DESC, rank);

CREATE TABLE IF NOT EXISTS uw_correlations (
    snapshot_date       DATE NOT NULL,
    ticker_a            TEXT NOT NULL,
    ticker_b            TEXT NOT NULL,
    correlation         DOUBLE PRECISION,
    window_days         INTEGER,
    payload             JSONB,
    PRIMARY KEY (snapshot_date, ticker_a, ticker_b)
);
CREATE INDEX IF NOT EXISTS idx_uw_correlations_a
    ON uw_correlations (ticker_a, snapshot_date DESC, correlation DESC);
