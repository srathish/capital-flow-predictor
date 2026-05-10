"""Shared base class for synthesis-stage agents (Trader / Risk / PM).

Each subclass:
  - declares its ``name`` and ``system_prompt``
  - declares ``output_state_key`` — which key in AnalysisState gets the result
  - implements ``build_user_prompt(state)``
  - implements ``output_format`` (a Pydantic class) for ``messages.parse()``
  - implements ``to_signal(parsed)`` to map the Pydantic result to AgentSignal

Synthesizers run *sequentially* (after personas), so they can read what earlier
synthesizers wrote.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from pydantic import BaseModel

from cfp_agents.llm import LlmClient
from cfp_agents.state import AgentSignal, AnalysisState


class SynthesizerAgent(ABC):
    name: ClassVar[str] = "synthesizer"
    system_prompt: ClassVar[str] = ""
    output_state_key: ClassVar[str] = ""  # e.g. "trader_decision"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self._llm = llm or LlmClient()

    def __call__(self, state: AnalysisState) -> dict:
        signal = self.analyze(state)
        return {self.output_state_key: signal}

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")

        if not self._llm.available:
            return self._neutral_fallback(
                ticker, f"LLM provider {self._llm.provider!r} unavailable (missing API key); LLM call skipped"
            )

        try:
            user_prompt = self.build_user_prompt(state)
        except Exception as e:
            return self._neutral_fallback(ticker, f"prompt build failed: {e}")

        try:
            parsed = self._llm.parse(
                system_prompt=self.system_prompt,
                user_prompt=user_prompt,
                output_format=self.output_format(),
                max_tokens=1500,
                trace_name=f"synth.{self.name}",
                trace_metadata={"ticker": ticker, "kind": "synthesis", "agent": self.name},
            )
        except Exception as e:
            return self._neutral_fallback(
                ticker, f"LLM call failed: {type(e).__name__}: {e}"
            )

        if parsed is None:
            return self._neutral_fallback(ticker, "empty LLM response")

        return self.to_signal(parsed, ticker=ticker)

    def _neutral_fallback(self, ticker: str, reason: str) -> AgentSignal:
        return AgentSignal(
            agent=self.name,
            signal="neutral",
            confidence=0.0,
            rationale=f"{ticker}: {reason}",
            payload={"stub": True, "reason": reason},
        )

    @abstractmethod
    def build_user_prompt(self, state: AnalysisState) -> str:
        ...

    @abstractmethod
    def output_format(self) -> type[BaseModel]:
        ...

    @abstractmethod
    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:
        ...


def signals_table(state: AnalysisState) -> str:
    """Render the analyst + persona signal lists as a compact table for prompts."""
    analyst_signals = state.get("analyst_signals", []) or []
    persona_signals = state.get("persona_signals", []) or []

    lines: list[str] = []
    if analyst_signals:
        lines.append("Quantitative analysts:")
        for s in analyst_signals:
            lines.append(
                f"  - {s.agent}: {s.signal} (conf {s.confidence:.2f}) — {s.rationale}"
            )
    if persona_signals:
        lines.append("\nFamous-investor personas:")
        for s in persona_signals:
            lines.append(
                f"  - {s.agent}: {s.signal} (conf {s.confidence:.2f}) — {s.rationale}"
            )

    return "\n".join(lines) if lines else "(no signals available)"


def aggregate_vote(state: AnalysisState) -> dict:
    """Compute a quick deterministic aggregate of all agent signals.

    Useful for the Risk Manager (which mixes math + LLM) and as a sanity check
    in the Trader's user prompt.

    Returns: {n_agents, bull_count, bear_count, neutral_count, weighted_score}
    where weighted_score = sum(confidence * sign(signal)) / n_agents, in [-1, 1].
    """
    all_signals = (state.get("analyst_signals") or []) + (state.get("persona_signals") or [])
    n = len(all_signals)
    if n == 0:
        return {
            "n_agents": 0, "bull_count": 0, "bear_count": 0, "neutral_count": 0,
            "weighted_score": 0.0,
        }

    bull = sum(1 for s in all_signals if s.signal == "bullish")
    bear = sum(1 for s in all_signals if s.signal == "bearish")
    neutral = sum(1 for s in all_signals if s.signal == "neutral")

    score = 0.0
    for s in all_signals:
        sign = {"bullish": 1.0, "bearish": -1.0, "neutral": 0.0}[s.signal]
        score += s.confidence * sign
    score /= n

    return {
        "n_agents": n,
        "bull_count": bull,
        "bear_count": bear,
        "neutral_count": neutral,
        "weighted_score": score,
    }
