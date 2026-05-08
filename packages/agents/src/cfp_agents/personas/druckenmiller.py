"""Stanley Druckenmiller — top-down macro asymmetry."""

from __future__ import annotations

from cfp_agents.personas.base import BasePersona
from cfp_agents.state import AnalysisState

SYSTEM_PROMPT = """\
You are Stanley Druckenmiller. You think top-down: the macro regime drives sector flows,
sector flows drive the stocks you care about. You position when the asymmetry is screaming —
big upside if you're right, manageable downside if you're wrong.

Your framework:
- The Fed and global liquidity are the dominant factor over 6-18 month windows
- The yield curve, dollar trend, and credit spreads tell you which regime we're in
- Stock price action confirms or denies the macro thesis — listen to it
- Concentrate positions when the setup is clean; size down when conviction is mixed
- You ride momentum but you also know when the regime is breaking

You de-emphasize:
- Bottom-up valuation when the macro regime is hostile
- Buying "cheap" stocks in a tightening regime
- Quality compounders unless the macro tide is at their back

Be decisive. Tell me whether the macro and tape are aligned for this name today.

Output a structured verdict with: signal, confidence (0..1), thesis,
3-5 bullets of key evidence (cite specific macro/cross-asset data), and 1-3 concerns.\
"""


class DruckenmillerPersona(BasePersona):
    name = "druckenmiller"
    system_prompt = SYSTEM_PROMPT

    def lens(self, state: AnalysisState) -> str:
        # Druck weighs raw tape + sector flow. Note: he reads RAW price tape
        # from the bundle (not the technicals analyst's interpretation) — that's
        # the de-anchoring fix. He'll come to his own conclusion about whether
        # the tape is bullish or bearish.
        bundle = state.get("evidence")
        if bundle is None:
            return ""

        out: list[str] = ["Druck lens — does macro + tape align?"]

        pc = bundle.price_context
        if pc.bars_count > 0 and pc.return_20d is not None:
            ma50_s = f"{pc.ma50_dist * 100:+.1f}%" if pc.ma50_dist is not None else "—"
            ma200_s = f"{pc.ma200_dist * 100:+.1f}%" if pc.ma200_dist is not None else "—"
            out.append(
                f"- Tape: 20d {pc.return_20d * 100:+.1f}%, MA50 dist {ma50_s}, "
                f"MA200 dist {ma200_s}, vol z {pc.volume_z_20d if pc.volume_z_20d is None else f'{pc.volume_z_20d:+.1f}'}"
            )

        opt = bundle.options_flow
        if abs(opt.net_call_premium_5d) + abs(opt.net_put_premium_5d) > 0:
            out.append(
                f"- Option flow 5d: net calls ${opt.net_call_premium_5d / 1e6:+.0f}M, "
                f"net puts ${opt.net_put_premium_5d / 1e6:+.0f}M (sticky {opt.sticky_pct * 100:.0f}%)"
            )

        dp = bundle.dark_pool
        if dp.premium_5d > 0:
            out.append(
                f"- Dark pool 5d: ${dp.premium_5d / 1e6:.0f}M, "
                f"{dp.above_vwap_pct * 100:.0f}% above midpoint"
            )

        etf = bundle.etf_context
        if etf.sector_etf and etf.in_flow_5d != 0:
            out.append(
                f"- Sector {etf.sector_etf} ETF flow 5d: ${etf.in_flow_5d / 1e6:+.0f}M"
            )

        return "\n".join(out) if len(out) > 1 else ""
