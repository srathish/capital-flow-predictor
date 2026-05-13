"""GET /v1/watchlist + /v1/watchlist/{sector} — latest watchlist."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from cfp_api.db import get_pool
from cfp_api.schemas import (
    WatchlistItem,
    WatchlistResponse,
    WatchlistSector,
)

router = APIRouter(prefix="/v1/watchlist", tags=["watchlist"])


def _parse_rationale(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"summary": raw}
    return {}


def _normalize_signal(s: str) -> str:
    """Watchlist columns may have stray values from older runs; normalize."""
    if s in {"long", "short", "avoid"}:
        return s
    return "avoid"


@router.get("", response_model=WatchlistResponse)
async def get_watchlist() -> WatchlistResponse:
    """Recently-analyzed tickers grouped by sector.

    Source of truth is `agent_signals` (every ticker the ensemble has run on).
    Curated `watchlists` rows enrich rank / target_weight / sector when available;
    otherwise we derive sector from `sector_holdings` and rank within sector by
    PM confidence.
    """
    pool = get_pool()
    sql = """
        WITH pm_latest AS (
            SELECT DISTINCT ON (ticker)
                ticker, run_ts, signal, confidence, rationale
            FROM agent_signals
            WHERE agent = 'portfolio_manager'
              AND run_ts > NOW() - INTERVAL '90 days'
            ORDER BY ticker, run_ts DESC
        ),
        wl_latest AS (
            SELECT DISTINCT ON (ticker)
                ticker, sector, rank, final_signal, target_weight
            FROM watchlists
            ORDER BY ticker, run_ts DESC
        ),
        sector_of AS (
            SELECT DISTINCT ON (constituent)
                constituent AS ticker, sector_etf AS sector
            FROM sector_holdings
            ORDER BY constituent, weight DESC NULLS LAST
        ),
        merged AS (
            SELECT
                pm.ticker,
                pm.run_ts,
                COALESCE(wl.sector, sof.sector, 'UNCLASSIFIED') AS sector,
                wl.rank AS wl_rank,
                COALESCE(
                    wl.final_signal,
                    CASE pm.signal
                        WHEN 'bullish' THEN 'long'
                        WHEN 'bearish' THEN 'short'
                        ELSE 'avoid'
                    END
                ) AS final_signal,
                pm.confidence AS final_confidence,
                wl.target_weight,
                pm.rationale
            FROM pm_latest pm
            LEFT JOIN wl_latest wl USING (ticker)
            LEFT JOIN sector_of sof USING (ticker)
        )
        SELECT
            ticker, run_ts, sector,
            COALESCE(
                wl_rank,
                ROW_NUMBER() OVER (
                    PARTITION BY sector
                    ORDER BY final_confidence DESC NULLS LAST, ticker ASC
                )
            ) AS rank,
            final_signal, final_confidence, target_weight, rationale
        FROM merged
        ORDER BY sector, rank
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)

    if not rows:
        raise HTTPException(status_code=404, detail="No analyzed tickers yet")

    by_sector: dict[str, list[WatchlistItem]] = defaultdict(list)
    run_ts = max(r["run_ts"] for r in rows)
    for r in rows:
        by_sector[r["sector"]].append(
            WatchlistItem(
                rank=int(r["rank"]),
                ticker=r["ticker"],
                final_signal=_normalize_signal(r["final_signal"]),  # type: ignore[arg-type]
                final_confidence=float(r["final_confidence"] or 0.0),
                target_weight=float(r["target_weight"]) if r["target_weight"] is not None else None,
                rationale=_parse_rationale(r["rationale"]),
            )
        )

    return WatchlistResponse(
        run_ts=run_ts,
        sectors=[WatchlistSector(sector=s, items=items) for s, items in by_sector.items()],
    )


@router.get("/{sector}", response_model=WatchlistSector)
async def get_watchlist_sector(sector: str) -> WatchlistSector:
    """One sector's recently-analyzed tickers (same merge as the top-level route)."""
    pool = get_pool()
    sector = sector.upper()
    sql = """
        WITH pm_latest AS (
            SELECT DISTINCT ON (ticker)
                ticker, run_ts, signal, confidence, rationale
            FROM agent_signals
            WHERE agent = 'portfolio_manager'
              AND run_ts > NOW() - INTERVAL '90 days'
            ORDER BY ticker, run_ts DESC
        ),
        wl_latest AS (
            SELECT DISTINCT ON (ticker)
                ticker, sector, rank, final_signal, target_weight
            FROM watchlists
            ORDER BY ticker, run_ts DESC
        ),
        sector_of AS (
            SELECT DISTINCT ON (constituent)
                constituent AS ticker, sector_etf AS sector
            FROM sector_holdings
            ORDER BY constituent, weight DESC NULLS LAST
        ),
        merged AS (
            SELECT
                pm.ticker,
                COALESCE(wl.sector, sof.sector, 'UNCLASSIFIED') AS sector,
                wl.rank AS wl_rank,
                COALESCE(
                    wl.final_signal,
                    CASE pm.signal
                        WHEN 'bullish' THEN 'long'
                        WHEN 'bearish' THEN 'short'
                        ELSE 'avoid'
                    END
                ) AS final_signal,
                pm.confidence AS final_confidence,
                wl.target_weight,
                pm.rationale
            FROM pm_latest pm
            LEFT JOIN wl_latest wl USING (ticker)
            LEFT JOIN sector_of sof USING (ticker)
        )
        SELECT
            ticker,
            COALESCE(
                wl_rank,
                ROW_NUMBER() OVER (
                    ORDER BY final_confidence DESC NULLS LAST, ticker ASC
                )
            ) AS rank,
            final_signal, final_confidence, target_weight, rationale
        FROM merged
        WHERE sector = $1
        ORDER BY rank
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, sector)

    if not rows:
        raise HTTPException(status_code=404, detail=f"No analyzed tickers for sector {sector}")

    return WatchlistSector(
        sector=sector,
        items=[
            WatchlistItem(
                rank=int(r["rank"]),
                ticker=r["ticker"],
                final_signal=_normalize_signal(r["final_signal"]),  # type: ignore[arg-type]
                final_confidence=float(r["final_confidence"] or 0.0),
                target_weight=float(r["target_weight"]) if r["target_weight"] is not None else None,
                rationale=_parse_rationale(r["rationale"]),
            )
            for r in rows
        ],
    )


# ---------- Custom (user-defined) watchlist ----------
#
# Session-keyed for now: client generates a UUID, sends it via the
# X-Session-Id header. Trivial to switch to a real user_id when auth lands —
# the table key is just renamed.


class CustomWatchlistEntry(BaseModel):
    ticker: str
    note: str | None = None
    added_at: datetime


class CustomWatchlistResponse(BaseModel):
    session_id: str
    entries: list[CustomWatchlistEntry]


class AddTickerRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=12)
    note: str | None = Field(default=None, max_length=200)


def _validate_session_id(session_id: str | None) -> str:
    if not session_id or not (8 <= len(session_id) <= 64):
        raise HTTPException(status_code=400, detail="X-Session-Id header required (8-64 chars)")
    return session_id


@router.get("/custom/list", response_model=CustomWatchlistResponse)
async def list_custom_watchlist(
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
) -> CustomWatchlistResponse:
    sid = _validate_session_id(x_session_id)
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ticker, note, added_at FROM custom_watchlist
            WHERE session_id = $1 ORDER BY added_at DESC
            """,
            sid,
        )
    return CustomWatchlistResponse(
        session_id=sid,
        entries=[
            CustomWatchlistEntry(ticker=r["ticker"], note=r["note"], added_at=r["added_at"])
            for r in rows
        ],
    )


@router.post("/custom/add", response_model=CustomWatchlistResponse, status_code=201)
async def add_to_custom_watchlist(
    body: AddTickerRequest,
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
) -> CustomWatchlistResponse:
    sid = _validate_session_id(x_session_id)
    ticker = body.ticker.strip().upper()
    if not ticker.isalpha() or len(ticker) > 12:
        raise HTTPException(status_code=400, detail="invalid ticker")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO custom_watchlist (session_id, ticker, note)
            VALUES ($1, $2, $3)
            ON CONFLICT (session_id, ticker) DO UPDATE SET note = EXCLUDED.note
            """,
            sid, ticker, body.note,
        )
    return await list_custom_watchlist(x_session_id=x_session_id)


@router.delete("/custom/{ticker}", response_model=CustomWatchlistResponse)
async def remove_from_custom_watchlist(
    ticker: str,
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
) -> CustomWatchlistResponse:
    sid = _validate_session_id(x_session_id)
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM custom_watchlist WHERE session_id = $1 AND ticker = $2",
            sid, ticker.upper(),
        )
    return await list_custom_watchlist(x_session_id=x_session_id)
