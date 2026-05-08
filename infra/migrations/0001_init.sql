-- Capital Flow Predictor — initial schema (DESIGN.md §5.3)
-- Idempotent: safe to re-run.
--
-- TimescaleDB is preferred (gives us hypertables for time-series compression
-- and retention policies), but the schema also works on vanilla Postgres at
-- our scale (~50k rows/table). The DO blocks below make TimescaleDB optional
-- so the same migrations run on local Docker (TimescaleDB) and on Railway's
-- managed Postgres (vanilla).

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'TimescaleDB extension not available; using vanilla Postgres tables.';
END $$;

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
DO $$ BEGIN PERFORM create_hypertable('prices_daily', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN NULL; END $$;

-- Macro series (FRED, etc.)
CREATE TABLE IF NOT EXISTS macro_daily (
    ts          TIMESTAMPTZ NOT NULL,
    series_id   TEXT NOT NULL,
    value       DOUBLE PRECISION,
    PRIMARY KEY (ts, series_id)
);
DO $$ BEGIN PERFORM create_hypertable('macro_daily', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN NULL; END $$;

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
DO $$ BEGIN PERFORM create_hypertable('gex_daily', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN NULL; END $$;

-- Computed features (point-in-time)
CREATE TABLE IF NOT EXISTS features_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    feature_set TEXT NOT NULL,
    payload     JSONB NOT NULL,
    PRIMARY KEY (ts, symbol, feature_set)
);
DO $$ BEGIN PERFORM create_hypertable('features_daily', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN NULL; END $$;

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
DO $$ BEGIN PERFORM create_hypertable('predictions', 'run_ts', if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN NULL; END $$;
