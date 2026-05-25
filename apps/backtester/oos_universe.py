"""Out-of-sample universe test - did the strategy curve-fit to mega-cap US stocks?

Test on universes NOT used in any tuning:
  1. Small/Mid cap US (IWM, IJR, IJH, MDY constituents)
  2. International equity ETFs (EFA, EEM, EWJ, EWZ, etc.)
  3. Sector ETFs only (XLK XLF XLE etc.)
  4. Commodities + bonds (GLD, SLV, TLT, IEF, USO)

If the robust winner from grid_focused still produces positive Sharpe across
these untested universes, the edge is generalizable. If it falls apart, it's
fit to mega-cap US.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2


UNIVERSES = {
    "Small/Mid US": ["IWM", "IJR", "IJH", "MDY", "VBR", "VB", "SMH", "XBI"],
    "International ETFs": ["EFA", "EEM", "EWJ", "EWZ", "EWG", "EWU", "EWA", "EWY", "EWT", "INDA", "MCHI", "VEA", "VWO"],
    "Sector ETFs": ["XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLY", "XLP", "XLB", "XLRE", "XLC"],
    "Commodity + Bond": ["GLD", "SLV", "USO", "UNG", "TLT", "IEF", "HYG", "LQD", "DBC"],
    "High-vol speculative": ["TSLA", "ROKU", "SHOP", "SQ", "PLTR", "COIN", "RIVN", "BYND", "ARKK"],
}


def main():
    p = PortfolioV2Params(max_concurrent=10, risk_pct_equity=1.5, atr_trail_mult=15.0)
    print(f"OOS universe test: conc={p.max_concurrent} risk={p.risk_pct_equity}% trail={p.atr_trail_mult}xATR\n")

    rows = []
    for univ_name, tickers in UNIVERSES.items():
        r = run_portfolio_v2(tickers, p, period="max")
        if not r:
            print(f"  {univ_name}: no result")
            continue
        rows.append({
            "universe": univ_name,
            "tickers": len(tickers),
            "trades": r["total_trades"],
            "win%": round(r["win_rate"], 1),
            "net%": round(r["net_pct"], 1),
            "cagr%": round(r["cagr"], 1),
            "dd%": round(r["max_dd_pct"], 1),
            "sharpe": round(r["sharpe"], 2),
        })
        print(f"  {univ_name:25s} ({len(tickers):2d} tickers) | trades={r['total_trades']:3d}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")

    df = pd.DataFrame(rows)
    print("\n========= OUT-OF-SAMPLE UNIVERSE RESULTS =========")
    print(df.to_string(index=False))
    df.to_csv(Path(__file__).parent / "results_oos_universe.csv", index=False)


if __name__ == "__main__":
    main()
