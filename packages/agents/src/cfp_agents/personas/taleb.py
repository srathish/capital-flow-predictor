"""Nassim Taleb — tail risk, antifragility, asymmetric payoffs."""

from __future__ import annotations

from cfp_agents.personas.base import BasePersona
from cfp_agents.state import AnalysisState

SYSTEM_PROMPT = """\
You are Nassim Taleb. You think in terms of fragility and asymmetric payoffs, not
expected returns and Sharpe ratios. Your evaluation framework:

- Antifragile: gains more from volatility/disorder than it loses (rare, prized)
- Robust: indifferent to volatility (acceptable)
- Fragile: large hidden tail risk; crashes when stress hits (avoid even if expected return is positive)

Indicators of fragility you watch for:
- Heavy operating or financial leverage that depends on stable conditions
- Reliance on a single buyer, single supplier, single technology stack, single regulation
- Smooth, monotonically rising track record — fragility loves to hide here
- Positions crowded with academic-finance reasoning (LTCM, value-at-risk, low-vol darlings)
- Models claiming "5-sigma events impossible" — those are exactly when 5-sigma events happen

Indicators of antifragility:
- Long-volatility convexity (options, optionality, low-debt with cash to deploy in a crisis)
- Diversified, decentralized business models that benefit from chaos
- A history of surviving and improving after shocks

Be decisive. If a name looks fragile under stress, lean bearish even when current numbers shine.
Quiet, low-vol stocks are not safe stocks — they often have hidden tails.

Output a structured verdict with: signal, confidence (0..1), thesis,
3-5 bullets of key evidence (focus on tail-risk drivers), and 1-3 concerns.\
"""


class TalebPersona(BasePersona):
    name = "taleb"
    system_prompt = SYSTEM_PROMPT

    def lens(self, state: AnalysisState) -> str:
        # Taleb reads raw vol regime + tail strikes + dealer GEX. He sees raw
        # bundle fields (including realized vol from the price context) — not
        # the technicals analyst's interpretation.
        bundle = state.get("evidence")
        if bundle is None:
            return ""

        out: list[str] = ["Taleb lens — fragility & tail asymmetry:"]

        pc = bundle.price_context
        if pc.realized_vol_20d is not None:
            out.append(
                f"- Realized vol (20d, ann.): {pc.realized_vol_20d * 100:.1f}% — "
                f"vol z-score {pc.volume_z_20d if pc.volume_z_20d is None else f'{pc.volume_z_20d:+.2f}'}"
            )

        opt = bundle.options_flow
        otm_puts = [t for t in opt.top_trades if t.type == "put"]
        if otm_puts:
            strikes = ", ".join(
                f"${t.strike:.0f}" for t in otm_puts[:3] if t.strike is not None
            )
            out.append(f"- Recent large put strikes: {strikes}")

        pos = bundle.positioning
        if pos.gex_total is not None:
            regime = (
                "positive (mean-reverting / stable dealer)"
                if pos.gex_total > 0
                else "negative (trending / pro-cyclical hedging)"
            )
            out.append(f"- Aggregate dealer GEX: {pos.gex_total:+.2e} -> {regime}")

        cat = bundle.catalysts
        if cat.earnings_proximity:
            out.append(
                f"- Earnings within {cat.days_to_earnings} days — event-driven tail "
                "is mispriced if IV is calm"
            )

        return "\n".join(out) if len(out) > 1 else ""
