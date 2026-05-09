"""Two-stage DCF — pure function. Persona's lens() can call it with bundle
fundamentals to get a real intrinsic value the LLM can cite.

Two stages:
  Stage 1 (years 1..N): explicit FCF growth, default 5 years.
  Stage 2 (terminal):   Gordon growth at terminal_growth forever.

Discount rate is WACC; we expose it as a parameter (default 9% — sensible
for large-cap US equity). Conservative defaults are intentional — Klarman
and Damodaran both prefer the conservative side of the valuation range.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DcfResult:
    """Output of compute_dcf — all values in dollars per share unless noted."""

    intrinsic_value_per_share: float
    pv_explicit_fcf: float          # PV of years 1..N
    pv_terminal_value: float        # PV of stage-2 perpetuity
    enterprise_value: float
    discount_rate: float
    growth_rate_explicit: float
    terminal_growth: float
    years_explicit: int
    fcf_base: float
    shares_outstanding: float
    upside_pct: float | None        # vs current price, if provided

    def summary(self, current_price: float | None = None) -> str:
        """One-line summary suitable for embedding in a persona prompt."""
        iv = self.intrinsic_value_per_share
        if current_price is not None and current_price > 0:
            up = (iv / current_price - 1.0) * 100
            arrow = "+" if up >= 0 else ""
            return (
                f"DCF intrinsic value: ${iv:,.2f}/share "
                f"(vs ${current_price:.2f} current, {arrow}{up:.1f}%) — "
                f"FCF base ${self.fcf_base / 1e9:.1f}B growing {self.growth_rate_explicit * 100:.0f}% "
                f"for {self.years_explicit}y, terminal {self.terminal_growth * 100:.1f}%, "
                f"discount {self.discount_rate * 100:.1f}%"
            )
        return (
            f"DCF intrinsic value: ${iv:,.2f}/share — "
            f"FCF base ${self.fcf_base / 1e9:.1f}B growing {self.growth_rate_explicit * 100:.0f}% "
            f"for {self.years_explicit}y, terminal {self.terminal_growth * 100:.1f}%, "
            f"discount {self.discount_rate * 100:.1f}%"
        )


def compute_dcf(
    *,
    fcf_base: float,
    shares_outstanding: float,
    discount_rate: float = 0.09,
    growth_rate_explicit: float = 0.06,
    terminal_growth: float = 0.025,
    years_explicit: int = 5,
    current_price: float | None = None,
    net_debt: float = 0.0,
) -> DcfResult | None:
    """Two-stage DCF on a base year FCF.

    Returns None if inputs are nonsensical (FCF<=0, no shares, terminal>=discount,
    etc.). Personas should treat None as "DCF not applicable for this name"
    and fall back to qualitative reasoning.
    """
    if fcf_base is None or fcf_base <= 0:
        return None
    if shares_outstanding is None or shares_outstanding <= 0:
        return None
    if discount_rate <= 0 or discount_rate <= terminal_growth:
        return None  # Gordon model degenerate
    if years_explicit <= 0:
        return None

    pv_explicit = 0.0
    fcf = fcf_base
    for t in range(1, years_explicit + 1):
        fcf *= 1.0 + growth_rate_explicit
        pv_explicit += fcf / ((1.0 + discount_rate) ** t)

    fcf_year_n_plus_1 = fcf * (1.0 + terminal_growth)
    terminal_value_at_n = fcf_year_n_plus_1 / (discount_rate - terminal_growth)
    pv_terminal = terminal_value_at_n / ((1.0 + discount_rate) ** years_explicit)

    enterprise_value = pv_explicit + pv_terminal
    equity_value = enterprise_value - max(0.0, net_debt)
    intrinsic = equity_value / shares_outstanding

    upside = None
    if current_price is not None and current_price > 0:
        upside = (intrinsic / current_price - 1.0) * 100.0

    return DcfResult(
        intrinsic_value_per_share=intrinsic,
        pv_explicit_fcf=pv_explicit,
        pv_terminal_value=pv_terminal,
        enterprise_value=enterprise_value,
        discount_rate=discount_rate,
        growth_rate_explicit=growth_rate_explicit,
        terminal_growth=terminal_growth,
        years_explicit=years_explicit,
        fcf_base=fcf_base,
        shares_outstanding=shares_outstanding,
        upside_pct=upside,
    )
