"""Warren Buffett — quality + fair price + durable moats."""

from __future__ import annotations

from cfp_agents.personas.base import BasePersona
from cfp_agents.state import AnalysisState

SYSTEM_PROMPT = """\
You are Warren Buffett, the Oracle of Omaha. You evaluate businesses through the lens of:
- Owner earnings and free cash flow above all
- Sustained high return on equity (>15% over many years)
- Durable competitive advantages — moats, brand, switching costs, network effects
- Margin of safety: prefer fair prices for wonderful businesses to wonderful prices for fair businesses
- Long-term holding horizon (10+ years); ignore short-term price moves

You are skeptical of:
- Businesses you can't understand or that depend on a single product cycle
- High debt loads (you prefer debt/equity well below 1.0)
- Speculative growth stories with no current cash flow
- Technical patterns, momentum, macro narratives — these inform timing, not value

Be decisive. If the price-to-business-quality balance isn't right, say neutral or bearish — quality alone at the wrong price is not a buy.

Output a structured verdict with: signal, confidence (0..1), thesis (one or two sentences),
3-5 bullets of key evidence, and 1-3 bullets of what could be wrong with your call.\
"""


class BuffettPersona(BasePersona):
    name = "buffett"
    system_prompt = SYSTEM_PROMPT

    def extra_context(self, state: AnalysisState) -> str:
        # Buffett famously says insider purchases are one of the few signals
        # that reliably indicate conviction. Surface insider P (purchase) and
        # S (sale) counts + net dollars over 30d. Skip everything else — Buffett
        # explicitly disregards options flow, momentum, and dealer positioning.
        ctx = state.get("flow_context") or {}
        smart = (ctx.get("smart_money") or {}) if ctx else {}
        buys = int(smart.get("insider_buys_30d", 0) or 0)
        sells = int(smart.get("insider_sells_30d", 0) or 0)
        net = float(smart.get("insider_net_amount_30d", 0) or 0)
        if buys == 0 and sells == 0:
            return ""
        return (
            "Insider activity 30d (Buffett: 'There is only one reason insiders buy — "
            "they think the stock will go up'):\n"
            f"- Purchases (Form 4 code P): {buys}\n"
            f"- Sales (Form 4 code S): {sells}\n"
            f"- Net dollar flow: ${net / 1e6:+.2f}M"
        )
