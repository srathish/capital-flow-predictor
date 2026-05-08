"""Technicals analyst: rule-based signal from PriceContext (already computed
in the EvidenceBundle).

Heuristics (same as before — Phase 4b is rule-based, no LLM):
  + Trend: close above MA50 and MA50 above MA200 -> uptrend (bullish)
  + Momentum: 20d return > 5% -> mild bullish
  + Mean reversion: RSI(14) < 30 -> oversold (bullish), > 70 -> overbought (bearish)
  + Volume conviction: 20d volume z-score scales confidence

PriceContext fields are populated once at bundle-build time (see
cfp_jobs.agents_runner._compute_price_context). The analyst is now a pure
scorer over those fields, not a feature engineer.
"""

from __future__ import annotations

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.bundle_compute import compute_price_context
from cfp_agents.state import AgentSignal, AnalysisState


class TechnicalsAnalyst(BaseAnalyst):
    name = "technicals"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        bundle = state.get("evidence")

        # Prefer the canonical PriceContext from the bundle. If no bundle was
        # attached (tests or direct callers), fall back to computing it on
        # the fly from state["prices"].
        if bundle is not None:
            pc = bundle.price_context
        else:
            pc = compute_price_context(state.get("prices"))

        if pc.bars_count == 0:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no price data",
            )
        if pc.bars_count < 50:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.1,
                rationale=f"{ticker}: only {pc.bars_count} bars, insufficient history",
            )

        ma50_dist = pc.ma50_dist
        ma200_dist = pc.ma200_dist
        ret_20 = pc.return_20d if pc.return_20d is not None else 0.0
        rsi = pc.rsi_14 if pc.rsi_14 is not None else 50.0
        vol_z = pc.volume_z_20d if pc.volume_z_20d is not None else 0.0

        # --- score components, each in roughly -1..+1 ---
        trend = 0.0
        if ma200_dist is not None and ma50_dist is not None:
            # close > MA50 > MA200 means ma50_dist > 0 AND last > ma200 (ma200_dist > 0)
            if ma50_dist > 0 and ma200_dist > 0:
                trend = 0.8
            elif ma50_dist < 0 and ma200_dist < 0:
                trend = -0.8
            elif ma50_dist > 0:
                trend = 0.3
            elif ma50_dist < 0:
                trend = -0.3
        elif ma50_dist is not None:
            trend = 0.3 if ma50_dist > 0 else -0.3

        momentum = clamp(ret_20 * 5.0, -1.0, 1.0)  # ±20% -> ±1.0

        mean_rev = 0.0
        if rsi < 30:
            mean_rev = 0.6
        elif rsi > 70:
            mean_rev = -0.4
        elif rsi < 40:
            mean_rev = 0.2
        elif rsi > 60:
            mean_rev = -0.1

        # --- aggregate ---
        score = 0.5 * trend + 0.3 * momentum + 0.2 * mean_rev
        score = clamp(score, -1.0, 1.0)

        confidence = clamp(abs(score) * (1.0 + 0.2 * clamp(vol_z, 0, 3) / 3))

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.15),
            confidence=confidence,
            rationale=(
                f"{ticker}: trend={trend:+.2f} momentum={momentum:+.2f} "
                f"rsi={rsi:.0f} vol_z={vol_z:+.1f} -> score={score:+.2f}"
            ),
            payload={
                "score": score,
                "trend": trend,
                "momentum_20d": ret_20,
                "rsi_14": rsi,
                "ma50_dist": ma50_dist,
                "ma200_dist": ma200_dist,
                "volume_z": vol_z,
            },
        )
