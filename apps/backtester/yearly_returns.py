"""Year-by-year returns breakdown of FINAL TREND v5 strategy."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2, UNIVERSE


def main():
    p = PortfolioV2Params(max_concurrent=10, risk_pct_equity=1.5, atr_trail_mult=15.0)
    print("Running full backtest...")
    r = run_portfolio_v2(UNIVERSE, p, period="10y")
    if not r: return

    eq = r["equity_curve"]["equity"]
    daily_ret = eq.pct_change()

    # Year-by-year returns
    yearly = eq.resample("YE").last()
    yearly_ret = yearly.pct_change() * 100

    # Yearly drawdowns
    rolling_max = eq.cummax()
    dd = (eq / rolling_max - 1) * 100
    yearly_dd = dd.resample("YE").min()

    # SPY benchmark
    from data import load_ohlcv
    spy = load_ohlcv("SPY", period="10y")["close"]
    spy_yearly = spy.resample("YE").last()
    spy_yearly_ret = spy_yearly.pct_change() * 100

    print(f"\nFINAL TREND v5 Strategy — Year-by-Year Returns")
    print(f"{'Year':<6} {'Return%':>10} {'Max DD%':>10} {'SPY%':>10} {'Alpha%':>10}")
    print("-" * 50)
    for year_end in yearly_ret.index:
        if pd.isna(yearly_ret.loc[year_end]): continue
        year = year_end.year
        ret = yearly_ret.loc[year_end]
        dd_year = yearly_dd.loc[year_end] if year_end in yearly_dd.index else 0
        spy_match = spy_yearly_ret[spy_yearly_ret.index.year == year]
        spy_ret = spy_match.iloc[0] if len(spy_match) > 0 else float("nan")
        alpha = ret - spy_ret if not pd.isna(spy_ret) else float("nan")
        print(f"{year:<6} {ret:>10.1f} {dd_year:>10.1f} {spy_ret if not pd.isna(spy_ret) else 0:>10.1f} {alpha if not pd.isna(alpha) else 0:>10.1f}")

    # Aggregate stats
    print(f"\n--- Summary ---")
    print(f"Mean year:      {yearly_ret.mean():.1f}%")
    print(f"Median year:    {yearly_ret.median():.1f}%")
    print(f"Best year:      {yearly_ret.max():.1f}% ({yearly_ret.idxmax().year})")
    print(f"Worst year:     {yearly_ret.min():.1f}% ({yearly_ret.idxmin().year})")
    print(f"Positive years: {(yearly_ret > 0).sum()} / {len(yearly_ret.dropna())}")
    print(f"vs SPY years:   {(yearly_ret > spy_yearly_ret.reindex(yearly_ret.index)).sum()} / {len(yearly_ret.dropna())}")


if __name__ == "__main__":
    main()
