"""Sentiment analyst — STUB.

This is a placeholder until the Reddit + StockTwits + Trends ingestion lands.
Returns a neutral signal with explicit "no data" rationale so downstream
agents (researchers, portfolio manager) know to ignore it rather than
treating "no signal" as a real neutral vote.
"""

from __future__ import annotations

from cfp_agents.base import BaseAnalyst
from cfp_agents.state import AgentSignal, AnalysisState


class SentimentAnalyst(BaseAnalyst):
    name = "sentiment"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        return AgentSignal(
            agent=self.name,
            signal="neutral",
            confidence=0.0,
            rationale=f"{ticker}: sentiment feed not yet connected (Reddit/StockTwits/Trends pending)",
            payload={"stub": True},
        )
