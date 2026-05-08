"""Agent ensemble endpoints.

GET  /v1/agents/{ticker}                    — latest run, or specific run via ?run_ts
GET  /v1/agents/{ticker}/timeline           — historical signals for one (ticker, agent) pair
POST /v1/agents/{ticker}/run                — kick off a new ensemble run (fire-and-forget)
GET  /v1/agents/{ticker}/runs/{run_ts}      — status + partial signals for a specific run
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.schemas import (
    AgentsForTickerResponse,
    AgentSignalEntry,
    AgentsTimelineEntry,
    AgentsTimelineResponse,
)
from cfp_api.settings import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/agents", tags=["agents"])

# Hold strong references to fire-and-forget tasks so the GC doesn't reap them
# while they're still running. Tasks self-remove when they complete.
_running_tasks: set[asyncio.Task] = set()


# Static classification — keeps the API stable as the ensemble evolves.
ANALYST_NAMES = {"technicals", "fundamentals", "sentiment", "news"}
SYNTH_NAMES = {"trader", "risk_manager", "portfolio_manager"}
EXPECTED_TOTAL = 4 + 13 + 3  # analysts + personas + synthesis


def _classify(agent_name: str) -> str:
    if agent_name in ANALYST_NAMES:
        return "analyst"
    if agent_name in SYNTH_NAMES:
        return "synthesis"
    # Anything else is treated as a persona — keeps the API forward-compatible
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
async def get_agents_for_ticker(
    ticker: str,
    run_ts: datetime | None = Query(  # noqa: B008 — idiomatic FastAPI Depends pattern
        default=None,
        description="If set, return signals for this specific run; otherwise the latest run.",
    ),
) -> AgentsForTickerResponse:
    """Latest full ensemble (analysts + personas + synthesis) for a ticker.

    Pass ``?run_ts=<ISO timestamp>`` to fetch a specific run's signals — useful
    for polling a streaming run as agents complete one by one.
    """
    pool = get_pool()
    ticker = ticker.upper()

    if run_ts is not None:
        sql = """
            SELECT run_ts, agent, signal, confidence, rationale, payload
            FROM agent_signals
            WHERE ticker = $1 AND run_ts = $2
            ORDER BY agent
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, ticker, run_ts)
    else:
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
        raise HTTPException(status_code=404, detail=f"No timeline for {ticker} / {agent}")

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


# ---------- Run ensemble (fire-and-forget) ----------


class RunResponse(BaseModel):
    ticker: str
    run_ts: datetime
    status: str  # "started" | "in_progress" | "complete"
    expected_total: int


class RunStatusResponse(BaseModel):
    ticker: str
    run_ts: datetime
    expected_total: int
    completed: int
    is_complete: bool
    signals: list[AgentSignalEntry]


def _kickoff_ensemble(ticker: str, run_ts: datetime, sector: str = "") -> None:
    """Run the streaming ensemble synchronously inside a worker thread.

    Lives outside the async event loop so LangGraph's blocking node calls don't
    starve the API. Errors get logged; clients see a partial result via the
    run_ts polling endpoint.
    """
    try:
        from cfp_jobs import agents_runner

        agents_runner.run_analysts_streaming(
            settings.database_url,
            ticker,
            sector=sector,
            run_ts=run_ts,
            include_personas=True,
        )
    except Exception as e:
        log.exception("ensemble run failed for %s/%s: %s", ticker, run_ts.isoformat(), e)


@router.post("/{ticker}/run", response_model=RunResponse, status_code=202)
async def run_ensemble(ticker: str, sector: str = Query("")) -> RunResponse:
    """Kick off a new ensemble run for `ticker`. Returns immediately with a run_ts.

    The actual run takes ~30-40 seconds. Poll
    ``GET /v1/agents/{ticker}/runs/{run_ts}`` to watch agents complete one by one.
    """
    ticker = ticker.upper()
    run_ts = datetime.now(UTC)

    task = asyncio.create_task(asyncio.to_thread(_kickoff_ensemble, ticker, run_ts, sector))
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)

    return RunResponse(
        ticker=ticker,
        run_ts=run_ts,
        status="started",
        expected_total=EXPECTED_TOTAL,
    )


@router.get("/{ticker}/runs/{run_ts}", response_model=RunStatusResponse)
async def get_run_status(ticker: str, run_ts: datetime) -> RunStatusResponse:
    """Polling endpoint for a specific run.

    Returns ``is_complete=True`` when the Portfolio Manager signal has landed,
    which is the last node in the ensemble graph.
    """
    pool = get_pool()
    ticker = ticker.upper()

    sql = """
        SELECT run_ts, agent, signal, confidence, rationale, payload
        FROM agent_signals
        WHERE ticker = $1 AND run_ts = $2
        ORDER BY agent
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, ticker, run_ts)

    completed = len(rows)
    is_complete = any(r["agent"] == "portfolio_manager" for r in rows)

    return RunStatusResponse(
        ticker=ticker,
        run_ts=run_ts,
        expected_total=EXPECTED_TOTAL,
        completed=completed,
        is_complete=is_complete,
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
