"""Discord alerts feed.

GET  /v1/discord/messages   — recent captured messages, newest first.
                              Filter by guild_name / channel_name / since.
GET  /v1/discord/sources    — configured (guild, channel) allowlist.
POST /v1/discord/sources    — add an entry to the allowlist.
DELETE /v1/discord/sources/{id} — remove an entry.

The ingestion side (apps/discord_listener) writes to discord_messages on its
own; the API only reads from it. Sources, on the other hand, are owned by the
UI — listener reloads the allowlist every 60s.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from cfp_api.db import get_pool
from cfp_api.discord_scoring import (
    TickerScore,
    Verdict,
    extract_tickers,
    score_ticker,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/discord", tags=["discord"])


# ---------- response models ----------


class DiscordTickerScore(BaseModel):
    ticker: str
    # 'bull' | 'bear' | 'neutral' | None (None = no data for that signal)
    flow: str | None
    gex: str | None
    whale: str | None
    reddit: str | None
    cross_chat_count: int       # # distinct guilds mentioning this ticker in last 30min
    bull_count: int
    bear_count: int


class DiscordMessage(BaseModel):
    message_id: str               # snowflakes can exceed JS safe-int range
    guild_id: str
    guild_name: str
    channel_id: str
    channel_name: str
    thread_id: str | None = None
    thread_name: str | None = None
    author_id: str
    author_name: str
    author_is_bot: bool
    content: str
    attachment_urls: list[str]
    posted_at: datetime
    tickers: list[str] = []                       # server-extracted, validated
    scores: list[DiscordTickerScore] = []         # one per ticker
    confluence: int = 0                           # max(bull_count, bear_count) across tickers


class DiscordMessagesResponse(BaseModel):
    messages: list[DiscordMessage]
    total: int


class DiscordSource(BaseModel):
    id: int
    guild_name: str
    channel_name: str
    label: str | None
    include_threads: bool
    enabled: bool
    created_at: datetime


class DiscordSourcesResponse(BaseModel):
    sources: list[DiscordSource]


class DiscordSourceCreate(BaseModel):
    guild_name: str = Field(min_length=1, max_length=128)
    channel_name: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=128)
    include_threads: bool = True


class InventoryChannel(BaseModel):
    channel_id: str
    channel_name: str
    is_thread: bool


class InventoryGuild(BaseModel):
    guild_id: str
    guild_name: str
    channels: list[InventoryChannel]


class DiscordInventoryResponse(BaseModel):
    guilds: list[InventoryGuild]
    refreshed_at: datetime | None


# ---------- routes ----------


@router.get("/messages", response_model=DiscordMessagesResponse)
async def get_messages(
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    since: Annotated[datetime | None, Query()] = None,
    guild_name: Annotated[str | None, Query()] = None,
    channel_name: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(description="case-insensitive substring filter on content")] = None,
) -> DiscordMessagesResponse:
    pool = get_pool()

    where: list[str] = []
    params: list = []
    if since is not None:
        params.append(since)
        where.append(f"posted_at > ${len(params)}")
    if guild_name:
        params.append(guild_name)
        where.append(f"guild_name = ${len(params)}")
    if channel_name:
        params.append(channel_name)
        where.append(f"channel_name = ${len(params)}")
    if q:
        params.append(f"%{q}%")
        where.append(f"content ILIKE ${len(params)}")

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(limit)
    limit_param = f"${len(params)}"

    rows = await pool.fetch(
        f"""
        SELECT message_id, guild_id, guild_name, channel_id, channel_name,
               thread_id, thread_name, author_id, author_name, author_is_bot,
               content, attachment_urls, posted_at
        FROM discord_messages
        {where_sql}
        ORDER BY posted_at DESC
        LIMIT {limit_param}
        """,
        *params,
    )

    # First pass: build base messages and extract tickers per message.
    base: list[tuple[DiscordMessage, list[str]]] = []
    all_tickers: set[str] = set()
    for r in rows:
        msg = DiscordMessage(
            message_id=str(r["message_id"]),
            guild_id=str(r["guild_id"]),
            guild_name=r["guild_name"],
            channel_id=str(r["channel_id"]),
            channel_name=r["channel_name"],
            thread_id=str(r["thread_id"]) if r["thread_id"] is not None else None,
            thread_name=r["thread_name"],
            author_id=str(r["author_id"]),
            author_name=r["author_name"],
            author_is_bot=r["author_is_bot"],
            content=r["content"],
            attachment_urls=_coerce_urls(r["attachment_urls"]),
            posted_at=r["posted_at"],
        )
        tickers = await extract_tickers(pool, msg.content)
        msg.tickers = tickers
        all_tickers.update(tickers)
        base.append((msg, tickers))

    # Cross-server confluence: for each ticker we saw in the result set,
    # count distinct guilds that mentioned it within the last 30 minutes.
    # One query over the recent message window — cheap.
    cross_counts: dict[str, int] = {t: 0 for t in all_tickers}
    if all_tickers:
        cross_counts = await _compute_cross_chat_counts(pool, all_tickers)

    # Score each (message, ticker) pair, using the discord_alert_scores
    # cache when fresh (<10min) and recomputing otherwise.
    scores_by_msg: dict[int, list[DiscordTickerScore]] = {}
    for msg, tickers in base:
        if not tickers:
            scores_by_msg[int(msg.message_id)] = []
            continue
        out: list[DiscordTickerScore] = []
        for t in tickers:
            cached = await _fetch_cached_score(pool, int(msg.message_id), t)
            if cached is None:
                fresh = await score_ticker(pool, t, cross_counts.get(t, 0))
                await _persist_score(pool, int(msg.message_id), fresh)
                out.append(_to_pydantic(fresh))
            else:
                # Refresh cross_chat_count on read (it's recency-sensitive)
                # even when other verdicts are still cached.
                cached.cross_chat_count = cross_counts.get(t, 0)
                out.append(cached)
        scores_by_msg[int(msg.message_id)] = out

    # Finalize messages: attach scores + composite confluence.
    messages: list[DiscordMessage] = []
    for msg, _t in base:
        msg.scores = scores_by_msg[int(msg.message_id)]
        if msg.scores:
            msg.confluence = max(
                max(s.bull_count, s.bear_count) for s in msg.scores
            )
        else:
            msg.confluence = 0
        messages.append(msg)

    total_row = await pool.fetchrow("SELECT COUNT(*) AS n FROM discord_messages")
    return DiscordMessagesResponse(messages=messages, total=total_row["n"] if total_row else 0)


# ---------- scoring cache helpers ----------


_SCORE_TTL_SECONDS = 600  # 10 minutes


async def _fetch_cached_score(
    pool, message_id: int, ticker: str
) -> DiscordTickerScore | None:
    row = await pool.fetchrow(
        """
        SELECT flow_verdict, gex_verdict, whale_verdict, reddit_verdict,
               cross_chat_count, bull_count, bear_count, scored_at
        FROM discord_alert_scores
        WHERE message_id = $1 AND ticker = $2
        """,
        message_id,
        ticker,
    )
    if not row:
        return None
    age = (datetime.now(timezone.utc) - row["scored_at"]).total_seconds()
    if age > _SCORE_TTL_SECONDS:
        return None
    return DiscordTickerScore(
        ticker=ticker,
        flow=row["flow_verdict"],
        gex=row["gex_verdict"],
        whale=row["whale_verdict"],
        reddit=row["reddit_verdict"],
        cross_chat_count=row["cross_chat_count"] or 0,
        bull_count=row["bull_count"],
        bear_count=row["bear_count"],
    )


async def _persist_score(pool, message_id: int, score: TickerScore) -> None:
    await pool.execute(
        """
        INSERT INTO discord_alert_scores
            (message_id, ticker, flow_verdict, gex_verdict, whale_verdict,
             reddit_verdict, cross_chat_count, bull_count, bear_count, scored_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        ON CONFLICT (message_id, ticker) DO UPDATE SET
            flow_verdict = EXCLUDED.flow_verdict,
            gex_verdict = EXCLUDED.gex_verdict,
            whale_verdict = EXCLUDED.whale_verdict,
            reddit_verdict = EXCLUDED.reddit_verdict,
            cross_chat_count = EXCLUDED.cross_chat_count,
            bull_count = EXCLUDED.bull_count,
            bear_count = EXCLUDED.bear_count,
            scored_at = now()
        """,
        message_id,
        score.ticker,
        score.flow,
        score.gex,
        score.whale,
        score.reddit,
        score.cross_chat_count,
        score.bull_count,
        score.bear_count,
    )


def _to_pydantic(s: TickerScore) -> DiscordTickerScore:
    return DiscordTickerScore(
        ticker=s.ticker,
        flow=s.flow,
        gex=s.gex,
        whale=s.whale,
        reddit=s.reddit,
        cross_chat_count=s.cross_chat_count,
        bull_count=s.bull_count,
        bear_count=s.bear_count,
    )


async def _compute_cross_chat_counts(pool, tickers: set[str]) -> dict[str, int]:
    """For each ticker, count distinct guilds whose messages in the last
    30 minutes contained that ticker (cashtag or word boundary). This is
    cheap because we run ONE query per unique ticker mentioning condition.

    We use a tilde-ILIKE pattern that matches either '$XYZ' or word-bounded
    'XYZ' to avoid pulling all messages back into Python."""
    if not tickers:
        return {}
    counts: dict[str, int] = {}
    for t in tickers:
        # \mXYZ\M is Postgres word-boundary regex. ILIKE for the cashtag is
        # fast on a short window.
        row = await pool.fetchrow(
            """
            SELECT COUNT(DISTINCT guild_id) AS n
            FROM discord_messages
            WHERE posted_at > now() - INTERVAL '30 minutes'
              AND (content ~* $1 OR content ILIKE $2)
            """,
            rf"\m{t}\M",
            f"%${t}%",
        )
        counts[t] = int(row["n"] if row else 0)
    return counts


@router.get("/inventory", response_model=DiscordInventoryResponse)
async def get_inventory() -> DiscordInventoryResponse:
    """Servers + channels the listener can currently see.

    Written by apps/discord_listener on connect and on guild/channel events.
    Empty until the listener has connected at least once. Used by the
    /discord/sources UI to render cascading dropdowns instead of free-text.
    """
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT guild_id, guild_name, channel_id, channel_name, is_thread, refreshed_at
        FROM discord_inventory
        ORDER BY guild_name, is_thread, channel_name
        """
    )

    by_guild: dict[int, InventoryGuild] = {}
    refreshed_at: datetime | None = None
    for r in rows:
        if refreshed_at is None or r["refreshed_at"] > refreshed_at:
            refreshed_at = r["refreshed_at"]
        g = by_guild.get(r["guild_id"])
        if g is None:
            g = InventoryGuild(
                guild_id=str(r["guild_id"]),
                guild_name=r["guild_name"],
                channels=[],
            )
            by_guild[r["guild_id"]] = g
        g.channels.append(
            InventoryChannel(
                channel_id=str(r["channel_id"]),
                channel_name=r["channel_name"],
                is_thread=r["is_thread"],
            )
        )

    return DiscordInventoryResponse(
        guilds=list(by_guild.values()), refreshed_at=refreshed_at
    )


@router.get("/sources", response_model=DiscordSourcesResponse)
async def list_sources() -> DiscordSourcesResponse:
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT id, guild_name, channel_name, label, include_threads, enabled, created_at
        FROM discord_sources
        ORDER BY guild_name, channel_name
        """
    )
    return DiscordSourcesResponse(
        sources=[DiscordSource(**dict(r)) for r in rows]
    )


@router.post("/sources", response_model=DiscordSource, status_code=201)
async def add_source(body: DiscordSourceCreate) -> DiscordSource:
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO discord_sources (guild_name, channel_name, label, include_threads)
            VALUES ($1, $2, $3, $4)
            RETURNING id, guild_name, channel_name, label, include_threads, enabled, created_at
            """,
            body.guild_name,
            body.channel_name,
            body.label,
            body.include_threads,
        )
    except Exception as e:  # asyncpg UniqueViolationError surfaces here
        log.warning("add_source failed: %s", e)
        raise HTTPException(status_code=409, detail="source_exists") from e
    return DiscordSource(**dict(row))


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: int) -> None:
    pool = get_pool()
    result = await pool.execute("DELETE FROM discord_sources WHERE id = $1", source_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="source_not_found")


# ---------- helpers ----------


def _coerce_urls(raw) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        # asyncpg without jsonb codec returns the raw JSON string.
        import json
        try:
            parsed = json.loads(raw)
            return [str(x) for x in parsed] if isinstance(parsed, list) else []
        except Exception:
            return []
    return []
