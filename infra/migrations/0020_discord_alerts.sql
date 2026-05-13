-- Discord alerts ingestion — read-only self-bot mirrors messages from the
-- operator's joined servers/channels into Postgres so the dashboard's
-- "Discord Alerts" tab can show every play in one feed instead of forcing
-- a context-switch across 5+ chats.
--
-- Two tables:
--   discord_sources   — allowlist of (guild, channel) the listener captures.
--                       If empty, the listener captures every channel it can
--                       see (handy for discovery; tighten via UI/SQL later).
--   discord_messages  — captured messages + attachment URLs. Plain text only
--                       (no embeds for now — we explicitly skipped those).
--                       Threads share the parent channel_id and carry their
--                       own thread_id/thread_name so the UI can group them.
--
-- The listener writes here; the API reads. No FK between them because
-- sources are advisory (we don't want a misconfigured source row to drop
-- legitimate messages on the floor).

CREATE TABLE IF NOT EXISTS discord_sources (
    id              BIGSERIAL PRIMARY KEY,
    guild_name      TEXT NOT NULL,
    channel_name    TEXT NOT NULL,
    label           TEXT,                       -- optional UI label override
    include_threads BOOLEAN NOT NULL DEFAULT TRUE,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_name, channel_name)
);

CREATE TABLE IF NOT EXISTS discord_messages (
    message_id      BIGINT PRIMARY KEY,         -- Discord snowflake
    guild_id        BIGINT NOT NULL,
    guild_name      TEXT NOT NULL,
    channel_id      BIGINT NOT NULL,
    channel_name    TEXT NOT NULL,
    thread_id       BIGINT,                     -- null if posted directly in channel
    thread_name     TEXT,
    author_id       BIGINT NOT NULL,
    author_name     TEXT NOT NULL,
    author_is_bot   BOOLEAN NOT NULL DEFAULT FALSE,
    content         TEXT NOT NULL DEFAULT '',
    attachment_urls JSONB NOT NULL DEFAULT '[]'::JSONB,
    posted_at       TIMESTAMPTZ NOT NULL,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discord_messages_posted_at
    ON discord_messages (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_discord_messages_guild_posted
    ON discord_messages (guild_name, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_discord_messages_channel_posted
    ON discord_messages (channel_id, posted_at DESC);
