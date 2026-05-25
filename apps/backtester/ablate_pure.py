"""Pure trend follower ablation — find the BEST minimal-logic variant."""

from __future__ import annotations

import math
import sys
from dataclasses import replace
from pathlib import Path
from time import time

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from pure_trend import PureParams, run_pure_trend
from master_strategy import ema, atr


MEGA = ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"]
DIVERSIFIED = list(set([
    "INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL",
    "JPM", "XOM", "WMT", "JNJ", "BA", "CAT", "KO", "PG",
    "SPY", "QQQ", "IWM", "AMD", "TSLA", "AVGO", "MU",
]))


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
    }


def run_variant(tickers: list[str], params: PureParams) -> list:
    out = []
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period="10y")
            if len(df) >= 300:
                out.append(run_pure_trend(df, params, ticker=tk))
        except Exception as e:
            print(f"    ! {tk}: {e}")
    return out


def main():
    base = PureParams()

    variants = {
        "BASE (pure trend, pyramid3, 5xATR)":  base,
        "  no pyramid":                         replace(base, pyramid_max=1),
        "  pyramid max=2":                      replace(base, pyramid_max=2),
        "  trail 3xATR (tighter)":              replace(base, atr_trail_mult=3.0),
        "  trail 4xATR":                        replace(base, atr_trail_mult=4.0),
        "  trail 6xATR":                        replace(base, atr_trail_mult=6.0),
        "  trail 8xATR (looser)":               replace(base, atr_trail_mult=8.0),
        "  trail 10xATR (very loose)":          replace(base, atr_trail_mult=10.0),
        "  stop 1xATR (tight)":                 replace(base, atr_stop_mult=1.0),
        "  stop 3xATR (loose)":                 replace(base, atr_stop_mult=3.0),
        "  risk 2%":                            replace(base, risk_pct_equity=2.0),
        "  risk 3%":                            replace(base, risk_pct_equity=3.0),
        "  risk 0.5%":                          replace(base, risk_pct_equity=0.5),
        "  no time stop":                       replace(base, max_trade_bars=10000),
        "  pyramid 4 spaced 1.5ATR":            replace(base, pyramid_max=4, pyramid_spacing_atr=1.5),
        "  pyramid 5 spaced 1.0ATR":            replace(base, pyramid_max=5, pyramid_spacing_atr=1.0),
        "  full pyramid (no size reduction)":   replace(base, pyramid_size_pct=1.0),
    }

    for basket_name, basket in [("MEGA-CAP (10)", MEGA), ("DIVERSIFIED (23)", DIVERSIFIED)]:
        print(f"\n\n========= {basket_name} =========")
        rows = []
        for label, params in variants.items():
            t0 = time()
            results = run_variant(basket, params)
            dt = time() - t0
            if not results:
                continue
            row = {"variant": label, **agg(results)}
            rows.append(row)
            print(f"  {dt:5.1f}s | {label:42s} | net%={row['net%']:6.1f} | dd%={row['dd%']:5.1f} | sharpe={row['sharpe']:4.2f}")

        df = pd.DataFrame(rows).sort_values("net%", ascending=False)
        print("\nRanked by net%:")
        print(df.to_string(index=False))

        out_path = Path(__file__).parent / f"results_pure_{basket_name.split()[0].lower().replace('-','')}.csv"
        df.to_csv(out_path, index=False)


if __name__ == "__main__":
    main()
