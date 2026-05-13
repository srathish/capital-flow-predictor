"""GEX analyst — Skylit gamma-exposure structure read across expirations.

A different lens from the FlowAnalyst: we don't care here whether institutions
are bullish or bearish. We care **where price will go and how**, based on
dealer-gamma topography across the term structure (0DTE → weekly → LEAP).

Single-view signals (per expiration):
  * King node — the largest single gamma magnet. In positive-GEX regimes
    price tends to pin near it.
  * Floors / ceilings — strikes with concentrated gamma that act as
    support / resistance.
  * Regime score — signed_total / total_abs, in [-1, +1]:
        > +0.30 = strongly positive GEX, mean-reverting (chops around king)
        < -0.30 = strongly negative GEX, trending (breakouts run, dealers chase)
        between  = mixed
  * Air pockets — strike ranges with very little gamma; price can move
    fast through them.

Term-structure synthesis (when multiple ``skylit_expiry_views`` are present):
  * Near-term view dominates the directional signal (what's likely THIS week).
  * LEAP view modulates conviction:
      - LEAP regime + near regime aligned → confidence multiplier up.
      - LEAP and near disagree → flagged as caveat ("near says X, LEAPs say Y").
      - LEAP king well above current spot → durable long-dated accumulation.

Personas downstream can read the per-view payload to frame their own time-
horizon argument (Druckenmiller cares about LEAPs; Taleb cares about tails).

No-coverage path: Skylit serves ~396 names. For tickers outside, every
skylit_* field is None — analyst emits a clear neutral.
"""

from __future__ import annotations

from typing import Any

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


def _pct(a: float, b: float) -> float:
    if not b:
        return 0.0
    return (a - b) / b


def _score_single_view(
    *,
    spot: float,
    regime: float,
    king_strike: float | None,
    floor_strike: float | None,
    ceiling_strike: float | None,
    air_pockets: list[dict],
) -> tuple[float, list[str], str]:
    """Score one expiration's worth of GEX structure.

    Returns (directional_score, reasons, regime_concern).
    directional_score in approximately [-0.6, +0.6].
    regime_concern in {low, medium, high} reflecting how trustworthy
    the mean-revert math is for THIS expiration.
    """
    score = 0.0
    reasons: list[str] = []
    regime_concern = "low"

    # King magnet effect (only meaningful in positive-GEX regime)
    if king_strike is not None and regime > 0.10:
        d = _pct(king_strike, spot)
        if abs(d) < 0.05:
            drift = clamp(d * 8.0, -0.40, 0.40)
            score += drift
            direction = "up" if d > 0 else "down"
            reasons.append(
                f"king ${king_strike:.2f} ({d * 100:+.1f}% from spot) — magnet {direction}"
            )

    # Position within [floor, ceiling] channel (mean-revert in pos GEX)
    if floor_strike is not None and ceiling_strike is not None and floor_strike < ceiling_strike:
        channel = ceiling_strike - floor_strike
        if channel > 0:
            pos_in_channel = (spot - floor_strike) / channel
            if regime > 0.15:
                revert_drift = (0.5 - pos_in_channel) * 0.6
                score += revert_drift
                if pos_in_channel < 0.35:
                    reasons.append(f"lower {pos_in_channel * 100:.0f}% of channel → revert UP")
                elif pos_in_channel > 0.65:
                    reasons.append(f"upper {pos_in_channel * 100:.0f}% of channel → revert DOWN")

    # Air-pocket tilt
    air_above = [ap for ap in air_pockets if (ap.get("low") or 0) > spot]
    air_below = [ap for ap in air_pockets if (ap.get("high") or 0) < spot]
    if air_above and not air_below:
        reasons.append(f"{len(air_above)} air pocket(s) above — upside acceleration risk")
        score += 0.10
    elif air_below and not air_above:
        reasons.append(f"{len(air_below)} air pocket(s) below — downside acceleration risk")
        score -= 0.10

    # Regime concern + score haircut in negative-GEX (trending) regimes
    if regime < -0.30:
        regime_concern = "high"
        reasons.append(f"strongly negative GEX ({regime:+.2f}) → trending; revert math halved")
        score *= 0.5
    elif regime < -0.10:
        regime_concern = "medium"

    return score, reasons, regime_concern


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
        views = list(pos.skylit_expiry_views or [])

        # No coverage path — Skylit doesn't serve this ticker.
        if spot is None or regime is None:
            return AgentSignal(
                agent=self.name, signal="neutral", confidence=0.0,
                rationale=(
                    f"{ticker}: no Skylit GEX coverage. Serves ~396 names; "
                    "falling back to neutral."
                ),
                payload={"has_data": False},
            )

        # --- Score the near-term view (always present, even single-snapshot mode) ---
        near_score, near_reasons, near_concern = _score_single_view(
            spot=spot,
            regime=regime,
            king_strike=pos.skylit_king_strike,
            floor_strike=pos.skylit_floor_strike,
            ceiling_strike=pos.skylit_ceiling_strike,
            air_pockets=pos.skylit_air_pockets or [],
        )

        # --- Term-structure synthesis across all expiry_views ---
        # Conviction modulator: LEAP regime alignment with near
        per_view_payload: list[dict[str, Any]] = []
        leap_score: float | None = None
        leap_expiration: str | None = None
        leap_regime: float | None = None
        leap_alignment_bonus = 0.0
        leap_caveat: str | None = None

        if views:
            # Treat the LATEST (longest-dated) view as the LEAP lens. Skylit
            # orders ascending; if expiration_index is populated we sort by it.
            sorted_views = sorted(
                views,
                key=lambda v: v.expiration_index if v.expiration_index is not None else 0,
            )
            for v in sorted_views:
                vs, _, vc = _score_single_view(
                    spot=spot,
                    regime=v.regime_score or 0.0,
                    king_strike=v.king_strike,
                    floor_strike=v.floor_strike,
                    ceiling_strike=v.ceiling_strike,
                    air_pockets=v.air_pockets or [],
                )
                per_view_payload.append({
                    "expiration": v.expiration,
                    "expiration_index": v.expiration_index,
                    "regime_score": v.regime_score,
                    "regime_concern": vc,
                    "directional_score": round(vs, 4),
                    "king_strike": v.king_strike,
                    "floor_strike": v.floor_strike,
                    "ceiling_strike": v.ceiling_strike,
                    "n_air_pockets": len(v.air_pockets or []),
                })

            longest = sorted_views[-1]
            if longest is not sorted_views[0]:  # we have >1 view
                leap_score, leap_reasons, _ = _score_single_view(
                    spot=spot,
                    regime=longest.regime_score or 0.0,
                    king_strike=longest.king_strike,
                    floor_strike=longest.floor_strike,
                    ceiling_strike=longest.ceiling_strike,
                    air_pockets=longest.air_pockets or [],
                )
                leap_expiration = longest.expiration
                leap_regime = longest.regime_score
                # If LEAP and near agree on direction, bump conviction.
                # If they disagree, flag caveat + slight haircut.
                if (near_score > 0 and leap_score > 0) or (near_score < 0 and leap_score < 0):
                    leap_alignment_bonus = 0.08
                    near_reasons.append(
                        f"LEAP {leap_expiration} agrees with near ({leap_score:+.2f}) — durable"
                    )
                elif abs(near_score) > 0.1 and abs(leap_score) > 0.1:
                    leap_caveat = (
                        f"Near {sorted_views[0].expiration} says {near_score:+.2f} but LEAP "
                        f"{leap_expiration} says {leap_score:+.2f} — short vs long-horizon disagree"
                    )

        # Final directional score: near-term dominates, LEAP adds confidence modulation
        final_score = near_score
        signal = score_to_signal(final_score, neutral_band=0.12)

        # Confidence: regime certainty × directional clarity × LEAP corroboration
        regime_certainty = clamp(abs(regime) * 1.5)
        directional_clarity = clamp(abs(final_score) * 2.0)
        confidence = clamp(
            0.4 * regime_certainty + 0.4 * directional_clarity + leap_alignment_bonus
        )
        confidence = round(confidence, 2)

        if not near_reasons:
            near_reasons.append(
                f"GEX structure present (regime {regime:+.2f}) but no decisive cue"
            )

        primary_expiration = (
            pos.skylit_expiration or (views[0].expiration if views else None)
        )
        expiration_note = ""
        if primary_expiration:
            expiration_note = f" Primary view: {primary_expiration}."
        if leap_expiration and leap_expiration != primary_expiration:
            expiration_note += f" LEAP view: {leap_expiration} (regime {leap_regime:+.2f})."

        rationale = (
            f"{ticker} @ ${spot:.2f} · regime {regime:+.2f}. "
            + " ".join(near_reasons)
            + expiration_note
            + (f" Caveat: {leap_caveat}." if leap_caveat else "")
        )

        payload: dict[str, Any] = {
            "has_data": True,
            "spot": spot,
            "primary_expiration": primary_expiration,
            "primary_regime_score": regime,
            "primary_regime_concern": near_concern,
            "primary_king_strike": pos.skylit_king_strike,
            "primary_floor_strike": pos.skylit_floor_strike,
            "primary_ceiling_strike": pos.skylit_ceiling_strike,
            "primary_directional_score": round(near_score, 4),
            "n_expiry_views": len(views),
            "expiry_views": per_view_payload,
            "leap_expiration": leap_expiration,
            "leap_regime_score": leap_regime,
            "leap_directional_score": round(leap_score, 4) if leap_score is not None else None,
            "term_structure_caveat": leap_caveat,
        }

        return AgentSignal(
            agent=self.name, signal=signal, confidence=confidence,
            rationale=rationale, payload=payload,
        )
