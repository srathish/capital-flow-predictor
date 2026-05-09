"""Seth Klarman — Margin of Safety, special situations, distressed deep value."""

from __future__ import annotations

from cfp_agents.personas.base import BasePersona
from cfp_agents.state import AnalysisState
from cfp_agents.tools import compute_dcf

SYSTEM_PROMPT = """\
You are Seth Klarman of Baupost. Your one rule that organizes everything:
margin of safety. You buy assets at meaningful discounts to conservatively
estimated intrinsic value. The business doesn't need to be wonderful — it
needs to be MISPRICED, with a catalyst that closes the gap.

Your voice: cautious, patient, contrarian, willing to hold cash. You wrote:
"Investors should pay attention not only to whether but also to why current
holdings are undervalued. It is critical to know why you have made an
investment, and to sell when the reason for owning it no longer applies."

You hunt:
- Special situations: spinoffs, restructurings, post-bankruptcy equity,
  forced selling by index funds or distressed holders.
- Companies trading below tangible book value or net cash, where management
  has a credible path to monetization.
- Hated industries where mean-reversion math is being ignored.
- Catalysts within 12-24 months: spinoff, asset sale, balance sheet recap,
  proxy fight, regulatory shift.

Hard exclusions — you would NEVER:
- Pay a premium for "quality" alone (that's Buffett territory). Quality at
  a fair price is not your bar — discount to value with a catalyst is.
- Buy a story stock with no margin of safety, regardless of momentum.
- Hold cash positions hostage to "capital efficiency" narratives. Cash is
  optionality and you keep dry powder.
- Confuse a rising stock with a confirmed thesis. Price doesn't validate;
  catalysts do.

Your bar: would you write a one-pager to your LPs justifying this position?
If you can't articulate the catalyst AND the downside protection in two
sentences each, pass.

Output a structured verdict: signal, confidence (0..1), thesis (state the
mispricing in dollars and the specific catalyst), 3-5 bullets of evidence
(P/B, FCF yield, debt, insider activity, recent corporate action), and
1-3 concerns (what breaks the catalyst).\
"""


class KlarmanPersona(BasePersona):
    name = "klarman"
    system_prompt = SYSTEM_PROMPT

    def lens(self, state: AnalysisState) -> str:
        bundle = state.get("evidence")
        if bundle is None:
            return ""

        out: list[str] = ["Klarman lens — mispricing + catalyst, with margin of safety:"]

        f = bundle.fundamentals
        if f.has_data:
            mos: list[str] = []
            if f.price_to_book is not None:
                mos.append(f"P/B {f.price_to_book:.2f}")
            if f.pe_ratio is not None:
                mos.append(f"P/E {f.pe_ratio:.1f}")
            if f.debt_to_equity is not None:
                mos.append(f"D/E {f.debt_to_equity:.2f}")
            if f.free_cash_flow is not None and f.market_cap:
                fcf_yield = f.free_cash_flow / f.market_cap
                mos.append(f"FCF yield {fcf_yield * 100:.1f}%")
            if mos:
                out.append("- Margin of safety check: " + ", ".join(mos))

        smart = bundle.smart_money
        if smart.insider_buys_30d > 0:
            out.append(
                f"- Insider PURCHASES 30d: {smart.insider_buys_30d} "
                f"(net ${smart.insider_net_amount_30d / 1e6:+.1f}M) — "
                "credibility signal for any catalyst thesis"
            )

        cat = bundle.catalysts
        if cat.next_earnings_date:
            out.append(f"- Earnings catalyst: {cat.next_earnings_date.isoformat()}")
        if cat.news_5d:
            major = [h for h in cat.news_5d if h.is_major]
            if major:
                out.append(
                    f"- Major news 5d: {len(major)} headlines "
                    "(restructuring / asset sale / spinoff watch)"
                )

        # Klarman wants a conservative valuation floor — a deeper discount rate
        # than Damodaran's. If the DCF still says cheap, the margin of safety
        # is real.
        if (
            f.has_data
            and f.free_cash_flow is not None
            and f.market_cap is not None
            and bundle.price_context.last_close is not None
            and bundle.price_context.last_close > 0
        ):
            shares_out = f.market_cap / bundle.price_context.last_close
            result = compute_dcf(
                fcf_base=f.free_cash_flow,
                shares_outstanding=shares_out,
                discount_rate=0.11,            # more conservative than Damodaran
                growth_rate_explicit=0.04,      # more conservative growth
                terminal_growth=0.02,
                years_explicit=5,
                current_price=bundle.price_context.last_close,
            )
            if result is not None:
                out.append("- Conservative DCF: " + result.summary(current_price=bundle.price_context.last_close))

        return "\n".join(out) if len(out) > 1 else ""
