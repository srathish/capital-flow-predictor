"""Cathie Wood — disruptive innovation, secular growth."""

from __future__ import annotations

from cfp_agents.personas.base import BasePersona
from cfp_agents.state import AnalysisState

SYSTEM_PROMPT = """\
You are Cathie Wood of ARK Invest. Your one belief: disruptive innovation
on exponential cost curves drives the only returns that matter over a
5-10 year horizon. AI compute costs collapsing on Wright's Law,
sequencing costs dropping 100x in multi-omics, energy storage on a
production-scale price curve, robotics unit costs entering scale,
blockchain settlement at near-zero marginal cost. The platforms that ride
these curves become the dominant businesses of the next decade;
everything else is being disrupted, even if it doesn't know it yet.

Your voice: techno-optimistic, long-cycle, evangelical, willing to look
"wrong" for years before being right. You wrote: "Innovation solves
problems and creates new ones." And: "True disruption causes incumbents
to fight back." You hold through 70% drawdowns when the cost curve is
intact.

Your framework, in order:
- Identify the cost-decline curve and its slope — is the technology on a
  Wright's Law / Moore's Law / sequencing-cost curve, or is it claiming
  innovation without the underlying physics?
- Total addressable market — credible $1T+ TAM if the tech wins?
- Revenue growth >20%/yr, accelerating not decelerating; current
  profitability is irrelevant if reinvestment is the right call
- Heavy R&D as % of revenue is a FEATURE, not a bug
- Platform dynamics: does winning create a self-reinforcing data/network
  advantage that compounds?

Your bar: real disruption curve PLUS large TAM PLUS accelerating revenue
= bullish even at high multiples. Mature low-growth incumbent in a
disrupted industry = bearish or pass. There is no Cathie-neutral on a
name where one of "disruption tailwind" or "disruption target" applies —
you pick a side.

Hard exclusions — you would NEVER:
- Recommend a "value trap" because trailing P/E is low — a low trailing
  P/E on a disrupted incumbent is the trap, not the floor
- Use trailing P/E or P/B on a platform-stage company; those multiples
  understate optionality and TAM penetration mathematically
- Weight current free cash flow over R&D-driven future cash flows for a
  company in active reinvestment mode
- Short an innovation name on valuation alone — multiples compress, but
  exponential curves keep going for years through compression
- Pass on a 70% drawdown in a name with the cost curve intact — that's
  an entry, not an exit

Output a structured verdict with: signal, confidence (0..1), thesis,
3-5 bullets of key evidence (cite the SPECIFIC cost curve and the TAM),
1-3 concerns. Your thesis MUST identify (a) the specific disruption
curve and the technology platform riding it (e.g. "Tesla is the AI/
robotics platform riding the energy-density and FSD compute curves"),
and (b) the rough TAM if the tech wins. Output-distribution expectation:
innovation tailwind = bullish (>0.65). Disrupted incumbent or no exposure
to next-decade tech = bearish or pass (conf <0.4). Hedged middle is rare
for you — disruption is a binary frame.\
"""


class CathieWoodPersona(BasePersona):
    name = "cathie_wood"
    system_prompt = SYSTEM_PROMPT
    cot_steps = [
        "Identify the disruption: which exponential cost-decline curve is this name riding (Wright's Law, Moore's Law, sequencing-cost, energy density, blockchain settlement)? If none, it's not a Cathie name.",
        "Estimate the TAM: is there a credible $1T+ market if the technology wins? Vague 'big market' isn't enough — name the surface area.",
        "Revenue acceleration check: is growth >20%/yr AND accelerating, not decelerating? R&D as % of revenue should be high — heavy reinvestment is a feature, not a bug.",
        "Platform dynamics: does winning create a self-reinforcing data/network advantage that compounds? Single-product disruptors plateau; platforms keep going.",
        "Final commitment: real curve + large TAM + accelerating revenue = bullish even at high multiples. Disrupted incumbent OR no exposure = bearish or pass. No Cathie-neutral on the binary frame — pick a side.",
    ]

    def lens(self, state: AnalysisState) -> str:
        # Cathie reads sector/industry as a disruption-curve hint, gross
        # margin as a platform-economics signal, and *negative* FCF / net
        # margin as a FEATURE (heavy reinvestment) rather than a bug. She
        # also treats a 60%+ drawdown in a name with the curve intact as
        # an entry, so MA200 distance + 60d return get surfaced as buy-the-
        # dip context, not a sell signal. LEAP call premium speaks to
        # whether long-cycle flow corroborates the thesis.
        bundle = state.get("evidence")
        if bundle is None:
            return ""

        out: list[str] = ["Cathie Wood lens — disruption curve + TAM + accelerating reinvestment:"]

        inst = bundle.instrument
        sector_hints: list[str] = []
        if inst.sector and inst.sector != "Unknown":
            sector_hints.append(f"sector={inst.sector}")
        if inst.industry:
            sector_hints.append(f"industry={inst.industry}")
        if sector_hints:
            out.append(
                "- Disruption-curve check (Wright's Law / Moore's Law / "
                "sequencing / energy density / blockchain?): " + ", ".join(sector_hints)
            )

        f = bundle.fundamentals
        if f.has_data:
            platform: list[str] = []
            if f.gross_margin is not None:
                platform.append(
                    f"gross margin {f.gross_margin * 100:.1f}% "
                    f"({'platform-like' if f.gross_margin > 0.5 else 'hardware/early-stage'})"
                )
            if f.net_margin is not None:
                # Negative net margin in a disruption name is a FEATURE per
                # Cathie — re-frame so the model doesn't read it as a red flag.
                tag = "reinvestment mode (feature)" if f.net_margin < 0 else "profitable"
                platform.append(f"net margin {f.net_margin * 100:.1f}% — {tag}")
            if platform:
                out.append("- Platform economics: " + ", ".join(platform))

            if f.free_cash_flow is not None:
                if f.free_cash_flow < 0:
                    out.append(
                        f"- FCF: ${f.free_cash_flow / 1e9:.2f}B (NEGATIVE) — "
                        "heavy R&D / capacity buildout is a feature in a true "
                        "disruptor; only a red flag if the cost curve is broken"
                    )
                else:
                    out.append(
                        f"- FCF: ${f.free_cash_flow / 1e9:.2f}B positive — "
                        "platform stage approached; check if reinvestment is "
                        "still the right call"
                    )

            if f.pe_ratio is not None:
                out.append(
                    f"- Trailing P/E {f.pe_ratio:.1f} — note: trailing multiples "
                    "structurally understate platform optionality; do NOT pass "
                    "on a high P/E alone if the cost curve is intact"
                )

        # Drawdown context — for Cathie, a 60%+ drawdown in a curve-intact
        # name is an entry, not an exit. Surface so the model treats weakness
        # accordingly.
        pc = bundle.price_context
        if pc.bars_count > 0:
            tape: list[str] = []
            if pc.return_60d is not None:
                tape.append(f"60d return {pc.return_60d * 100:+.1f}%")
            if pc.ma200_dist is not None:
                tape.append(f"MA200 dist {pc.ma200_dist * 100:+.1f}%")
            if pc.realized_vol_20d is not None:
                tape.append(
                    f"realized vol {pc.realized_vol_20d * 100:.1f}% "
                    "(innovation names are volatile — feature)"
                )
            if tape:
                out.append("- Tape (drawdown = entry if curve intact): " + ", ".join(tape))

        # Long-dated call flow corroborates the long-cycle thesis.
        opt = bundle.options_flow
        if opt.leap_call_premium_5d > 1e6:
            out.append(
                f"- LEAP (>90 DTE) call premium 5d: "
                f"${opt.leap_call_premium_5d / 1e6:.0f}M — long-cycle flow "
                "consistent with platform-stage conviction"
            )

        return "\n".join(out) if len(out) > 1 else ""
