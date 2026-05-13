-- Discord inventory — what the listener can see.
--
-- The API process isn't connected to Discord; only the listener is. So when
-- the dashboard wants to render a "pick a server / pick a channel" dropdown,
-- it needs that info mirrored into Postgres. The listener owns this table:
--   - full refresh on on_ready
--   - incremental updates on guild_join / guild_remove / channel_create /
--     channel_update / channel_delete
--
-- We only store *text-like* channels (regular text channels + threads). DM
-- channels and voice channels are never written here — voice has no
-- messages, DMs we'd never capture anyway.

CREATE TABLE IF NOT EXISTS discord_inventory (
    channel_id        BIGINT PRIMARY KEY,
    guild_id          BIGINT NOT NULL,
    guild_name        TEXT NOT NULL,
    channel_name      TEXT NOT NULL,
    parent_channel_id BIGINT,                    -- non-null for threads
    is_thread         BOOLEAN NOT NULL DEFAULT FALSE,
    refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discord_inventory_guild
    ON discord_inventory (guild_id, channel_name);
