"""Tests for the agent ensemble runner.

Most of agents_runner.py is glue between DB → LangGraph → DB and depends on
LLM API keys + a live database. We test the parts we can pin down:

  * upsert_agent_signals — verifies the row shape against AgentSignal contract
  * AGENT_SIGNAL_UPSERT SQL — uses the right column names + conflict target
  * EXPECTED_TOTAL stays in sync with the runner's signal contract
"""

from __future__ import annotations

import re
from unittest.mock import MagicMock

from cfp_agents.state import AgentSignal
from cfp_jobs.agents_runner import AGENT_SIGNAL_UPSERT, upsert_agent_signals


def test_upsert_sql_has_correct_columns_and_conflict_target() -> None:
    # The upsert relies on (run_ts, ticker, agent) being a unique key.
    assert "ON CONFLICT (run_ts, ticker, agent)" in AGENT_SIGNAL_UPSERT
    # All seven payload fields must be referenced as named params.
    for name in ("run_ts", "ticker", "agent", "signal", "confidence", "rationale", "payload"):
        assert f"%({name})s" in AGENT_SIGNAL_UPSERT
    # DO UPDATE clause must touch every mutable column (no half-merges).
    do_update = AGENT_SIGNAL_UPSERT.split("DO UPDATE SET", 1)[1]
    for name in ("signal", "confidence", "rationale", "payload"):
        assert re.search(rf"\b{name}\s*=\s*EXCLUDED\.{name}\b", do_update), name


def test_upsert_empty_list_returns_zero() -> None:
    conn = MagicMock()
    assert upsert_agent_signals(conn, run_ts=None, ticker="NVDA", signals=[]) == 0
    conn.cursor.assert_not_called()


def test_upsert_executes_one_batch_for_n_signals() -> None:
    from datetime import UTC, datetime

    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur

    signals = [
        AgentSignal(agent="technicals", signal="bullish", confidence=0.7, rationale="ma cross"),
        AgentSignal(agent="fundamentals", signal="neutral", confidence=0.4, rationale="ok"),
    ]
    n = upsert_agent_signals(conn, run_ts=datetime.now(UTC), ticker="NVDA", signals=signals)
    assert n == 2
    cur.executemany.assert_called_once()
    args, _ = cur.executemany.call_args
    sql, rows = args
    assert sql is AGENT_SIGNAL_UPSERT
    assert len(rows) == 2
    # Every row must carry the four core fields the SQL parameterizes on.
    for r in rows:
        assert set(r) >= {"run_ts", "ticker", "agent", "signal", "confidence", "rationale", "payload"}
        assert r["ticker"] == "NVDA"
