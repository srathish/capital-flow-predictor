"""Base classes / utilities shared across analyst nodes."""

from __future__ import annotations

from abc import ABC, abstractmethod

from cfp_agents.state import AgentSignal, AnalysisState, Signal


class BaseAnalyst(ABC):
    """An analyst node. Receives the AnalysisState, returns a partial state update.

    LangGraph nodes are plain callables; this ABC just enforces the contract
    and gives us a name for telemetry.
    """

    name: str = "base"

    def __call__(self, state: AnalysisState) -> dict:
        """LangGraph node entry point. Returns a dict to merge into state."""
        signal = self.analyze(state)
        return {"analyst_signals": [signal]}

    @abstractmethod
    def analyze(self, state: AnalysisState) -> AgentSignal:
        ...


def score_to_signal(score: float, *, neutral_band: float = 0.15) -> Signal:
    """Map a -1..+1 score to a tri-state signal with a deadband around 0."""
    if score > neutral_band:
        return "bullish"
    if score < -neutral_band:
        return "bearish"
    return "neutral"


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))
