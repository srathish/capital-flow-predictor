"""Grid search optimal (max_concurrent, risk%) on portfolio mode.

Looking for the Pareto frontier of Sharpe vs CAGR.
"""

from __future__ import annotations

import sys
from itertools import product
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2, UNIVERSE


def main():
    max_concurrent_values = [3, 5, 8, 10, 12, 15, 20]
    risk_values = [0.3, 0.5, 0.7, 1.0, 1.5, 2.0]
    trail_mults = [5.0, 8.0, 10.0, 15.0]

    print(f"Grid search: {len(max_concurrent_values)} x {len(risk_values)} x {len(trail_mults)} = {len(max_concurrent_values) * len(risk_values) * len(trail_mults)} configs\n")

    rows = []
    for max_conc, risk, trail in product(max_concurrent_values, risk_values, trail_mults):
        p = PortfolioV2Params(max_concurrent=max_conc, risk_pct_equity=risk, atr_trail_mult=trail)
        r = run_portfolio_v2(UNIVERSE, p, period="10y")
        if not r:
            continue
        rows.append({
            "max_conc": max_conc, "risk%": risk, "trail_atr": trail,
            "net%": round(r["net_pct"], 0), "cagr%": round(r["cagr"], 1),
            "dd%": round(r["max_dd_pct"], 1), "sharpe": round(r["sharpe"], 2),
            "trades": r["total_trades"],
        })
        print(f"  conc={max_conc:2d} risk={risk:.1f}% trail={trail:4.1f}xATR -> CAGR={rows[-1]['cagr%']:5.1f}  DD={rows[-1]['dd%']:5.1f}  Sharpe={rows[-1]['sharpe']:.2f}")

    df = pd.DataFrame(rows)
    print("\n========= TOP 15 BY SHARPE =========")
    print(df.nlargest(15, "sharpe").to_string(index=False))

    print("\n========= TOP 15 BY CAGR =========")
    print(df.nlargest(15, "cagr%").to_string(index=False))

    print("\n========= BEST RISK-ADJUSTED (CAGR / DD) =========")
    df["cagr_over_dd"] = df["cagr%"] / df["dd%"].replace(0, 1)
    print(df.nlargest(15, "cagr_over_dd").to_string(index=False))

    out_path = Path(__file__).parent / "results_grid_search.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
