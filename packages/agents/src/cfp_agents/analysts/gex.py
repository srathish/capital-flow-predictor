"""GEX analyst — gamma exposure structure read.

A different lens from the FlowAnalyst: we don't care here whether institutions
are bullish or bearish. We care **where price will go and how it will get
there**, based on the dealer-gamma topography:

  * King node — the largest single gamma magnet on the chain. Price tends to
    pin near it in positive-GEX regimes.
  * Floors / ceilings — strikes with concentrated put-side or call-side gamma
    that act as support / resistance.
  * Regime score — signed_total / total_abs, in [-1, +1]:
        > +0.30 = strongly positive GEX, mean-reverting (price chops around king)
        < -0.30 = strongly negative GEX, trending (breakouts run, dealers chase)
        between  = mixed
  * Air pockets — strike ranges with very little gamma. Price can move fast
    through them; targeting one is a high-velocity setup.
  * Liquidity vacuums — gamma-light zones near current spot where slippage
    risk is elevated.

Reads `bundle.positioning.skylit_*` fields. If Skylit doesn't cover the
ticker (Skylit serves ~396 names; SPY/QQQ/SPXW + the rest), every skylit_*
field is None — the analyst emits a clear "no GEX data" neutral.

Expiration awareness:
  Skylit can report structure for near-term, weekly, or LEAP expirations
  (out to ~1 year). The analyst surfaces ``skylit_expiration`` in the
  rationale so consumers know whether they're reading 0DTE chop or LEAP-
  scale positioning. Personas reading our payload can adjust their own
  time-horizon framing accordingly.

Heuristics (rule-based, transparent):
  + spot < king, king close (within 3%), positive GEX  -> mild bullish drift
  + spot > king, king close, positive GEX              -> mild bearish drift
  + spot in lower half of [floor, ceiling], pos GEX    -> bullish mean-revert
  + spot in upper half of [floor, ceiling], pos GEX    -> bearish mean-revert
  + negative GEX regime                                -> high "regime fragility"
                                                          flag; direction depends
                                                          on momentum (we don't
                                                          have it, so neutral)
  + air pocket immediately above spot (call gap)       -> upside acceleration risk
  + air pocket immediately below spot (put gap)        -> downside acceleration risk

Confidence reflects:
  - magnitude of |regime_score| (further from zero = stronger structure read)
  - distance from spot to nearest wall (closer = more decisive)
  - presence of air pockets in the bullish/bearish direction (corroboration)
"""

from __future__ import annotations

from typing import Any

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


def _pct(a: float, b: float) -> float:
    """(a - b) / b — guards against zero."""
    if not b:
        return 0.0
    return (a - b) / b


def _abs_pct(a: float, b: float) -> float:
    return abs(_pct(a, b))


class GexAnalyst(BaseAnalyst):
    name = "gex"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        bundle = state.get("evidence")
        if bundle is None:
            return AgentSignal(
                agent=self.name, signal="neutral", confidence=0.0,
                rationale=f"{ticker}: no evidence bundle in state",
                payload={"stub": True},
            )

        pos = bundle.positioning

        spot = pos.skylit_spot
        regime = pos.skylit_regime_score
        king_strike = pos.skylit_king_strike
        king_gamma = pos.skylit_king_gamma
        floor_strike = pos.skylit_floor_strike
        floor_sig = pos.skylit_floor_significance
        ceiling_strike = pos.skylit_ceiling_strike
        ceiling_sig = pos.skylit_ceiling_significance
        air_pockets = pos.skylit_air_pockets or []
        vacuums = pos.skylit_liquidity_vacuums or []
        expiration = pos.skylit_expiration

        # No coverage path — Skylit serves a curated universe (~396 names + the
        # index trio). For tickers outside that universe every skylit_* field
        # is None. Don't fabricate a signal.
        if spot is None or regime is None:
            return AgentSignal(
                agent=self.name, signal="neutral", confidence=0.0,
                rationale=(
                    f"{ticker}: no Skylit GEX coverage for this ticker. "
                    "Skylit serves ~396 names; falling back to neutral."
                ),
                payload={"has_data": False},
            )

        # ---- Compute the bull/bear directional drift implied by positioning ----
        # Convention: positive score → bullish drift, negative → bearish drift.
        score = 0.0
        reasons: list[str] = []

        # King magnet effect (only meaningful in positive-GEX regime)
        if king_strike is not None and regime > 0.10:
            d = _pct(king_strike, spot)
            if abs(d) < 0.05:  # king within 5% of spot — strong magnet
                # Positive regime + king above spot → price drawn UP to king.
                # Multiplier of 8 means a 2% king-distance clears the 0.12 neutral
                # band; a 5% king distance maxes out at the +/-0.40 cap.
                drift = clamp(d * 8.0, -0.40, 0.40)
                score += drift
                direction = "up" if d > 0 else "down"
                reasons.append(
                    f"king strike ${king_strike:.2f} sits {d * 100:+.1f}% from spot; "
                    f"positive GEX (regime {regime:+.2f}) → magnet drift {direction}"
                )

        # Position within the [floor, ceiling] channel — mean-revert in pos GEX,
        # breakout risk in neg GEX. We score the mean-revert lens here.
        if floor_strike is not None and ceiling_strike is not None and floor_strike < ceiling_strike:
            channel = ceiling_strike - floor_strike
            if channel > 0:
                pos_in_channel = (spot - floor_strike) / channel
                # 0 = at floor (mean-revert up), 1 = at ceiling (mean-revert down)
                if regime > 0.15:
                    revert_drift = (0.5 - pos_in_channel) * 0.6  # pos GEX → revert to mid
                    score += revert_drift
                    if pos_in_channel < 0.35:
                        reasons.append(
                            f"spot in lower {pos_in_channel * 100:.0f}% of [floor "
                            f"${floor_strike:.2f}, ceiling ${ceiling_strike:.2f}] "
                            f"in positive-GEX regime → mean-revert UP"
                        )
                    elif pos_in_channel > 0.65:
                        reasons.append(
                            f"spot in upper {pos_in_channel * 100:.0f}% of [floor "
                            f"${floor_strike:.2f}, ceiling ${ceiling_strike:.2f}] "
                            f"in positive-GEX regime → mean-revert DOWN"
                        )

        # Air pockets — gaps in gamma let price move fast through them
        air_above = []
        air_below = []
        for ap in air_pockets:
            lo, hi = ap.get("low"), ap.get("high")
            if lo is None or hi is None:
                continue
            if lo > spot:
                air_above.append((lo, hi))
            elif hi < spot:
                air_below.append((lo, hi))
        if air_above and not air_below:
            reasons.append(
                f"{len(air_above)} air pocket(s) above spot — upside acceleration risk"
            )
            score += 0.10
        elif air_below and not air_above:
            reasons.append(
                f"{len(air_below)} air pocket(s) below spot — downside acceleration risk"
            )
            score -= 0.10
        elif air_above and air_below:
            reasons.append(
                f"air pockets both sides ({len(air_above)} up, {len(air_below)} down) — "
                "two-way breakout risk"
            )

        # Regime concern (NOT a directional signal, but reduces confidence in
        # whatever direction we picked). Neg-GEX = trending = our mean-revert
        # math is wrong; high abs regime = strong structure either way.
        regime_concern = "low"
        if regime < -0.30:
            regime_concern = "high"
            reasons.append(
                f"strongly negative GEX (regime {regime:+.2f}) = trending regime; "
                "mean-revert assumptions don't hold — directional view halved"
            )
            score *= 0.5
        elif regime < -0.10:
            regime_concern = "medium"
        elif regime > 0.30:
            regime_concern = "low"

        # Convert to signal + confidence
        signal = score_to_signal(score, neutral_band=0.12)
        # Confidence: regime certainty × structure proximity × directional clarity
        regime_certainty = clamp(abs(regime) * 1.5)
        proximity = 0.5
        if king_strike is not None:
            proximity = clamp(1.0 - _abs_pct(king_strike, spot) * 5.0)
        directional_clarity = clamp(abs(score) * 2.0)
        confidence = round(clamp(0.4 * regime_certainty + 0.3 * proximity + 0.3 * directional_clarity), 2)

        if not reasons:
            # We have data but it doesn't favor either side. Be explicit.
            reasons.append(
                f"GEX structure present (regime {regime:+.2f}) but no decisive "
                f"directional cue — spot near king or far from walls"
            )

        expiration_note = ""
        if expiration:
            expiration_note = (
                f" Structure reflects {expiration} expiration (LEAP-scale data "
                "if dated >90d). Pair this read with the ensemble's time-horizon."
            )

        rationale = (
            f"{ticker} @ ${spot:.2f} · regime_score {regime:+.2f}. "
            + " ".join(reasons)
            + expiration_note
        )

        payload: dict[str, Any] = {
            "has_data": True,
            "spot": spot,
            "regime_score": regime,
            "regime_concern": regime_concern,
            "king_strike": king_strike,
            "king_gamma": king_gamma,
            "floor_strike": floor_strike,
            "floor_significance": floor_sig,
            "ceiling_strike": ceiling_strike,
            "ceiling_significance": ceiling_sig,
            "n_air_pockets_above": len(air_above),
            "n_air_pockets_below": len(air_below),
            "n_liquidity_vacuums": len(vacuums),
            "expiration": expiration,
            "directional_score": round(score, 4),
        }

        return AgentSignal(
            agent=self.name, signal=signal, confidence=confidence,
            rationale=rationale, payload=payload,
        )
