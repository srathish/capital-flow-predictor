"""Per-ticker equity curve plots for FINAL TREND v5."""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from pure_trend import PureParams, run_pure_trend

PLOTS_DIR = Path(__file__).parent / "plots" / "v5_per_ticker"
PLOTS_DIR.mkdir(parents=True, exist_ok=True)

TICKERS = ["NVDA", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "TSLA", "AVGO",
           "AMD", "MU", "JPM", "SPY", "QQQ", "INTC", "NFLX"]


def main():
    p = PureParams(atr_trail_mult=15.0, risk_pct_equity=2.0)  # match Pine v5 defaults
    print("Generating per-ticker v5 plots (matches Pine strategy logic)...")

    for tk in TICKERS:
        try:
            df = load_ohlcv(tk, period="10y")
            if len(df) < 300:
                continue
            r = run_pure_trend(df, p, ticker=tk)
            if r.equity_curve is None:
                continue

            # Buy & hold comparison
            bh = df["close"] / df["close"].iloc[0] * 100_000
            bh = bh.reindex(r.equity_curve.index, method="ffill")

            fig, ax = plt.subplots(figsize=(12, 5))
            ax.plot(r.equity_curve.index, r.equity_curve,
                    label=f"TREND v5 ({r.net_profit_pct:+.0f}%, CAGR {r.cagr:.1f}%, Sharpe {r.sharpe:.2f}, DD {r.max_drawdown_pct:.0f}%)",
                    color="green", linewidth=2)
            ax.plot(bh.index, bh, label=f"Buy & Hold ({r.buy_hold_return_pct:+.0f}%)",
                    color="gray", linewidth=1, alpha=0.6)
            ax.axhline(100_000, color="black", linestyle="--", linewidth=0.5, alpha=0.4)
            ax.set_title(f"{tk} — TREND v5 vs Buy & Hold (10y, single-ticker $100k start)", fontsize=11)
            ax.set_ylabel("Equity ($)")
            ax.set_yscale("log")
            ax.legend(loc="upper left", fontsize=9)
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            out_path = PLOTS_DIR / f"{tk}.png"
            fig.savefig(out_path, dpi=100)
            plt.close(fig)
            print(f"  saved {tk}: {r.net_profit_pct:+.0f}% vs B&H {r.buy_hold_return_pct:+.0f}%")
        except Exception as e:
            print(f"  ! {tk}: {e}")

    print(f"\nAll plots in {PLOTS_DIR}/")


if __name__ == "__main__":
    main()
