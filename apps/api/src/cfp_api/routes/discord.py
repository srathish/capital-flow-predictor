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
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/discord", tags=["discord"])


# ---------- response models ----------


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

    messages = [
        DiscordMessage(
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
            # attachment_urls comes back from asyncpg as a JSON string when the
            # column is jsonb without a custom codec — decode defensively.
            attachment_urls=_coerce_urls(r["attachment_urls"]),
            posted_at=r["posted_at"],
        )
        for r in rows
    ]

    total_row = await pool.fetchrow("SELECT COUNT(*) AS n FROM discord_messages")
    return DiscordMessagesResponse(messages=messages, total=total_row["n"] if total_row else 0)


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
