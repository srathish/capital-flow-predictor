"""Walk-forward validation — train 2010-2018, test 2018-2026.

If a variant looks great on the full 10y backtest but fails on a 5-year
holdout that wasn't used for tuning, it's overfit.

We test the top 3 variants from the pure-trend ablation:
  - BASE (5xATR trail, pyramid 3, 1% risk)
  - Best Sharpe: 10xATR trail + 1% risk
  - Highest profit: 3% risk
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from pure_trend import PureParams, run_pure_trend

# Use 16y of data so we have a meaningful train/test split
PERIOD = "max"

# Cover both mega-cap and diversified — total 23 unique tickers
BASKET = sorted(set([
    "INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL",
    "JPM", "XOM", "WMT", "JNJ", "BA", "CAT", "KO", "PG",
    "SPY", "QQQ", "IWM", "AMD", "TSLA", "AVGO", "MU",
]))

VARIANTS = {
    "base (5xATR, py3, 1%)": PureParams(),
    "best Sharpe (10xATR, 1%)": PureParams(atr_trail_mult=10.0),
    "high return (5xATR, py3, 2%)": PureParams(risk_pct_equity=2.0),
    "high return (5xATR, py3, 3%)": PureParams(risk_pct_equity=3.0),
    "best Sharpe (10xATR) + 2% risk": PureParams(atr_trail_mult=10.0, risk_pct_equity=2.0),
}


def run_window(ticker: str, params: PureParams, start: str, end: str) -> dict | None:
    df = load_ohlcv(ticker, period=PERIOD)
    df = df[(df.index >= start) & (df.index < end)]
    if len(df) < 250:
        return None
    r = run_pure_trend(df, params, ticker=ticker)
    return {
        "ticker": ticker,
        "trades": r.total_trades,
        "win%": round(r.win_rate, 1),
        "net%": round(r.net_profit_pct, 1),
        "cagr%": round(r.cagr, 2),
        "dd%": round(r.max_drawdown_pct, 1),
        "sharpe": round(r.sharpe, 2),
    }


def main():
    train_start, train_end = "2010-01-01", "2018-01-01"
    test_start, test_end = "2018-01-01", "2026-06-01"

    print("Walk-forward validation: train 2010-2018, test 2018-2026")
    print(f"Basket: {len(BASKET)} tickers")
    print(f"{'='*80}")

    summary_rows = []
    for variant_name, params in VARIANTS.items():
        train_results, test_results = [], []
        for tk in BASKET:
            tr = run_window(tk, params, train_start, train_end)
            te = run_window(tk, params, test_start, test_end)
            if tr: train_results.append(tr)
            if te: test_results.append(te)

        if not train_results or not test_results:
            continue

        def mean(rows, k):
            return sum(r[k] for r in rows) / len(rows)

        train_mean_net = mean(train_results, "net%")
        test_mean_net = mean(test_results, "net%")
        train_mean_sharpe = mean(train_results, "sharpe")
        test_mean_sharpe = mean(test_results, "sharpe")
        train_mean_dd = mean(train_results, "dd%")
        test_mean_dd = mean(test_results, "dd%")

        # Decay = how much does performance drop in the holdout?
        net_decay = test_mean_net - train_mean_net
        sharpe_decay = test_mean_sharpe - train_mean_sharpe

        summary_rows.append({
            "variant": variant_name,
            "train_net%": round(train_mean_net, 1),
            "test_net%": round(test_mean_net, 1),
            "net_decay": round(net_decay, 1),
            "train_sharpe": round(train_mean_sharpe, 2),
            "test_sharpe": round(test_mean_sharpe, 2),
            "sharpe_decay": round(sharpe_decay, 2),
            "train_dd%": round(train_mean_dd, 1),
            "test_dd%": round(test_mean_dd, 1),
        })

        print(f"\n--- {variant_name} ---")
        print(f"  TRAIN (2010-2018):  net%={train_mean_net:6.1f}  sharpe={train_mean_sharpe:.2f}  dd%={train_mean_dd:.1f}")
        print(f"  TEST  (2018-2026):  net%={test_mean_net:6.1f}  sharpe={test_mean_sharpe:.2f}  dd%={test_mean_dd:.1f}")
        print(f"  DECAY:              net={net_decay:+.1f}%   sharpe={sharpe_decay:+.2f}")

    df = pd.DataFrame(summary_rows)
    print(f"\n\n========= SUMMARY =========")
    print(df.to_string(index=False))

    out_path = Path(__file__).parent / "results_walkforward.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
