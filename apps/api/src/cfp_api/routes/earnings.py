"""Earnings Radar — upcoming earnings + IV/max-pain context + Delphi take.

GET /v1/earnings/upcoming
    Next N days of earnings with expected move, IV rank, max-pain distance,
    historical 1d post-earnings move, and (when available) Delphi's pre-
    earnings prediction for the report-date horizon.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["earnings"], prefix="/v1/earnings")


class EarningsRow(BaseModel):
    ticker: str
    report_date: datetime
    report_time: str | None
    expected_move: float | None
    expected_move_perc: float | None
    iv_rank: float | None
    iv30: float | None
    spot: float | None
    max_pain_distance: float | None
    avg_post_earnings_1d: float | None
    delphi_probability: float | None
    delphi_bias: str | None
    delphi_target_low: float | None
    delphi_target_high: float | None


@router.get("/upcoming", response_model=list[EarningsRow])
async def upcoming(days: int = Query(30, ge=1, le=120), limit: int = Query(50, ge=1, le=500)) -> list[EarningsRow]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH e AS (
                SELECT ticker, report_date, report_time, expected_move, expected_move_perc
                FROM uw_earnings
                WHERE report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1::int)
            ),
            hist AS (
                SELECT ticker, AVG(post_earnings_move_1d) AS avg_pe_1d
                FROM uw_earnings
                WHERE post_earnings_move_1d IS NOT NULL
                GROUP BY ticker
            ),
            f AS (
                SELECT DISTINCT ON (ticker) ticker, spot_price, iv_rank, iv30, max_pain_distance
                FROM delphi_features
                ORDER BY ticker, snapshot_ts DESC
            ),
            d AS (
                SELECT DISTINCT ON (ticker) ticker, probability, bias,
                       target_range_low, target_range_high, forecast_horizon
                FROM delphi_predictions
                WHERE forecast_horizon IN ('1w', '1mo')
                  AND model_version IN ('v0.2-features', 'v0.1-rules')
                ORDER BY ticker, created_at DESC
            )
            SELECT e.ticker, e.report_date, e.report_time,
                   e.expected_move, e.expected_move_perc,
                   f.iv_rank, f.iv30, f.spot_price, f.max_pain_distance,
                   hist.avg_pe_1d,
                   d.probability, d.bias, d.target_range_low, d.target_range_high
            FROM e
            LEFT JOIN hist USING (ticker)
            LEFT JOIN f    USING (ticker)
            LEFT JOIN d    USING (ticker)
            ORDER BY e.report_date ASC, e.ticker ASC
            LIMIT $2
            """,
            days, limit,
        )
    return [
        EarningsRow(
            ticker=r["ticker"],
            report_date=datetime.combine(r["report_date"], datetime.min.time()),
            report_time=r["report_time"],
            expected_move=r["expected_move"],
            expected_move_perc=r["expected_move_perc"],
            iv_rank=r["iv_rank"],
            iv30=r["iv30"],
            spot=r["spot_price"],
            max_pain_distance=r["max_pain_distance"],
            avg_post_earnings_1d=r["avg_pe_1d"],
            delphi_probability=r["probability"],
            delphi_bias=r["bias"],
            delphi_target_low=r["target_range_low"],
            delphi_target_high=r["target_range_high"],
        )
        for r in rows
    ]
