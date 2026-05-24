"""Macro — top-down regime view.

GET /v1/macro/current
    Today's composite regime + last 60d of regime history (for trend chart).

GET /v1/macro/series
    Time series of VIX, yield curve, DXY, Fed funds.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["macro"], prefix="/v1/macro")


class RegimePoint(BaseModel):
    asof_date: datetime
    composite_regime: str
    vol_regime: str
    trend_regime: str
    macro_regime: str
    vix_close: float | None
    vix_z_30d: float | None
    yield_curve_2_10: float | None
    dxy_close: float | None
    fed_funds_rate: float | None
    spy_close: float | None


class CurrentRegimeResponse(BaseModel):
    current: RegimePoint | None
    history: list[RegimePoint]


class MacroSeriesPoint(BaseModel):
    ts: datetime
    value: float


class MacroSeriesResponse(BaseModel):
    series_id: str
    points: list[MacroSeriesPoint]


@router.get("/current", response_model=CurrentRegimeResponse)
async def current_regime(days: int = Query(90, ge=1, le=365)) -> CurrentRegimeResponse:
    """Today's composite regime + history. Empty rows when macro_regime hasn't
    been populated yet (delphi-regime job is the writer).

    Earlier version used `CURRENT_DATE - $1` and asyncpg sometimes binds the
    int such that the subtraction fails; the broad except hid the error and
    the UI rendered the "macro_regime is empty" fallback even when 90 days
    of rows existed. Fixed by using INTERVAL with explicit cast and by
    LOGGING the exception instead of silently swallowing it.
    """
    import logging as _l
    pool = get_pool()
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(
                """
                SELECT asof_date::timestamptz AS asof_date, composite_regime,
                       vol_regime, trend_regime, macro_regime,
                       vix_close, vix_z_30d, yield_curve_2_10, dxy_close,
                       fed_funds_rate, spy_close
                FROM macro_regime
                WHERE asof_date >= (CURRENT_DATE - ($1::int || ' days')::interval)::date
                ORDER BY asof_date DESC
                """,
                days,
            )
        except Exception as e:
            _l.getLogger("cfp_api").warning("macro/current query failed: %s", e)
            return CurrentRegimeResponse(current=None, history=[])
    pts = [
        RegimePoint(
            asof_date=r["asof_date"],
            composite_regime=r["composite_regime"],
            vol_regime=r["vol_regime"],
            trend_regime=r["trend_regime"],
            macro_regime=r["macro_regime"],
            vix_close=r["vix_close"],
            vix_z_30d=r["vix_z_30d"],
            yield_curve_2_10=r["yield_curve_2_10"],
            dxy_close=r["dxy_close"],
            fed_funds_rate=r["fed_funds_rate"],
            spy_close=r["spy_close"],
        )
        for r in rows
    ]
    return CurrentRegimeResponse(current=pts[0] if pts else None, history=pts)


@router.get("/series/{series_id}", response_model=MacroSeriesResponse)
async def macro_series(series_id: str, days: int = Query(365, ge=1, le=3650)) -> MacroSeriesResponse:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, value FROM macro_daily
            WHERE series_id = $1 AND ts >= NOW() - ($2::int || ' days')::interval
              AND value IS NOT NULL
            ORDER BY ts ASC
            """,
            series_id, days,
        )
    return MacroSeriesResponse(
        series_id=series_id,
        points=[MacroSeriesPoint(ts=r["ts"], value=float(r["value"])) for r in rows],
    )
