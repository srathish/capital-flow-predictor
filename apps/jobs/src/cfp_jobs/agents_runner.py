"""Run the agent ensemble for a ticker: DB load -> graph invoke -> persist signals.

Phase 4b: just the analyst layer. Researcher/Trader/Risk/PM nodes land in 4c-4e.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import pandas as pd
import psycopg
from cfp_agents.graph import build_analyst_graph, build_full_graph
from cfp_agents.state import AgentSignal
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect, to_psycopg_url

log = logging.getLogger(__name__)


AGENT_SIGNAL_UPSERT = """
INSERT INTO agent_signals (run_ts, ticker, agent, signal, confidence, rationale, payload)
VALUES (%(run_ts)s, %(ticker)s, %(agent)s, %(signal)s, %(confidence)s, %(rationale)s, %(payload)s)
ON CONFLICT (run_ts, ticker, agent) DO UPDATE SET
    signal = EXCLUDED.signal,
    confidence = EXCLUDED.confidence,
    rationale = EXCLUDED.rationale,
    payload = EXCLUDED.payload
"""


def _load_prices(conn: psycopg.Connection, ticker: str, lookback_days: int = 365) -> pd.DataFrame:
    sql = """
        SELECT ts, open, high, low, close, volume
        FROM prices_daily
        WHERE symbol = %s AND ts >= NOW() - (%s || ' days')::interval
        ORDER BY ts
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker, str(lookback_days)))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def _load_fundamentals(conn: psycopg.Connection, ticker: str) -> pd.DataFrame:
    sql = """
        SELECT fiscal_period, period_type, metric, value, source, last_fetched
        FROM fundamentals
        WHERE ticker = %s
        ORDER BY fiscal_period
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker,))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def _ensure_prices(database_url: str, ticker: str) -> pd.DataFrame:
    """Load prices from DB; if empty, pull a year via yfinance and upsert.

    The constituent-stock universe is much wider than our predictor universe,
    so most agent-targeted tickers won't have prices_daily rows yet.
    """
    with connect(database_url) as conn:
        prices = _load_prices(conn, ticker)
    if not prices.empty:
        return prices

    log.info("agents: no prices for %s in DB; pulling 1y via yfinance", ticker)
    from datetime import timedelta

    from cfp_jobs.ingestion import prices as prices_ingest

    start = datetime.now(UTC) - timedelta(days=400)
    prices_ingest.ingest(database_url, [ticker], start=start)
    with connect(database_url) as conn:
        prices = _load_prices(conn, ticker)
    return prices


def upsert_agent_signals(conn: psycopg.Connection, run_ts: datetime, ticker: str, signals: list[AgentSignal]) -> int:
    if not signals:
        return 0
    rows = []
    for s in signals:
        r = s.to_db_row(run_ts, ticker)
        r["payload"] = Jsonb(r["payload"])
        rows.append(r)
    with conn.cursor() as cur:
        cur.executemany(AGENT_SIGNAL_UPSERT, rows)
    return len(rows)


def run_analysts(database_url: str, ticker: str, sector: str = "", *, include_personas: bool = False) -> dict:
    """Run the agent ensemble on `ticker`. Returns a summary dict.

    Args:
        include_personas: when False (Phase 4b behavior), runs only the 4 analyst
            nodes. When True (Phase 4d), runs the full graph — 4 analysts +
            13 personas + Trader + Risk Manager + Portfolio Manager — and persists
            every agent's signal.

    Side effect: writes to agent_signals table.
    """
    prices = _ensure_prices(database_url, ticker)
    with connect(database_url) as conn:
        fundamentals = _load_fundamentals(conn, ticker)

    graph = build_full_graph() if include_personas else build_analyst_graph()
    state = {
        "ticker": ticker,
        "sector": sector,
        "prices": prices,
        "fundamentals": fundamentals,
        "analyst_signals": [],
        "persona_signals": [],
    }
    result = graph.invoke(state)

    analyst_sigs: list[AgentSignal] = result.get("analyst_signals", []) or []
    persona_sigs: list[AgentSignal] = result.get("persona_signals", []) or []

    synth_sigs: list[AgentSignal] = []
    for key in ("trader_decision", "risk_assessment", "portfolio_decision"):
        v = result.get(key)
        if isinstance(v, AgentSignal):
            synth_sigs.append(v)

    all_signals = analyst_sigs + persona_sigs + synth_sigs

    run_ts = datetime.now(UTC)
    with connect(database_url) as conn:
        n = upsert_agent_signals(conn, run_ts, ticker, all_signals)
        conn.commit()

    log.info(
        "agents/%s: %d signals persisted (%d analyst, %d persona, %d synth)",
        ticker, n, len(analyst_sigs), len(persona_sigs), len(synth_sigs),
    )

    def _kind(s: AgentSignal) -> str:
        if s in analyst_sigs:
            return "analyst"
        if s in persona_sigs:
            return "persona"
        return "synthesis"

    return {
        "ticker": ticker,
        "run_ts": run_ts.isoformat(),
        "n_signals": n,
        "n_analysts": len(analyst_sigs),
        "n_personas": len(persona_sigs),
        "n_synth": len(synth_sigs),
        "signals": [
            {
                "agent": s.agent,
                "signal": s.signal,
                "confidence": s.confidence,
                "rationale": s.rationale,
                "kind": _kind(s),
            }
            for s in all_signals
        ],
    }


def latest_signals(database_url: str, ticker: str) -> pd.DataFrame:
    """Return the most-recent signals for `ticker` across all agents."""
    sql = """
        SELECT a.run_ts, a.agent, a.signal, a.confidence, a.rationale
        FROM agent_signals a
        WHERE a.ticker = %s
          AND a.run_ts = (SELECT MAX(run_ts) FROM agent_signals WHERE ticker = %s)
        ORDER BY a.agent
    """
    with psycopg.connect(to_psycopg_url(database_url)) as conn, conn.cursor() as cur:
        cur.execute(sql, (ticker, ticker))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)
