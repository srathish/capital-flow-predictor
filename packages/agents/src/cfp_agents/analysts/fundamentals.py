"""Fundamentals analyst: rule-based signal from financial statements.

Heuristics (Phase 4b — rule-based, transparent):
  + Growth: 3y revenue CAGR — fast = bullish, declining = bearish
  + Profitability: ROE level — high = bullish
  + Cash flow: FCF positive and growing
  + Leverage: debt/equity — high = bearish modifier
  + Valuation: P/E vs sensible range — extreme = bearish
"""

from __future__ import annotations

import math

import pandas as pd

from cfp_agents.base import BaseAnalyst, clamp, score_to_signal
from cfp_agents.state import AgentSignal, AnalysisState


def _latest_value(df: pd.DataFrame, metric: str) -> float | None:
    """Most-recent annual value of `metric` from the long-format fundamentals frame."""
    if df is None or df.empty:
        return None
    sel = df[(df["metric"] == metric) & (df["period_type"] == "A")]
    if sel.empty:
        return None
    sel = sel.sort_values("fiscal_period")
    return float(sel.iloc[-1]["value"])


def _series_value(df: pd.DataFrame, metric: str, n: int) -> float | None:
    """Get the value `n` periods back (0 = latest)."""
    if df is None or df.empty:
        return None
    sel = df[(df["metric"] == metric) & (df["period_type"] == "A")]
    if len(sel) <= n:
        return None
    sel = sel.sort_values("fiscal_period")
    return float(sel.iloc[-(n + 1)]["value"])


def _cagr(end: float | None, start: float | None, years: float) -> float | None:
    if end is None or start is None or start <= 0 or end <= 0 or years <= 0:
        return None
    return (end / start) ** (1.0 / years) - 1.0


class FundamentalsAnalyst(BaseAnalyst):
    name = "fundamentals"

    def analyze(self, state: AnalysisState) -> AgentSignal:
        ticker = state.get("ticker", "?")
        f = state.get("fundamentals")
        if f is None or f.empty:
            return AgentSignal(
                agent=self.name,
                signal="neutral",
                confidence=0.0,
                rationale=f"{ticker}: no fundamentals data",
            )

        rev_now = _latest_value(f, "revenue")
        rev_3y_ago = _series_value(f, "revenue", n=3)
        rev_cagr_3y = _cagr(rev_now, rev_3y_ago, years=3)

        roe = _latest_value(f, "roe")
        fcf_now = _latest_value(f, "free_cash_flow")
        fcf_1y_ago = _series_value(f, "free_cash_flow", n=1)
        fcf_growth = (
            (fcf_now - fcf_1y_ago) / abs(fcf_1y_ago)
            if fcf_now is not None and fcf_1y_ago is not None and fcf_1y_ago != 0
            else None
        )

        debt_to_equity = _latest_value(f, "debt_to_equity")
        pe_ratio = _latest_value(f, "pe_ratio")

        # --- score components ---
        # Growth: 0%/yr = neutral; +30%/yr = +1; -10%/yr = -1
        growth_s = clamp((rev_cagr_3y or 0.0) / 0.30, -1.0, 1.0) if rev_cagr_3y is not None else 0.0

        # Profitability: ROE 15% = +0.5; 30% = +1.0; 0% = -0.3; negative = -1.0
        prof_s = 0.0
        if roe is not None:
            prof_s = -1.0 if roe < 0 else clamp((roe - 0.05) / 0.25, -0.3, 1.0)

        # Cash flow: positive growing FCF = bullish; negative = bearish
        cf_s = 0.0
        if fcf_now is not None:
            if fcf_now < 0:
                cf_s = -0.7
            else:
                cf_s = 0.3
                if fcf_growth is not None:
                    cf_s += clamp(fcf_growth, -0.5, 0.7) * 0.4
                cf_s = clamp(cf_s, -1.0, 1.0)

        # Leverage: D/E up to 1.0 fine; > 2.0 concerning; > 4 alarming
        lev_s = 0.0
        if debt_to_equity is not None:
            if debt_to_equity < 0:  # negative book value → distress
                lev_s = -1.0
            elif debt_to_equity > 4.0:
                lev_s = -0.6
            elif debt_to_equity > 2.0:
                lev_s = -0.3
            elif debt_to_equity < 0.5:
                lev_s = 0.1

        # Valuation: P/E extreme = caution; <0 (loss-making) different penalty
        val_s = 0.0
        if pe_ratio is not None:
            if pe_ratio < 0:
                val_s = -0.4  # losses
            elif pe_ratio > 60:
                val_s = -0.4  # very expensive
            elif pe_ratio > 35:
                val_s = -0.2
            elif pe_ratio < 8:
                val_s = 0.2  # cheap (or value trap — caveat)

        score = clamp(
            0.30 * growth_s
            + 0.25 * prof_s
            + 0.20 * cf_s
            + 0.15 * lev_s
            + 0.10 * val_s,
            -1.0,
            1.0,
        )

        # Confidence: how much data did we have?
        n_signals = sum(
            1
            for x in (rev_cagr_3y, roe, fcf_now, debt_to_equity, pe_ratio)
            if x is not None and not (isinstance(x, float) and math.isnan(x))
        )
        coverage = n_signals / 5.0
        confidence = clamp(abs(score) * coverage)

        return AgentSignal(
            agent=self.name,
            signal=score_to_signal(score, neutral_band=0.15),
            confidence=confidence,
            rationale=(
                f"{ticker}: rev_cagr_3y={_pct(rev_cagr_3y)} roe={_pct(roe)} "
                f"fcf_growth={_pct(fcf_growth)} d/e={_num(debt_to_equity)} "
                f"pe={_num(pe_ratio)} -> score={score:+.2f}"
            ),
            payload={
                "score": score,
                "rev_cagr_3y": rev_cagr_3y,
                "roe": roe,
                "fcf_now": fcf_now,
                "fcf_growth_yoy": fcf_growth,
                "debt_to_equity": debt_to_equity,
                "pe_ratio": pe_ratio,
                "coverage": coverage,
            },
        )


def _pct(x: float | None) -> str:
    return f"{x * 100:.1f}%" if x is not None else "—"


def _num(x: float | None) -> str:
    return f"{x:.2f}" if x is not None else "—"
