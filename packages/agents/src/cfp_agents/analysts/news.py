"""News analyst — STUB.

Will eventually consume FMP /stable/news, SEC 8-K filings, or NewsAPI.
Until then it returns neutral with a no-data rationale.
"""

from __future__ import annotations

from cfp_agents.base import BaseAnalyst
from cfp_agents.state import AgentSignal, AnalysisState


class NewsAnalyst(BaseAnalyst):
    name = "news"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        return AgentSignal(
            agent=self.name,
            signal="neutral",
            confidence=0.0,
            rationale=f"{ticker}: news feed not yet connected",
            payload={"stub": True},
        )
