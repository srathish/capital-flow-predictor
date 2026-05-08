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

    def extra_context(self, state: AnalysisState) -> str:
        # Taleb reads vol regime + tail strikes. Volume z-score (regime) plus
        # IV snapshot from recent UW flow (tail-strike pricing) plus dealer
        # gamma exposure (a flat dealer book = forced selling on a shock).
        out: list[str] = []

        analyst_signals = state.get("analyst_signals", []) or []
        tech = next((s for s in analyst_signals if s.agent == "technicals"), None)
        if tech:
            vol_z = (tech.payload or {}).get("volume_z")
            out.append(
                f"Volume z-score (20d) on most recent bar: "
                f"{vol_z if vol_z is None else f'{vol_z:+.2f}'}"
            )

        ctx = state.get("flow_context") or {}
        if ctx:
            opt = ctx.get("options_flow") or {}
            pos = ctx.get("positioning") or {}
            tail_lines: list[str] = []

            top = opt.get("top_trades") or []
            otm_puts = [t for t in top if t.get("type") == "put"]
            if otm_puts:
                strikes = ", ".join(
                    f"${t['strike']:.0f}" for t in otm_puts[:3] if t.get("strike") is not None
                )
                tail_lines.append(f"Recent large put strikes: {strikes}")

            gex = pos.get("gex_total")
            if gex is not None:
                regime = "positive (mean-reverting / stable dealer)" if gex > 0 else "negative (trending / pro-cyclical hedging)"
                tail_lines.append(f"Aggregate dealer GEX: {gex:+.2e} → {regime}")

            if tail_lines:
                out.append("Tail / dealer regime (Taleb lens):\n- " + "\n- ".join(tail_lines))

        return "\n\n".join(out)
