"""GET /v1/agents/{ticker} + /v1/agents/{ticker}/timeline — agent ensemble snapshots."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from cfp_api.db import get_pool
from cfp_api.schemas import (
    AgentsForTickerResponse,
    AgentSignalEntry,
    AgentsTimelineEntry,
    AgentsTimelineResponse,
)

router = APIRouter(prefix="/v1/agents", tags=["agents"])


# Static classification — keeps the API stable as the ensemble evolves.
ANALYST_NAMES = {"technicals", "fundamentals", "sentiment", "news"}
SYNTH_NAMES = {"trader", "risk_manager", "portfolio_manager"}


def _classify(agent_name: str) -> str:
    if agent_name in ANALYST_NAMES:
        return "analyst"
    if agent_name in SYNTH_NAMES:
        return "synthesis"
    # Anything else we treat as a persona — keeps the API forward-compatible
    # if more personas are added without redeploying.
    return "persona"


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


@router.get("/{ticker}", response_model=AgentsForTickerResponse)
async def get_agents_for_ticker(ticker: str) -> AgentsForTickerResponse:
    """Latest full ensemble (analysts + personas + synthesis) for a ticker."""
    pool = get_pool()
    ticker = ticker.upper()
    sql = """
        SELECT run_ts, agent, signal, confidence, rationale, payload
        FROM agent_signals
        WHERE ticker = $1
          AND run_ts = (SELECT MAX(run_ts) FROM agent_signals WHERE ticker = $1)
        ORDER BY agent
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, ticker)

    if not rows:
        raise HTTPException(status_code=404, detail=f"No agent signals for {ticker}")

    return AgentsForTickerResponse(
        ticker=ticker,
        run_ts=rows[0]["run_ts"],
        signals=[
            AgentSignalEntry(
                agent=r["agent"],
                kind=_classify(r["agent"]),  # type: ignore[arg-type]
                signal=r["signal"],  # type: ignore[arg-type]
                confidence=float(r["confidence"] or 0.0),
                rationale=r["rationale"],
                payload=_parse_payload(r["payload"]),
            )
            for r in rows
        ],
    )


@router.get("/{ticker}/timeline", response_model=AgentsTimelineResponse)
async def get_agent_timeline(
    ticker: str,
    agent: str = Query(..., description="Agent name, e.g. portfolio_manager, buffett, technicals"),
    limit: int = Query(30, ge=1, le=200),
) -> AgentsTimelineResponse:
    """Historical signals for one (ticker, agent) pair, newest first."""
    pool = get_pool()
    ticker = ticker.upper()
    sql = """
        SELECT run_ts, signal, confidence, rationale
        FROM agent_signals
        WHERE ticker = $1 AND agent = $2
        ORDER BY run_ts DESC
        LIMIT $3
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, ticker, agent, limit)

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No timeline for {ticker} / {agent}",
        )

    return AgentsTimelineResponse(
        ticker=ticker,
        agent=agent,
        entries=[
            AgentsTimelineEntry(
                run_ts=r["run_ts"],
                signal=r["signal"],  # type: ignore[arg-type]
                confidence=float(r["confidence"] or 0.0),
                rationale=r["rationale"],
            )
            for r in rows
        ],
    )
