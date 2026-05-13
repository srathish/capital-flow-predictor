"""Read-only Discord listener.

Logs into Discord using a *user* token (not a bot token), subscribes to
message events across every guild/channel/thread the account is in, filters
against the ``discord_sources`` allowlist (if enabled), and inserts each
captured message into ``discord_messages``.

This is a self-bot. Discord's ToS does not love them. Mitigations:
- read-only: no sends, no reacts, no edits, no joining/leaving
- single connection, default reconnect/backoff from the library
- no scraping of historical messages — we only consume the live gateway
- skip own messages and DMs (we never want to capture private chats)
- token comes from env; never logged

Run with: ``python -m discord_listener.main``
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
from datetime import UTC, datetime, timedelta

import asyncpg
import discord  # provided by discord.py-self

from discord_listener.settings import settings

log = logging.getLogger("discord_listener")


def _setup_logging() -> None:
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )
    # discord.py-self is chatty at INFO; bump it to WARNING.
    logging.getLogger("discord").setLevel(logging.WARNING)


# ---------- DB helpers ----------


async def _open_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(settings.database_url, min_size=1, max_size=4)


async def _load_allowlist(pool: asyncpg.Pool) -> set[tuple[str, str]]:
    """Return {(guild_name, channel_name), ...} of enabled sources.

    The set is lower-cased on both sides so the listener's name comparison is
    case-insensitive — Discord channel names are already lowercase by
    convention but guild names aren't.
    """
    rows = await pool.fetch(
        "SELECT guild_name, channel_name FROM discord_sources WHERE enabled = TRUE"
    )
    return {(r["guild_name"].lower(), r["channel_name"].lower()) for r in rows}


_INSERT_SQL = """
INSERT INTO discord_messages (
    message_id, guild_id, guild_name,
    channel_id, channel_name, thread_id, thread_name,
    author_id, author_name, author_is_bot,
    content, attachment_urls, posted_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13
)
ON CONFLICT (message_id) DO NOTHING
"""


async def _insert_message(pool: asyncpg.Pool, msg: discord.Message) -> bool:
    """Insert a message; returns True if a row was actually written."""
    # Threads in discord.py-self show up as the message's channel — the parent
    # text channel is on .channel.parent. Detect threads via the channel type.
    channel = msg.channel
    if isinstance(channel, discord.Thread):
        parent = channel.parent
        channel_id = parent.id if parent else channel.id
        channel_name = parent.name if parent else channel.name
        thread_id: int | None = channel.id
        thread_name: str | None = channel.name
    else:
        channel_id = channel.id
        channel_name = getattr(channel, "name", "") or ""
        thread_id = None
        thread_name = None

    attachments = [a.url for a in msg.attachments]

    result = await pool.execute(
        _INSERT_SQL,
        msg.id,
        msg.guild.id if msg.guild else 0,
        msg.guild.name if msg.guild else "",
        channel_id,
        channel_name,
        thread_id,
        thread_name,
        msg.author.id,
        str(msg.author),
        bool(msg.author.bot),
        msg.content or "",
        json.dumps(attachments),
        msg.created_at,
    )
    # asyncpg returns "INSERT 0 1" on a real insert, "INSERT 0 0" on conflict.
    return result.endswith(" 1")


# ---------- Discord client ----------


class Listener(discord.Client):
    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__()
        self._pool = pool
        self._allowlist: set[tuple[str, str]] = set()
        self._allowlist_loaded_at: datetime | None = None

    async def _maybe_refresh_allowlist(self) -> None:
        """Reload the allowlist at most every 60s so UI edits propagate
        without restarting the service."""
        now = datetime.now(UTC)
        if (
            self._allowlist_loaded_at is None
            or (now - self._allowlist_loaded_at).total_seconds() > 60
        ):
            self._allowlist = await _load_allowlist(self._pool)
            self._allowlist_loaded_at = now

    def _is_allowed(self, msg: discord.Message) -> bool:
        if msg.guild is None:
            return False  # never capture DMs / group DMs
        if msg.author.id == self.user.id if self.user else False:
            return False  # never capture our own messages
        if not settings.use_source_allowlist:
            return True
        if not self._allowlist:
            # Allowlist mode is on but empty — capture nothing rather than
            # silently fall back to capture-all. Operator can disable
            # allowlist mode via env or add rows to discord_sources.
            return False

        guild = msg.guild.name.lower()
        channel = msg.channel
        # For threads we match on the *parent* channel name; the operator
        # configures sources at the channel level and include_threads is on
        # by default. If we ever want per-thread granularity we add a
        # thread_name column to discord_sources.
        if isinstance(channel, discord.Thread):
            chan_name = (channel.parent.name if channel.parent else channel.name).lower()
        else:
            chan_name = (getattr(channel, "name", "") or "").lower()

        return (guild, chan_name) in self._allowlist

    def _is_too_old(self, msg: discord.Message) -> bool:
        age = datetime.now(UTC) - msg.created_at
        return age > timedelta(seconds=settings.max_message_age_seconds)

    async def on_ready(self) -> None:
        await self._maybe_refresh_allowlist()
        log.info(
            "discord_listener ready as %s — %d guilds, %d sources in allowlist (mode=%s)",
            self.user,
            len(self.guilds),
            len(self._allowlist),
            "allowlist" if settings.use_source_allowlist else "all-channels",
        )

    async def on_message(self, msg: discord.Message) -> None:
        try:
            await self._maybe_refresh_allowlist()
            if self._is_too_old(msg):
                return
            if not self._is_allowed(msg):
                return
            wrote = await _insert_message(self._pool, msg)
            if wrote:
                log.info(
                    "captured %s/#%s msg=%d author=%s len=%d att=%d",
                    msg.guild.name if msg.guild else "?",
                    getattr(msg.channel, "name", "?"),
                    msg.id,
                    msg.author,
                    len(msg.content or ""),
                    len(msg.attachments),
                )
        except Exception:  # noqa: BLE001
            # Don't let one bad message kill the listener.
            log.exception("on_message failed for msg=%s", getattr(msg, "id", "?"))


# ---------- entrypoint ----------


async def _run() -> None:
    _setup_logging()
    if not settings.discord_user_token:
        log.warning("DISCORD_USER_TOKEN is empty — listener disabled, exiting.")
        return

    pool = await _open_pool()
    client = Listener(pool)

    # Graceful shutdown on SIGTERM (Railway sends this on redeploy).
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            # Windows / some restricted envs — fall back to default handling.
            pass

    async def _runner() -> None:
        try:
            await client.start(settings.discord_user_token)
        finally:
            await pool.close()

    runner_task = asyncio.create_task(_runner())
    stop_task = asyncio.create_task(stop.wait())
    done, _pending = await asyncio.wait(
        {runner_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
    )

    if stop_task in done:
        log.info("shutdown signal received, closing discord client")
        await client.close()
        try:
            await runner_task
        except Exception:
            log.exception("runner task ended with exception during shutdown")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
