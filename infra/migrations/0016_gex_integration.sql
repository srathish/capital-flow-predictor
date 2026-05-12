-- 0016 — gexester-vexster integration: Discord-feed mirror + skylit.ai auth status.
--
-- Three tables, all owned by the gex feature surface:
--
--   gex_feed              Mirror of every Discord embed posted by gexester.
--                         Lets the Bellwether /gex tab show the same content
--                         as the Discord channel, persisted beyond Discord's
--                         visible window, with structured fields for filtering.
--
--   skylit_status         One-row-ish health log for the Clerk/Heatseeker auth
--                         path. gexester posts to it on every JWT refresh + on
--                         every __client cookie rotation. UI badge reads the
--                         latest row to decide green / yellow / red.
--                         NO secret values stored — metadata + timestamps only.
--                         The actual cookie continues to live in gexester's
--                         local .env (now persisted properly post-Layer-1).
--
--   skylit_reauth_request Queue of UI-initiated "open a browser and re-auth"
--                         triggers. The cfp-jobs skylit-watch daemon on the
--                         operator's laptop long-polls pending rows, launches
--                         Playwright, and marks the row completed when the
--                         new cookie is written to gexester's .env.

CREATE TABLE IF NOT EXISTS gex_feed (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Which gexester script emitted this. One of: brief, monitor, scanner,
    -- decision, structure, other. Lets the UI filter by source.
    source       TEXT NOT NULL,
    -- Discord embed components, kept lossless so the UI can render the same
    -- card the operator saw in Discord. fields is a JSON array of
    -- { name, value, inline } objects matching Discord's schema.
    title        TEXT,
    description  TEXT,
    fields       JSONB NOT NULL DEFAULT '[]'::JSONB,
    color        INTEGER,          -- Discord color int (0xRRGGBB as decimal)
    footer       TEXT,
    -- Tickers this post references (parsed from title/fields when possible).
    -- Lets the UI scope the feed to "everything about SPY today".
    tickers      TEXT[] NOT NULL DEFAULT '{}',
    -- Raw payload the webhook would have sent — kept for debugging and for
    -- future schema changes where we'd want to backfill richer parsing.
    raw          JSONB
);

CREATE INDEX IF NOT EXISTS idx_gex_feed_ts ON gex_feed (ts DESC);
CREATE INDEX IF NOT EXISTS idx_gex_feed_source_ts ON gex_feed (source, ts DESC);
-- GIN on tickers lets `WHERE tickers @> ARRAY['SPY']` use the index.
CREATE INDEX IF NOT EXISTS idx_gex_feed_tickers ON gex_feed USING GIN (tickers);


CREATE TABLE IF NOT EXISTS skylit_status (
    id                  BIGSERIAL PRIMARY KEY,
    posted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Auth method actually being used right now. Mirrors authStatus().method
    -- from gexester: 'clerk-auto-refresh', 'static-jwt', 'none'.
    method              TEXT NOT NULL,
    -- TTL of the cached JWT at the moment of posting. ~60s in practice; near 0
    -- means a refresh is imminent. Below 0 / null means no JWT cached.
    jwt_ttl_seconds     INTEGER,
    -- Wall-clock of the last successful __client cookie rotation. Null until
    -- we see one this process. UI converts to "rotated N ago".
    cookie_rotated_at   TIMESTAMPTZ,
    -- Did the last persistence attempt write the rotated cookie back to .env?
    -- This is the operational signal: persist_ok=false here is the exact
    -- pathology that caused the historical "expires every 1-2 days" symptom.
    persist_ok          BOOLEAN,
    persist_error       TEXT,
    -- Heatseeker SSE connection state: 'open', 'closed', 'reconnecting', 'unknown'.
    sse_state           TEXT,
    -- Free-form note from the poster. Useful for one-off context like
    -- "manual re-auth from UI button".
    note                TEXT
);

CREATE INDEX IF NOT EXISTS idx_skylit_status_posted ON skylit_status (posted_at DESC);


CREATE TABLE IF NOT EXISTS skylit_reauth_request (
    id              BIGSERIAL PRIMARY KEY,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Free-text source: 'ui_button', 'cli', 'scheduled'. Lets us audit who
    -- triggered which re-auth without coupling to a user-id schema.
    requested_by    TEXT NOT NULL DEFAULT 'ui_button',
    -- Lifecycle: pending → in_progress → (completed | failed | cancelled).
    -- Daemon CAS's pending → in_progress to claim a row; the UI never sees
    -- two daemons racing on the same request.
    status          TEXT NOT NULL DEFAULT 'pending',
    claimed_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    -- On completion: human-readable summary of what happened. Failures get
    -- the exception class + first 200 chars of message. Success rows get
    -- something like "Captured session ses_xxx, cookie len 412".
    result          TEXT
);

CREATE INDEX IF NOT EXISTS idx_skylit_reauth_pending
    ON skylit_reauth_request (requested_at)
    WHERE status = 'pending';
