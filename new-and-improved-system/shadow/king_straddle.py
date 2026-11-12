"""King geometry Stage B (DESIGN_king_geometry.md A1): short 10:31 ATM 0DTE straddle on top King-share days.

    python shadow/king_straddle.py build      # 2025-05-01 → 2026-03-31
    python shadow/king_straddle.py holdout    # 2026-04-01 → 2026-10-16 (one run)
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
OUT = os.path.join(HERE, "results_king_geometry")
PERIODS = {"build": ("2025-05-01", "2026-03-31"), "holdout": ("2026-04-01", "2026-10-16")}
LO_CUT, HI_CUT = json.load(open(os.path.join(OUT, "terciles_front.json")))["kshare"]
SLIP, COMM = 0.02, 0.65
ENTRY_M, EXIT_M = 631, 955

sys.path.insert(0, HERE)
from king_geometry import panel  # noqa: E402  (same features, same point-in-time rules)


def opt_rows(id_, d):
    f = os.path.join(OC, f"{id_}_{d}.json")
    return {r["m"]: r["c"] for r in json.load(open(f))} if os.path.exists(f) else None


def px(rows, m):
    for k in (m, m - 1, m + 1, m - 2, m + 2):
        if k in rows:
            return rows[k]
    return None


def mean(x): return float(np.mean(x)) if len(x) else float("nan")
def tstat(x): return float(np.mean(x) / (np.std(x, ddof=1) / math.sqrt(len(x)))) if len(x) > 1 and np.std(x, ddof=1) > 0 else float("nan")
def pf(x): g, l = sum(v for v in x if v > 0), -sum(v for v in x if v < 0); return g / l if l else float("inf")


def main():
    period = sys.argv[1]; lo, hi = PERIODS[period]
    plan = {(p["T"], p["d"], p["id"][len(p["T"]) + 6]): p for p in json.load(open(os.path.join(HERE, "results_management_only_plan.json")))}
    rows = panel(lo, hi, "front")
    trades, skipped = [], 0
    for r in rows:
        c, p = plan.get((r["sym"], r["d"], "C")), plan.get((r["sym"], r["d"], "P"))
        oc, op = (opt_rows(c["id"], r["d"]) if c else None), (opt_rows(p["id"], r["d"]) if p else None)
        if not oc or not op:
            skipped += 1; continue
        ec, ep, xc, xp = px(oc, ENTRY_M), px(op, ENTRY_M), px(oc, EXIT_M), px(op, EXIT_M)
        if None in (ec, ep, xc, xp):
            skipped += 1; continue
        prem = ec + ep - 2 * SLIP
        pnl_hold = (prem - (xc + xp + 2 * SLIP)) * 100 - 4 * COMM
        # 2x-premium stop variant
        pnl_stop, stopped = pnl_hold, False
        for m in range(ENTRY_M + 1, EXIT_M):
            mc, mp = px(oc, m), px(op, m)
            if mc is not None and mp is not None and mc + mp >= 2 * prem:
                pnl_stop = (prem - (mc + mp + 2 * SLIP)) * 100 - 4 * COMM; stopped = True; break
        trades.append({"sym": r["sym"], "d": r["d"], "kshare": r["kshare"], "bucket": "top" if r["kshare"] >= HI_CUT else "bottom" if r["kshare"] <= LO_CUT else "mid",
                       "premium": prem * 100, "pnl": pnl_hold, "pnl_stop": pnl_stop, "stopped": stopped})
    json.dump({"period": period, "trades": trades, "skipped": skipped}, open(os.path.join(OUT, f"stageB_{period}.json"), "w"), indent=1)
    top = [t["pnl"] for t in trades if t["bucket"] == "top"]; bot = [t["pnl"] for t in trades if t["bucket"] == "bottom"]; allp = [t["pnl"] for t in trades]
    rng = random.Random(3); ctrl = sorted(mean(rng.sample(allp, len(top))) for _ in range(200)) if top else []
    q = (lambda p: ctrl[min(len(ctrl) - 1, int(p * len(ctrl)))]) if ctrl else (lambda p: float("nan"))
    print(f"{period} {lo}→{hi}: {len(trades)} straddles sold, skipped {skipped}\n")
    print(f"{'sample':8s} {'n':>4s} {'mean $':>8s} {'t':>6s} {'PF':>6s} {'win':>5s} {'%prem':>7s} {'worst':>8s} | {'w/ 2x stop mean':>15s} {'stopped':>7s}")
    for lab, key in (("top", "top"), ("bottom", "bottom"), ("all", None)):
        ts = [t for t in trades if key is None or t["bucket"] == key]; x = [t["pnl"] for t in ts]; xs = [t["pnl_stop"] for t in ts]
        print(f"{lab:8s} {len(x):4d} {mean(x):+8.2f} {tstat(x):6.2f} {pf(x):6.2f} {sum(v>0 for v in x)/max(1,len(x))*100:4.0f}% {mean([t['pnl']/t['premium'] for t in ts])*100:+6.1f}% {min(x) if x else float('nan'):+8.2f} | {mean(xs):+15.2f} {sum(t['stopped'] for t in ts):7d}")
    other = [t["pnl"] for t in trades if t["bucket"] != "top"]
    diff_t = (mean(top) - mean(other)) / math.sqrt(np.var(top, ddof=1) / len(top) + np.var(other, ddof=1) / len(other)) if top and other else float("nan")
    print(f"\ntop minus other: t {diff_t:.2f} | random control (n={len(top)}): 95th {q(0.95):+.2f} 97.5th {q(0.975):+.2f} median {q(0.5):+.2f}")
    if period == "build":
        crit = {"mean>0 & t≥2": mean(top) > 0 and tstat(top) >= 2, "PF≥1.3": pf(top) >= 1.3, "diff t≥2": diff_t >= 2, "> ctrl 97.5": mean(top) > q(0.975)}
    else:
        crit = {"mean>0 & t≥1.65": mean(top) > 0 and tstat(top) >= 1.65, "> ctrl 95": mean(top) > q(0.95)}
    print("Stage B primary (short straddle, top kshare tercile):", crit, "→", "PASS" if all(crit.values()) else "FAIL")


if __name__ == "__main__":
    main()
