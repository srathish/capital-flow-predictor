"""Generate equity curve plots for FINAL TREND v5 portfolio strategy."""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2, UNIVERSE

PLOTS_DIR = Path(__file__).parent / "plots"
PLOTS_DIR.mkdir(exist_ok=True)


def main():
    p = PortfolioV2Params(max_concurrent=10, risk_pct_equity=1.5, atr_trail_mult=15.0)
    print("Running v5 portfolio backtest (10y window for realistic position sizes)...")
    r = run_portfolio_v2(UNIVERSE, p, period="10y")
    if not r or "equity_curve" not in r:
        print("No equity curve.")
        return

    eq = r["equity_curve"]["equity"]
    print(f"Final: ${eq.iloc[-1]:,.0f}  CAGR: {r['cagr']:.1f}%  Sharpe: {r['sharpe']:.2f}  DD: {r['max_dd_pct']:.1f}%")

    # Compute drawdown
    rm = eq.cummax()
    dd_pct = (eq / rm - 1) * 100

    # Buy & hold SPY benchmark (equal-weighted across universe is harder, just use SPY)
    from data import load_ohlcv
    spy = load_ohlcv("SPY", period="max")["close"]
    spy = spy[(spy.index >= eq.index[0]) & (spy.index <= eq.index[-1])]
    spy_eq = spy / spy.iloc[0] * 100_000

    # Plot
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 9), gridspec_kw={"height_ratios": [3, 1]}, sharex=True)

    ax1.plot(eq.index, eq, label=f"FINAL TREND v5 ({r['net_pct']:+.0f}%, CAGR {r['cagr']:.1f}%, Sharpe {r['sharpe']:.2f})", color="green", linewidth=2)
    ax1.plot(spy_eq.index, spy_eq, label=f"SPY Buy & Hold ({(spy_eq.iloc[-1]/100_000-1)*100:+.0f}%)", color="gray", linewidth=1, alpha=0.7)
    ax1.axhline(100_000, color="black", linestyle="--", linewidth=0.5, alpha=0.5)
    ax1.set_title(f"FINAL TREND v5 — Portfolio Mode (max 10 positions, 1.5% risk, 15xATR trail)\n10y on 43-ticker universe", fontsize=12)
    ax1.set_ylabel("Equity ($)")
    ax1.set_yscale("log")
    ax1.legend(loc="upper left", fontsize=10)
    ax1.grid(True, alpha=0.3)

    ax2.fill_between(dd_pct.index, dd_pct, 0, color="red", alpha=0.4)
    ax2.set_ylabel("Drawdown %")
    ax2.set_xlabel("Date")
    ax2.grid(True, alpha=0.3)
    ax2.set_ylim(min(dd_pct.min(), -25), 1)

    fig.tight_layout()
    out_path = PLOTS_DIR / "FINAL_v5_equity_curve.png"
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    print(f"Saved -> {out_path}")


if __name__ == "__main__":
    main()
