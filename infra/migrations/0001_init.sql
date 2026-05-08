-- Capital Flow Predictor — initial schema (DESIGN.md §5.3)
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw OHLCV
CREATE TABLE IF NOT EXISTS prices_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    open        DOUBLE PRECISION,
    high        DOUBLE PRECISION,
    low         DOUBLE PRECISION,
    close       DOUBLE PRECISION,
    volume      BIGINT,
    source      TEXT NOT NULL,
    PRIMARY KEY (ts, symbol, source)
);
SELECT create_hypertable('prices_daily', 'ts', if_not_exists => TRUE);

-- Macro series (FRED, etc.)
CREATE TABLE IF NOT EXISTS macro_daily (
    ts          TIMESTAMPTZ NOT NULL,
    series_id   TEXT NOT NULL,
    value       DOUBLE PRECISION,
    PRIMARY KEY (ts, series_id)
);
SELECT create_hypertable('macro_daily', 'ts', if_not_exists => TRUE);

-- ETF flows (weekly cadence — not a hypertable)
CREATE TABLE IF NOT EXISTS etf_flows_weekly (
    week_end    DATE NOT NULL,
    symbol      TEXT NOT NULL,
    net_flow    DOUBLE PRECISION,
    aum         DOUBLE PRECISION,
    PRIMARY KEY (week_end, symbol)
);

-- Heatseeker-derived GEX features
CREATE TABLE IF NOT EXISTS gex_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    total_gex   DOUBLE PRECISION,
    flip_level  DOUBLE PRECISION,
    call_wall   DOUBLE PRECISION,
    put_wall    DOUBLE PRECISION,
    PRIMARY KEY (ts, symbol)
);
SELECT create_hypertable('gex_daily', 'ts', if_not_exists => TRUE);

-- Computed features (point-in-time)
CREATE TABLE IF NOT EXISTS features_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    feature_set TEXT NOT NULL,
    payload     JSONB NOT NULL,
    PRIMARY KEY (ts, symbol, feature_set)
);
SELECT create_hypertable('features_daily', 'ts', if_not_exists => TRUE);

-- Predictions
CREATE TABLE IF NOT EXISTS predictions (
    run_ts      TIMESTAMPTZ NOT NULL,
    target_ts   TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    horizon_d   INT NOT NULL,
    model       TEXT NOT NULL,
    rank        INT,
    score       DOUBLE PRECISION,
    confidence  DOUBLE PRECISION,
    explanation JSONB,
    PRIMARY KEY (run_ts, target_ts, symbol, horizon_d, model)
);
SELECT create_hypertable('predictions', 'run_ts', if_not_exists => TRUE);
