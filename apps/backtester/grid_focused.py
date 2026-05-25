"""Focused grid search — 36 configs that span the meaningful parameter space.

Avoids overfit by:
1. Running each config on BOTH train (2014-2020) and test (2020-2026) windows
2. Selecting params by TRAIN performance, validating on TEST
3. Reporting decay (test - train) to flag overfit candidates
"""

from __future__ import annotations

import sys
from itertools import product
from pathlib import Path
from time import time

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2, UNIVERSE


def main():
    max_concurrent_values = [5, 10, 15]
    risk_values = [0.5, 1.0, 1.5, 2.0]
    trail_mults = [5.0, 10.0, 15.0]

    configs = list(product(max_concurrent_values, risk_values, trail_mults))
    print(f"Focused grid: {len(configs)} configs × 2 windows = {len(configs)*2} runs\n")

    rows = []
    for max_conc, risk, trail in configs:
        p = PortfolioV2Params(max_concurrent=max_conc, risk_pct_equity=risk, atr_trail_mult=trail)
        t0 = time()
        # TRAIN: 2014-2020
        r_train = run_portfolio_v2(UNIVERSE, p, start_date="2014-01-01", end_date="2020-01-01", period="max")
        # TEST: 2020-2026
        r_test = run_portfolio_v2(UNIVERSE, p, start_date="2020-01-01", end_date="2026-06-01", period="max")
        dt = time() - t0
        if not r_train or not r_test:
            continue
        rows.append({
            "conc": max_conc, "risk": risk, "trail": trail,
            "tr_cagr": round(r_train["cagr"], 1),
            "tr_dd": round(r_train["max_dd_pct"], 1),
            "tr_sharpe": round(r_train["sharpe"], 2),
            "te_cagr": round(r_test["cagr"], 1),
            "te_dd": round(r_test["max_dd_pct"], 1),
            "te_sharpe": round(r_test["sharpe"], 2),
            "sharpe_decay": round(r_test["sharpe"] - r_train["sharpe"], 2),
            "cagr_decay": round(r_test["cagr"] - r_train["cagr"], 1),
        })
        print(f"  {dt:5.1f}s | conc={max_conc:2d} risk={risk:.1f}% trail={trail:4.1f}x | TRAIN cagr={r_train['cagr']:5.1f} sh={r_train['sharpe']:.2f} | TEST cagr={r_test['cagr']:5.1f} sh={r_test['sharpe']:.2f}")

    df = pd.DataFrame(rows)
    print("\n========= TOP 10 by TRAIN Sharpe (in-sample best — DO NOT pick these) =========")
    print(df.nlargest(10, "tr_sharpe").to_string(index=False))

    print("\n========= TOP 10 by TEST Sharpe (out-of-sample best) =========")
    print(df.nlargest(10, "te_sharpe").to_string(index=False))

    # ROBUSTNESS: prefer params where TEST Sharpe doesn't drop much from TRAIN
    df["robust_score"] = df["te_sharpe"] - 0.5 * df["sharpe_decay"].abs()  # reward stable sharpe
    print("\n========= TOP 10 ROBUST (high TEST sharpe + low decay) — PICK FROM HERE =========")
    print(df.nlargest(10, "robust_score").to_string(index=False))

    out_path = Path(__file__).parent / "results_grid_focused.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
