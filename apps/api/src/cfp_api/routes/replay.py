"""Historical replay endpoint.

GET /v1/agents/{ticker}/replay?date=YYYY-MM-DD

Pulls the EvidenceBundle + agent_signals from a past run and joins to actual
forward returns vs SPY. Use case: "30 days ago this ensemble said X — how
did it play out?" The schema is intentionally the same shape as
/v1/agents/{ticker} plus a forward-return block, so the UI can reuse its
ensemble-grid component.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from datetime import date as date_t
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

router = APIRouter(prefix="/v1/agents", tags=["agents"])


class ForwardReturn(BaseModel):
    horizon_days: int
    ticker_return: float | None
    spy_return: float | None
    excess_return: float | None  # ticker - spy
    hit: bool | None              # did the PM's directional call get rewarded?


class ReplaySignal(BaseModel):
    agent: str
    signal: str | None
    confidence: float | None
    rationale: str | None
    payload: dict[str, Any]


class ReplayResponse(BaseModel):
    ticker: str
    as_of: date_t
    run_ts: datetime | None
    has_bundle: bool
    pm_signal: str | None
    pm_confidence: float | None
    forward_returns: list[ForwardReturn]
    signals: list[ReplaySignal]


def _parse_payload(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return {}


async def _forward_return(conn, ticker: str, from_dt: datetime, days: int) -> tuple[float | None, float | None]:
    """Return (ticker_return, spy_return) over `days` from `from_dt`. Either
    can be None if the price bar isn't available yet."""
    target = from_dt + timedelta(days=days)

    async def _ret(sym: str) -> float | None:
        # closest bar at or before from_dt, and at or after target
        base_close = await conn.fetchval(
            """
            SELECT close FROM prices_daily
            WHERE symbol = $1 AND ts <= $2
            ORDER BY ts DESC LIMIT 1
            """, sym, from_dt,
        )
        fwd_close = await conn.fetchval(
            """
            SELECT close FROM prices_daily
            WHERE symbol = $1 AND ts >= $2
            ORDER BY ts ASC LIMIT 1
            """, sym, target,
        )
        if base_close is None or fwd_close is None or base_close == 0:
            return None
        return float(fwd_close) / float(base_close) - 1.0

    return await _ret(ticker), await _ret("SPY")


def _hit(signal: str | None, excess: float | None, threshold: float = 0.01) -> bool | None:
    """Did the PM's call get rewarded by the forward excess return? Mirrors
    the same logic in cfp_jobs.eval_agents — neutral hits if the move
    stayed small, directional hits if direction agreed."""
    if signal is None or excess is None:
        return None
    if signal == "bullish":
        if abs(excess) <= threshold:
            return None
        return excess > threshold
    if signal == "bearish":
        if abs(excess) <= threshold:
            return None
        return excess < -threshold
    if signal == "neutral":
        return abs(excess) <= threshold
    return None


@router.get("/{ticker}/replay", response_model=ReplayResponse)
async def replay(
    ticker: str,
    date: date_t = Query(..., description="As-of date (UTC). YYYY-MM-DD"),
) -> ReplayResponse:
    """Replay the latest agent run on or before `date` for `ticker`."""
    pool = get_pool()
    sym = ticker.upper()
    # Treat the as-of as end-of-day UTC so a run at 23:59 on that date is included.
    as_of_dt = datetime.combine(date, datetime.max.time(), tzinfo=UTC)

    async with pool.acquire() as conn:
        run_ts = await conn.fetchval(
            """
            SELECT MAX(run_ts) FROM agent_signals
            WHERE ticker = $1 AND run_ts <= $2 AND agent = 'portfolio_manager'
            """,
            sym, as_of_dt,
        )
        if run_ts is None:
            # Fall back to any agent at all — partial run is still informative.
            run_ts = await conn.fetchval(
                """
                SELECT MAX(run_ts) FROM agent_signals
                WHERE ticker = $1 AND run_ts <= $2
                """,
                sym, as_of_dt,
            )
        if run_ts is None:
            raise HTTPException(
                status_code=404,
                detail=f"No agent run for {sym} on or before {date.isoformat()}",
            )

        rows = await conn.fetch(
            """
            SELECT agent, signal, confidence, rationale, payload
            FROM agent_signals
            WHERE ticker = $1 AND run_ts = $2
            ORDER BY agent
            """,
            sym, run_ts,
        )
        has_bundle = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM run_evidence WHERE ticker = $1 AND run_ts = $2)",
            sym, run_ts,
        )

        # Forward returns at 5/10/20d
        fwd: list[ForwardReturn] = []
        pm_signal: str | None = None
        pm_conf: float | None = None
        for r in rows:
            if r["agent"] == "portfolio_manager":
                pm_signal = r["signal"]
                pm_conf = float(r["confidence"] or 0.0)
                break

        for h in (5, 10, 20):
            tr, sr = await _forward_return(conn, sym, run_ts, h)
            excess = (tr - sr) if (tr is not None and sr is not None) else None
            fwd.append(ForwardReturn(
                horizon_days=h,
                ticker_return=tr,
                spy_return=sr,
                excess_return=excess,
                hit=_hit(pm_signal, excess),
            ))

    return ReplayResponse(
        ticker=sym,
        as_of=date,
        run_ts=run_ts,
        has_bundle=bool(has_bundle),
        pm_signal=pm_signal,
        pm_confidence=pm_conf,
        forward_returns=fwd,
        signals=[
            ReplaySignal(
                agent=r["agent"],
                signal=r["signal"],
                confidence=float(r["confidence"]) if r["confidence"] is not None else None,
                rationale=r["rationale"],
                payload=_parse_payload(r["payload"]),
            )
            for r in rows
        ],
    )
