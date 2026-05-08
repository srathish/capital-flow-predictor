"""Shared state and signal schemas for the agent ensemble.

`AnalysisState` is the object that flows through the LangGraph. Each node
reads what it needs and writes its output back. We use a TypedDict so the
graph framework's reducers (operator.add for lists, etc.) work cleanly.
"""

from __future__ import annotations

import operator
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, TypedDict

import pandas as pd
from cfp_shared import EvidenceBundle

Signal = Literal["bullish", "bearish", "neutral"]


@dataclass
class AgentSignal:
    """Single agent's verdict on a ticker."""

    agent: str
    signal: Signal
    confidence: float  # 0..1
    rationale: str
    payload: dict[str, Any] = field(default_factory=dict)

    def to_db_row(self, run_ts: pd.Timestamp, ticker: str) -> dict:
        return {
            "run_ts": run_ts,
            "ticker": ticker,
            "agent": self.agent,
            "signal": self.signal,
            "confidence": float(self.confidence),
            "rationale": self.rationale,
            "payload": self.payload,
        }


class AnalysisState(TypedDict, total=False):
    """State passed through the LangGraph for one ticker.

    Inputs (set by the runner before .invoke()):
      ticker, sector, prices, fundamentals

    Outputs (filled in by analyst nodes; appended via operator.add):
      analyst_signals
    """

    # Inputs
    ticker: str
    sector: str
    prices: pd.DataFrame  # ts, open, high, low, close, volume
    fundamentals: pd.DataFrame  # fiscal_period, period_type, metric, value
    # Canonical evidence bundle — populated by the agent runner before
    # .invoke(). All agents (analysts + personas + synthesis) read from
    # state["evidence"]. Personas no longer have extra_context() hooks;
    # they have lens() methods that pick fields from this same bundle.
    evidence: EvidenceBundle

    # Outputs from analyst nodes (lists merged by LangGraph via the reducer)
    analyst_signals: Annotated[list[AgentSignal], operator.add]
    # Outputs from persona nodes (Phase 4c)
    persona_signals: Annotated[list[AgentSignal], operator.add]
    # Outputs from synthesis nodes (Phase 4d) — single signals, not lists
    trader_decision: AgentSignal
    risk_assessment: AgentSignal
    portfolio_decision: AgentSignal
