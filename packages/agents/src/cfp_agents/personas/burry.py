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

    def lens(self, state: AnalysisState) -> str:
        # Burry hunts for froth (unusual call buying at high IV) and shorts
        # heavily-owned, expensively-borrowed names. Surface insider sells +
        # short fee + LEAP call premium as the things that flag mania.
        bundle = state.get("evidence")
        if bundle is None:
            return ""
        opt = bundle.options_flow
        pos = bundle.positioning
        smart = bundle.smart_money

        lines = ["Burry lens — froth & short setup:"]
        if opt.leap_call_premium_5d > 5e6:
            lines.append(
                f"- LEAP call buying ${opt.leap_call_premium_5d / 1e6:.0f}M (>90 DTE) — "
                f"froth flag if IV is rich (sticky pct {opt.sticky_pct * 100:.0f}%)"
            )
        if opt.net_call_premium_5d > 0 or opt.net_put_premium_5d > 0:
            lines.append(
                f"- Net option premium 5d: calls ${opt.net_call_premium_5d / 1e6:+.0f}M vs "
                f"puts ${opt.net_put_premium_5d / 1e6:+.0f}M"
            )
        if pos.fee_rate is not None:
            squeeze = " (squeezable)" if pos.fee_rate > 5 else ""
            lines.append(f"- Borrow fee rate: {pos.fee_rate:.2f}%{squeeze}")
        if smart.insider_sells_30d > 0 or smart.insider_buys_30d > 0:
            lines.append(
                f"- Insider 30d: {smart.insider_buys_30d} buys / "
                f"{smart.insider_sells_30d} sells, net ${smart.insider_net_amount_30d / 1e6:+.1f}M"
            )

        # Reddit chatter — Burry treats elevated WSB attention as a froth
        # flag. If the name is in the WSB top-20 with a 3x+ mention spike,
        # that's the kind of crowded long he shorts.
        rd = bundle.reddit
        if rd.has_data and rd.is_contrarian_warning:
            lines.append(
                f"- WSB attention: {rd.mentions_today} mentions ({rd.spike_ratio:.1f}x avg), "
                f"rank #{rd.rank_today} — froth signal"
            )
        elif rd.has_data and rd.spike_ratio is not None and rd.spike_ratio > 2.0:
            lines.append(
                f"- Reddit chatter rising: {rd.spike_ratio:.1f}x avg — watch for crowded-long setup"
            )

        return "\n".join(lines) if len(lines) > 1 else ""
