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
from pydantic import BaseModel, Field, field_validator

from cfp_agents.state import AgentSignal, AnalysisState
from cfp_agents.synthesis.base import SynthesizerAgent, aggregate_vote, signals_table

MAX_PER_POSITION = 0.10  # 10% portfolio cap per single name
HIGH_VOL_THRESHOLD = 0.40  # annualized realized vol above which we halve sizing


class RiskAssessment(BaseModel):
    target_weight: float = Field(
        ge=0.0, le=1.0,
        description="Recommended portfolio weight (0..1). 0 = no position.",
    )
    # Models occasionally emit a signed delta (-0.10) instead of the magnitude
    # the schema asks for (0.10). Accept either and coerce to absolute via the
    # validator below — clamps to (0, 1] so we never persist nonsense.
    max_stop_loss: float = Field(
        le=1.0,
        description="Drawdown magnitude from entry that triggers exit (e.g. 0.10 = -10%). Always positive.",
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

    @field_validator("max_stop_loss", mode="before")
    @classmethod
    def _coerce_stop_loss(cls, v: float | int | str) -> float:
        """Coerce signed deltas (-0.10) to magnitude (0.10) and floor at a small
        positive so a stop of literally zero doesn't get persisted as 'no stop'."""
        try:
            f = abs(float(v))
        except (TypeError, ValueError):
            return 0.10
        return max(0.005, min(f, 1.0))


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
    """Compute baseline target weight from trader confidence + Kelly + regime + vol.

    Layered sizing (each multiplier defends a different lens):
      1. Kelly fraction from (win_prob = trader.confidence, win_loss_ratio = 2)
      2. Half-Kelly haircut + per-position cap (10%)
      3. Regime multiplier (1.0 bull / 0.5 chop / 0.0 bear) from the EvidenceBundle
      4. Vol scale: realized vol > 40% halves the position
      5. Vote alignment: if the weighted ensemble vote contradicts the trader's
         direction, halve the position again

    The breakdown dict is what the LLM commentary sees, so naming matches the
    fields personas can reference (kelly_raw, regime, etc.).
    """
    trader: AgentSignal | None = state.get("trader_decision")
    if trader is None:
        return 0.0, {"reason": "no_trader_decision"}

    direction = (trader.payload or {}).get("direction", "wait")
    if direction in {"avoid", "wait"}:
        return 0.0, {"reason": f"trader_direction={direction}", "direction": direction}

    # Kelly + caps live in cfp_models so the API can call the same math when
    # backtesting position sizing without re-importing the agent stack.
    from cfp_models.position_sizing import PositionSizingConfig, size_position

    # Pull regime context off the EvidenceBundle when present; default to chop
    # (0.5 risk_multiplier) so a missing bundle still gets a reasonable sizing.
    bundle = state.get("evidence")
    regime_mult = 0.5
    regime_label = "unknown"
    if bundle is not None and getattr(bundle, "market_regime", None) is not None:
        regime_mult = float(bundle.market_regime.risk_multiplier or 0.5)
        regime_label = bundle.market_regime.regime or "unknown"

    vol = _latest_realized_vol(state.get("prices"))
    vol_scale = 1.0
    if vol is not None and vol > HIGH_VOL_THRESHOLD:
        vol_scale = 0.5

    # Vote alignment sanity check (preserves v1 behavior).
    agg = aggregate_vote(state)
    direction_sign = {"long": 1.0, "short": -1.0}.get(direction, 0.0)
    vote_aligned = (agg["weighted_score"] * direction_sign) > 0

    sizing = size_position(
        win_prob=max(0.0, min(1.0, trader.confidence)),
        win_loss_ratio=2.0,  # canonical 2:1 reward:risk for a thesis-driven position
        regime_multiplier=regime_mult,
        current_drawdown=0.0,  # no portfolio-level DD telemetry yet
        cfg=PositionSizingConfig(max_per_position=MAX_PER_POSITION, kelly_haircut=0.5),
    )
    weight = sizing["final_size"] * vol_scale
    if not vote_aligned:
        weight *= 0.5

    return weight, {
        "kelly_raw": sizing["kelly_raw"],
        "kelly_sized": sizing["kelly_sized"],
        "regime": regime_label,
        "regime_mult": regime_mult,
        "vol_scale": vol_scale,
        "realized_vol_20d": vol,
        "vote_aligned": vote_aligned,
        "direction": direction,
        "trader_confidence": trader.confidence,
        # `base` is kept for backward-compat with existing prompt/log code that
        # references it; equals the half-Kelly sized fraction before regime/vol.
        "base": sizing["kelly_sized"],
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
