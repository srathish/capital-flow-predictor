"""Trading-halts feed — Phase C surface.

  GET /v1/halts/recent?lookback_minutes=180&limit=50&active_only=false

Reads from uw_trading_halts, written in real time by the uw_socket
subscriber service. Each row is a halt event (with a paired resumption
timestamp if/when it arrived).

Used by the /flow page to render a "live halts" strip — halts are
strong real-time event injectors that often precede news catalysts.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/halts", tags=["halts"])


class HaltItem(BaseModel):
    ts: datetime
    ticker: str
    halt_code: str | None
    halt_reason: str | None
    market: str | None
    resumption_ts: datetime | None
    is_active: bool


class HaltsResponse(BaseModel):
    count: int
    items: list[HaltItem]


@router.get("/recent", response_model=HaltsResponse)
async def recent_halts(
    lookback_minutes: int = Query(180, ge=1, le=1440),
    limit: int = Query(50, ge=1, le=200),
    active_only: bool = Query(
        False,
        description="If true, only return halts that haven't resumed yet.",
    ),
) -> HaltsResponse:
    pool = get_pool()
    sql = """
        SELECT ts, ticker, halt_code, halt_reason, market, resumption_ts
        FROM uw_trading_halts
        WHERE ts >= NOW() - ($1::INTEGER || ' minutes')::INTERVAL
    """
    params: list = [lookback_minutes]
    if active_only:
        sql += " AND resumption_ts IS NULL"
    sql += " ORDER BY ts DESC LIMIT $" + str(len(params) + 1)
    params.append(limit)
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(sql, *params)
        except Exception as e:
            # Table not yet created (pre-migration deploy) or DB error;
            # return empty so the UI degrades gracefully.
            log.warning("recent_halts query failed: %s", e)
            return HaltsResponse(count=0, items=[])

    items = [
        HaltItem(
            ts=r["ts"],
            ticker=r["ticker"],
            # halt_code is NOT NULL in the table (PK) but '' means "unknown" —
            # expose that as None to the client so the UI can hide the chip.
            halt_code=(r["halt_code"] or None),
            halt_reason=r["halt_reason"],
            market=r["market"],
            resumption_ts=r["resumption_ts"],
            is_active=r["resumption_ts"] is None,
        )
        for r in rows
    ]
    return HaltsResponse(count=len(items), items=items)
