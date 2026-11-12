"""Overnight gap Stage B (DESIGN_overnight_gap.md, amendment A2): 1DTE ATM straddle 15:55 → 09:35 on low-gamma days.

    python shadow/overnight_straddle.py build      # 2025-05-01 → 2026-03-31
    python shadow/overnight_straddle.py holdout    # 2026-04-01 → 2026-10-16 (one run)
"""
import json
import math
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NIS = os.path.join(HERE, "..")
OC = os.path.join(NIS, ".cache", "uwopt_intraday")
GX = os.path.join(NIS, ".cache", "uw", "gex_strike")
OUT = os.path.join(HERE, "results_overnight_gap")
PERIODS = {"build": ("2025-05-01", "2026-03-31"), "holdout": ("2026-04-01", "2026-10-16")}
LOW_CUT, HIGH_CUT = json.load(open(os.path.join(OUT, "terciles_build.json")))["B"]
SLIP, COMM = 0.02, 0.65           # per leg per side; commission per contract per side
ENTRY_M, EXIT_M = 955, 575        # 15:55 and 09:35 ET (minute the bar starts)


def balance(f):
    rows = json.load(open(f)) if os.path.exists(f) else []
    s = sum(abs(r["gex"]) for r in rows)
    return sum(r["gex"] for r in rows) / s if s else None


def px(id_, d, m):
    f = os.path.join(OC, f"{id_}_{d}.json")
    if not os.path.exists(f):
        return None
    rows = {r["m"]: r["c"] for r in json.load(open(f))}
    for k in (m, m - 1, m + 1):      # tolerate a one-minute hole
        if k in rows:
            return rows[k]
    return None


def mean(x): return float(np.mean(x)) if len(x) else float("nan")
def tstat(x): return float(np.mean(x) / (np.std(x, ddof=1) / math.sqrt(len(x)))) if len(x) > 1 and np.std(x, ddof=1) > 0 else float("nan")
def pf(x):
    g, l = sum(v for v in x if v > 0), -sum(v for v in x if v < 0)
    return g / l if l else float("inf")


def main():
    period = sys.argv[1]; lo, hi = PERIODS[period]
    plan = json.load(open(os.path.join(OUT, "stageB_plan.json")))
    by = {}
    for p in plan:
        by.setdefault((p["T"], p["d"]), {})[p["id"][len(p["T"]) + 6]] = p
    trades, skipped = [], {"no_prev_B": 0, "no_price": 0}
    for (T, d), legs in sorted(by.items()):
        if not (lo <= d <= hi) or set(legs) != {"C", "P"}:
            continue
        daily = sorted(f[len(T) + 1:-5] for f in os.listdir(GX) if f.startswith(T + "_"))
        prev = [x for x in daily if x < d]
        B = balance(os.path.join(GX, f"{T}_{prev[-1]}.json")) if prev else None
        if B is None:
            skipped["no_prev_B"] += 1; continue
        dn = legs["C"]["dn"]
        ein = [px(legs[k]["id"], d, ENTRY_M) for k in "CP"]; eout = [px(legs[k]["id"], dn, EXIT_M) for k in "CP"]
        if None in ein or None in eout:
            skipped["no_price"] += 1; continue
        cost = sum(ein) + 2 * SLIP; proceeds = sum(eout) - 2 * SLIP
        pnl = (proceeds - cost) * 100 - 4 * COMM
        trades.append({"T": T, "d": d, "B_prev": B, "bucket": "low" if B <= LOW_CUT else "high" if B >= HIGH_CUT else "mid",
                       "premium": cost * 100, "pnl": pnl, "ret": pnl / (cost * 100)})
    json.dump({"period": period, "trades": trades, "skipped": skipped}, open(os.path.join(OUT, f"stageB_{period}.json"), "w"), indent=1)
    rng = random.Random(11)
    allp = [t["pnl"] for t in trades]
    low = [t["pnl"] for t in trades if t["bucket"] == "low"]; high = [t["pnl"] for t in trades if t["bucket"] == "high"]
    ctrl = sorted(mean(rng.sample(allp, len(low))) for _ in range(200)) if low and len(low) <= len(allp) else []
    print(f"{period} {lo}→{hi}: {len(trades)} straddles, skipped {skipped}\n")
    print(f"{'sample':10s} {'n':>4s} {'mean $':>8s} {'t':>6s} {'PF':>6s} {'win':>5s} {'mean %prem':>10s} {'worst $':>8s}")
    for lab, x in (("low-B", low), ("high-B", high), ("all", allp)):
        r = [t["ret"] for t in trades if (lab == "all" or t["bucket"] == lab.split("-")[0])]
        print(f"{lab:10s} {len(x):4d} {mean(x):+8.2f} {tstat(x):6.2f} {pf(x):6.2f} {sum(v>0 for v in x)/max(1,len(x))*100:4.0f}% {mean(r)*100:+9.1f}% {min(x) if x else float('nan'):+8.2f}")
    diff_t = float("nan")
    if low and len(allp) > len(low):
        other = [t["pnl"] for t in trades if t["bucket"] != "low"]
        diff_t = (mean(low) - mean(other)) / math.sqrt(np.var(low, ddof=1) / len(low) + np.var(other, ddof=1) / len(other))
    q = (lambda p: ctrl[min(len(ctrl) - 1, int(p * len(ctrl)))]) if ctrl else (lambda p: float("nan"))
    print(f"\nlow-B minus other: t {diff_t:.2f} | random-day control (n={len(low)}): 95th {q(0.95):+.2f} 97.5th {q(0.975):+.2f}")
    if period == "build":
        crit = {"mean>0 & t≥2": mean(low) > 0 and tstat(low) >= 2, "PF≥1.3": pf(low) >= 1.3, "diff t≥2": diff_t >= 2, "> ctrl 97.5": mean(low) > q(0.975)}
    else:
        crit = {"mean>0 & t≥1.65": mean(low) > 0 and tstat(low) >= 1.65, "> ctrl 95": mean(low) > q(0.95)}
    print("Stage B primary (low-B 1DTE straddle):", crit, "→", "PASS" if all(crit.values()) else "FAIL")


if __name__ == "__main__":
    main()
