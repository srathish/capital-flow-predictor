"""Bull / Bear researchers — adversarial pre-trader synthesis.

Sits between the personas and the Trader. Each researcher reads the same
inputs (EvidenceBundle + 5 analyst signals + 13 persona signals) but is
*forced* to take a side:

  - BullResearcher writes the strongest LONG case, even if consensus is bearish.
  - BearResearcher writes the strongest SHORT case, even if consensus is bullish.

This forces structural disagreement into the pipeline. With 21 votes feeding
the Trader directly, a 14-bull / 7-bear split usually collapses to a confident
LONG without anyone seriously articulating why someone smart might be SHORT.
The researchers fix that by giving the Trader two sharp adversarial briefs to
reconcile, instead of a list of confidence-weighted opinions.

Pattern borrowed from TradingAgents (Stanford 2024). Each researcher must:
  1. Pick the 3-5 strongest pieces of evidence on its side.
  2. Name which of the 13 personas back its side.
  3. Pre-empt the strongest objection the other side would raise.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from cfp_agents.state import AgentSignal, AnalysisState
from cfp_agents.synthesis.base import SynthesizerAgent, signals_table


class ResearcherOutput(BaseModel):
    """Adversarial brief written by either the bull or bear researcher."""

    thesis: str = Field(
        description=(
            "1-2 sentence headline thesis for this side. State the trade and the "
            "single most important reason it works."
        )
    )
    key_evidence: list[str] = Field(
        default_factory=list,
        description=(
            "3-5 bullets, each citing a specific number or signal "
            "(e.g. 'LEAP call premium $214M with 78% sticky in OI', "
            "'gross margin expanded 380bps QoQ to 41.2%'). No vague claims."
        ),
    )
    supporting_personas: list[str] = Field(
        default_factory=list,
        description=(
            "Which of the 13 personas explicitly back this side. Use their "
            "agent names (e.g. ['buffett', 'lynch', 'damodaran'])."
        ),
    )
    counter_argument: str = Field(
        description=(
            "Pre-empt the strongest objection the other side will raise — the "
            "argument you find hardest to dismiss. Acknowledge it honestly, "
            "then explain why the trade still works."
        ),
    )
    conviction: float = Field(
        ge=0.0, le=1.0,
        description=(
            "0..1. How strong IS this side, honestly? A bull researcher on a "
            "stock where every signal is bearish should return ~0.2, not 0.8 — "
            "be calibrated, not loyal to the assigned side."
        ),
    )


_BASE_RULES = """\
Mechanical rules:
- You are taking a SIDE. You must produce the strongest case for that side
  even if you personally find the other side more compelling. Do NOT hedge.
- Cite SPECIFIC numbers from the evidence and signals — no vague claims like
  "strong fundamentals" or "good flow."
- Name PERSONAS who back your side by their agent name (buffett, burry,
  druckenmiller, taleb, soros, simons, klarman, greenblatt, minervini,
  cathie_wood, damodaran, lynch, ackman). Don't fabricate — only name personas
  that actually leaned your direction.
- counter_argument MUST acknowledge the other side's strongest point. If you
  can't find one, you are not engaging seriously — re-read the signals.
- conviction is a HONEST measure of how strong your side actually is, not a
  measure of how committed you are to it. A bull on a bearish-consensus stock
  should return low conviction, not high.

Output the structured ResearcherOutput.\
"""


BULL_SYSTEM_PROMPT = (
    "You are the BULL researcher. Your single job is to construct the strongest "
    "possible LONG case for this ticker, drawing on the EvidenceBundle and the "
    "21 agent signals. You take the long side EVEN IF the consensus is bearish.\n\n"
    + _BASE_RULES
)


BEAR_SYSTEM_PROMPT = (
    "You are the BEAR researcher. Your single job is to construct the strongest "
    "possible SHORT case for this ticker, drawing on the EvidenceBundle and the "
    "21 agent signals. You take the short side EVEN IF the consensus is bullish.\n\n"
    + _BASE_RULES
)


def _build_user_prompt(state: AnalysisState, side: str) -> str:
    ticker = state.get("ticker", "?")
    sector = state.get("sector", "")
    return (
        f"Construct the strongest {side.upper()} case for {ticker} "
        f"(sector ETF: {sector or 'unknown'}).\n\n"
        f"All agent signals (use these as your inputs — do not invent evidence):\n"
        f"{signals_table(state)}\n\n"
        f"Produce the ResearcherOutput. Remember: you are the {side} researcher; "
        f"build the {side} case even if consensus disagrees."
    )


class BullResearcher(SynthesizerAgent):
    name = "bull_researcher"
    system_prompt = BULL_SYSTEM_PROMPT
    output_state_key = "bull_research"

    def output_format(self) -> type[BaseModel]:
        return ResearcherOutput

    def build_user_prompt(self, state: AnalysisState) -> str:
        return _build_user_prompt(state, "bull")

    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:
        assert isinstance(parsed, ResearcherOutput)
        return AgentSignal(
            agent=self.name,
            signal="bullish",
            confidence=parsed.conviction,
            rationale=parsed.thesis,
            payload={
                "thesis": parsed.thesis,
                "key_evidence": parsed.key_evidence,
                "supporting_personas": parsed.supporting_personas,
                "counter_argument": parsed.counter_argument,
                "conviction": parsed.conviction,
                "model": self._llm.model,
            },
        )


class BearResearcher(SynthesizerAgent):
    name = "bear_researcher"
    system_prompt = BEAR_SYSTEM_PROMPT
    output_state_key = "bear_research"

    def output_format(self) -> type[BaseModel]:
        return ResearcherOutput

    def build_user_prompt(self, state: AnalysisState) -> str:
        return _build_user_prompt(state, "bear")

    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:
        assert isinstance(parsed, ResearcherOutput)
        return AgentSignal(
            agent=self.name,
            signal="bearish",
            confidence=parsed.conviction,
            rationale=parsed.thesis,
            payload={
                "thesis": parsed.thesis,
                "key_evidence": parsed.key_evidence,
                "supporting_personas": parsed.supporting_personas,
                "counter_argument": parsed.counter_argument,
                "conviction": parsed.conviction,
                "model": self._llm.model,
            },
        )
