"""Generate equity-curve plots comparing strategies on key tickers.

Creates PNG charts showing:
  - Buy & hold equity
  - Original MASTER v3.1 (the loser)
  - Pure Trend v4 winner

Output: apps/backtester/plots/*.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # headless backend, no display needed
import matplotlib.pyplot as plt
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Params as ParamsV1, run_backtest as run_v1
from pure_trend import PureParams, run_pure_trend

PLOTS_DIR = Path(__file__).parent / "plots"
PLOTS_DIR.mkdir(exist_ok=True)

KEY_TICKERS = ["NVDA", "AAPL", "MSFT", "META", "INTC", "SPY", "QQQ", "JPM"]


def plot_ticker(ticker: str, period: str = "10y"):
    df = load_ohlcv(ticker, period=period)
    if len(df) < 300:
        return

    p1 = ParamsV1()
    r_v1 = run_v1(df, p1, ticker=ticker)

    p_winner = PureParams(atr_trail_mult=10.0, risk_pct_equity=2.0)
    r_winner = run_pure_trend(df, p_winner, ticker=ticker)

    p_conservative = PureParams(atr_trail_mult=5.0, risk_pct_equity=1.0)
    r_conservative = run_pure_trend(df, p_conservative, ticker=ticker)

    # Buy & hold equity curve
    bh = df["close"] / df["close"].iloc[0] * 100_000

    fig, ax = plt.subplots(figsize=(12, 6))
    ax.plot(bh.index, bh, label=f"Buy & Hold ({(bh.iloc[-1]/100_000-1)*100:+.0f}%)", color="gray", linewidth=1, alpha=0.7)
    if r_v1.equity_curve is not None:
        ax.plot(r_v1.equity_curve.index, r_v1.equity_curve, label=f"MASTER v3.1 ({r_v1.net_profit_pct:+.0f}%, Sharpe {r_v1.sharpe:.2f})", color="orange", linewidth=1.5)
    if r_conservative.equity_curve is not None:
        ax.plot(r_conservative.equity_curve.index, r_conservative.equity_curve, label=f"Pure Trend (5xATR/1%) ({r_conservative.net_profit_pct:+.0f}%, Sharpe {r_conservative.sharpe:.2f})", color="blue", linewidth=1.5)
    if r_winner.equity_curve is not None:
        ax.plot(r_winner.equity_curve.index, r_winner.equity_curve, label=f"Pure Trend v4 (10xATR/2%) ({r_winner.net_profit_pct:+.0f}%, Sharpe {r_winner.sharpe:.2f})", color="green", linewidth=2)
    ax.axhline(100_000, color="black", linestyle="--", linewidth=0.5, alpha=0.5)
    ax.set_title(f"{ticker} — Strategy Comparison (10y, $100k start, log scale)")
    ax.set_ylabel("Equity ($)")
    ax.set_yscale("log")
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()

    out_path = PLOTS_DIR / f"{ticker}.png"
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    print(f"  saved {out_path}")


def plot_basket_summary():
    """One chart showing equity-curve comparison across all key tickers (normalized)."""
    fig, ax = plt.subplots(figsize=(14, 7))
    p_winner = PureParams(atr_trail_mult=10.0, risk_pct_equity=2.0)
    for tk in KEY_TICKERS:
        df = load_ohlcv(tk, period="10y")
        if len(df) < 300:
            continue
        r = run_pure_trend(df, p_winner, ticker=tk)
        if r.equity_curve is None:
            continue
        normalized = r.equity_curve / r.equity_curve.iloc[0] * 100
        ax.plot(normalized.index, normalized, label=f"{tk} ({r.net_profit_pct:+.0f}%)", linewidth=1.2)

    ax.axhline(100, color="black", linestyle="--", linewidth=0.5, alpha=0.5)
    ax.set_title("Pure Trend v4 — Equity Curves Across Key Tickers (10y, normalized to 100)")
    ax.set_ylabel("Equity (normalized)")
    ax.legend(loc="upper left", ncol=2, fontsize=9)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    out_path = PLOTS_DIR / "_BASKET_SUMMARY.png"
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    print(f"  saved {out_path}")


def main():
    print("Generating equity curve plots...")
    for tk in KEY_TICKERS:
        plot_ticker(tk)
    plot_basket_summary()
    print(f"\nAll plots saved to {PLOTS_DIR}/")


if __name__ == "__main__":
    main()
