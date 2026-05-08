-- Capital Flow Predictor — lead-lag (Granger causality) matrix (DESIGN.md §6.5)
-- Computed monthly across the full universe + cross-asset basket.

CREATE TABLE IF NOT EXISTS lead_lag_matrix (
    computed_ts  TIMESTAMPTZ NOT NULL,
    leader       TEXT NOT NULL,
    follower     TEXT NOT NULL,
    max_lag      INT NOT NULL,
    p_value      DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (computed_ts, leader, follower, max_lag)
);

-- Lookups: "which symbols lead XLE?" — sort by p_value ascending, take top-K.
CREATE INDEX IF NOT EXISTS idx_lead_lag_follower
    ON lead_lag_matrix (follower, computed_ts DESC, p_value);
