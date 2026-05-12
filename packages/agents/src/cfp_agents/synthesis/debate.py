"""Debate stage — structured cross-examination between the strongest
bullish and bearish personas.

Sits between the persona pass and the bull/bear researchers. Until now the
trader saw 13 independent persona votes plus two adversarial researcher
briefs that *summarized* the bull/bear cases. The summaries didn't
actually engage with each other — they restated their own side.

The debate forces real engagement. After all 13 personas vote we pick:

  top_bull = the persona with max confidence among signal=='bullish'
  top_bear = the persona with max confidence among signal=='bearish'

Then each is shown the OTHER's thesis + key_evidence, and asked to write
one structured rebuttal:

  - target_claim:     the single piece of opponent evidence that, if true,
                      would actually flip your call.
  - flip_condition:   the explicit condition under which you would flip.
  - why_it_is_wrong:  why you don't think the target_claim holds.
  - confidence_after: how confident you remain after considering it.

The two rebuttals (bull_rebuttal, bear_rebuttal) flow into the existing
researcher prompts (which now treat them as cross-examination input, not
just persona votes) and into the trader (which sees the load-bearing
disagreement explicitly instead of inferring it from the vote count).

Cost: +2 LLM calls per ticker.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from cfp_agents.llm import LlmClient
from cfp_agents.state import AgentSignal, AnalysisState, llm_override_for

# ───────────────────────── Output schema ─────────────────────────


class RebuttalOutput(BaseModel):
    """One side's structured cross-examination of the other side's strongest
    persona."""

    target_claim: str = Field(
        description=(
            "Quote or paraphrase the SINGLE piece of evidence in your "
            "opponent's case that — if you accepted it as true and binding — "
            "would actually flip your call. Not the weakest claim, the "
            "load-bearing one."
        )
    )
    flip_condition: str = Field(
        description=(
            "Make it explicit: 'I would flip to <opposite signal> if <X>.' "
            "Concrete and falsifiable, e.g. 'I would flip bearish if FCF "
            "margin compresses to <8% and capex stays >$2B/qtr for 2 quarters' "
            "— not 'if fundamentals deteriorate'."
        )
    )
    why_it_is_wrong: str = Field(
        description=(
            "Why the target_claim does NOT hold today, given the actual "
            "EvidenceBundle numbers. Cite a specific counter-fact. Refusing "
            "to engage ('it's just wrong') is not acceptable."
        )
    )
    confidence_after: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "Your confidence in your original side after considering the "
            "opponent's evidence. Should usually move 0.05-0.15 from the "
            "pre-debate confidence — large unchanged means you didn't "
            "engage; large drop means you should have voted the other side."
        ),
    )


# ───────────────────────── Persona picking ─────────────────────────


def _pick_top(signals: list[AgentSignal], side: Literal["bullish", "bearish"]) -> AgentSignal | None:
    """Highest-confidence persona on the given side; ``None`` if the side is
    empty (everyone voted the other way or neutral)."""
    candidates = [s for s in signals if s.signal == side]
    if not candidates:
        return None
    # Stable tie-break: highest confidence, then alphabetical agent name
    return max(candidates, key=lambda s: (s.confidence, -ord(s.agent[0]) if s.agent else 0))


def _format_opponent_case(opp: AgentSignal) -> str:
    payload = opp.payload or {}
    evidence_lines = payload.get("key_evidence") or []
    concerns = payload.get("concerns") or []
    body = [
        f"Opponent persona: **{opp.agent}** ({opp.signal}, conf {opp.confidence:.2f})",
        f"Their thesis: {opp.rationale}",
    ]
    if evidence_lines:
        body.append("Their key evidence:")
        for i, e in enumerate(evidence_lines, 1):
            body.append(f"  [{i}] {e}")
    if concerns:
        body.append("Their stated concerns about their own call:")
        for c in concerns:
            body.append(f"  - {c}")
    return "\n".join(body)


# ───────────────────────── Prompts ─────────────────────────

_DEBATE_RULES = """\
Mechanical rules for this rebuttal:
- Engage with the opponent's SPECIFIC evidence, not their conclusion. If
  you find yourself writing "they're wrong because <your own thesis>",
  rewrite — that's not engagement.
- target_claim must come from the opponent's key_evidence list, not from
  thin air. Pick the single piece that actually threatens you most.
- flip_condition must be falsifiable. "If sentiment improves" is not
  falsifiable. "If ARK net inflows turn positive 4 weeks in a row" is.
- why_it_is_wrong cites a number from the EvidenceBundle that contradicts
  the target_claim. If you can't find one, your case is weaker than you
  thought — lower confidence_after accordingly.
- confidence_after is honest. Refusing to budge means you didn't engage.

Output the structured RebuttalOutput. No preamble, no extra prose.\
"""


def _build_rebuttal_user_prompt(
    state: AnalysisState,
    *,
    self_signal: AgentSignal,
    opponent: AgentSignal,
    side: str,
) -> str:
    ticker = state.get("ticker", "?")
    own_evidence = (self_signal.payload or {}).get("key_evidence") or []
    own_evidence_block = ""
    if own_evidence:
        own_evidence_block = "\n\nYour own key evidence (do NOT just restate this):\n"
        own_evidence_block += "\n".join(f"  - {e}" for e in own_evidence)
    return (
        f"You are persona **{self_signal.agent}**. On ticker {ticker} you voted "
        f"{self_signal.signal} with confidence {self_signal.confidence:.2f}. "
        f"Your thesis: {self_signal.rationale}"
        f"{own_evidence_block}\n\n"
        f"Now read the strongest case on the OTHER side:\n\n"
        f"{_format_opponent_case(opponent)}\n\n"
        f"As the {side} side of the debate, write your rebuttal as RebuttalOutput. "
        f"Pick the single piece of THEIR evidence that, if true, would flip you, "
        f"explain the flip condition, and explain why it doesn't hold today."
    )


# ───────────────────────── Nodes ─────────────────────────


class _RebuttalNode:
    """Shared implementation for BullRebuttal and BearRebuttal.

    A LangGraph node — instantiated once and called as a function with
    ``state`` returning a dict to merge into AnalysisState.
    """

    def __init__(
        self,
        *,
        side: Literal["bull", "bear"],
        llm: LlmClient | None = None,
    ) -> None:
        self.side = side
        self.name = "bull_rebuttal" if side == "bull" else "bear_rebuttal"
        self.output_key = self.name
        self.self_signal_kind: Literal["bullish", "bearish"] = (
            "bullish" if side == "bull" else "bearish"
        )
        self.opponent_signal_kind: Literal["bullish", "bearish"] = (
            "bearish" if side == "bull" else "bullish"
        )
        self._llm = llm or LlmClient()

    def __call__(self, state: AnalysisState) -> dict:
        signal = self._run(state)
        return {self.output_key: signal}

    # ----- internal -----

    def _run(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        personas = state.get("persona_signals") or []
        self_signal = _pick_top(personas, self.self_signal_kind)
        opponent = _pick_top(personas, self.opponent_signal_kind)

        if self_signal is None or opponent is None:
            return self._neutral(
                ticker,
                f"no {self.self_signal_kind} or {self.opponent_signal_kind} persona "
                f"available; debate skipped",
            )

        if not self._llm.available:
            return self._neutral(
                ticker, f"LLM provider {self._llm.provider!r} unavailable; debate skipped"
            )

        system_prompt = (
            f"You are persona {self_signal.agent}, defending the {self.side.upper()} "
            f"side of a structured debate on {ticker}.\n\n" + _DEBATE_RULES
        )
        user_prompt = _build_rebuttal_user_prompt(
            state,
            self_signal=self_signal,
            opponent=opponent,
            side=self.side,
        )

        provider_override, model_override = llm_override_for(state)

        try:
            parsed = self._llm.parse(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                output_format=RebuttalOutput,
                max_tokens=900,
                trace_name=f"debate.{self.name}",
                trace_metadata={
                    "ticker": ticker,
                    "kind": "debate",
                    "side": self.side,
                    "self_persona": self_signal.agent,
                    "opponent_persona": opponent.agent,
                },
                provider_override=provider_override,
                model_override=model_override,
            )
        except Exception as e:
            return self._neutral(ticker, f"LLM call failed: {type(e).__name__}: {e}")

        if parsed is None:
            return self._neutral(ticker, "empty LLM response")

        return AgentSignal(
            agent=self.name,
            signal=self.self_signal_kind,
            confidence=parsed.confidence_after,
            rationale=(
                f"{self_signal.agent} rebuts {opponent.agent}: "
                f"{parsed.why_it_is_wrong}"
            ),
            payload={
                "self_persona": self_signal.agent,
                "opponent_persona": opponent.agent,
                "target_claim": parsed.target_claim,
                "flip_condition": parsed.flip_condition,
                "why_it_is_wrong": parsed.why_it_is_wrong,
                "confidence_before": self_signal.confidence,
                "confidence_after": parsed.confidence_after,
                "model": self._llm.model,
            },
        )

    def _neutral(self, ticker: str, reason: str) -> AgentSignal:
        return AgentSignal(
            agent=self.name,
            signal="neutral",
            confidence=0.0,
            rationale=f"{ticker}: {reason}",
            payload={"stub": True, "reason": reason, "side": self.side},
        )


class BullRebuttal(_RebuttalNode):
    def __init__(self, llm: LlmClient | None = None) -> None:
        super().__init__(side="bull", llm=llm)


class BearRebuttal(_RebuttalNode):
    def __init__(self, llm: LlmClient | None = None) -> None:
        super().__init__(side="bear", llm=llm)


# ───────────────────────── Helpers used by downstream prompts ─────────────────────────


def render_rebuttals(state: AnalysisState) -> str:
    """Render bull/bear rebuttals as a compact block for trader/researcher prompts."""
    bull = state.get("bull_rebuttal")
    bear = state.get("bear_rebuttal")
    sections: list[str] = []
    for side, sig in (("BULL", bull), ("BEAR", bear)):
        if sig is None:
            continue
        payload = sig.payload or {}
        if payload.get("stub"):
            continue
        self_p = payload.get("self_persona", "?")
        opp_p = payload.get("opponent_persona", "?")
        target = payload.get("target_claim", "")
        flip = payload.get("flip_condition", "")
        why = payload.get("why_it_is_wrong", "")
        before = payload.get("confidence_before")
        after = payload.get("confidence_after", sig.confidence)
        before_s = f"{before:.2f}" if isinstance(before, (int, float)) else "?"
        after_s = f"{after:.2f}" if isinstance(after, (int, float)) else "?"
        sections.append(
            f"{side} REBUTTAL — {self_p} rebutting {opp_p} (conf {before_s} → {after_s}):\n"
            f"  Target claim: {target}\n"
            f"  Flip condition: {flip}\n"
            f"  Why it's wrong: {why}"
        )
    return "\n\n".join(sections) if sections else "(no rebuttals; debate stage skipped)"
