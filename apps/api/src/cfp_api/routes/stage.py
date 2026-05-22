"""STAGE Scanner endpoints — exposes the BCS/HFS port to the web tab.

Two endpoints, both GET, both auth-protected by main.py:

  /v1/stage/scan?universe=focus      Ranked list across a universe.
  /v1/stage/{ticker}                 Full dashboard for one ticker.

The route is intentionally thin: real work happens in stage_logic.analyze
(pure function, easy to test) and stage_data.fetch_bars_batch (yfinance).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api import stage_data, stage_logic, stage_universes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/stage", tags=["stage"])


Phase = Literal["BASE", "HANDLE", "NEUTRAL", "CAUTION", "DANGER"]


class StageConditions(BaseModel):
    stage2_trend: bool
    volume_dry_up: bool
    atr_contracted: bool
    ema_tight: bool
    in_base_zone: bool
    uptrend_active: bool
    in_pullback_zone: bool
    holding_ema50: bool
    range_tight: bool
    vol_dry_in_handle: bool
    # 6th HFS condition (DRIFT.md fix #3) — handle duration in [5,15] bars
    handle_duration_ok: bool


class StageFiredToday(BaseModel):
    """Master-gated breakout flags. True iff ALL gates passed today.

    bcs_breakout / hfs_breakout are NOT pure trigger-break flags any more —
    they include G3a (Grade ≥ min_grade) and G3b (pre-breakout accumulation).
    They are the indicator's "A-SETUP GO" markers.
    """

    bcs_breakout: bool
    hfs_breakout: bool
    breakdown_warn: bool


class StageDanger(BaseModel):
    stage4: bool
    bear_stack: bool


class StageGradeComponents(BaseModel):
    volume_surge: bool
    pre_break_tightness: bool  # DRIFT.md fix #2 — replaces TV's strongBar
    range_expansion: bool
    bb_thrust: bool
    bb_expanding: bool


class StageGrade(BaseModel):
    """G3a — breakout quality on the most recent bar, 0-5.

    `ok` = value >= min_required. `rvol` is the repaint-fixed RVOL
    (volume[i] / vol_ma[i-1]).
    """

    value: int
    min_required: int
    ok: bool
    rvol: float
    components: StageGradeComponents


class StageFlow(BaseModel):
    """G3b — pre-breakout accumulation gate (DRIFT.md fix #1).

    Both components look BACKWARD from the current bar over the prior
    `flow_len` bars. NOT a same-bar money-flow reading. `ok` = both pass.
    `up_vol_ratio` may be null if the window had no clear up/down days,
    or 999.0 as a sentinel for +inf (all up, no down).
    """

    ok: bool
    obv_slope: float
    obv_slope_positive: bool
    up_vol_ratio: float | None
    up_vol_ratio_ok: bool


StageMasterVerdict = Literal[
    "A-SETUP - GO",
    "ARMED - WAIT FOR BREAK",
    "CAUTION - NO NEW LONGS",
    "DANGER - SKIP",
    "WATCH / NEUTRAL",
]


class StageTargetDays(BaseModel):
    """Estimated trading days to reach a target. Bracket reflects efficiency
    band (optimistic = 0.5 ADR captured per day; conservative = 0.25)."""

    optimistic: int | None
    expected: int | None
    conservative: int | None


class StageTarget(BaseModel):
    price: float
    gain_pct: float
    adr_multiple: float
    days: StageTargetDays


class StageRecommendedPlay(BaseModel):
    """A specific option contract suggestion, sized to the scanner's targets
    and time horizons. Independent of what's in the flow tape — that's the
    cross-reference. `long_strike`/`short_strike` are only set for spreads."""

    kind: Literal["aggressive_call", "call_debit_spread", "leap_conviction"]
    label: str
    option_type: Literal["call", "put"]
    strike: float | None
    long_strike: float | None
    short_strike: float | None
    expiry: str
    days_to_expiry: int
    rationale: str


class StageRead(BaseModel):
    """Plain-English summary of the setup. Generated deterministically from
    phase + score + targets; no LLM in the loop."""

    setup_type: str
    rarity: Literal["rare", "uncommon", "common", "n/a"]
    sizing_hint: Literal["skip", "small", "standard", "size_up"]
    read: str


class StageTargets(BaseModel):
    adr_pct: float
    adr_dollars: float
    base_low: float
    base_low_lookback_bars: int
    extension_target: float
    extension_gain_pct: float
    stop_price: float
    stop_pct: float
    stop_logic: str
    rr_to_t1: float | None
    targets: dict[str, StageTarget]


class StageTickerResult(BaseModel):
    ticker: str
    date: str | None
    close: float | None
    phase: Phase
    bcs_score: int
    hfs_score: int  # now scored 0-6 (added handle_duration_ok)
    active_score: int
    active_ready: bool
    trigger_level: float | None
    distance_pct: float | None
    pullback_pct: float | None
    pct_from_52w_high: float | None
    handle_duration_bars: int | None = None
    conditions: StageConditions
    fired_today: StageFiredToday
    danger: StageDanger
    targets: StageTargets | None = None
    recommended_plays: list[StageRecommendedPlay] = []
    read: StageRead | None = None
    grade: StageGrade | None = None
    flow: StageFlow | None = None
    master_verdict: StageMasterVerdict = "WATCH / NEUTRAL"
    error: str | None = None


class StageScanResponse(BaseModel):
    universe: str
    requested: int
    scanned: int
    skipped: int
    items: list[StageTickerResult]


def _analyze_ticker(
    ticker: str, bars: list, reason: str | None = None
) -> StageTickerResult:
    """Run analyze() and adapt the dict into the response model.

    `reason` is the classification from stage_data when bars came back empty
    — surfaces 'not_found' / 'rate_limited' / 'insufficient_history' to the
    UI instead of a generic 'no_data' for everything.
    """
    if not bars:
        return _empty_result(ticker, reason or "no_data")
    try:
        r = stage_logic.analyze(bars)
    except Exception as exc:  # noqa: BLE001
        logger.warning("stage_logic failed for %s: %s", ticker, exc)
        return _empty_result(ticker, f"analyze_error: {type(exc).__name__}")
    return StageTickerResult(ticker=ticker, **r, error=None)


def _empty_result(ticker: str, why: str) -> StageTickerResult:
    return StageTickerResult(
        ticker=ticker,
        date=None,
        close=None,
        phase="NEUTRAL",
        bcs_score=0,
        hfs_score=0,
        active_score=0,
        active_ready=False,
        trigger_level=None,
        distance_pct=None,
        pullback_pct=None,
        pct_from_52w_high=None,
        conditions=StageConditions(
            stage2_trend=False,
            volume_dry_up=False,
            atr_contracted=False,
            ema_tight=False,
            in_base_zone=False,
            uptrend_active=False,
            in_pullback_zone=False,
            holding_ema50=False,
            range_tight=False,
            vol_dry_in_handle=False,
            handle_duration_ok=False,
        ),
        fired_today=StageFiredToday(bcs_breakout=False, hfs_breakout=False, breakdown_warn=False),
        danger=StageDanger(stage4=False, bear_stack=False),
        targets=None,
        recommended_plays=[],
        read=None,
        grade=None,
        flow=None,
        master_verdict="WATCH / NEUTRAL",
        error=why,
    )


# Phase priority for ranking — armed setups first, then by score descending,
# then by trigger proximity. DANGER/CAUTION sort to the bottom because the
# scanner is a "find longs" tool; the warnings are informational.
_PHASE_RANK = {"BASE": 0, "HANDLE": 1, "NEUTRAL": 2, "CAUTION": 3, "DANGER": 4}


def _rank_key(r: StageTickerResult) -> tuple:
    armed = 0 if r.active_ready else 1
    phase_rank = _PHASE_RANK.get(r.phase, 9)
    score = -r.active_score
    # Smaller distance to trigger = ranked higher. None goes last.
    dist = abs(r.distance_pct) if r.distance_pct is not None else 9999.0
    return (armed, phase_rank, score, dist)


@router.get("/scan", response_model=StageScanResponse)
async def scan(
    universe: str = Query("focus", description="focus | sp500 | all"),
    tickers: str | None = Query(
        None, description="Comma-separated tickers. Overrides `universe` when set."
    ),
    only_armed: bool = Query(
        False, description="If true, return only tickers with active_ready=true."
    ),
    limit: int = Query(200, ge=1, le=1000),
) -> StageScanResponse:
    """Scan a universe and return STAGE results ranked by setup quality."""
    if tickers:
        symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
        universe_label = "custom"
    else:
        if universe.lower().strip() not in stage_universes.UNIVERSES:
            raise HTTPException(status_code=400, detail=f"unknown universe: {universe}")
        symbols = stage_universes.resolve(universe)
        universe_label = universe
        if not symbols:
            # Universe is known but the loader returned empty — usually the
            # Wikipedia scrape failing for sp500. Surface that distinctly so
            # the UI can tell the user "try again" vs "fix your query".
            raise HTTPException(
                status_code=503,
                detail=(
                    f"universe '{universe}' is currently unavailable. "
                    "If this is sp500/all, the constituent list scrape "
                    "failed — retry in a moment."
                ),
            )

    requested = len(symbols)

    # yfinance batch download is blocking; punt to a thread so we don't stall
    # the event loop while fetching 500 tickers.
    bars_by_ticker = await asyncio.to_thread(stage_data.fetch_bars_batch, symbols)

    results = [
        _analyze_ticker(t, *bars_by_ticker.get(t, ([], "no_data"))) for t in symbols
    ]

    if only_armed:
        results = [r for r in results if r.active_ready]

    results.sort(key=_rank_key)
    scanned = sum(1 for r in results if r.error is None)
    skipped = sum(1 for r in results if r.error is not None)

    return StageScanResponse(
        universe=universe_label,
        requested=requested,
        scanned=scanned,
        skipped=skipped,
        items=results[:limit],
    )


@router.get("/{ticker}", response_model=StageTickerResult)
async def get_ticker(ticker: str) -> StageTickerResult:
    """Full STAGE dashboard for one ticker — what the TV indicator shows."""
    ticker = ticker.upper().strip()
    bars, reason = await asyncio.to_thread(stage_data.fetch_bars, ticker)
    return _analyze_ticker(ticker, bars, reason)
