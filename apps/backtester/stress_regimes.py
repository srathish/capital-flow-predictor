"""Stress-test the robust winning config on specific market regimes.

Critical anti-overfit check: if the strategy works ONLY in trending bull markets,
it'll blow up the moment regime shifts. Need to see:
  - 2015-2017 (sideways chop year)
  - 2018 Q4 (sharp correction)
  - 2020 Mar (COVID crash + recovery)
  - 2022 (year-long bear)
  - 2023-2024 (AI bull)
  - 2025-2026 (mixed)

Each window tests if the strategy survives different regime types.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2, UNIVERSE


# Each regime window includes 2 years of warmup before to ensure indicators are valid
REGIMES = [
    ("2015-2016 chop + recovery",   "2013-01-01", "2017-01-01"),  # includes 2014-15 chop
    ("2018 vol + Q4 crash",         "2016-01-01", "2019-01-01"),
    ("2020 COVID crash + rebound",  "2018-01-01", "2021-01-01"),
    ("2022 BEAR market",            "2020-01-01", "2023-01-01"),
    ("2023-2024 AI bull",           "2021-01-01", "2025-01-01"),
    ("2014-2018 mid cycle",         "2012-01-01", "2018-01-01"),
    ("2018-2022 incl COVID + bear", "2016-01-01", "2022-12-31"),
    ("2010-2015 post-GFC",          "2008-01-01", "2015-12-31"),
]


def main():
    # Use the robust winner from grid_focused.py
    p = PortfolioV2Params(max_concurrent=10, risk_pct_equity=1.5, atr_trail_mult=15.0)
    print(f"Stress test: conc={p.max_concurrent} risk={p.risk_pct_equity}% trail={p.atr_trail_mult}×ATR\n")

    rows = []
    for label, start, end in REGIMES:
        r = run_portfolio_v2(UNIVERSE, p, start_date=start, end_date=end, period="max")
        if not r: continue
        rows.append({
            "regime": label,
            "trades": r["total_trades"],
            "win%": round(r["win_rate"], 1),
            "net%": round(r["net_pct"], 1),
            "cagr%": round(r["cagr"], 1),
            "dd%": round(r["max_dd_pct"], 1),
            "sharpe": round(r["sharpe"], 2),
        })
        print(f"  {label:30s} | trades={r['total_trades']:3d}  net%={r['net_pct']:7.1f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:5.2f}")

    df = pd.DataFrame(rows)
    print("\n========= REGIME STRESS TEST =========")
    print(df.to_string(index=False))

    # Summary stats
    print(f"\nRegimes with positive returns: {(df['net%'] > 0).sum()} / {len(df)}")
    print(f"Regimes with Sharpe > 0:        {(df['sharpe'] > 0).sum()} / {len(df)}")
    print(f"Worst regime: {df.loc[df['net%'].idxmin(), 'regime']} ({df['net%'].min():.1f}%)")
    print(f"Best regime:  {df.loc[df['net%'].idxmax(), 'regime']} ({df['net%'].max():.1f}%)")
    print(f"Worst DD:     {df['dd%'].max():.1f}% in {df.loc[df['dd%'].idxmax(), 'regime']}")

    out_path = Path(__file__).parent / "results_stress_regimes.csv"
    df.to_csv(out_path, index=False)


if __name__ == "__main__":
    main()
