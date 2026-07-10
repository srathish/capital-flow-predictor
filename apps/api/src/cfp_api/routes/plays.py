"""Tracked plays endpoints — the Falcon-style live-plays feed.

Backend for the /plays UI page. Reads from Bellwether's `tracked_plays`
table (SQLite in apps/gex/data + mirrored to Postgres by the tracker),
returns rows shaped as ready-to-render cards.

Endpoints:
  GET /v1/plays/live?ticker=SPXW  — currently open tracked plays
  GET /v1/plays/today?date=YYYY-MM-DD  — all plays for a session (open + closed)
  GET /v1/plays/{play_id}  — single play detail

No mutation endpoints — plays open/close only via the tracker service on
fire-state changes, not via API.
"""

from __future__ import annotations

import json
from datetime import UTC, date as date_t, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

router = APIRouter(tags=["plays"])


class PlayCard(BaseModel):
    """One tracked play, shaped for card rendering."""

    play_id: int
    fire_ts_ms: int
    trading_day: str
    ticker: str
    state: str
    pattern_name: str
    option_symbol: str
    option_type: Literal["put", "call"]
    strike: float
    expiration: str
    spot_at_fire: float
    entry_mark: float
    entry_bid: float | None = None
    entry_ask: float | None = None
    current_mark: float | None = None
    current_ts_ms: int | None = None
    best_mark: float | None = None
    best_mark_ts_ms: int | None = None
    best_pct_gain: float | None = None
    status: str
    close_ts_ms: int | None = None
    close_mark: float | None = None
    close_reason: str | None = None
    supporting_state: dict[str, Any] | None = None


def _row_to_card(row: dict[str, Any]) -> PlayCard:
    ss = row.get("supporting_state")
    if isinstance(ss, str):
        try:
            ss = json.loads(ss)
        except Exception:
            ss = None
    return PlayCard(**{**row, "supporting_state": ss})


@router.get("/v1/plays/live", response_model=list[PlayCard])
async def get_live_plays(
    ticker: str | None = Query(None, description="Filter to one underlying, e.g. SPXW"),
) -> list[PlayCard]:
    """Currently open tracked plays (status='live'), newest fire first."""
    pool = get_pool()
    async with pool.acquire() as conn:
        if ticker:
            rows = await conn.fetch(
                """
                SELECT * FROM tracked_plays
                WHERE status = 'live' AND ticker = $1
                ORDER BY fire_ts_ms DESC
                LIMIT 200
                """,
                ticker,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM tracked_plays
                WHERE status = 'live'
                ORDER BY fire_ts_ms DESC
                LIMIT 200
                """
            )
    return [_row_to_card(dict(r)) for r in rows]


@router.get("/v1/plays/today", response_model=list[PlayCard])
async def get_today_plays(
    trading_date: str | None = Query(
        None, alias="date", description="YYYY-MM-DD, defaults to today (UTC)"
    ),
    ticker: str | None = Query(None),
) -> list[PlayCard]:
    """All plays for a session — open + closed. Feeds the daily "Falcon" board."""
    day = trading_date or datetime.now(UTC).date().isoformat()
    try:
        date_t.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(400, f"invalid date: {day}") from exc

    pool = get_pool()
    async with pool.acquire() as conn:
        if ticker:
            rows = await conn.fetch(
                """
                SELECT * FROM tracked_plays
                WHERE trading_day = $1 AND ticker = $2
                ORDER BY fire_ts_ms DESC
                LIMIT 500
                """,
                day, ticker,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM tracked_plays
                WHERE trading_day = $1
                ORDER BY fire_ts_ms DESC
                LIMIT 500
                """,
                day,
            )
    return [_row_to_card(dict(r)) for r in rows]


@router.get("/v1/plays/{play_id}", response_model=PlayCard)
async def get_play(play_id: int) -> PlayCard:
    """Single-play detail. Used by the card-expanded view + share modal."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM tracked_plays WHERE play_id = $1",
            play_id,
        )
    if row is None:
        raise HTTPException(404, f"play {play_id} not found")
    return _row_to_card(dict(row))


class PlaysSummary(BaseModel):
    trading_day: str
    total: int
    live: int
    closed: int
    best_gain_pct: float | None = None
    avg_best_gain_pct: float | None = None


@router.get("/v1/plays/summary/today", response_model=PlaysSummary)
async def get_today_summary(
    trading_date: str | None = Query(None, alias="date"),
) -> PlaysSummary:
    """Header stats for the Falcon board: N plays, best gain, avg."""
    day = trading_date or datetime.now(UTC).date().isoformat()
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'live') AS live,
              COUNT(*) FILTER (WHERE status != 'live') AS closed,
              MAX(best_pct_gain) AS best_gain_pct,
              AVG(best_pct_gain) AS avg_best_gain_pct
            FROM tracked_plays
            WHERE trading_day = $1
            """,
            day,
        )
    return PlaysSummary(
        trading_day=day,
        total=int(row["total"] or 0),
        live=int(row["live"] or 0),
        closed=int(row["closed"] or 0),
        best_gain_pct=float(row["best_gain_pct"]) if row["best_gain_pct"] is not None else None,
        avg_best_gain_pct=float(row["avg_best_gain_pct"]) if row["avg_best_gain_pct"] is not None else None,
    )
