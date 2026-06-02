-- Talon v2 scanner — separate table from v1 (talon_scans) so the two scanner
-- generations don't interleave. v2 adds chart-structure signals (ATR, volume
-- contraction, MA position, coiled_score) on top of v1's flow gates, plus
-- theme-level aggregation for "coiled basket" detection.
--
-- One row per v2 scan. The full payload (v1 actionable + watchlist + the new
-- coiled_setups tier + themes_summary) lives in result_json. Headline counters
-- mirror the v1 table for symmetry.

CREATE TABLE IF NOT EXISTS talon2_scans (
    v2_scan_id         TEXT PRIMARY KEY,           -- 12-char hex from uuid4
    scan_date          DATE NOT NULL,
    started_at         TIMESTAMPTZ NOT NULL,
    completed_at       TIMESTAMPTZ NOT NULL,
    elapsed_seconds    DOUBLE PRECISION NOT NULL,
    universe_total     INTEGER NOT NULL,
    with_gex_data      INTEGER NOT NULL,
    actionable_count   INTEGER NOT NULL,
    watchlist_count    INTEGER NOT NULL,
    coiled_count       INTEGER NOT NULL DEFAULT 0,
    result_json        JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS talon2_scans_completed_at_idx
    ON talon2_scans (completed_at DESC);

CREATE INDEX IF NOT EXISTS talon2_scans_scan_date_idx
    ON talon2_scans (scan_date);
