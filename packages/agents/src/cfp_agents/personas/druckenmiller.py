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

    def extra_context(self, state: AnalysisState) -> str:
        # Druck weighs the tape heavily AND watches sector flows. Surface
        # both: technicals payload + UW flow (dark pool, sector ETF flow,
        # net option premium directionality).
        out: list[str] = []

        analyst_signals = state.get("analyst_signals", []) or []
        tech = next((s for s in analyst_signals if s.agent == "technicals"), None)
        if tech:
            payload = tech.payload or {}
            rsi = payload.get("rsi_14")
            ret_20 = payload.get("momentum_20d")
            ma50 = payload.get("ma50_dist")
            ma200 = payload.get("ma200_dist")
            tape_line = (
                "Tape (price action): "
                f"20d return {ret_20:+.1%} | RSI(14) {rsi:.0f} | "
                f"distance MA50 {ma50:+.1%} | distance MA200 "
                f"{ma200 if ma200 is None else f'{ma200:+.1%}'}"
            )
            out.append(tape_line)

        ctx = state.get("flow_context") or {}
        if ctx:
            opt = ctx.get("options_flow") or {}
            dp = ctx.get("dark_pool") or {}
            etf = ctx.get("etf_context") or {}
            flow_lines: list[str] = []
            net_calls = float(opt.get("net_call_premium_5d", 0) or 0)
            net_puts = float(opt.get("net_put_premium_5d", 0) or 0)
            if abs(net_calls) + abs(net_puts) > 0:
                flow_lines.append(
                    f"Option flow 5d: net calls ${net_calls / 1e6:+.0f}M, net puts ${net_puts / 1e6:+.0f}M"
                )
            if dp.get("premium_5d"):
                flow_lines.append(
                    f"Dark pool 5d: ${float(dp['premium_5d']) / 1e6:.0f}M, "
                    f"{float(dp.get('above_vwap_pct', 0.5)) * 100:.0f}% above VWAP"
                )
            if etf and etf.get("in_flow_5d") is not None:
                v = float(etf['in_flow_5d'])
                flow_lines.append(
                    f"Sector {etf.get('sector_etf')} ETF flow 5d: ${v / 1e6:+.0f}M"
                )
            if flow_lines:
                out.append("Flow tape (Druck lens — sector + tape confirmation):\n- " + "\n- ".join(flow_lines))

        return "\n\n".join(out)
