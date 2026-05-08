"""Trader — synthesizes 17 agent signals into a position thesis."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from cfp_agents.state import AgentSignal, AnalysisState
from cfp_agents.synthesis.base import SynthesizerAgent, aggregate_vote, signals_table


class TraderDecision(BaseModel):
    direction: Literal["long", "short", "avoid", "wait"] = Field(
        description=(
            "Position direction: long (buy), short (sell), avoid (skip entirely), "
            "wait (interesting but no clear edge yet)."
        )
    )
    confidence: float = Field(ge=0.0, le=1.0)
    thesis: str = Field(description="One- to two-sentence position thesis.")
    bull_summary: list[str] = Field(
        default_factory=list,
        description="3-5 bullets of the strongest bullish arguments raised by the agents.",
    )
    bear_summary: list[str] = Field(
        default_factory=list,
        description="3-5 bullets of the strongest bearish arguments raised by the agents.",
    )
    key_risks: list[str] = Field(
        default_factory=list,
        description="1-3 specific risks that, if realized, would invalidate this thesis.",
    )


SYSTEM_PROMPT = """\
You are the Trader. Seventeen specialized agents — quantitative analysts and
famous-investor personas with very different philosophies — have each rendered
a verdict on a single ticker. Your job is to synthesize their signals into a
single tradeable position thesis.

Approach:
- Take stronger signals over weaker ones (confidence-weighted).
- Notice WHO disagrees and WHY. A bullish Buffett + bearish Burry is a real conflict.
  Crowded agreement may itself be a warning sign.
- Distill the bull case and the bear case as the agents collectively articulated them.
- Pick a direction: long, short, avoid, or wait.
  - long / short: clear edge in your direction
  - avoid: too many irreconcilable concerns; skip
  - wait: interesting but no clear catalyst yet
- Be calibrated. Confidence 0.5 is a coin flip — be willing to use the full range.

Output the structured TraderDecision.\
"""


class Trader(SynthesizerAgent):
    name = "trader"
    system_prompt = SYSTEM_PROMPT
    output_state_key = "trader_decision"

    def output_format(self) -> type[BaseModel]:
        return TraderDecision

    def build_user_prompt(self, state: AnalysisState) -> str:
        ticker = state.get("ticker", "?")
        sector = state.get("sector", "")
        agg = aggregate_vote(state)
        return (
            f"Synthesize a position decision for {ticker} (sector ETF: {sector or 'unknown'}).\n\n"
            f"Aggregate vote: bull={agg['bull_count']}, bear={agg['bear_count']}, "
            f"neutral={agg['neutral_count']}, weighted score={agg['weighted_score']:+.3f}\n\n"
            f"Agent verdicts:\n{signals_table(state)}\n\n"
            "Produce the TraderDecision.\n\n"
            "Quality bar:\n"
            "- thesis: 2-3 complete sentences naming WHO disagrees and WHY, "
            "and how you reconciled them.\n"
            "- bull_summary: 3-5 bullets, each attributable to a specific persona "
            "or analyst (e.g. 'Druckenmiller: macro tailwind from accommodative Fed').\n"
            "- bear_summary: 3-5 bullets, same attribution requirement.\n"
            "- key_risks: 1-3 specific catalysts that would force a thesis change."
        )

    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:
        assert isinstance(parsed, TraderDecision)
        # Map direction to signal so it lives in agent_signals consistently
        sig_map = {"long": "bullish", "short": "bearish", "avoid": "neutral", "wait": "neutral"}
        return AgentSignal(
            agent=self.name,
            signal=sig_map[parsed.direction],
            confidence=parsed.confidence,
            rationale=parsed.thesis,
            payload={
                "direction": parsed.direction,
                "bull_summary": parsed.bull_summary,
                "bear_summary": parsed.bear_summary,
                "key_risks": parsed.key_risks,
                "model": self._llm.model,
            },
        )
