"""Portfolio Manager — final approval and target weight.

Reads the Trader's thesis and the Risk Manager's assessment, applies a final
sanity check, and emits the watchlist-ready decision: long / short / avoid plus
the actual size we'd put on.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from cfp_agents.state import AgentSignal, AnalysisState
from cfp_agents.synthesis.base import SynthesizerAgent


class PortfolioDecision(BaseModel):
    final_signal: Literal["long", "short", "avoid"] = Field(
        description="Final position: long, short, or avoid. No 'wait' here — make the call."
    )
    target_weight: float = Field(
        ge=0.0, le=1.0,
        description="Final portfolio weight (0..1). 0 if avoid.",
    )
    confidence: float = Field(ge=0.0, le=1.0)
    final_thesis: str = Field(
        description="Two- to three-sentence final verdict. This goes in the watchlist."
    )
    reasoning_notes: list[str] = Field(
        default_factory=list,
        description="Bullets explaining how Trader + Risk Manager were reconciled.",
    )


SYSTEM_PROMPT = """\
You are the Portfolio Manager. The Trader has made a position recommendation and
the Risk Manager has assessed it. Your job is to make the final call and write the
single sentence that goes into the watchlist.

Reconciliation rules:
- If Risk Manager vetoed: final_signal must be "avoid" and target_weight must be 0.
- If the Risk Manager halved the weight, respect that — they're saying conviction is
  not yet at full size.
- If Trader said "wait" or "avoid": final_signal is "avoid", target_weight 0.
- For a real position, target_weight should equal the Risk Manager's target unless
  you have a specific reason to override.

Be decisive. The watchlist downstream needs a clean long/short/avoid call — no hedges.

Output the structured PortfolioDecision.\
"""


class PortfolioManager(SynthesizerAgent):
    name = "portfolio_manager"
    system_prompt = SYSTEM_PROMPT
    output_state_key = "portfolio_decision"

    def output_format(self) -> type[BaseModel]:
        return PortfolioDecision

    def build_user_prompt(self, state: AnalysisState) -> str:
        ticker = state.get("ticker", "?")
        sector = state.get("sector", "")
        trader: AgentSignal | None = state.get("trader_decision")
        risk: AgentSignal | None = state.get("risk_assessment")

        if trader is None or risk is None:
            return (
                f"Make a final portfolio decision for {ticker} (sector ETF: {sector}).\n"
                "Trader and Risk Manager outputs are missing — recommend avoid."
            )

        trader_payload = trader.payload or {}
        risk_payload = risk.payload or {}

        # Tolerant formatters — Trader or Risk Manager may have hit a graceful
        # fallback (e.g. transient LLM error) and left a stub payload without
        # the usual fields. Don't blow up on missing keys.
        def _f(v: object, *, pct: bool = False, dec: int = 3) -> str:
            if v is None:
                return "n/a"
            try:
                fv = float(v)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return str(v)
            return f"{fv:.{dec}{'%' if pct else 'f'}}"

        return (
            f"Final decision for {ticker} (sector ETF: {sector or 'unknown'}).\n\n"
            f"TRADER:\n"
            f"  Direction: {trader_payload.get('direction', 'n/a')}\n"
            f"  Confidence: {trader.confidence:.2f}\n"
            f"  Thesis: {trader.rationale}\n"
            f"  Bull summary: {'; '.join(trader_payload.get('bull_summary', []))}\n"
            f"  Bear summary: {'; '.join(trader_payload.get('bear_summary', []))}\n"
            f"  Key risks: {'; '.join(trader_payload.get('key_risks', []))}\n\n"
            f"RISK MANAGER:\n"
            f"  Target weight: {_f(risk_payload.get('target_weight'))}\n"
            f"  Max stop loss: {_f(risk_payload.get('max_stop_loss'), pct=True, dec=2)}\n"
            f"  Veto: {risk_payload.get('veto', False)}"
            + (f" ({risk_payload.get('veto_reason')})" if risk_payload.get('veto') else "") +
            "\n"
            f"  Regime concern: {risk_payload.get('regime_concern', 'n/a')}\n"
            f"  Correlation caveat: {risk_payload.get('correlation_caveat', '')}\n"
            f"  Rationale: {risk.rationale}\n\n"
            "Reconcile and produce the PortfolioDecision."
        )

    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:
        assert isinstance(parsed, PortfolioDecision)
        sig_map = {"long": "bullish", "short": "bearish", "avoid": "neutral"}
        return AgentSignal(
            agent=self.name,
            signal=sig_map[parsed.final_signal],
            confidence=parsed.confidence,
            rationale=parsed.final_thesis,
            payload={
                "final_signal": parsed.final_signal,
                "target_weight": parsed.target_weight,
                "reasoning_notes": parsed.reasoning_notes,
                "model": self._llm.model,
            },
        )
