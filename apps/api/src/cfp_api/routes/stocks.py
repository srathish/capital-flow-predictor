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

import math
from datetime import date as date_t
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.finviz import PRESETS as FINVIZ_PRESETS
from cfp_api.finviz import available_presets, fetch_preset_tickers
from cfp_api.schemas import (
    FinvizPresetsResponse,
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


def _opportunity_score(
    *,
    confidence: float,
    iv_rank: float | None,
    open_interest: int | None,
    universe_rank: int | None,
    near_earnings: bool,
    has_verdict: bool,
    signal: str | None,
) -> tuple[float | None, dict[str, float]]:
    """Composite 0-100 opportunity score with an interpretable breakdown.

    Borrowed from the options-test repo's 0-120 scoring idea, retargeted to
    the inputs we already compute in the screener so we don't double-fetch.
    Components (max points):
        conviction      40  — PM confidence × signal weight (avoid = 0)
        iv_rank         20  — implied vol within trailing-90d range
        liquidity       20  — log10(open_interest) scaled
        sector_strength 15  — top XGB-ranked sectors get more points
        earnings_window  5  — proximity penalty inverted; clean = full points

    Returns (None, {}) when there's no PM verdict — Finviz-only rows opt out
    of the score so we don't pretend conviction exists.
    """
    if not has_verdict:
        return None, {}
    signal_weight = {"long": 1.0, "short": 0.85, "avoid": 0.0}.get(signal or "", 0.0)
    conviction_pts = max(0.0, min(1.0, confidence)) * signal_weight * 40.0
    iv_pts = max(0.0, min(1.0, (iv_rank if iv_rank is not None else 0.0))) * 20.0
    # log10(1) = 0 → minimum, log10(1e5) = 5 → max. Scale to 20.
    if open_interest is None or open_interest <= 0:
        liq_pts = 0.0
    else:
        liq_pts = max(0.0, min(20.0, math.log10(open_interest + 1) * 4.0))
    if universe_rank is None:
        sector_pts = 5.0
    else:
        # universe_rank is 1..~26 sectors. Rank 1-3 = 15 pts, then decays.
        sector_pts = max(0.0, 15.0 - max(0, universe_rank - 1) * 0.7)
    earnings_pts = 0.0 if near_earnings else 5.0
    total = conviction_pts + iv_pts + liq_pts + sector_pts + earnings_pts
    return round(total, 2), {
        "conviction": round(conviction_pts, 2),
        "iv_rank": round(iv_pts, 2),
        "liquidity": round(liq_pts, 2),
        "sector_strength": round(sector_pts, 2),
        "earnings_window": round(earnings_pts, 2),
    }


class CalibrationBucket(BaseModel):
    label: str                # e.g. ">=75", "50-75", "25-50", "<25"
    lo: float                 # inclusive lower bound on conviction-score (0..100)
    hi: float | None          # exclusive upper bound; None == open-ended
    n: int                    # number of PM signals in this bucket with valid fwd return
    hit_rate_10d: float | None    # fraction hit at 10d (None if n < 5)
    mean_excess_10d: float | None # mean fwd_return_10d (signed by direction) (None if n < 5)
    median_excess_10d: float | None


class CalibrationResponse(BaseModel):
    window_days: int
    horizon_days: int
    hit_threshold: float
    n_total: int
    overall_hit_rate: float | None
    overall_mean_excess: float | None
    buckets: list[CalibrationBucket]
    note: str


@router.get("/screen/calibration", response_model=CalibrationResponse)
async def screen_calibration(
    days: int = Query(default=90, ge=14, le=365, description="Lookback window in calendar days"),
    horizon: int = Query(default=10, description="Forward-return horizon. Must be one of {5, 10, 20, 60}."),
) -> CalibrationResponse:
    if horizon not in (5, 10, 20, 60):
        raise HTTPException(status_code=422, detail="horizon must be one of 5, 10, 20, 60")
    """How does the opportunity score's conviction component (≈40% of total)
    predict forward returns? Joins `agent_eval` PM rows over the last `days`
    and buckets by `confidence × signal_weight × 100`. The other 60% of the
    composite (IV rank, liquidity, sector strength, earnings) isn't
    backtestable from historical rows yet — see note in response.
    """
    pool = get_pool()
    horizon_int = horizon  # already a Literal[5,10,20,60] int
    # Pull all matured PM rows in the window. signal in {bullish,bearish,neutral}
    # gets coerced to its directional weight on the read side so we don't need
    # to bake the formula into SQL.
    sql = f"""
        SELECT confidence, signal,
               fwd_return_{horizon_int}d AS excess,
               hit_{horizon_int}d AS hit
        FROM agent_eval
        WHERE agent = 'portfolio_manager'
          AND run_ts >= NOW() - ($1 || ' days')::interval
          AND fwd_return_{horizon_int}d IS NOT NULL
    """  # noqa: S608 — horizon is regex-gated
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, str(days))

    bucket_defs = [
        (">=75", 75.0, None),
        ("50-75", 50.0, 75.0),
        ("25-50", 25.0, 50.0),
        ("<25",   0.0,  25.0),
    ]

    def _score(conf: float | None, signal: str | None) -> float:
        sig_w = {"bullish": 1.0, "bearish": 0.85, "neutral": 0.0}.get(signal or "", 0.0)
        return max(0.0, min(1.0, conf or 0.0)) * sig_w * 100.0

    def _signed_excess(excess: float | None, signal: str | None) -> float | None:
        # Sign so that "good for the call" is positive regardless of direction.
        if excess is None:
            return None
        if signal == "bearish":
            return -float(excess)
        return float(excess)

    n_total = 0
    overall_hits = 0
    overall_signed: list[float] = []
    buckets: list[CalibrationBucket] = []

    # Pre-compute (score, hit, signed_excess) once.
    scored = []
    for r in rows:
        s = _score(r["confidence"], r["signal"])
        se = _signed_excess(r["excess"], r["signal"])
        h = bool(r["hit"]) if r["hit"] is not None else None
        scored.append((s, h, se))
        n_total += 1
        if h is True:
            overall_hits += 1
        if se is not None:
            overall_signed.append(se)

    for label, lo, hi in bucket_defs:
        sel = [
            (s, h, se) for s, h, se in scored
            if s >= lo and (hi is None or s < hi)
        ]
        n = len(sel)
        if n >= 5:
            graded = [h for _, h, _ in sel if h is not None]
            hit_rate = (sum(1 for h in graded if h) / len(graded)) if graded else None
            signed = sorted(se for _, _, se in sel if se is not None)
            mean = (sum(signed) / len(signed)) if signed else None
            med = signed[len(signed) // 2] if signed else None
        else:
            hit_rate = mean = med = None
        buckets.append(CalibrationBucket(
            label=label, lo=lo, hi=hi, n=n,
            hit_rate_10d=hit_rate,
            mean_excess_10d=mean,
            median_excess_10d=med,
        ))

    overall_hit_rate = (overall_hits / n_total) if n_total else None
    overall_mean = (sum(overall_signed) / len(overall_signed)) if overall_signed else None

    return CalibrationResponse(
        window_days=days,
        horizon_days=horizon_int,
        hit_threshold=0.01,  # mirrors cfp_jobs.eval_agents.HIT_THRESHOLD
        n_total=n_total,
        overall_hit_rate=overall_hit_rate,
        overall_mean_excess=overall_mean,
        buckets=buckets,
        note=(
            "Calibrated on the conviction component (≈40% of opportunity score). "
            "IV rank / liquidity / sector strength / earnings-window components "
            "aren't backtested historically — they're additive to score but "
            "their out-of-sample lift is still TBD."
        ),
    )


@router.get("/finviz-presets", response_model=FinvizPresetsResponse)
async def list_finviz_presets() -> FinvizPresetsResponse:
    """List Finviz screener presets the frontend can offer as universe filters."""
    return FinvizPresetsResponse(presets=available_presets())  # type: ignore[arg-type]


@router.get("/screen", response_model=StockScreenResponse)
async def screen_stocks(
    signal: ScreenSignal = Query(default="long", description="Filter by final signal"),
    min_confidence: float = Query(default=0.5, ge=0.0, le=1.0),
    sector: str | None = Query(default=None, description="Filter to one sector ETF (e.g. XLK)"),
    min_oi: int = Query(default=0, ge=0, description="Open-interest gate (ticker-aggregated)"),
    min_iv_rank: float = Query(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="IV-rank gate (0..1). Drops tickers where the 90d IV-rank proxy is below this.",
    ),
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
    finviz_preset: str | None = Query(
        default=None,
        description=(
            "If set, constrain the universe to tickers from this Finviz preset "
            "(see /v1/stocks/finviz-presets). Agent verdicts are LEFT-joined, "
            "so tickers with no recent agent run still appear (with null conf)."
        ),
    ),
    sort: str = Query(
        default="composite",
        pattern="^(composite|opportunity|confidence|iv_rank|open_interest)$",
        description=(
            "Rank order. 'composite' (default, legacy) keeps confidence×iv×√oi; "
            "'opportunity' uses the 0-100 composite score (recommended)."
        ),
    ),
) -> StockScreenResponse:
    """Rank stocks the agents have analyzed by options-trade attractiveness."""
    pool = get_pool()
    sector_norm = sector.upper() if sector else None

    # Finviz preset → resolve to a ticker universe up front.  When set, the
    # screener flips from "agent-driven universe" to "Finviz-driven universe
    # with agent overlay" — so tickers with no recent portfolio_manager run
    # still appear (null confidence/rationale) instead of being dropped.
    finviz_tickers: list[str] | None = None
    if finviz_preset is not None:
        if finviz_preset not in FINVIZ_PRESETS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown finviz_preset '{finviz_preset}'. See /v1/stocks/finviz-presets.",
            )
        finviz_tickers = await fetch_preset_tickers(finviz_preset)
        if not finviz_tickers:
            # Finviz returned nothing (network blip, parse miss, or the preset
            # genuinely has no hits today).  Short-circuit with an empty result
            # rather than running a SQL query that would join against an empty
            # universe.
            return StockScreenResponse(
                run_ts=None,
                universe_size=0,
                filtered_count=0,
                filters={
                    "signal": signal,
                    "min_confidence": min_confidence,
                    "sector": sector_norm,
                    "min_oi": min_oi,
                    "min_iv_rank": min_iv_rank,
                    "exclude_earnings_within_days": exclude_earnings_within_days,
                    "lookback_days": lookback_days,
                    "limit": limit,
                    "finviz_preset": finviz_preset,
                },
                items=[],
            )

    # The SQL is structured as a sequence of CTEs:
    #   pm_latest    — most-recent portfolio_manager verdict per ticker (the universe)
    #   wl_latest    — most-recent watchlist row per ticker (enrichment)
    #   iv_daily     — per-ticker daily mean IV from uw_flow_alerts (last 90d)
    #   iv_stats     — min/max/latest of iv_daily → IV-rank proxy
    #   oi_latest    — SUM(curr_oi) on each ticker's most-recent uw_oi_change date
    #   earnings_next — soonest future earnings event per ticker
    # The outer SELECT joins all enrichments LEFT, so a ticker with no UW data
    # still ranks (its iv_rank/oi will be null but composite still computes).
    #
    # When `finviz_tickers` is set, we unnest a passed-in array as the
    # universe and LEFT JOIN agent_signals onto it.  Otherwise the universe
    # comes from recent portfolio_manager rows.
    if finviz_tickers is not None:
        # WITH ORDINALITY preserves Finviz's original rank so we can use it as
        # a tiebreaker when the agent ensemble hasn't run on the ticker yet.
        pm_cte = """
            pm_latest AS (
                SELECT
                    fv.ticker,
                    fv.universe_rank,
                    pm.run_ts,
                    pm.signal,
                    pm.confidence,
                    pm.rationale
                FROM UNNEST($2::text[]) WITH ORDINALITY AS fv(ticker, universe_rank)
                LEFT JOIN LATERAL (
                    SELECT run_ts, signal, confidence, rationale
                    FROM agent_signals
                    WHERE agent = 'portfolio_manager'
                      AND ticker = fv.ticker
                      AND run_ts > NOW() - ($1 || ' days')::interval
                    ORDER BY run_ts DESC
                    LIMIT 1
                ) pm ON TRUE
            ),
        """
    else:
        pm_cte = """
            pm_latest AS (
                SELECT DISTINCT ON (ticker)
                    ticker, NULL::bigint AS universe_rank, run_ts, signal, confidence, rationale
                FROM agent_signals
                WHERE agent = 'portfolio_manager'
                  AND run_ts > NOW() - ($1 || ' days')::interval
                ORDER BY ticker, run_ts DESC
            ),
        """

    sql = f"""
        WITH {pm_cte}
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
                pm.universe_rank,
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
            universe_rank,
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
        ORDER BY composite_score DESC NULLS LAST, universe_rank ASC NULLS LAST
    """

    async with pool.acquire() as conn:
        if finviz_tickers is not None:
            rows = await conn.fetch(sql, str(lookback_days), finviz_tickers)
        else:
            rows = await conn.fetch(sql, str(lookback_days))

    universe_size = len(rows)
    if universe_size == 0:
        if finviz_preset is not None:
            # Finviz returned tickers but none survived the universe-build (this
            # should be unreachable given we short-circuit empty Finviz earlier,
            # but defensively return an empty result rather than a 404).
            return StockScreenResponse(
                run_ts=None,
                universe_size=0,
                filtered_count=0,
                filters={"finviz_preset": finviz_preset},
                items=[],
            )
        raise HTTPException(
            status_code=404,
            detail=(
                f"No portfolio_manager runs in the last {lookback_days} days. "
                "Trigger an agent ensemble run or widen lookback_days."
            ),
        )

    latest_run = max((r["pm_run_ts"] for r in rows if r["pm_run_ts"] is not None), default=None)

    items: list[StockScreenItem] = []
    for r in rows:
        sig = r["final_signal"]
        has_verdict = r["pm_run_ts"] is not None
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

        # When a Finviz preset is the universe, tickers without a recent
        # agent verdict are kept regardless of the signal / min-confidence
        # gates — the user explicitly asked to see Finviz hits, and dropping
        # unrated names would silently turn this into an intersection-only
        # view.  Sector, OI, IV-rank, and earnings gates still apply.
        finviz_unrated = finviz_preset is not None and not has_verdict
        if not finviz_unrated:
            if signal != "any" and sig != signal:
                continue
            if conf < min_confidence:
                continue
        if sector_norm is not None and sec != sector_norm:
            continue
        if min_oi > 0 and not liquidity_ok:
            continue
        iv_rank_val = float(r["iv_rank"]) if r["iv_rank"] is not None else None
        if min_iv_rank > 0.0 and (iv_rank_val is None or iv_rank_val < min_iv_rank):
            continue
        if near_earn:
            continue

        opp_score, opp_breakdown = _opportunity_score(
            confidence=conf,
            iv_rank=iv_rank_val,
            open_interest=total_oi,
            universe_rank=r["universe_rank"],
            near_earnings=near_earn,
            has_verdict=has_verdict,
            signal=sig,
        )
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
                opportunity_score=opp_score,
                opportunity_breakdown=opp_breakdown,
                rationale=r["rationale"],
                has_agent_verdict=has_verdict,
            )
        )

    # Re-sort if a non-default order was requested. SQL ordered by composite —
    # for any other key, sort the materialized list in Python (cheap, N ≤ 100s).
    if sort == "opportunity":
        items.sort(key=lambda i: (i.opportunity_score or 0.0), reverse=True)
    elif sort == "confidence":
        items.sort(key=lambda i: i.confidence, reverse=True)
    elif sort == "iv_rank":
        items.sort(key=lambda i: (i.iv_rank or 0.0), reverse=True)
    elif sort == "open_interest":
        items.sort(key=lambda i: (i.open_interest or 0), reverse=True)

    items = items[:limit]

    filters: dict[str, Any] = {
        "signal": signal,
        "min_confidence": min_confidence,
        "sector": sector_norm,
        "min_oi": min_oi,
        "min_iv_rank": min_iv_rank,
        "exclude_earnings_within_days": exclude_earnings_within_days,
        "lookback_days": lookback_days,
        "limit": limit,
        "finviz_preset": finviz_preset,
    }

    return StockScreenResponse(
        run_ts=latest_run,
        universe_size=universe_size,
        filtered_count=len(items),
        filters=filters,
        items=items,
    )
