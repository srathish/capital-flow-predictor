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
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.metrics import ensemble_runs_total
from cfp_api.ratelimit import rate_limit_run
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
ANALYST_NAMES = {"technicals", "fundamentals", "sentiment", "news", "flow"}
SYNTH_NAMES = {
    "bull_rebuttal",
    "bear_rebuttal",
    "bull_researcher",
    "bear_researcher",
    "trader",
    "risk_manager",
    "portfolio_manager",
}
# 5 analysts + 13 personas + 2 rebuttals + 2 researchers + 3 synthesis = 25
EXPECTED_TOTAL = 5 + 13 + 2 + 2 + 3


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
        # "Latest run" must exclude incomplete runs — pick the most recent
        # run_ts that has a portfolio_manager signal (synthesis layer
        # completed). Otherwise a partial / crashed run hides the last
        # good one.
        sql = """
            SELECT run_ts, agent, signal, confidence, rationale, payload
            FROM agent_signals
            WHERE ticker = $1
              AND run_ts = (
                  SELECT MAX(run_ts) FROM agent_signals
                  WHERE ticker = $1 AND agent = 'portfolio_manager'
              )
            ORDER BY agent
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, ticker)
        # Fallback: if no run has a PM signal yet, return the most recent
        # partial run so the dashboard isn't empty on a brand-new ticker.
        if not rows:
            sql_fallback = """
                SELECT run_ts, agent, signal, confidence, rationale, payload
                FROM agent_signals
                WHERE ticker = $1
                  AND run_ts = (SELECT MAX(run_ts) FROM agent_signals WHERE ticker = $1)
                ORDER BY agent
            """
            async with pool.acquire() as conn:
                rows = await conn.fetch(sql_fallback, ticker)

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


# ---------- chart data (OHLCV + flow / insider / earnings markers) ----------


class OhlcvBar(BaseModel):
    ts: datetime
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: int | None


class ChartMarker(BaseModel):
    """A point-in-time annotation on the chart. type is what the FE renders."""

    ts: datetime
    type: Literal["flow_call", "flow_put", "insider_buy", "insider_sell", "earnings"]
    price: float | None
    label: str            # short caption shown on hover
    detail: str | None    # longer caption (premium, strike, etc.)
    source_url: str | None = None  # external link to verify the underlying filing/event


def _edgar_form4_url(ticker: str) -> str:
    # EDGAR accepts a ticker in CIK= and resolves it server-side. Listing all
    # Form 4 filings for the issuer lets users eyeball whether our markers
    # correspond to real SEC filings on the same dates.
    return (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcompany&CIK={ticker}&type=4&dateb=&owner=include&count=40"
    )


def _edgar_earnings_url(ticker: str) -> str:
    # 8-K is where earnings releases are filed.
    return (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcompany&CIK={ticker}&type=8-K&dateb=&owner=include&count=40"
    )


class ChartDataResponse(BaseModel):
    ticker: str
    bars: list[OhlcvBar]
    markers: list[ChartMarker]


# Threshold for surfacing a flow alert as a chart marker. Avoids cluttering
# the chart with $50K trades — only show real institutional-size sweeps.
_MIN_FLOW_PREMIUM = 1_000_000.0


@router.get("/{ticker}/chart-data", response_model=ChartDataResponse)
async def get_chart_data(
    ticker: str,
    days: int = Query(180, ge=30, le=720, description="Lookback window in days"),
) -> ChartDataResponse:
    """OHLCV bars + chart markers (flow alerts, insider txns, earnings).

    Reads from prices_daily + uw_flow_alerts + uw_insider_transactions +
    uw_earnings. Flow alerts are filtered to >$1M premium so the chart
    doesn't fill with noise."""
    ticker = ticker.upper()
    pool = get_pool()

    async with pool.acquire() as conn:
        bar_rows = await conn.fetch(
            """
            SELECT ts, open, high, low, close, volume
            FROM prices_daily
            WHERE symbol = $1 AND ts >= NOW() - ($2 || ' days')::interval
            ORDER BY ts ASC
            """,
            ticker, str(days),
        )
        flow_rows = await conn.fetch(
            """
            SELECT created_at, option_type, strike, expiry, total_premium, alert_rule
            FROM uw_flow_alerts
            WHERE ticker = $1
              AND created_at >= NOW() - ($2 || ' days')::interval
              AND total_premium >= $3
            ORDER BY created_at ASC
            """,
            ticker, str(days), _MIN_FLOW_PREMIUM,
        )
        insider_rows = await conn.fetch(
            """
            SELECT transaction_date, transaction_code, owner_name, amount, price
            FROM uw_insider_transactions
            WHERE ticker = $1
              AND transaction_date >= (NOW() - ($2 || ' days')::interval)::date
              AND transaction_code IN ('P','S')
            ORDER BY transaction_date ASC
            """,
            ticker, str(days),
        )
        earnings_rows = await conn.fetch(
            """
            SELECT report_date, expected_move, expected_move_perc, actual_eps
            FROM uw_earnings
            WHERE ticker = $1
              AND report_date >= (NOW() - ($2 || ' days')::interval)::date
            ORDER BY report_date ASC
            """,
            ticker, str(days),
        )

    bars = [
        OhlcvBar(
            ts=r["ts"],
            open=float(r["open"]) if r["open"] is not None else None,
            high=float(r["high"]) if r["high"] is not None else None,
            low=float(r["low"]) if r["low"] is not None else None,
            close=float(r["close"]) if r["close"] is not None else None,
            volume=int(r["volume"]) if r["volume"] is not None else None,
        )
        for r in bar_rows
    ]

    # Build a fast date -> close lookup so markers know what price to render at.
    close_by_date: dict[str, float] = {}
    for b in bars:
        if b.close is not None:
            close_by_date[b.ts.date().isoformat()] = b.close

    def _close_at(d: datetime | str) -> float | None:
        key = d.date().isoformat() if hasattr(d, "date") else str(d)
        return close_by_date.get(key)

    markers: list[ChartMarker] = []

    for r in flow_rows:
        ts = r["created_at"]
        prem = float(r["total_premium"] or 0)
        strike = float(r["strike"]) if r["strike"] is not None else None
        expiry = r["expiry"]
        otype = r["option_type"]
        markers.append(ChartMarker(
            ts=ts,
            type="flow_call" if otype == "call" else "flow_put",
            price=_close_at(ts),
            label=f"{otype.upper()} ${strike:.0f}" if strike else otype.upper(),
            detail=(
                f"${prem / 1e6:.1f}M premium, exp {expiry.isoformat() if expiry else '?'}, "
                f"{r['alert_rule'] or '?'}"
            ),
        ))

    for r in insider_rows:
        td = r["transaction_date"]
        # Coerce date -> datetime so the marker model is happy.
        ts = datetime.combine(td, datetime.min.time(), tzinfo=UTC)
        amt = float(r["amount"] or 0)
        price = float(r["price"] or 0)
        signed_dollars = amt * price
        markers.append(ChartMarker(
            ts=ts,
            type="insider_buy" if r["transaction_code"] == "P" else "insider_sell",
            price=_close_at(ts),
            label=f"Insider {'buy' if r['transaction_code'] == 'P' else 'sell'}",
            detail=f"{r['owner_name'] or '?'}: {amt:,.0f} sh @ ${price:.2f} = ${signed_dollars / 1e6:+.2f}M",
            source_url=_edgar_form4_url(ticker),
        ))

    for r in earnings_rows:
        ts = datetime.combine(r["report_date"], datetime.min.time(), tzinfo=UTC)
        em = r["expected_move_perc"]
        eps = r["actual_eps"]
        detail_parts: list[str] = []
        if em is not None:
            detail_parts.append(f"expected move {float(em) * 100:.1f}%")
        if eps is not None:
            detail_parts.append(f"actual EPS {float(eps):.2f}")
        markers.append(ChartMarker(
            ts=ts,
            type="earnings",
            price=_close_at(ts),
            label="Earnings",
            detail=", ".join(detail_parts) or None,
            source_url=_edgar_earnings_url(ticker),
        ))

    return ChartDataResponse(ticker=ticker, bars=bars, markers=markers)


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


@router.post(
    "/{ticker}/run",
    response_model=RunResponse,
    status_code=202,
    dependencies=[Depends(rate_limit_run)],
)
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
    ensemble_runs_total.inc(ticker=ticker)

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


# ---------- Pairwise persona comparison ----------


class PersonaSnapshot(BaseModel):
    persona: str
    signal: str | None
    confidence: float | None
    rationale: str | None
    run_ts: datetime | None


class ComparisonResponse(BaseModel):
    ticker: str
    left: PersonaSnapshot
    right: PersonaSnapshot
    agree: bool
    confidence_delta: float  # left.conf - right.conf
    summary: str  # one-line "left:long(0.7) vs right:short(0.4) — disagree"


@router.get("/{ticker}/comparison", response_model=ComparisonResponse)
async def get_persona_comparison(
    ticker: str,
    left: str = Query(..., description="First persona (e.g. buffett)"),
    right: str = Query(..., description="Second persona (e.g. burry)"),
) -> ComparisonResponse:
    """Compare two personas' latest takes on the same ticker.

    Reads the latest agent_signals row per (ticker, persona) — these may come
    from different runs, which is intentional: a persona that hasn't fired
    recently still appears with its last known stance.
    """
    pool = get_pool()
    ticker = ticker.upper()
    left_name = left.strip().lower()
    right_name = right.strip().lower()
    if left_name == right_name:
        raise HTTPException(status_code=400, detail="left and right must differ")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (agent) agent, signal, confidence, rationale, run_ts
            FROM agent_signals
            WHERE ticker = $1 AND agent = ANY($2::text[])
            ORDER BY agent, run_ts DESC
            """,
            ticker, [left_name, right_name],
        )
    by_agent = {r["agent"]: r for r in rows}

    def _snap(name: str) -> PersonaSnapshot:
        r = by_agent.get(name)
        if r is None:
            return PersonaSnapshot(persona=name, signal=None, confidence=None, rationale=None, run_ts=None)
        return PersonaSnapshot(
            persona=name,
            signal=r["signal"],
            confidence=float(r["confidence"] or 0.0),
            rationale=r["rationale"],
            run_ts=r["run_ts"],
        )

    l = _snap(left_name)
    r = _snap(right_name)
    agree = bool(l.signal and r.signal and l.signal == r.signal)
    delta = (l.confidence or 0.0) - (r.confidence or 0.0)
    verdict = "agree" if agree else "disagree"
    summary = (
        f"{l.persona}:{l.signal or '?'}({l.confidence or 0:.2f}) "
        f"vs {r.persona}:{r.signal or '?'}({r.confidence or 0:.2f}) — {verdict}"
    )
    return ComparisonResponse(
        ticker=ticker, left=l, right=r, agree=agree,
        confidence_delta=round(delta, 4), summary=summary,
    )
