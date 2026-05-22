"""Catalyst calendar feed — earnings, dividends, splits, analyst events, macro.

Reads from the tables populated by `cfp-jobs catalysts-ingest`:

  GET /v1/catalysts/today
    Everything happening today + the next pre/post-market session. The
    "what's catalyst-rich tonight" view the /explosive scanner relies on.

  GET /v1/catalysts/upcoming?days=N
    Calendar view across the next N days (default 7).

  GET /v1/catalysts/{ticker}
    Per-ticker catalyst rollup: upcoming earnings, dividends, splits, recent
    analyst actions. Used by the /explosive/{ticker} drilldown.

  GET /v1/catalysts/analyst-events?since=N
    Recent analyst upgrades / downgrades / price-target changes (market-wide
    feed).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/catalysts", tags=["catalysts"])


# ---------- models ---------------------------------------------------------


class EarningsRow(BaseModel):
    ticker: str
    company_name: str | None
    report_date: date
    session: str
    eps_estimate: float | None
    expected_move_pct: float | None
    market_cap: float | None
    sector: str | None


class DividendRow(BaseModel):
    ticker: str
    ex_date: date
    cash_amount: float | None
    frequency: str | None
    yield_percent: float | None


class SplitRow(BaseModel):
    ticker: str
    ex_date: date
    split_ratio: float | None


class AnalystRow(BaseModel):
    ticker: str
    event_date: date
    firm: str
    action: str
    rating_prior: str | None
    rating_new: str | None
    price_target_prior: float | None
    price_target_new: float | None


class EconomicRow(BaseModel):
    event_ts: datetime
    event_name: str
    country: str | None
    importance: str | None
    forecast: str | None
    previous: str | None
    actual: str | None


class CatalystsTodayResponse(BaseModel):
    snapshot_date: date
    earnings_pre: list[EarningsRow]
    earnings_post: list[EarningsRow]
    dividends_ex_today: list[DividendRow]
    splits_ex_today: list[SplitRow]
    analyst_today: list[AnalystRow]
    economic_today: list[EconomicRow]


class CatalystsUpcomingResponse(BaseModel):
    days: int
    earnings: list[EarningsRow]
    dividends: list[DividendRow]
    splits: list[SplitRow]
    economic: list[EconomicRow]


class TickerCatalystsResponse(BaseModel):
    ticker: str
    upcoming_earnings: EarningsRow | None
    upcoming_dividends: list[DividendRow]
    upcoming_splits: list[SplitRow]
    recent_analyst: list[AnalystRow]


# ---------- row mappers ----------------------------------------------------


def _earnings(r: Any) -> EarningsRow:
    return EarningsRow(
        ticker=r["ticker"],
        company_name=r["company_name"],
        report_date=r["report_date"],
        session=r["session"],
        eps_estimate=r["eps_estimate"],
        expected_move_pct=r["expected_move_pct"],
        market_cap=r["market_cap"],
        sector=r["sector"],
    )


def _dividend(r: Any) -> DividendRow:
    return DividendRow(
        ticker=r["ticker"],
        ex_date=r["ex_date"],
        cash_amount=r["cash_amount"],
        frequency=r["frequency"],
        yield_percent=r["yield_percent"],
    )


def _split(r: Any) -> SplitRow:
    return SplitRow(
        ticker=r["ticker"],
        ex_date=r["ex_date"],
        split_ratio=r["split_ratio"],
    )


def _analyst(r: Any) -> AnalystRow:
    return AnalystRow(
        ticker=r["ticker"],
        event_date=r["event_date"],
        firm=r["firm"],
        action=r["action"],
        rating_prior=r["rating_prior"],
        rating_new=r["rating_new"],
        price_target_prior=r["price_target_prior"],
        price_target_new=r["price_target_new"],
    )


def _economic(r: Any) -> EconomicRow:
    return EconomicRow(
        event_ts=r["event_ts"],
        event_name=r["event_name"],
        country=r["country"],
        importance=r["importance"],
        forecast=r["forecast"],
        previous=r["previous"],
        actual=r["actual"],
    )


# ---------- routes ---------------------------------------------------------


@router.get("/today", response_model=CatalystsTodayResponse)
async def catalysts_today() -> CatalystsTodayResponse:
    """Everything catalyst-y happening today."""
    pool = get_pool()
    today = datetime.now().date()
    async with pool.acquire() as conn:
        earnings = await conn.fetch(
            """
            SELECT ticker, company_name, report_date, session, eps_estimate,
                   expected_move_pct, market_cap, sector
            FROM uw_earnings_calendar_daily
            WHERE report_date = $1
            ORDER BY session, market_cap DESC NULLS LAST
            """,
            today,
        )
        divs = await conn.fetch(
            """
            SELECT ticker, ex_date, cash_amount, frequency, yield_percent
            FROM uw_dividends WHERE ex_date = $1 ORDER BY ticker
            """,
            today,
        )
        splits = await conn.fetch(
            "SELECT ticker, ex_date, split_ratio FROM uw_stock_splits WHERE ex_date = $1 ORDER BY ticker",
            today,
        )
        analyst = await conn.fetch(
            """
            SELECT ticker, event_date, firm, action, rating_prior, rating_new,
                   price_target_prior, price_target_new
            FROM uw_analyst_ratings WHERE event_date = $1
            ORDER BY ticker
            """,
            today,
        )
        econ = await conn.fetch(
            """
            SELECT event_ts, event_name, country, importance, forecast, previous, actual
            FROM uw_economic_calendar
            WHERE event_ts::date = $1
            ORDER BY event_ts
            """,
            today,
        )
    return CatalystsTodayResponse(
        snapshot_date=today,
        earnings_pre=[_earnings(r) for r in earnings if r["session"] == "pre"],
        earnings_post=[_earnings(r) for r in earnings if r["session"] == "post"],
        dividends_ex_today=[_dividend(r) for r in divs],
        splits_ex_today=[_split(r) for r in splits],
        analyst_today=[_analyst(r) for r in analyst],
        economic_today=[_economic(r) for r in econ],
    )


@router.get("/upcoming", response_model=CatalystsUpcomingResponse)
async def catalysts_upcoming(
    days: int = Query(7, ge=1, le=30),
) -> CatalystsUpcomingResponse:
    """Calendar across the next N days. Earnings ordered by date+market cap."""
    pool = get_pool()
    today = datetime.now().date()
    horizon = today + timedelta(days=days)
    async with pool.acquire() as conn:
        earnings = await conn.fetch(
            """
            SELECT ticker, company_name, report_date, session, eps_estimate,
                   expected_move_pct, market_cap, sector
            FROM uw_earnings_calendar_daily
            WHERE report_date BETWEEN $1 AND $2
            ORDER BY report_date, session, market_cap DESC NULLS LAST
            """,
            today,
            horizon,
        )
        divs = await conn.fetch(
            """
            SELECT ticker, ex_date, cash_amount, frequency, yield_percent
            FROM uw_dividends WHERE ex_date BETWEEN $1 AND $2 ORDER BY ex_date, ticker
            """,
            today,
            horizon,
        )
        splits = await conn.fetch(
            "SELECT ticker, ex_date, split_ratio FROM uw_stock_splits WHERE ex_date BETWEEN $1 AND $2 ORDER BY ex_date, ticker",
            today,
            horizon,
        )
        econ = await conn.fetch(
            """
            SELECT event_ts, event_name, country, importance, forecast, previous, actual
            FROM uw_economic_calendar
            WHERE event_ts::date BETWEEN $1 AND $2
            ORDER BY event_ts
            """,
            today,
            horizon,
        )
    return CatalystsUpcomingResponse(
        days=days,
        earnings=[_earnings(r) for r in earnings],
        dividends=[_dividend(r) for r in divs],
        splits=[_split(r) for r in splits],
        economic=[_economic(r) for r in econ],
    )


@router.get("/analyst-events", response_model=list[AnalystRow])
async def analyst_events(
    days: int = Query(7, ge=1, le=30),
    ticker: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
) -> list[AnalystRow]:
    """Recent analyst actions, market-wide or for a specific ticker."""
    pool = get_pool()
    since = datetime.now().date() - timedelta(days=days)
    async with pool.acquire() as conn:
        if ticker:
            rows = await conn.fetch(
                """
                SELECT ticker, event_date, firm, action, rating_prior, rating_new,
                       price_target_prior, price_target_new
                FROM uw_analyst_ratings
                WHERE ticker = $1 AND event_date >= $2
                ORDER BY event_date DESC
                LIMIT $3
                """,
                ticker.upper(),
                since,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT ticker, event_date, firm, action, rating_prior, rating_new,
                       price_target_prior, price_target_new
                FROM uw_analyst_ratings
                WHERE event_date >= $1
                ORDER BY event_date DESC
                LIMIT $2
                """,
                since,
                limit,
            )
    return [_analyst(r) for r in rows]


@router.get("/{ticker}", response_model=TickerCatalystsResponse)
async def ticker_catalysts(ticker: str) -> TickerCatalystsResponse:
    """Per-ticker catalyst rollup — what the explosive drilldown surfaces."""
    pool = get_pool()
    sym = ticker.upper().strip()
    today = datetime.now().date()
    async with pool.acquire() as conn:
        ne = await conn.fetchrow(
            """
            SELECT ticker, company_name, report_date, session, eps_estimate,
                   expected_move_pct, market_cap, sector
            FROM uw_earnings_calendar_daily
            WHERE ticker = $1 AND report_date >= $2
            ORDER BY report_date ASC, session ASC
            LIMIT 1
            """,
            sym,
            today,
        )
        divs = await conn.fetch(
            """
            SELECT ticker, ex_date, cash_amount, frequency, yield_percent
            FROM uw_dividends WHERE ticker = $1 AND ex_date >= $2 ORDER BY ex_date LIMIT 4
            """,
            sym,
            today,
        )
        splits = await conn.fetch(
            "SELECT ticker, ex_date, split_ratio FROM uw_stock_splits WHERE ticker = $1 AND ex_date >= $2 ORDER BY ex_date LIMIT 4",
            sym,
            today,
        )
        analyst = await conn.fetch(
            """
            SELECT ticker, event_date, firm, action, rating_prior, rating_new,
                   price_target_prior, price_target_new
            FROM uw_analyst_ratings
            WHERE ticker = $1 AND event_date >= $2
            ORDER BY event_date DESC
            LIMIT 10
            """,
            sym,
            today - timedelta(days=90),
        )
    return TickerCatalystsResponse(
        ticker=sym,
        upcoming_earnings=_earnings(ne) if ne else None,
        upcoming_dividends=[_dividend(r) for r in divs],
        upcoming_splits=[_split(r) for r in splits],
        recent_analyst=[_analyst(r) for r in analyst],
    )
