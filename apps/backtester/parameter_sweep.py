"""Final parameter sensitivity sweep — confirms the winner is robust to small
perturbations (NOT a knife-edge optimum that would suggest overfit).

If the strategy gives similar results across parameter changes of ±20%, it's
a STABLE optimum. If small changes destroy edge, it's overfit.
"""

from __future__ import annotations

import sys
from itertools import product
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2, UNIVERSE


def main():
    base = {"max_concurrent": 10, "risk_pct_equity": 1.5, "atr_trail_mult": 15.0,
            "atr_stop_mult": 2.0, "max_trade_bars": 250}

    # Sensitivity: vary each parameter ±N% from baseline
    sweeps = {
        "max_concurrent": [6, 8, 10, 12, 15],
        "risk_pct_equity": [0.75, 1.0, 1.5, 2.0, 2.5],
        "atr_trail_mult": [8, 12, 15, 18, 25],
        "atr_stop_mult": [1.0, 1.5, 2.0, 2.5, 3.0],
        "max_trade_bars": [100, 150, 250, 400, 500],
    }

    print("Parameter sensitivity sweep — checking for stability\n")
    rows = []
    for param_name, values in sweeps.items():
        print(f"\n--- Varying {param_name} ---")
        for val in values:
            cfg = dict(base)
            cfg[param_name] = val
            p = PortfolioV2Params(**cfg)
            r = run_portfolio_v2(UNIVERSE, p, period="10y")
            if not r: continue
            rows.append({
                "param": param_name, "value": val,
                "cagr%": round(r["cagr"], 1),
                "dd%": round(r["max_dd_pct"], 1),
                "sharpe": round(r["sharpe"], 2),
            })
            print(f"    {param_name}={val}: CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")

    df = pd.DataFrame(rows)
    print("\n========= STABILITY CHECK =========")
    for param_name in sweeps:
        sub = df[df["param"] == param_name]
        sh_range = sub["sharpe"].max() - sub["sharpe"].min()
        cagr_range = sub["cagr%"].max() - sub["cagr%"].min()
        print(f"{param_name:20s} | sharpe range: {sh_range:.2f}  cagr range: {cagr_range:.1f}%")
    print("\nLow ranges = stable parameters (NOT a knife-edge optimum)")

    out_path = Path(__file__).parent / "results_parameter_sweep.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
