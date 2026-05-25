"""Master v2 ablation — test each new filter individually, then combinations.

15 variants × 10 tickers × 10y. Identifies which features actually contribute.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, replace
from pathlib import Path
from time import time

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Params as ParamsV1, run_backtest as run_v1
from master_strategy_v2 import ParamsV2, run_backtest_v2

BASKET = ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"]
PERIOD = "10y"


def agg(results: list) -> dict:
    """Compute mean stats across a list of BacktestResults."""
    if not results:
        return {}
    return {
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


def run_v1_variant(params: ParamsV1) -> list:
    out = []
    for tk in BASKET:
        df = load_ohlcv(tk, period=PERIOD)
        if len(df) >= 300:
            out.append(run_v1(df, params, ticker=tk))
    return out


def run_v2_variant(params: ParamsV2) -> list:
    out = []
    for tk in BASKET:
        df = load_ohlcv(tk, period=PERIOD)
        if len(df) >= 300:
            out.append(run_backtest_v2(df, params, ticker=tk))
    return out


def main():
    base_v2 = ParamsV2()  # already has the winning trail (Chand 5xATR, max_trade_bars=250)

    variants = {
        "V1 baseline (Pine defaults)": ("v1", ParamsV1()),
        "V2 baseline (trail fix only)": ("v2", base_v2),
        "V2 + trend_filter": ("v2", replace(base_v2, use_trend_filter=True)),
        "V2 + macro_filter": ("v2", replace(base_v2, use_macro_filter=True)),
        "V2 + sector_filter": ("v2", replace(base_v2, use_sector_filter=True)),
        "V2 + continuation_entries": ("v2", replace(base_v2, use_continuation_entries=True)),
        "V2 + pyramid(max=2)": ("v2", replace(base_v2, max_pyramid=2)),
        "V2 + pyramid(max=3)": ("v2", replace(base_v2, max_pyramid=3)),
        "V2 + adaptive_trail": ("v2", replace(base_v2, trend_adaptive_trail=True)),
        "V2 + pocket_pivot": ("v2", replace(base_v2, use_pocket_pivot=True)),
        "V2 + cont + pyramid(2)": ("v2", replace(base_v2, use_continuation_entries=True, max_pyramid=2)),
        "V2 + trend + macro": ("v2", replace(base_v2, use_trend_filter=True, use_macro_filter=True)),
        "V2 + trend + sector": ("v2", replace(base_v2, use_trend_filter=True, use_sector_filter=True)),
        "V2 + macro + sector": ("v2", replace(base_v2, use_macro_filter=True, use_sector_filter=True)),
        "V2 + ALL filters ON": ("v2", replace(
            base_v2,
            use_trend_filter=True, use_macro_filter=True, use_sector_filter=True,
            use_continuation_entries=True, trend_adaptive_trail=True, max_pyramid=2,
        )),
    }

    rows = []
    for label, (ver, p) in variants.items():
        t0 = time()
        results = run_v1_variant(p) if ver == "v1" else run_v2_variant(p)
        dt = time() - t0
        if not results:
            continue
        row = {"variant": label, **agg(results)}
        rows.append(row)
        print(f"  {dt:5.1f}s | {label:42s} | net%={row['net%']:6.1f} | sharpe={row['sharpe']:4.2f}")

    df = pd.DataFrame(rows)
    print("\n\n========= MASTER V2 ABLATION (10-ticker basket, 10y) =========")
    print(df.to_string(index=False))

    # Save to CSV for review
    out_path = Path(__file__).parent / "results_ablate_v2.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
