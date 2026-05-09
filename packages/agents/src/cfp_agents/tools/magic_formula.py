"""Greenblatt's Magic Formula score.

Two components, ranked separately, summed:
  - Earnings yield = EBIT / Enterprise Value (proxy: 1 / P/E when EBIT n/a)
  - Return on capital = ROIC (proxy: ROE when ROIC n/a)

The original formula ranks the universe and buys the top decile. We don't
have the universe in the persona's context, so we surface the absolute
values + a simple "good/marginal/poor" classification per component."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MagicFormulaResult:
    earnings_yield: float | None       # 1/PE, or EBIT/EV if available
    roic: float | None                  # or ROE proxy
    quality_label: str                  # 'top quartile' | 'top half' | 'below average' | 'poor'

    def summary(self) -> str:
        ey_s = f"{self.earnings_yield * 100:.1f}%" if self.earnings_yield is not None else "n/a"
        roic_s = f"{self.roic * 100:.1f}%" if self.roic is not None else "n/a"
        return (
            f"Magic Formula: earnings yield {ey_s}, ROIC {roic_s} — "
            f"{self.quality_label}"
        )


def compute_magic_formula(
    *,
    pe_ratio: float | None = None,
    roic: float | None = None,
    roe: float | None = None,
) -> MagicFormulaResult | None:
    """Cheap-and-good joint check. Returns None if nothing useful to say."""
    earnings_yield: float | None = None
    if pe_ratio is not None and pe_ratio > 0:
        earnings_yield = 1.0 / pe_ratio
    elif pe_ratio is not None and pe_ratio < 0:
        earnings_yield = -0.01  # flag for unprofitable

    capital_return = roic if roic is not None else roe

    if earnings_yield is None and capital_return is None:
        return None

    # Quality bucket — fixed thresholds, not universe-relative.
    # ey >= 8% AND roic >= 20%   -> top quartile
    # ey >= 6% AND roic >= 15%   -> top half
    # ey >= 4% AND roic >= 10%   -> below average
    # else                        -> poor
    if (
        earnings_yield is not None and earnings_yield >= 0.08
        and capital_return is not None and capital_return >= 0.20
    ):
        label = "top quartile (cheap AND good — Magic Formula long candidate)"
    elif (
        earnings_yield is not None and earnings_yield >= 0.06
        and capital_return is not None and capital_return >= 0.15
    ):
        label = "top half (worth a closer look)"
    elif (
        earnings_yield is not None and earnings_yield >= 0.04
        and capital_return is not None and capital_return >= 0.10
    ):
        label = "below average for the formula"
    else:
        label = "fails the Magic Formula filter"

    return MagicFormulaResult(
        earnings_yield=earnings_yield,
        roic=capital_return,
        quality_label=label,
    )
