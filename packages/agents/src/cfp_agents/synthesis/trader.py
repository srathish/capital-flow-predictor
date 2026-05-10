"""Trader — reconciles bull and bear researcher briefs into a position thesis."""

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
You are the Trader. Two researchers — a Bull and a Bear — have each been
forced to construct the strongest possible case for their assigned side,
drawing on the same underlying signals (5 quantitative analysts + 13
famous-investor personas). Your job is to ADJUDICATE between them and
produce a single tradeable position thesis.

Approach:
- Read the bull brief AND the bear brief carefully. Each one has cited
  specific evidence and pre-empted the other side's strongest objection.
- Decide which case is structurally stronger — not by counting votes, but
  by the QUALITY of evidence and how well each side handled the counter-argument.
- Note conviction asymmetry: a bull at 0.7 vs a bear at 0.3 is a different
  signal than both at 0.5. Calibrated researchers will report low conviction
  when their assigned side is weak.
- Pick a direction: long, short, avoid, or wait.
  - long / short: one researcher made a clearly stronger case
  - avoid: both made strong cases on irreconcilable axes; the trade is too
    fragile to express directionally
  - wait: interesting setup but no clear catalyst yet to force a re-rating
- Be calibrated. Confidence 0.5 is a coin flip — use the full range.

Use the bull/bear briefs as your primary input. The raw 18 agent signals
are provided as backup so you can verify the researchers' citations.

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

        bull = state.get("bull_research")
        bear = state.get("bear_research")
        bull_block = _format_brief(bull, "BULL")
        bear_block = _format_brief(bear, "BEAR")

        return (
            f"Adjudicate the position decision for {ticker} (sector ETF: {sector or 'unknown'}).\n\n"
            f"=== BULL RESEARCHER ===\n{bull_block}\n\n"
            f"=== BEAR RESEARCHER ===\n{bear_block}\n\n"
            f"=== Underlying signals (for citation verification) ===\n"
            f"Aggregate vote: bull={agg['bull_count']}, bear={agg['bear_count']}, "
            f"neutral={agg['neutral_count']}, weighted score={agg['weighted_score']:+.3f}\n\n"
            f"{signals_table(state)}\n\n"
            "Produce the TraderDecision.\n\n"
            "Quality bar:\n"
            "- thesis: 2-3 complete sentences explaining which researcher made the "
            "stronger case and WHY (which evidence carried the most weight, and how "
            "the loser handled the counter-argument).\n"
            "- bull_summary: 3-5 bullets — distill the bull researcher's case. Each "
            "bullet should be attributable (e.g. 'Druckenmiller: macro tailwind from "
            "accommodative Fed').\n"
            "- bear_summary: 3-5 bullets — distill the bear researcher's case, same "
            "attribution requirement.\n"
            "- key_risks: 1-3 specific catalysts that would force a thesis change."
        )

    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:  # noqa: ARG002
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


def _format_brief(brief: AgentSignal | None, side: str) -> str:
    """Render a researcher's AgentSignal payload into the prompt format the
    Trader sees. Falls back to a placeholder when the researcher errored so
    the Trader keeps a usable structure on partial runs."""
    if brief is None:
        return f"({side} researcher unavailable — no brief produced)"
    payload = brief.payload or {}
    thesis = payload.get("thesis", brief.rationale)
    evidence = payload.get("key_evidence", []) or []
    personas = payload.get("supporting_personas", []) or []
    counter = payload.get("counter_argument", "")
    conviction = payload.get("conviction", brief.confidence)

    lines = [
        f"Conviction: {conviction:.2f}",
        f"Thesis: {thesis}",
        "Key evidence:",
    ]
    for e in evidence[:5]:
        lines.append(f"  - {e}")
    if personas:
        lines.append(f"Supporting personas: {', '.join(personas)}")
    if counter:
        lines.append(f"Counter-argument they had to handle: {counter}")
    return "\n".join(lines)
