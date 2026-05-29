-- Talon scanner — persist scan results across restarts so the latest scan
-- survives Railway redeploys and concurrent users see the same data.
--
-- One row per scan. The full ranked output (actionable + watchlist + skipped)
-- lives in `result_json`. Headline counters and metadata are normalized
-- columns for cheap "latest scan" lookups + filter/sort in admin tooling.

CREATE TABLE IF NOT EXISTS talon_scans (
    scan_id            TEXT PRIMARY KEY,           -- 12-char hex from uuid4
    scan_date          DATE NOT NULL,              -- the scan's nominal date
    started_at         TIMESTAMPTZ NOT NULL,
    completed_at       TIMESTAMPTZ NOT NULL,
    elapsed_seconds    DOUBLE PRECISION NOT NULL,
    universe_total     INTEGER NOT NULL,
    with_gex_data      INTEGER NOT NULL,
    actionable_count   INTEGER NOT NULL,
    watchlist_count    INTEGER NOT NULL,
    skip_count         INTEGER NOT NULL,
    result_json        JSONB NOT NULL              -- full payload returned by the API
);

CREATE INDEX IF NOT EXISTS talon_scans_completed_at_idx
    ON talon_scans (completed_at DESC);

CREATE INDEX IF NOT EXISTS talon_scans_scan_date_idx
    ON talon_scans (scan_date);
