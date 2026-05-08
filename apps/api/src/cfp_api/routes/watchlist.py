"""GET /v1/watchlist + /v1/watchlist/{sector} — latest watchlist."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, HTTPException

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
    """Latest watchlist run, grouped by sector."""
    pool = get_pool()
    sql = """
        SELECT run_ts, sector, ticker, rank, final_signal, final_confidence,
               target_weight, rationale
        FROM watchlists
        WHERE run_ts = (SELECT MAX(run_ts) FROM watchlists)
        ORDER BY sector, rank
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)

    if not rows:
        raise HTTPException(status_code=404, detail="No watchlist runs yet")

    by_sector: dict[str, list[WatchlistItem]] = defaultdict(list)
    run_ts = rows[0]["run_ts"]
    for r in rows:
        by_sector[r["sector"]].append(
            WatchlistItem(
                rank=r["rank"],
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
    """One sector's watchlist from the latest run."""
    pool = get_pool()
    sector = sector.upper()
    sql = """
        SELECT ticker, rank, final_signal, final_confidence, target_weight, rationale
        FROM watchlists
        WHERE run_ts = (SELECT MAX(run_ts) FROM watchlists)
          AND sector = $1
        ORDER BY rank
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, sector)

    if not rows:
        raise HTTPException(status_code=404, detail=f"No watchlist entries for sector {sector}")

    return WatchlistSector(
        sector=sector,
        items=[
            WatchlistItem(
                rank=r["rank"],
                ticker=r["ticker"],
                final_signal=_normalize_signal(r["final_signal"]),  # type: ignore[arg-type]
                final_confidence=float(r["final_confidence"] or 0.0),
                target_weight=float(r["target_weight"]) if r["target_weight"] is not None else None,
                rationale=_parse_rationale(r["rationale"]),
            )
            for r in rows
        ],
    )
