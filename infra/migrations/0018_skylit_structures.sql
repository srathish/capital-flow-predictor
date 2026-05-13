-- 0018 — Skylit / Heatseeker GEX structure snapshots.
--
-- The apps/gex Node service polls Heatseeker for SPY/QQQ/SPX (and any other
-- ticker passed in) every N minutes, runs computeSurface + deriveStructure
-- with --all-expirations, and writes the full term-structure payload here.
-- The Python skylit_bridge reads from this table — no shell-out to Node from
-- the API container.
--
-- One row per (ticker, fetched_at). Latest row wins; the API reads the most
-- recent within an acceptable freshness window (default 15 min RTH).

CREATE TABLE IF NOT EXISTS skylit_structures (
    ticker          TEXT NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL,
    spot            DOUBLE PRECISION,
    expiration      TEXT,                 -- primary (nearest) expiry
    -- The full JSON shape matches what scripts/structure-snapshot.js outputs
    -- with --all-expirations: top-level surface + structure, plus
    -- expiry_views: [{expiration, regime_score, king, floor, ceiling, ...}, ...]
    structure       JSONB NOT NULL,
    PRIMARY KEY (ticker, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_skylit_structures_latest
    ON skylit_structures (ticker, fetched_at DESC);
