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


class StageFiredToday(BaseModel):
    bcs_breakout: bool
    hfs_breakout: bool
    breakdown_warn: bool


class StageDanger(BaseModel):
    stage4: bool
    bear_stack: bool


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
    hfs_score: int
    active_score: int
    active_ready: bool
    trigger_level: float | None
    distance_pct: float | None
    pullback_pct: float | None
    pct_from_52w_high: float | None
    conditions: StageConditions
    fired_today: StageFiredToday
    danger: StageDanger
    targets: StageTargets | None = None
    read: StageRead | None = None
    error: str | None = None


class StageScanResponse(BaseModel):
    universe: str
    requested: int
    scanned: int
    skipped: int
    items: list[StageTickerResult]


def _analyze_ticker(ticker: str, bars: list) -> StageTickerResult:
    """Run analyze() and adapt the dict into the response model."""
    if not bars:
        return _empty_result(ticker, "no_data")
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
        ),
        fired_today=StageFiredToday(bcs_breakout=False, hfs_breakout=False, breakdown_warn=False),
        danger=StageDanger(stage4=False, bear_stack=False),
        targets=None,
        read=None,
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
        symbols = stage_universes.resolve(universe)
        universe_label = universe
        if not symbols:
            raise HTTPException(status_code=400, detail=f"unknown universe: {universe}")

    requested = len(symbols)

    # yfinance batch download is blocking; punt to a thread so we don't stall
    # the event loop while fetching 500 tickers.
    bars_by_ticker = await asyncio.to_thread(stage_data.fetch_bars_batch, symbols)

    results = [_analyze_ticker(t, bars_by_ticker.get(t, [])) for t in symbols]

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
    bars = await asyncio.to_thread(stage_data.fetch_bars, ticker)
    return _analyze_ticker(ticker, bars)
