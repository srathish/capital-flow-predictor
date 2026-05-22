-- 0038_confluence.sql
--
-- Cross-tab confluence cache.
--
-- One row per ticker, lazily materialized on demand by /v1/confluence/{T}
-- and refreshed when older than the API's TTL (default 15 min). The API
-- does all the source-table joining; this table is just the cache + the
-- shape the UI reads from.
--
-- Sources (subject to threshold cutoffs in the API):
--   explosive          — explosive_scores.score >= 70
--   delphi             — ticker in latest top-10 by delphi_score (any horizon)
--   whale              — whale_conviction_signals.score >= 70 in last 4h
--   reddit_mentions    — top 20 by spike_ratio in last 6h
--   reddit_catalysts   — >=1 post with catalyst_score >= 0.10 in last 24h
--   flow               — uw_flow_alert with total_premium >= 1M in last 4h
--
-- Schema is intentionally narrow: the source detail is denormalized into a
-- JSONB array so the UI can render the expandable source list without a
-- second round-trip. Counts + max score live as plain columns so the
-- screener page can rank without parsing JSONB.

BEGIN;

CREATE TABLE IF NOT EXISTS confluence_signals (
    ticker              TEXT PRIMARY KEY,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    n_sources           INTEGER NOT NULL DEFAULT 0,
    max_source_score    DOUBLE PRECISION,
    sources             JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary             TEXT
);

CREATE INDEX IF NOT EXISTS idx_confluence_n
    ON confluence_signals (n_sources DESC, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_confluence_freshness
    ON confluence_signals (computed_at DESC);

COMMIT;
