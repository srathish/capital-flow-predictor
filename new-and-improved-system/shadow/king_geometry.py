"""King geometry at 10:30 → rest-of-day range (shadow/DESIGN_king_geometry.md).

    python shadow/king_geometry.py build      # 2025-05-01 → 2026-03-31
    python shadow/king_geometry.py holdout    # 2026-04-01 → 2026-10-16 (one run)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NIS = os.path.join(HERE, "..")
BOARDS = os.path.join(NIS, ".cache", "skylit_boards_1030")
M1 = os.path.join(NIS, ".cache", "uw", "m1")
GX = os.path.join(NIS, ".cache", "uw", "gex_strike")
OUT = os.path.join(HERE, "results_king_geometry"); os.makedirs(OUT, exist_ok=True)
PERIODS = {"build": ("2025-05-01", "2026-03-31"), "holdout": ("2026-04-01", "2026-10-16")}
ET = ZoneInfo("America/New_York")
FLOOR = 0.0005


def emin(t): d = datetime.fromtimestamp(t, timezone.utc).astimezone(ET); return d.hour * 60 + d.minute


def bars_for(sym, d):
    f = os.path.join(M1, sym, f"{d}.json")
    if not os.path.exists(f):
        return None
    out = {emin(b["t"]): b for b in json.load(open(f)) if b.get("m") == "r"}
    return out if len(out) >= 300 else None


def balance_file(f):
    rows = json.load(open(f)) if os.path.exists(f) else []
    s = sum(abs(r["gex"]) for r in rows)
    return sum(r["gex"] for r in rows) / s if s else None


def geometry(bs, d, spot, column):
    exps = bs["expirations"]
    if column == "front":
        if not exps or exps[0][:10] != d:
            return None
        vals = {float(s["strike"]): float(row[0] or 0) for s, row in zip(bs["strikes"], bs["matrix"])}
    else:
        vals = {float(s["strike"]): float(s["value"] or 0) for s in bs["strikes"]}
    tot = sum(abs(v) for v in vals.values())
    if not tot:
        return None
    kk = max(vals, key=lambda k: abs(vals[k]))
    side = 1 if kk > spot else -1
    opp = sum(abs(v) for k, v in vals.items() if (k - spot) * side < 0)
    return {"kdist": abs(kk / spot - 1), "kshare": abs(vals[kk]) / tot, "oppshare": opp / tot, "side": side}


def ols_cluster(X, y, groups):
    X = np.asarray(X, float); y = np.asarray(y, float)
    XtX_inv = np.linalg.inv(X.T @ X); beta = XtX_inv @ X.T @ y; e = y - X @ beta
    meat = np.zeros((X.shape[1], X.shape[1]))
    for g in set(groups):
        idx = [i for i, gg in enumerate(groups) if gg == g]; s = (X[idx] * e[idx, None]).sum(0); meat += np.outer(s, s)
    V = XtX_inv @ meat @ XtX_inv
    return beta, beta / np.sqrt(np.diag(V)), 1 - (e @ e) / ((y - y.mean()) @ (y - y.mean()))


def panel(lo, hi, column):
    vix = json.load(open(os.path.join(NIS, ".cache", "vix_cboe.json")))
    rows = []
    for f in sorted(os.listdir(BOARDS)):
        d = f[:10]
        if not (lo <= d <= hi):
            continue
        board = {s["symbol"]: s for s in json.load(open(os.path.join(BOARDS, f)))["data"]["symbols"]}
        for sym in ("SPY", "QQQ"):
            bars = bars_for(sym, d)
            if bars is None or sym not in board or 629 not in bars:
                continue
            spot = bars[629]["c"]
            g = geometry(board[sym], d, spot, column)
            if g is None:
                continue
            fh = [bars[m] for m in range(570, 630) if m in bars]; rest = [bars[m] for m in range(630, 960) if m in bars]
            if len(fh) < 50 or len(rest) < 300:
                continue
            D = json.load(open(os.path.join(NIS, ".cache", "uw", f"daily_{sym}.json"))); days = sorted(D); i = days.index(d)
            prev_d = days[i - 1]
            Bp = balance_file(os.path.join(GX, f"{sym}_{prev_d}.json"))
            if Bp is None or prev_d not in vix:
                continue
            m20 = np.mean([(D[days[j]]["h"] - D[days[j]]["l"]) / D[days[j]]["c"] for j in range(i - 20, i)])
            close = rest[-1]["c"]
            rows.append({"sym": sym, "d": d, **g, "lnvix": math.log(vix[prev_d]), "fh": math.log((max(b["h"] for b in fh) - min(b["l"] for b in fh)) / spot),
                         "B_prev": Bp, "m20": math.log(m20),
                         "rod": math.log((max(b["h"] for b in rest) - min(b["l"] for b in rest)) / spot),
                         "cls": math.log(abs(close / spot - 1) + FLOOR), "updir": 1.0 if close > spot else 0.0})
    return rows


def fit(rows, target, feats, terc=None):
    base = ["lnvix", "fh", "B_prev", "m20"]
    X0 = [[1, r["sym"] == "QQQ"] + [r[k] for k in base] for r in rows]; y = [r[target] for r in rows]; g = [r["d"] for r in rows]
    _, _, r20 = ols_cluster(X0, y, g)
    X1 = [row + [r[k] for k in feats] for row, r in zip(X0, rows)]
    b, t, r21 = ols_cluster(X1, y, g)
    out = {"n": len(rows), "r2_base": float(r20), "r2_full": float(r21)}
    for j, k in enumerate(feats):
        Xk = [row + [r[k]] for row, r in zip(X0, rows)]; _, _, r2k = ols_cluster(Xk, y, g)
        out[k] = {"coef": float(b[len(base) + 2 + j]), "t": float(t[len(base) + 2 + j]), "dr2_alone": float(r2k - r20)}
        if terc:
            lo_c, hi_c = terc[k]; raw = [math.exp(r[target]) for r in rows if r[k] <= lo_c]; hi_v = [math.exp(r[target]) for r in rows if r[k] >= hi_c]
            out[k]["terc_ratio_hi_over_lo"] = float(np.mean(hi_v) / np.mean(raw)) if raw and hi_v else float("nan")
    return out


def main():
    period = sys.argv[1]; lo, hi = PERIODS[period]
    res = {"period": period, "range": [lo, hi]}
    for column in ("front", "agg"):
        rows = panel(lo, hi, column)
        tf = os.path.join(OUT, f"terciles_{column}.json")
        feats = ["kdist", "kshare", "oppshare"]
        if period == "build":
            terc = {k: (float(np.percentile([r[k] for r in rows], 100 / 3)), float(np.percentile([r[k] for r in rows], 200 / 3))) for k in feats}
            json.dump(terc, open(tf, "w"))
        else:
            terc = json.load(open(tf))
        res[column] = {"rod": fit(rows, "rod", feats, terc), "cls": fit(rows, "cls", feats, terc), "direction": fit(rows, "updir", ["side"])}
        print(f"\n[{column}] {period} {lo}→{hi}: n={len(rows)}")
        for tg in ("rod", "cls"):
            f = res[column][tg]
            print(f"  {tg}: R² base {f['r2_base']:.3f} full {f['r2_full']:.3f} | " + " | ".join(f"{k} coef {f[k]['coef']:+.3f} t {f[k]['t']:+.2f} ΔR² {f[k]['dr2_alone']:.4f} terc(hi/lo) {f[k]['terc_ratio_hi_over_lo']:.2f}" for k in feats))
        print(f"  direction control: side t {res[column]['direction']['side']['t']:+.2f}")
    json.dump(res, open(os.path.join(OUT, f"{period}.json"), "w"), indent=1)
    p = res["front"]["rod"]
    tmin = 2.5 if period == "build" else 2.0
    h1 = {"kdist>0": p["kdist"]["coef"] > 0, f"|t|≥{tmin}": abs(p["kdist"]["t"]) >= tmin, **({"ΔR²≥0.01": p["kdist"]["dr2_alone"] >= 0.01} if period == "build" else {})}
    h2 = {"kshare<0": p["kshare"]["coef"] < 0, f"|t|≥{tmin}": abs(p["kshare"]["t"]) >= tmin, **({"ΔR²≥0.01": p["kshare"]["dr2_alone"] >= 0.01} if period == "build" else {})}
    dc = abs(res["front"]["direction"]["side"]["t"]) < 2
    print(f"\nH1 far King → bigger range: {h1} → {'PASS' if all(h1.values()) else 'FAIL'}")
    print(f"H2 dominant King → smaller range: {h2} → {'PASS' if all(h2.values()) else 'FAIL'}   | direction control clean: {dc}")


if __name__ == "__main__":
    main()
