"""GET /v1/stocks/screen — ranked stock screener for options-trade candidates.

Joins the agent ensemble's latest portfolio_manager verdict with watchlist
enrichment (target_weight, sector), an IV-rank proxy from uw_flow_alerts,
aggregate open interest from uw_oi_change, and the next earnings event from
uw_earnings. Ranks by:

    composite = confidence × coalesce(iv_rank, 0.5) × √max(open_interest, 1)

UW tables may be empty during early ingestion — the screener degrades to
returning candidates with null IV/OI rather than excluding them. The
`liquidity_ok` flag and `min_oi` filter let callers gate explicitly.
"""

from __future__ import annotations

from datetime import date as date_t
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from cfp_api.db import get_pool
from cfp_api.schemas import (
    ScreenSignal,
    StockScreenItem,
    StockScreenResponse,
)

router = APIRouter(prefix="/v1/stocks", tags=["stocks"])


# Map portfolio_manager's bullish/bearish/neutral to the watchlist long/short/avoid
# vocabulary so we can return a unified `final_signal` whether the ticker came
# from a watchlist run or from the agent table alone.
_PM_TO_WATCHLIST_SIGNAL_SQL = """
    CASE
        WHEN pm.signal = 'bullish' THEN 'long'
        WHEN pm.signal = 'bearish' THEN 'short'
        ELSE 'avoid'
    END
"""


@router.get("/screen", response_model=StockScreenResponse)
async def screen_stocks(
    signal: ScreenSignal = Query(default="long", description="Filter by final signal"),
    min_confidence: float = Query(default=0.5, ge=0.0, le=1.0),
    sector: str | None = Query(default=None, description="Filter to one sector ETF (e.g. XLK)"),
    min_oi: int = Query(default=0, ge=0, description="Open-interest gate (ticker-aggregated)"),
    exclude_earnings_within_days: int = Query(
        default=0,
        ge=0,
        description="If >0, exclude tickers with earnings within this many days",
    ),
    limit: int = Query(default=25, ge=1, le=100),
    lookback_days: int = Query(
        default=30,
        ge=1,
        le=365,
        description="How far back to consider portfolio_manager runs as the universe",
    ),
) -> StockScreenResponse:
    """Rank stocks the agents have analyzed by options-trade attractiveness."""
    pool = get_pool()
    sector_norm = sector.upper() if sector else None

    # The SQL is structured as a sequence of CTEs:
    #   pm_latest    — most-recent portfolio_manager verdict per ticker (the universe)
    #   wl_latest    — most-recent watchlist row per ticker (enrichment)
    #   iv_daily     — per-ticker daily mean IV from uw_flow_alerts (last 90d)
    #   iv_stats     — min/max/latest of iv_daily → IV-rank proxy
    #   oi_latest    — SUM(curr_oi) on each ticker's most-recent uw_oi_change date
    #   earnings_next — soonest future earnings event per ticker
    # The outer SELECT joins all enrichments LEFT, so a ticker with no UW data
    # still ranks (its iv_rank/oi will be null but composite still computes).
    sql = f"""
        WITH pm_latest AS (
            SELECT DISTINCT ON (ticker)
                ticker, run_ts, signal, confidence, rationale
            FROM agent_signals
            WHERE agent = 'portfolio_manager'
              AND run_ts > NOW() - ($1 || ' days')::interval
            ORDER BY ticker, run_ts DESC
        ),
        wl_latest AS (
            SELECT DISTINCT ON (ticker)
                ticker, sector, final_signal, final_confidence, target_weight
            FROM watchlists
            ORDER BY ticker, run_ts DESC
        ),
        iv_daily AS (
            SELECT ticker, created_at::date AS d, AVG(iv_end) AS daily_iv
            FROM uw_flow_alerts
            WHERE iv_end IS NOT NULL
              AND created_at > NOW() - INTERVAL '90 days'
            GROUP BY ticker, created_at::date
        ),
        iv_stats AS (
            SELECT
                ticker,
                MIN(daily_iv) AS iv_min_90d,
                MAX(daily_iv) AS iv_max_90d,
                (
                    SELECT daily_iv FROM iv_daily i2
                    WHERE i2.ticker = i1.ticker
                    ORDER BY d DESC LIMIT 1
                ) AS latest_iv
            FROM iv_daily i1
            GROUP BY ticker
        ),
        oi_latest_date AS (
            SELECT ticker, MAX(curr_date) AS latest_d
            FROM uw_oi_change
            GROUP BY ticker
        ),
        oi_latest AS (
            SELECT o.ticker, SUM(o.curr_oi)::bigint AS total_oi
            FROM uw_oi_change o
            JOIN oi_latest_date m ON m.ticker = o.ticker AND m.latest_d = o.curr_date
            GROUP BY o.ticker
        ),
        earnings_next AS (
            SELECT DISTINCT ON (ticker)
                ticker, report_date, expected_move_perc
            FROM uw_earnings
            WHERE report_date >= CURRENT_DATE
            ORDER BY ticker, report_date ASC
        ),
        joined AS (
            SELECT
                pm.ticker,
                pm.run_ts AS pm_run_ts,
                pm.rationale,
                wl.sector AS wl_sector,
                COALESCE(wl.final_signal, {_PM_TO_WATCHLIST_SIGNAL_SQL}) AS final_signal,
                COALESCE(wl.final_confidence, pm.confidence) AS confidence,
                wl.target_weight,
                CASE
                    WHEN iv.iv_max_90d IS NOT NULL
                     AND iv.iv_min_90d IS NOT NULL
                     AND iv.iv_max_90d > iv.iv_min_90d
                    THEN (iv.latest_iv - iv.iv_min_90d) / (iv.iv_max_90d - iv.iv_min_90d)
                    ELSE NULL
                END AS iv_rank,
                iv.latest_iv,
                oi.total_oi,
                en.report_date AS next_earnings_date,
                en.expected_move_perc
            FROM pm_latest pm
            LEFT JOIN wl_latest wl ON wl.ticker = pm.ticker
            LEFT JOIN iv_stats iv ON iv.ticker = pm.ticker
            LEFT JOIN oi_latest oi ON oi.ticker = pm.ticker
            LEFT JOIN earnings_next en ON en.ticker = pm.ticker
        )
        SELECT
            ticker,
            pm_run_ts,
            rationale,
            wl_sector,
            final_signal,
            confidence,
            target_weight,
            iv_rank,
            latest_iv,
            total_oi,
            next_earnings_date,
            expected_move_perc,
            (confidence
                * COALESCE(iv_rank, 0.5)
                * SQRT(GREATEST(COALESCE(total_oi, 1), 1))
            ) AS composite_score
        FROM joined
        ORDER BY composite_score DESC NULLS LAST
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, str(lookback_days))

    universe_size = len(rows)
    if universe_size == 0:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No portfolio_manager runs in the last {lookback_days} days. "
                "Trigger an agent ensemble run or widen lookback_days."
            ),
        )

    latest_run = max((r["pm_run_ts"] for r in rows), default=None)

    items: list[StockScreenItem] = []
    for r in rows:
        sig = r["final_signal"]
        conf = float(r["confidence"] or 0.0)
        sec = r["wl_sector"]
        total_oi = int(r["total_oi"]) if r["total_oi"] is not None else None
        liquidity_ok = (total_oi is not None) and (total_oi >= min_oi)

        next_e = r["next_earnings_date"]
        days_to_e = (next_e - date_t.today()).days if next_e else None
        near_earn = (
            exclude_earnings_within_days > 0
            and days_to_e is not None
            and 0 <= days_to_e <= exclude_earnings_within_days
        )

        # Apply filters
        if signal != "any" and sig != signal:
            continue
        if conf < min_confidence:
            continue
        if sector_norm is not None and sec != sector_norm:
            continue
        if min_oi > 0 and not liquidity_ok:
            continue
        if near_earn:
            continue

        items.append(
            StockScreenItem(
                ticker=r["ticker"],
                sector=sec,
                final_signal=sig,  # type: ignore[arg-type]
                confidence=conf,
                target_weight=float(r["target_weight"]) if r["target_weight"] is not None else None,
                iv_rank=float(r["iv_rank"]) if r["iv_rank"] is not None else None,
                latest_iv=float(r["latest_iv"]) if r["latest_iv"] is not None else None,
                open_interest=total_oi,
                liquidity_ok=liquidity_ok,
                next_earnings_date=next_e,
                days_to_earnings=days_to_e,
                expected_move_pct=(
                    float(r["expected_move_perc"]) if r["expected_move_perc"] is not None else None
                ),
                near_earnings=near_earn,
                composite_score=float(r["composite_score"] or 0.0),
                rationale=r["rationale"],
            )
        )

    items = items[:limit]

    filters: dict[str, Any] = {
        "signal": signal,
        "min_confidence": min_confidence,
        "sector": sector_norm,
        "min_oi": min_oi,
        "exclude_earnings_within_days": exclude_earnings_within_days,
        "lookback_days": lookback_days,
        "limit": limit,
    }

    return StockScreenResponse(
        run_ts=latest_run,
        universe_size=universe_size,
        filtered_count=len(items),
        filters=filters,
        items=items,
    )
