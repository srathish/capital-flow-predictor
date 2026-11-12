"""Overnight hedge test (shadow/DESIGN_overnight_hedge.md): skip low-gamma nights in an overnight-only SPY/QQQ exposure.

    python shadow/overnight_hedge.py build      # 2023-12-13 → 2025-04-30
    python shadow/overnight_hedge.py holdout    # 2025-05-01 → 2026-10-16 (one run)
"""
import json
import math
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NIS = os.path.join(HERE, "..")
GX = os.path.join(NIS, ".cache", "uw", "gex_strike")
OUT = os.path.join(HERE, "results_overnight_hedge"); os.makedirs(OUT, exist_ok=True)
PERIODS = {"build": ("2023-12-13", "2025-04-30"), "holdout": ("2025-05-01", "2026-10-16")}
LOW_CUT = json.load(open(os.path.join(HERE, "results_overnight_gap", "terciles_build.json")))["B"][0]
COST = 0.0001  # 1 bp per side, charged as 2 bp on each skipped night


def balance(f):
    rows = json.load(open(f)) if os.path.exists(f) else []
    s = sum(abs(r["gex"]) for r in rows)
    return sum(r["gex"] for r in rows) / s if s else None


def series(sym, lo, hi):
    D = json.load(open(os.path.join(NIS, ".cache", "uw", f"daily_{sym}.json")))
    vix = json.load(open(os.path.join(NIS, ".cache", "vix_cboe.json")))
    days = sorted(D)
    out = []
    for i, d in enumerate(days[:-1]):
        if not (lo <= d <= hi):
            continue
        B = balance(os.path.join(GX, f"{sym}_{d}.json"))
        if B is None or d not in vix:
            continue
        out.append({"d": d, "r": D[days[i + 1]]["o"] / D[d]["c"] - 1, "B": B, "vix": vix[d]})
    return out


def stats(r):
    r = np.asarray(r)
    mu, sd = r.mean(), r.std(ddof=1)
    cum = np.cumprod(1 + r); dd = (cum / np.maximum.accumulate(cum) - 1).min()
    return {"sharpe": float(mu / sd * math.sqrt(252)) if sd else float("nan"), "vol": float(sd * math.sqrt(252)),
            "mean_bp": float(mu * 1e4), "maxdd": float(dd), "n": int(len(r))}


def apply(rows, skip):
    return [(-2 * COST if s else x["r"]) for x, s in zip(rows, skip)]


def welch(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float((a.mean() - b.mean()) / math.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b)))


def main():
    period = sys.argv[1]; lo, hi = PERIODS[period]
    res = {"period": period, "range": [lo, hi], "low_cut": LOW_CUT, "symbols": {}}
    rng = random.Random(5)
    for sym in ("SPY", "QQQ"):
        rows = series(sym, lo, hi)
        skipS = [x["B"] <= LOW_CUT for x in rows]; k = sum(skipS)
        topv = set(sorted(range(len(rows)), key=lambda i: -rows[i]["vix"])[:k]); skipV = [i in topv for i in range(len(rows))]
        A, S, V = stats([x["r"] for x in rows]), stats(apply(rows, skipS)), stats(apply(rows, skipV))
        R = []
        for _ in range(1000):
            idx = set(rng.sample(range(len(rows)), k)); R.append(stats(apply(rows, [i in idx for i in range(len(rows))]))["sharpe"])
        R.sort()
        skipped = [x["r"] for x, s in zip(rows, skipS) if s]; kept = [x["r"] for x, s in zip(rows, skipS) if not s]
        q = lambda p: R[min(len(R) - 1, int(p * len(R)))]
        res["symbols"][sym] = {"A": A, "S": S, "V": V, "skipped_nights": k, "R_sharpe_50": q(0.5), "R_sharpe_95": q(0.95), "R_sharpe_97p5": q(0.975),
                               "direction_t": welch(skipped, kept), "skipped_mean_bp": float(np.mean(skipped) * 1e4), "kept_mean_bp": float(np.mean(kept) * 1e4)}
    json.dump(res, open(os.path.join(OUT, f"{period}.json"), "w"), indent=1)
    print(f"{period} {lo}→{hi}\n")
    print(f"{'sym':4s} {'nights':>6s} {'skip':>5s} | {'Sharpe A':>8s} {'Sharpe S':>8s} {'Sharpe V':>8s} {'R 50/95/97.5':>20s} | {'vol A':>6s} {'vol S':>6s} | {'mean A bp':>9s} {'mean S bp':>9s} | {'maxDD A':>7s} {'maxDD S':>7s} | dir t  skipped/kept bp")
    ok = {}
    for sym, x in res["symbols"].items():
        A, S, V = x["A"], x["S"], x["V"]
        print(f"{sym:4s} {A['n']:6d} {x['skipped_nights']:5d} | {A['sharpe']:8.2f} {S['sharpe']:8.2f} {V['sharpe']:8.2f} {x['R_sharpe_50']:6.2f}/{x['R_sharpe_95']:5.2f}/{x['R_sharpe_97p5']:5.2f} | "
              f"{A['vol']*100:5.1f}% {S['vol']*100:5.1f}% | {A['mean_bp']:9.2f} {S['mean_bp']:9.2f} | {A['maxdd']*100:6.1f}% {S['maxdd']*100:6.1f}% | {x['direction_t']:+5.2f}  {x['skipped_mean_bp']:+.1f}/{x['kept_mean_bp']:+.1f}")
        if period == "build":
            ok[sym] = {"S>A": S["sharpe"] > A["sharpe"], "S≥V": S["sharpe"] >= V["sharpe"], "S>R97.5": S["sharpe"] > x["R_sharpe_97p5"],
                       "vol≤0.90A": S["vol"] <= 0.90 * A["vol"], "dir clean": abs(x["direction_t"]) < 2}
        else:
            ok[sym] = {"S>A": S["sharpe"] > A["sharpe"], "S>R95": S["sharpe"] > x["R_sharpe_95"], "vol≤0.92A": S["vol"] <= 0.92 * A["vol"]}
    print("\ncriteria:", ok, "→", "PASS" if all(all(v.values()) for v in ok.values()) else "FAIL")


if __name__ == "__main__":
    main()
