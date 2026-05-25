"""Entry-filter ablation. All variants use the trail-fix (Chand 5xATR only)
from the prior ablation. We're testing whether loosening entry criteria
generates MORE trades that capture more of the underlying trend.

The hypothesis: the strategy is too restrictive on entries, so it sits on
the sidelines through most of a strong trend. Buy-and-hold = 2,141% mean,
we're capturing only 20%.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, replace
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Params, run_backtest

BASKET = ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"]


def run_variant(tickers: list[str], params: Params, label: str) -> dict:
    results = []
    for tk in tickers:
        df = load_ohlcv(tk, period="10y")
        if len(df) < 300:
            continue
        results.append(run_backtest(df, params, ticker=tk))

    if not results:
        return {}

    return {
        "variant": label,
        "trades": round(sum(r.total_trades for r in results) / len(results), 0),
        "win%": round(sum(r.win_rate for r in results) / len(results), 1),
        "net%": round(sum(r.net_profit_pct for r in results) / len(results), 1),
        "cagr%": round(sum(r.cagr for r in results) / len(results), 2),
        "dd%": round(sum(r.max_drawdown_pct for r in results) / len(results), 1),
        "pf": round(sum(r.profit_factor for r in results) / len(results), 2),
        "sharpe": round(sum(r.sharpe for r in results) / len(results), 2),
        "best%": round(max(r.net_profit_pct for r in results), 0),
        "worst%": round(min(r.net_profit_pct for r in results), 0),
    }


def main():
    # All variants start from the WINNER of the trail ablation: Chand 5xATR only
    trail_fix = Params(trail_method="Chandelier", atr_trail_mult=5.0)

    variants = {
        "TRAIL-FIX baseline":           trail_fix,
        "+ minGrade=2 (looser grade)":  replace(trail_fix, min_grade=2),
        "+ minGrade=4 (stricter)":      replace(trail_fix, min_grade=4),
        "+ requireFlow=off":            replace(trail_fix, require_flow=False),
        "+ minGrade=2 + flow off":      replace(trail_fix, min_grade=2, require_flow=False),
        "+ stop=Setup Low (tighter)":   replace(trail_fix, stop_method="Setup Low"),
        "+ stop=50EMA":                 replace(trail_fix, stop_method="50EMA"),
        "+ stop=ATR":                   replace(trail_fix, stop_method="ATR"),
        "+ risk%=2.0 (double size)":    replace(trail_fix, risk_pct_equity=2.0),
        "+ risk%=0.5 (half size)":      replace(trail_fix, risk_pct_equity=0.5),
    }

    rows = []
    for label, p in variants.items():
        print(f"Running: {label}")
        r = run_variant(BASKET, p, label)
        if r:
            rows.append(r)

    df = pd.DataFrame(rows)
    print("\n\n========= ENTRY FILTER + SIZING ABLATION (trail fix baked in) =========")
    print(df.to_string(index=False))


if __name__ == "__main__":
    main()
