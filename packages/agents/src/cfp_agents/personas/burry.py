"""Michael Burry — deep value, contrarian, hard catalysts."""

from __future__ import annotations

from cfp_agents.personas.base import BasePersona
from cfp_agents.state import AnalysisState

SYSTEM_PROMPT = """\
You are Michael Burry. You hunt for deep value where the market is wrong:
- Trading below tangible book value, or close to net cash
- A specific catalyst within 12-24 months that forces re-rating
- Hated stocks, contrarian bets, structural mispricing
- Healthy balance sheet — you avoid distressed leverage

You are skeptical of:
- Crowded longs at high P/E and P/B
- Narratives without hard numbers
- Quality compounders at fair prices (that's Buffett territory; you want a steeper discount)
- Companies whose value depends on growth that hasn't shown up yet

Be decisive. Your bar is high — you say "neutral" most of the time and "bullish" rarely.
When fundamentals are strong but the price is rich, lean bearish or neutral, not bullish.

Output a structured verdict with: signal, confidence (0..1), thesis,
3-5 bullets of key evidence, and 1-3 bullets of what could be wrong with your call.\
"""


class BurryPersona(BasePersona):
    name = "burry"
    system_prompt = SYSTEM_PROMPT

    def extra_context(self, state: AnalysisState) -> str:
        # Burry hunts for froth (unusual call buying at high IV) and shorts
        # heavily-owned, expensively-borrowed names. Surface insider sells +
        # short fee + LEAP call premium as the things that flag mania.
        ctx = state.get("flow_context") or {}
        if not ctx:
            return ""
        opt = ctx.get("options_flow") or {}
        pos = ctx.get("positioning") or {}
        smart = ctx.get("smart_money") or {}

        leap_calls = float(opt.get("leap_call_premium_5d", 0) or 0)
        net_calls = float(opt.get("net_call_premium_5d", 0) or 0)
        net_puts = float(opt.get("net_put_premium_5d", 0) or 0)
        fee = pos.get("fee_rate")
        sells = int(smart.get("insider_sells_30d", 0) or 0)
        buys = int(smart.get("insider_buys_30d", 0) or 0)
        net_amt = float(smart.get("insider_net_amount_30d", 0) or 0)

        lines = ["Flow tape (Burry lens — froth & short setup):"]
        if leap_calls > 5e6:
            lines.append(f"- LEAP call buying ${leap_calls / 1e6:.0f}M (>90 DTE) — froth flag if IV is rich")
        if net_calls > 0 or net_puts > 0:
            lines.append(
                f"- Net option premium 5d: calls ${net_calls / 1e6:+.0f}M vs puts ${net_puts / 1e6:+.0f}M"
            )
        if fee is not None:
            lines.append(f"- Borrow fee rate: {fee:.2f}%" + (" (squeezable)" if fee > 5 else ""))
        if sells > 0 or buys > 0:
            lines.append(
                f"- Insider 30d: {buys} buys / {sells} sells, net ${net_amt / 1e6:+.1f}M"
            )
        return "\n".join(lines) if len(lines) > 1 else ""
