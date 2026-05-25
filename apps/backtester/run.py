"""Run the MASTER strategy on a basket of tickers and print stats.

Usage:
    python apps/backtester/run.py                       # baseline on default basket
    python apps/backtester/run.py --tickers AAPL,NVDA   # custom basket
    python apps/backtester/run.py --ablation            # run all 4 ablation variants
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Params, run_backtest

DEFAULT_BASKET = [
    "INTC", "META", "NFLX",            # the names the user already eyeballed
    "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL",  # mega-cap trend leaders
    "SPY", "QQQ",                      # broad market benchmarks
]


def run_basket(tickers: list[str], params: Params, period: str = "max", label: str = "baseline") -> pd.DataFrame:
    rows = []
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
        except Exception as e:
            print(f"  ! {tk}: data load failed — {e}")
            continue

        if len(df) < 300:
            print(f"  ! {tk}: only {len(df)} bars, skipping")
            continue

        result = run_backtest(df, params, ticker=tk)
        rows.append(result.summary_dict())

    df_out = pd.DataFrame(rows)
    if df_out.empty:
        print(f"[{label}] no results")
        return df_out

    # Add aggregate row
    agg = {
        "ticker": "MEAN",
        "trades": df_out["trades"].mean(),
        "win_rate%": df_out["win_rate%"].mean(),
        "net_profit$": df_out["net_profit$"].mean(),
        "net_profit%": df_out["net_profit%"].mean(),
        "cagr%": df_out["cagr%"].mean(),
        "buy_hold%": df_out["buy_hold%"].mean(),
        "max_dd%": df_out["max_dd%"].mean(),
        "profit_factor": df_out["profit_factor"].mean(),
        "sharpe": df_out["sharpe"].mean(),
        "avg_win$": df_out["avg_win$"].mean(),
        "avg_loss$": df_out["avg_loss$"].mean(),
    }
    df_out = pd.concat([df_out, pd.DataFrame([agg])], ignore_index=True)

    print(f"\n========= {label} =========")
    print(df_out.to_string(index=False))
    return df_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(DEFAULT_BASKET), help="comma-separated tickers")
    ap.add_argument("--period", default="max", help="yfinance period (e.g. max, 10y, 5y)")
    ap.add_argument("--ablation", action="store_true", help="run all 4 ablation variants")
    args = ap.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",")]

    baseline = Params()  # all defaults — matches Pine v3.1

    if not args.ablation:
        run_basket(tickers, baseline, period=args.period, label="BASELINE (defaults)")
        return

    # === ABLATION VARIANTS ===
    # Each variant is a single change from baseline so we can attribute deltas.
    variants = {
        "BASELINE": baseline,
        "A. maxTradeBars=500": replace(baseline, max_trade_bars=500),
        "B. A + moveBeAfterT1=off": replace(baseline, max_trade_bars=500, move_be_after_t1=False),
        "C. B + trail=21EMA only": replace(baseline, max_trade_bars=500, move_be_after_t1=False, trail_method="21EMA"),
        "D. C + exitOnDanger=off": replace(baseline, max_trade_bars=500, move_be_after_t1=False, trail_method="21EMA", exit_on_danger=False),
    }

    summary_rows = []
    for name, p in variants.items():
        df = run_basket(tickers, p, period=args.period, label=name)
        if df.empty:
            continue
        mean_row = df[df["ticker"] == "MEAN"].iloc[0].to_dict()
        mean_row["variant"] = name
        summary_rows.append(mean_row)

    if summary_rows:
        summary = pd.DataFrame(summary_rows)
        cols = ["variant", "trades", "win_rate%", "net_profit%", "cagr%", "buy_hold%", "max_dd%", "profit_factor", "sharpe"]
        print("\n\n========= ABLATION SUMMARY (mean across basket) =========")
        print(summary[cols].to_string(index=False))


if __name__ == "__main__":
    main()
