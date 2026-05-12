-- 0017 — Cloud-hosted skylit credential storage.
--
-- gexester now runs on Railway (not the operator's laptop), so the Clerk
-- __client cookie can't live in a local .env anymore — there's no persistent
-- .env on a Railway container that survives a deploy. The cookie has to live
-- in Postgres, which is the only durable shared store between:
--
--   - apps/gex          (the Railway-hosted poller, reads on boot)
--   - cfp-jobs skylit-watch  (the laptop daemon, writes after Discord OAuth)
--   - apps/api          (mediates writes via /v1/skylit/credentials)
--
-- Schema invariants:
--   - Exactly one logical "current" row. We use a single-row table guarded by
--     a constant primary key so an UPSERT semantically replaces the credential
--     rather than appending history. (History lives in skylit_status from 0016
--     which we keep as the audit trail.)
--   - The cookie + session id are stored as text. They're effectively
--     bearer secrets but encryption-at-rest is provided by the Postgres host
--     (Railway encrypts volumes); column-level encryption would require a KMS
--     and the threat model here is "DB compromise" which is already game-over.
--     If we later add a secrets vault we can re-key in place.

CREATE TABLE IF NOT EXISTS skylit_credentials (
    -- Constant primary key — table holds exactly one row by design.
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    client_cookie   TEXT NOT NULL,
    client_uat      TEXT NOT NULL DEFAULT '',
    session_id      TEXT NOT NULL,
    -- When this credential was captured (or last rotated by gexester's
    -- in-process refresh). gexester logs cookie_rotated_at to skylit_status
    -- separately; this column is the canonical "currently-valid since" stamp.
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Who/what wrote the row. Mostly for debugging: 'skylit-watch' for the
    -- laptop daemon, 'gexester-rotate' for in-process cookie rotation.
    source          TEXT NOT NULL DEFAULT 'unknown'
);

-- No additional indexes — single-row table makes lookups O(1) anyway.
