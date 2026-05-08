"""Risk Manager — deterministic position sizing + LLM tail-risk commentary.

The math is deterministic so that sizing is reproducible and reviewable. The LLM
adds qualitative commentary on correlation risk, regime fragility, and whether
this position is sized correctly given the broader portfolio context.

Position-sizing rule (Phase 4d v1, deliberately simple):
  base_weight = trader.confidence * max_per_position
  if trader.direction == 'avoid' or 'wait': target_weight = 0
  if realized_vol_20d > 0.40 (annualized): scale by 0.5
  if weighted_vote_score has sign opposite to trader direction: veto

Sizing constants are tunable; the v1 defaults match a "modest concentration"
portfolio with max ~10% per name.
"""

from __future__ import annotations

from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field

from cfp_agents.state import AgentSignal, AnalysisState
from cfp_agents.synthesis.base import SynthesizerAgent, aggregate_vote, signals_table

MAX_PER_POSITION = 0.10  # 10% portfolio cap per single name
HIGH_VOL_THRESHOLD = 0.40  # annualized realized vol above which we halve sizing


class RiskAssessment(BaseModel):
    target_weight: float = Field(
        ge=0.0, le=1.0,
        description="Recommended portfolio weight (0..1). 0 = no position.",
    )
    max_stop_loss: float = Field(
        ge=0.0, le=1.0,
        description="Drawdown threshold from entry that triggers exit (e.g. 0.10 = -10%).",
    )
    veto: bool = Field(
        description="True if risk considerations override the trader's direction (size to zero).",
    )
    veto_reason: str = Field(
        default="",
        description="If veto is True, the specific risk reason. Empty otherwise.",
    )
    regime_concern: Literal["low", "medium", "high"] = Field(
        description="How fragile is this position to a macro/regime shift?",
    )
    rationale: str = Field(description="One- to two-sentence risk commentary.")
    correlation_caveat: str = Field(
        default="",
        description="Notes on correlation with likely existing exposures (broader market beta, sector clustering).",
    )


SYSTEM_PROMPT = """\
You are the Risk Manager. The Trader has proposed a position. Your job is to
evaluate it under risk lenses the Trader may have downplayed:

- Tail risk: what's the drawdown if this thesis is wrong?
- Correlation: this position vs. likely existing exposures (broader market beta, sector clustering)
- Regime sensitivity: would a hostile macro shift flip this?
- Position sizing: is the target weight calibrated to conviction AND uncertainty?

You will be given:
- The Trader's direction and confidence
- A deterministic baseline target weight (already computed from sizing math)
- The 17 agent signals (analysts + personas) for context

You may VETO the position if a specific tail risk makes it unwise (e.g., the
analysts agree but every macro persona is bearish on the regime). Veto sparingly —
it means "don't do this even though the Trader said long."

Output the structured RiskAssessment. The deterministic baseline `target_weight`
will be used unless you veto (in which case it goes to 0).\
"""


def _latest_realized_vol(prices: pd.DataFrame | None) -> float | None:
    """Compute 20d annualized realized vol from daily close. Returns None if insufficient data."""
    if prices is None or prices.empty or "close" not in prices.columns:
        return None
    close = prices.sort_values("ts")["close"].astype(float)
    if len(close) < 21:
        return None
    import numpy as np
    log_ret = np.log(close / close.shift(1)).dropna()
    if len(log_ret) < 20:
        return None
    return float(log_ret.rolling(20).std().iloc[-1] * (252 ** 0.5))


def deterministic_target_weight(state: AnalysisState) -> tuple[float, dict]:
    """Compute baseline target weight from trader confidence + vol scaling.

    Returns (weight, breakdown) where breakdown explains the components.
    """
    trader: AgentSignal | None = state.get("trader_decision")
    if trader is None:
        return 0.0, {"reason": "no_trader_decision"}

    direction = (trader.payload or {}).get("direction", "wait")
    if direction in {"avoid", "wait"}:
        return 0.0, {"reason": f"trader_direction={direction}"}

    base = trader.confidence * MAX_PER_POSITION
    vol = _latest_realized_vol(state.get("prices"))
    vol_scale = 1.0
    if vol is not None and vol > HIGH_VOL_THRESHOLD:
        vol_scale = 0.5

    # Sanity check: vote agrees with trader direction?
    agg = aggregate_vote(state)
    direction_sign = {"long": 1.0, "short": -1.0}.get(direction, 0.0)
    vote_aligned = (agg["weighted_score"] * direction_sign) > 0

    weight = base * vol_scale
    if not vote_aligned:
        weight *= 0.5  # vote disagrees with trader direction — half size

    return weight, {
        "base": base,
        "vol_scale": vol_scale,
        "realized_vol_20d": vol,
        "vote_aligned": vote_aligned,
        "direction": direction,
        "trader_confidence": trader.confidence,
    }


class RiskManager(SynthesizerAgent):
    name = "risk_manager"
    system_prompt = SYSTEM_PROMPT
    output_state_key = "risk_assessment"

    def output_format(self) -> type[BaseModel]:
        return RiskAssessment

    def build_user_prompt(self, state: AnalysisState) -> str:
        ticker = state.get("ticker", "?")
        baseline_weight, breakdown = deterministic_target_weight(state)
        trader = state.get("trader_decision")
        trader_summary = (
            f"Trader direction={breakdown.get('direction', 'n/a')} "
            f"confidence={trader.confidence:.2f}: {trader.rationale}"
            if trader
            else "(no Trader decision available)"
        )
        vol = breakdown.get("realized_vol_20d")
        vol_str = f"{vol:.1%}" if vol is not None else "n/a"

        return (
            f"Evaluate the position risk for {ticker}.\n\n"
            f"Trader's view: {trader_summary}\n\n"
            f"Deterministic sizing baseline: target_weight={baseline_weight:.3f}\n"
            f"  - Base (confidence * max_per_position={MAX_PER_POSITION:.2f}): "
            f"{breakdown.get('base', 0):.3f}\n"
            f"  - Realized vol (20d annualized): {vol_str}; vol_scale={breakdown.get('vol_scale', 1.0)}\n"
            f"  - Vote aligned with direction: {breakdown.get('vote_aligned')}\n\n"
            f"Underlying agent signals:\n{signals_table(state)}\n\n"
            "Produce the RiskAssessment. If you accept the deterministic baseline weight, "
            f"return target_weight={baseline_weight:.3f}. If you veto, return 0.0 with veto_reason."
        )

    def to_signal(self, parsed: BaseModel, *, ticker: str) -> AgentSignal:
        assert isinstance(parsed, RiskAssessment)
        weight = 0.0 if parsed.veto else parsed.target_weight
        sig = "neutral"
        return AgentSignal(
            agent=self.name,
            signal=sig,
            confidence=1.0 - {"low": 0.0, "medium": 0.3, "high": 0.6}[parsed.regime_concern],
            rationale=parsed.rationale,
            payload={
                "target_weight": weight,
                "max_stop_loss": parsed.max_stop_loss,
                "veto": parsed.veto,
                "veto_reason": parsed.veto_reason,
                "regime_concern": parsed.regime_concern,
                "correlation_caveat": parsed.correlation_caveat,
                "model": self._llm.model,
            },
        )
