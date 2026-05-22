"""Intraday 1-minute spot-GEX feed.

Reads from uw_spot_gex_intraday (migration 0029), populated by
`cfp-jobs spot-gex-ingest`. Two endpoints:

  GET /v1/gex/spot/{ticker}?day=YYYY-MM-DD
    Today's full 1-min series for the ticker (or `day` if provided). Returns
    the underlying price + gamma/delta/charm/vanna time-series so the FE can
    overlay GEX on the price chart.

  GET /v1/gex/spot/{ticker}/latest
    Just the most recent minute bar — useful for live dashboards.

The /apps/gex Heatseeker monitor stays the source of truth for SPY/QQQ/SPX
sub-second polling. This is the per-ticker layer for everything else (any
ticker with an /explosive score has UW spot-GEX populated).
"""

from __future__ import annotations

import logging
from datetime import date as date_t, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/gex", tags=["gex-intraday"])


class SpotGexBar(BaseModel):
    ts: datetime
    underlying_price: float | None
    total_gamma: float | None
    total_delta: float | None
    total_charm: float | None
    total_vanna: float | None
    call_gamma: float | None
    put_gamma: float | None


class SpotGexSeriesResponse(BaseModel):
    ticker: str
    day: date_t
    bar_count: int
    bars: list[SpotGexBar]


class SpotGexLatestResponse(BaseModel):
    ticker: str
    bar: SpotGexBar | None
    minutes_stale: float | None


def _bar(r: Any) -> SpotGexBar:
    return SpotGexBar(
        ts=r["ts"],
        underlying_price=r["underlying_price"],
        total_gamma=r["total_gamma"],
        total_delta=r["total_delta"],
        total_charm=r["total_charm"],
        total_vanna=r["total_vanna"],
        call_gamma=r["call_gamma"],
        put_gamma=r["put_gamma"],
    )


@router.get("/spot/{ticker}", response_model=SpotGexSeriesResponse)
async def spot_gex_series(
    ticker: str,
    day: date_t | None = Query(None, description="Defaults to today (UTC)."),
) -> SpotGexSeriesResponse:
    pool = get_pool()
    sym = ticker.upper().strip()
    d = day or datetime.now().date()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, underlying_price,
                   total_gamma, total_delta, total_charm, total_vanna,
                   call_gamma, put_gamma
            FROM uw_spot_gex_intraday
            WHERE ticker = $1 AND ts::date = $2
            ORDER BY ts ASC
            """,
            sym,
            d,
        )
    return SpotGexSeriesResponse(
        ticker=sym, day=d, bar_count=len(rows), bars=[_bar(r) for r in rows]
    )


@router.get("/spot/{ticker}/latest", response_model=SpotGexLatestResponse)
async def spot_gex_latest(ticker: str) -> SpotGexLatestResponse:
    pool = get_pool()
    sym = ticker.upper().strip()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT ts, underlying_price,
                   total_gamma, total_delta, total_charm, total_vanna,
                   call_gamma, put_gamma
            FROM uw_spot_gex_intraday
            WHERE ticker = $1
            ORDER BY ts DESC
            LIMIT 1
            """,
            sym,
        )
    if not row:
        return SpotGexLatestResponse(ticker=sym, bar=None, minutes_stale=None)
    age = (datetime.now(row["ts"].tzinfo) - row["ts"]).total_seconds() / 60.0
    return SpotGexLatestResponse(ticker=sym, bar=_bar(row), minutes_stale=age)
