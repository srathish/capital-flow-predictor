-- Capital Flow Predictor — Evidence bundle persistence
--
-- Every agent ensemble run computes one EvidenceBundle (the canonical
-- "this is what every agent saw"). Persisted here so a run can be replayed
-- without re-fetching UW / FMP / yfinance, and so the chat panel can read
-- the same bundle the run computed instead of re-querying Postgres.
--
-- The bundle JSON is the source of truth; columns are denormalized for
-- fast filtering ("show me runs where IREN had earnings within 7 days").

CREATE TABLE IF NOT EXISTS run_evidence (
    run_ts            TIMESTAMPTZ NOT NULL,
    ticker            TEXT NOT NULL,
    schema_version    TEXT NOT NULL,
    bundle            JSONB NOT NULL,
    -- denormalized for filtering / dashboards
    instrument_type   TEXT,
    sector            TEXT,
    next_earnings_date DATE,
    earnings_proximity BOOLEAN,
    PRIMARY KEY (run_ts, ticker)
);

CREATE INDEX IF NOT EXISTS idx_run_evidence_ticker_ts
    ON run_evidence (ticker, run_ts DESC);
