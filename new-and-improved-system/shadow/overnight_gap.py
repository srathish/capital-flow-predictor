"""Overnight gap size from the gamma regime, Stage A (shadow/DESIGN_overnight_gap.md).

    python shadow/overnight_gap.py build      # 2023-12-13 → 2025-04-30
    python shadow/overnight_gap.py holdout    # 2025-05-01 → 2026-10-16 (sealed; one run)
Writes shadow/results_overnight_gap/<period>.json and prints the pre-registered metrics.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NIS = os.path.join(HERE, "..")
GX = os.path.join(NIS, ".cache", "uw", "gex_strike")
OUT = os.path.join(HERE, "results_overnight_gap"); os.makedirs(OUT, exist_ok=True)
PERIODS = {"build": ("2023-12-13", "2025-04-30"), "holdout": ("2025-05-01", "2026-10-16")}
FLOOR = 0.0005
TERCILES_FILE = os.path.join(OUT, "terciles_build.json")


def balance(rows, lo=None, hi=None):
    g = [r["gex"] for r in rows if (lo is None or lo <= r["k"] <= hi)]
    s = sum(abs(x) for x in g)
    return sum(g) / s if s else None


def build_panel(lo, hi):
    vix = json.load(open(os.path.join(NIS, ".cache", "vix_cboe.json")))
    panel = []
    for sym in ("SPY", "QQQ"):
        D = json.load(open(os.path.join(NIS, ".cache", "uw", f"daily_{sym}.json")))
        days = sorted(D)
        for i, d in enumerate(days[:-1]):
            if not (lo <= d <= hi) or i < 20:
                continue
            f = os.path.join(GX, f"{sym}_{d}.json")
            if not os.path.exists(f) or d not in vix:
                continue
            rows = json.load(open(f))
            if not rows:
                continue
            p, n, pp = D[d], D[days[i + 1]], D[days[i - 1]]
            rng = lambda x: (x["h"] - x["l"]) / x["c"]
            m20 = np.mean([rng(D[days[j]]) for j in range(i - 19, i + 1)])
            B, Bloc = balance(rows), balance(rows, p["c"] * 0.98, p["c"] * 1.02)
            if B is None or Bloc is None:
                continue
            panel.append({
                "sym": sym, "d": d, "dn": days[i + 1], "B": B, "Bloc": Bloc, "lnvix": math.log(vix[d]),
                "prev": math.log(rng(p)), "m20": math.log(m20), "absret": abs(p["c"] / pp["c"] - 1),
                "gap_raw": n["o"] / p["c"] - 1, "c2c_raw": n["c"] / p["c"] - 1,
                "gap": math.log(abs(n["o"] / p["c"] - 1) + FLOOR), "c2c": math.log(abs(n["c"] / p["c"] - 1) + FLOOR),
            })
    return panel


def ols_cluster(X, y, groups):
    """OLS with cluster-robust (by date) standard errors. Returns beta, t, R²."""
    X = np.asarray(X, float); y = np.asarray(y, float)
    XtX_inv = np.linalg.inv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    e = y - X @ beta
    meat = np.zeros((X.shape[1], X.shape[1]))
    for g in set(groups):
        idx = [i for i, gg in enumerate(groups) if gg == g]
        s = (X[idx] * e[idx, None]).sum(0)
        meat += np.outer(s, s)
    V = XtX_inv @ meat @ XtX_inv
    t = beta / np.sqrt(np.diag(V))
    r2 = 1 - (e @ e) / ((y - y.mean()) @ (y - y.mean()))
    return beta, t, r2


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def analyse(panel, target, bvar, terc):
    X0 = [[1, r["sym"] == "QQQ", r["lnvix"], r["prev"], r["m20"], r["absret"]] for r in panel]
    X1 = [row + [r[bvar]] for row, r in zip(X0, panel)]
    y = [r[target] for r in panel]; g = [r["d"] for r in panel]
    b0, t0, r20 = ols_cluster(X0, y, g); b1, t1, r21 = ols_cluster(X1, y, g)
    lo_cut, hi_cut = terc[bvar]
    raw = target + "_raw"
    lo = [abs(r[raw]) for r in panel if r[bvar] <= lo_cut]; hi = [abs(r[raw]) for r in panel if r[bvar] >= hi_cut]
    return {"target": target, "bvar": bvar, "n": len(panel), "coef_B": float(b1[-1]), "t_B": float(t1[-1]),
            "r2_base": float(r20), "r2_full": float(r21), "dr2": float(r21 - r20),
            "spearman": spearman([r[bvar] for r in panel], [abs(r[raw]) for r in panel]),
            "tercile_ratio": float(np.mean(lo) / np.mean(hi)), "mean_abs_lowB": float(np.mean(lo)), "mean_abs_highB": float(np.mean(hi)),
            "n_lo": len(lo), "n_hi": len(hi)}


def direction_control(panel, bvar):
    y = [1.0 if r["gap_raw"] > 0 else 0.0 for r in panel]
    X = [[1, r["sym"] == "QQQ", r["lnvix"], r[bvar]] for r in panel]
    b, t, _ = ols_cluster(X, y, [r["d"] for r in panel])
    return {"t_B_on_gap_sign": float(t[-1]), "p_up": float(np.mean(y))}


def main():
    period = sys.argv[1]
    lo, hi = PERIODS[period]
    panel = build_panel(lo, hi)
    if period == "build":
        terc = {v: (float(np.percentile([r[v] for r in panel], 100 / 3)), float(np.percentile([r[v] for r in panel], 200 / 3))) for v in ("B", "Bloc")}
        json.dump(terc, open(TERCILES_FILE, "w"))
    else:
        terc = json.load(open(TERCILES_FILE))
    res = {"period": period, "range": [lo, hi], "n": len(panel), "terciles": terc,
           "fits": [analyse(panel, tg, bv, terc) for tg in ("gap", "c2c") for bv in ("B", "Bloc")],
           "direction_control": {bv: direction_control(panel, bv) for bv in ("B", "Bloc")},
           "by_sym": {s: sum(r["sym"] == s for r in panel) for s in ("SPY", "QQQ")}}
    # Amendment A1: descriptive slices, no verdict weight
    top_vix = sorted({r["d"]: r["lnvix"] for r in panel}.items(), key=lambda kv: -kv[1])[:10]
    ex = [r for r in panel if r["d"] not in {d for d, _ in top_vix}]
    res["slices"] = {"SPY": analyse([r for r in panel if r["sym"] == "SPY"], "gap", "B", terc),
                     "QQQ": analyse([r for r in panel if r["sym"] == "QQQ"], "gap", "B", terc),
                     "ex_top10_vix": analyse(ex, "gap", "B", terc)}
    json.dump(res, open(os.path.join(OUT, f"{period}.json"), "w"), indent=1)
    print(f"{period} {lo}→{hi}: n={len(panel)} symbol-days {res['by_sym']}; terciles {terc}\n")
    print(f"{'target':5s} {'var':5s} {'coef':>8s} {'t(clust)':>9s} {'ΔR²':>7s} {'R²base':>7s} {'spearman':>9s} {'terc ratio':>10s} {'lowB mean':>10s} {'highB mean':>10s}")
    for f in res["fits"]:
        print(f"{f['target']:5s} {f['bvar']:5s} {f['coef_B']:+8.3f} {f['t_B']:9.2f} {f['dr2']:7.4f} {f['r2_base']:7.3f} {f['spearman']:+9.3f} {f['tercile_ratio']:10.3f} {f['mean_abs_lowB']*100:9.3f}% {f['mean_abs_highB']*100:9.3f}%")
    print("\nslices (A1, descriptive):")
    for k, f in res["slices"].items():
        print(f"  {k:12s} n={f['n']:4d} coef {f['coef_B']:+.3f} t {f['t_B']:+.2f} terc {f['tercile_ratio']:.2f} (n_lo {f['n_lo']}, n_hi {f['n_hi']})")
    print("\ndirection control (t of B on P(gap up)):", {k: round(v["t_B_on_gap_sign"], 2) for k, v in res["direction_control"].items()})
    p = next(f for f in res["fits"] if f["target"] == "gap" and f["bvar"] == "B")
    if period == "build":
        crit = {"coef<0": p["coef_B"] < 0, "|t|≥2.5": abs(p["t_B"]) >= 2.5, "terc≥1.15": p["tercile_ratio"] >= 1.15, "ΔR²≥0.01": p["dr2"] >= 0.01}
    else:
        crit = {"coef<0": p["coef_B"] < 0, "|t|≥2.0": abs(p["t_B"]) >= 2.0, "terc≥1.10": p["tercile_ratio"] >= 1.10}
    dc_ok = abs(res["direction_control"]["B"]["t_B_on_gap_sign"]) < 2
    print("Primary (gap ~ B):", crit, "| direction control clean:", dc_ok, "→", "PASS" if all(crit.values()) else "FAIL")


if __name__ == "__main__":
    main()
