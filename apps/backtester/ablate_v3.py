"""V3 ablation — test LOOSE filters + exit-side filters + diversified basket.

The v2 ablation showed strict filters hurt. Two hypotheses:
  1. Filters too strict — try looser thresholds (only block true panic)
  2. Filters belong on exits not entries — test exit-side variants

Also expand basket to include weak/cyclical names to remove bull-trend bias.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path
from time import time

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy_v2 import ParamsV2, run_backtest_v2

# Diversified basket — adds cyclical / value / sector ETFs for balance
DIVERSIFIED_BASKET = [
    # Original mega-cap tech
    "INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL",
    # Cyclical / value
    "JPM", "XOM", "WMT", "JNJ", "BA", "CAT",
    # Defensive / dividend
    "KO", "PG", "WMT",
    # ETFs
    "SPY", "QQQ", "IWM",
    # Volatile tech
    "AMD", "TSLA", "AVGO", "MU",
]
PERIOD = "10y"


def agg(results: list) -> dict:
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
        "bh%": round(sum(r.buy_hold_return_pct for r in results) / len(results), 0),
    }


def run_variant(tickers: list[str], params: ParamsV2) -> list:
    out = []
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=PERIOD)
            if len(df) >= 300:
                out.append(run_backtest_v2(df, params, ticker=tk))
        except Exception as e:
            print(f"    ! {tk}: {e}")
    return out


def main():
    # Strongest baseline from v2 ablation: trail fix + pyramid(3)
    strong = ParamsV2(max_pyramid=3)

    variants = {
        "STRONG baseline (trail-fix + pyramid3)":  strong,
        "+ macro LOOSE":                            replace(strong, use_macro_loose=True),
        "+ sector LOOSE":                           replace(strong, use_sector_loose=True),
        "+ trend LOOSE (block STRONG_DOWN only)":   replace(strong, use_trend_loose=True),
        "+ exit_on_macro_panic":                    replace(strong, exit_on_macro_panic=True),
        "+ exit_on_sector_death":                   replace(strong, exit_on_sector_death=True),
        "+ macro+sector LOOSE":                     replace(strong, use_macro_loose=True, use_sector_loose=True),
        "+ all LOOSE filters":                      replace(strong, use_macro_loose=True, use_sector_loose=True, use_trend_loose=True),
        "+ all LOOSE + exit_on_panic":              replace(strong, use_macro_loose=True, use_sector_loose=True, use_trend_loose=True, exit_on_macro_panic=True),
        "+ continuation_entries":                   replace(strong, use_continuation_entries=True),
        "+ pyramid(3) + 2% risk":                   replace(strong, risk_pct_equity=2.0),
        "+ pyramid(3) + 3% risk":                   replace(strong, risk_pct_equity=3.0),
    }

    # Test on TWO baskets
    baskets = {
        "MEGA-CAP (original 10)": ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"],
        "DIVERSIFIED (24)":       list(set(DIVERSIFIED_BASKET)),  # dedupe
    }

    for basket_name, basket in baskets.items():
        print(f"\n\n========= BASKET: {basket_name} ({len(basket)} tickers) =========")
        rows = []
        for label, params in variants.items():
            t0 = time()
            results = run_variant(basket, params)
            dt = time() - t0
            if not results:
                continue
            row = {"variant": label, **agg(results)}
            rows.append(row)
            print(f"  {dt:5.1f}s | {label:45s} | net%={row['net%']:6.1f} | sharpe={row['sharpe']:4.2f} | bh%={row['bh%']:6.0f}")

        df = pd.DataFrame(rows)
        print(df.to_string(index=False))

        out_path = Path(__file__).parent / f"results_ablate_v3_{basket_name.split()[0].lower()}.csv"
        df.to_csv(out_path, index=False)


if __name__ == "__main__":
    main()
