"""Trail-tightness ablation — the diagnostic showed ALL exits are TrailExit,
so this is where the bleed is. Test 5 trail configurations head-to-head."""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Params, run_backtest

BASKET = ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"]


def run_variant(tickers: list[str], params: Params, label: str) -> dict:
    results = []
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period="10y")
            if len(df) < 300:
                continue
            r = run_backtest(df, params, ticker=tk)
            results.append(r)
        except Exception as e:
            print(f"  ! {tk}: {e}")

    if not results:
        return {}

    return {
        "variant": label,
        "avg_trades": sum(r.total_trades for r in results) / len(results),
        "win_rate%": sum(r.win_rate for r in results) / len(results),
        "net_profit%": sum(r.net_profit_pct for r in results) / len(results),
        "cagr%": sum(r.cagr for r in results) / len(results),
        "max_dd%": sum(r.max_drawdown_pct for r in results) / len(results),
        "profit_factor": sum(r.profit_factor for r in results) / len(results),
        "sharpe": sum(r.sharpe for r in results) / len(results),
        "avg_win$": sum(r.avg_win for r in results) / len(results),
        "avg_loss$": sum(r.avg_loss for r in results) / len(results),
        "best_pct": max(r.net_profit_pct for r in results),
        "worst_pct": min(r.net_profit_pct for r in results),
    }


def main():
    base = Params()  # current defaults

    variants = {
        "BASE (Chand 3xATR OR 21EMA)": base,
        "Chand 3xATR only":            replace(base, trail_method="Chandelier"),
        "Chand 5xATR only":            replace(base, trail_method="Chandelier", atr_trail_mult=5.0),
        "Chand 8xATR only":            replace(base, trail_method="Chandelier", atr_trail_mult=8.0),
        "21EMA only":                  replace(base, trail_method="21EMA"),
        "10EMA only":                  replace(base, trail_method="10EMA"),
        "Chand 5x + BE off":           replace(base, trail_method="Chandelier", atr_trail_mult=5.0, move_be_after_t1=False),
        "Chand 8x + BE off":           replace(base, trail_method="Chandelier", atr_trail_mult=8.0, move_be_after_t1=False),
    }

    rows = []
    for label, p in variants.items():
        print(f"Running: {label}")
        row = run_variant(BASKET, p, label)
        if row:
            rows.append(row)

    df = pd.DataFrame(rows)
    print("\n\n========= TRAIL TIGHTNESS ABLATION (10-ticker mean, 10y) =========")
    cols = ["variant", "avg_trades", "win_rate%", "net_profit%", "cagr%", "max_dd%", "profit_factor", "sharpe", "best_pct", "worst_pct"]
    print(df[cols].round(2).to_string(index=False))


if __name__ == "__main__":
    main()
