"""Institutional flow & ownership feed.

Reads tables from migration 0030 populated by `cfp-jobs institutional-ingest`.

  GET /v1/institutional/{ticker}
    Per-ticker rollup: latest ownership, recent 13F activity, insider buy/sell
    aggregates. The view the /explosive drilldown surfaces as a confirmation
    panel.

  GET /v1/institutional/screener/net-buyers?days=N
    Top tickers by net 13F adds over the last N days. Standalone smart-money
    screener for the /flow tab.

  GET /v1/institutional/activity/recent
    Firehose of recent institutional activity (paginated).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/institutional", tags=["institutional"])


class OwnershipSnapshot(BaseModel):
    snapshot_date: date
    institutional_pct: float | None
    insider_pct: float | None
    float_pct: float | None
    institution_count: int | None
    top_holders: list[dict] = []


class InsiderRollup(BaseModel):
    window_days: int
    buy_count: int | None
    sell_count: int | None
    buy_value_usd: float | None
    sell_value_usd: float | None
    net_value_usd: float | None


class ActivityRow(BaseModel):
    institution_name: str
    ticker: str
    action: str | None
    shares: int | None
    shares_change: int | None
    value_usd: float | None
    filing_date: date | None
    report_date: date | None


class TickerInstitutionalResponse(BaseModel):
    ticker: str
    ownership: OwnershipSnapshot | None
    insider_rollups: list[InsiderRollup]
    recent_activity: list[ActivityRow]


class NetBuyersRow(BaseModel):
    ticker: str
    net_value_usd: float | None
    net_shares_change: int | None
    buyer_count: int


class NetBuyersResponse(BaseModel):
    days: int
    rows: list[NetBuyersRow]


def _ownership(r: Any) -> OwnershipSnapshot:
    th = r["top_holders"]
    return OwnershipSnapshot(
        snapshot_date=r["snapshot_date"],
        institutional_pct=r["institutional_pct"],
        insider_pct=r["insider_pct"],
        float_pct=r["float_pct"],
        institution_count=r["institution_count"],
        top_holders=th if isinstance(th, list) else [],
    )


def _rollup(r: Any) -> InsiderRollup:
    return InsiderRollup(
        window_days=r["window_days"],
        buy_count=r["buy_count"],
        sell_count=r["sell_count"],
        buy_value_usd=r["buy_value_usd"],
        sell_value_usd=r["sell_value_usd"],
        net_value_usd=r["net_value_usd"],
    )


def _activity(r: Any) -> ActivityRow:
    return ActivityRow(
        institution_name=r["institution_name"],
        ticker=r["ticker"],
        action=r["action"],
        shares=r["shares"],
        shares_change=r["shares_change"],
        value_usd=r["value_usd"],
        filing_date=r["filing_date"],
        report_date=r["report_date"],
    )


@router.get("/screener/net-buyers", response_model=NetBuyersResponse)
async def net_buyers(
    days: int = Query(30, ge=1, le=180),
    limit: int = Query(50, ge=1, le=200),
) -> NetBuyersResponse:
    """Tickers with the largest net institutional buying in the last N days.
    Aggregates shares_change across institutions where action is buy / increased / new."""
    pool = get_pool()
    since = datetime.now().date() - timedelta(days=days)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ticker,
                   SUM(COALESCE(value_usd, 0)) AS net_value_usd,
                   SUM(COALESCE(shares_change, 0)) AS net_shares_change,
                   COUNT(DISTINCT institution_name) AS buyer_count
            FROM uw_institution_activity
            WHERE filing_date >= $1
              AND action IN ('buy', 'new', 'increased')
            GROUP BY ticker
            ORDER BY net_value_usd DESC NULLS LAST
            LIMIT $2
            """,
            since,
            limit,
        )
    return NetBuyersResponse(
        days=days,
        rows=[
            NetBuyersRow(
                ticker=r["ticker"],
                net_value_usd=float(r["net_value_usd"]) if r["net_value_usd"] is not None else None,
                net_shares_change=int(r["net_shares_change"]) if r["net_shares_change"] is not None else None,
                buyer_count=int(r["buyer_count"]),
            )
            for r in rows
        ],
    )


@router.get("/activity/recent", response_model=list[ActivityRow])
async def recent_activity(
    days: int = Query(7, ge=1, le=60),
    limit: int = Query(100, ge=1, le=500),
    ticker: str | None = Query(None),
) -> list[ActivityRow]:
    """Firehose of recent institutional activity. Filter by ticker if given."""
    pool = get_pool()
    since = datetime.now().date() - timedelta(days=days)
    async with pool.acquire() as conn:
        if ticker:
            rows = await conn.fetch(
                """
                SELECT institution_name, ticker, action, shares, shares_change,
                       value_usd, filing_date, report_date
                FROM uw_institution_activity
                WHERE ticker = $1 AND filing_date >= $2
                ORDER BY filing_date DESC
                LIMIT $3
                """,
                ticker.upper(),
                since,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT institution_name, ticker, action, shares, shares_change,
                       value_usd, filing_date, report_date
                FROM uw_institution_activity
                WHERE filing_date >= $1
                ORDER BY filing_date DESC
                LIMIT $2
                """,
                since,
                limit,
            )
    return [_activity(r) for r in rows]


@router.get("/{ticker}", response_model=TickerInstitutionalResponse)
async def ticker_institutional(ticker: str) -> TickerInstitutionalResponse:
    """Per-ticker institutional rollup."""
    pool = get_pool()
    sym = ticker.upper().strip()
    async with pool.acquire() as conn:
        own = await conn.fetchrow(
            """
            SELECT snapshot_date, institutional_pct, insider_pct, float_pct,
                   institution_count, top_holders
            FROM uw_stock_ownership
            WHERE ticker = $1
            ORDER BY snapshot_date DESC
            LIMIT 1
            """,
            sym,
        )
        rollups = await conn.fetch(
            """
            SELECT window_days, buy_count, sell_count, buy_value_usd,
                   sell_value_usd, net_value_usd
            FROM uw_stock_insider_buy_sells
            WHERE ticker = $1
              AND snapshot_date = (
                SELECT MAX(snapshot_date) FROM uw_stock_insider_buy_sells WHERE ticker = $1
              )
            ORDER BY window_days
            """,
            sym,
        )
        activity = await conn.fetch(
            """
            SELECT institution_name, ticker, action, shares, shares_change,
                   value_usd, filing_date, report_date
            FROM uw_institution_activity
            WHERE ticker = $1
            ORDER BY filing_date DESC
            LIMIT 25
            """,
            sym,
        )
    return TickerInstitutionalResponse(
        ticker=sym,
        ownership=_ownership(own) if own else None,
        insider_rollups=[_rollup(r) for r in rollups],
        recent_activity=[_activity(r) for r in activity],
    )
