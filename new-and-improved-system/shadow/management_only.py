"""Management-only test (shadow/DESIGN_management_only.md): node exits vs fixed exits on coin-direction 0DTE entries.

    python shadow/management_only.py build      # 2025-05-01 → 2026-03-31
    python shadow/management_only.py holdout    # 2026-04-01 → 2026-10-16 (one run)
"""
import json
import math
import os
import random
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NIS = os.path.join(HERE, "..")
BOARDS = os.path.join(NIS, ".cache", "skylit_boards_1030")
OC = os.path.join(NIS, ".cache", "uwopt_intraday")
M1 = os.path.join(NIS, ".cache", "uw", "m1")
OUT = os.path.join(HERE, "results_management_only"); os.makedirs(OUT, exist_ok=True)
PERIODS = {"build": ("2025-05-01", "2026-03-31"), "holdout": ("2026-04-01", "2026-10-16")}
ET = ZoneInfo("America/New_York")
SLIP, COMM = 0.02, 0.65
ENTRY_M, FLAT_M = 631, 955          # 10:31 entry minute, 15:55 flatten
P20, MIN_DIST = 0.20, 0.0015


def emin(t): d = datetime.fromtimestamp(t, timezone.utc).astimezone(ET); return d.hour * 60 + d.minute


def bars_for(sym, d):
    f = os.path.join(M1, sym, f"{d}.json")
    if not os.path.exists(f):
        return None
    out = {}
    for b in json.load(open(f)):
        if b.get("m") == "r":
            out[emin(b["t"])] = b
    return out if len(out) >= 300 else None


def opt(id_, d):
    f = os.path.join(OC, f"{id_}_{d}.json")
    if not os.path.exists(f):
        return None
    rows = {r["m"]: r["c"] for r in json.load(open(f))}
    return rows or None


def opt_px(rows, m):
    for k in (m, m - 1, m + 1, m - 2, m + 2):
        if k in rows:
            return rows[k]
    return None


def levels(board_sym, d, spot, direction, column="front"):
    """Target (in trade direction) and stop level (against) from P20 nodes. column: 'front' or 'agg'."""
    exps = board_sym["expirations"]
    if column == "front":
        if not exps or exps[0].replace("", "")[:10] != d:
            return None
        vals = {float(s["strike"]): float(row[0] or 0) for s, row in zip(board_sym["strikes"], board_sym["matrix"])}
    else:
        vals = {float(s["strike"]): float(s["value"] or 0) for s in board_sym["strikes"]}
    king = max(abs(v) for v in vals.values()) if vals else 0
    if not king:
        return None
    nodes = [k for k, v in vals.items() if abs(v) >= P20 * king]
    above = sorted(k for k in nodes if k >= spot * (1 + MIN_DIST)); below = sorted((k for k in nodes if k <= spot * (1 - MIN_DIST)), reverse=True)
    tgt, stp = (above[0] if above else None, below[0] if below else None) if direction > 0 else (below[0] if below else None, above[0] if above else None)
    return (tgt, stp) if tgt is not None and stp is not None else None


def run_trade(bars, orows, direction, entry_px, tgt, stp, rule):
    """Return exit option price and exit minute. rule: F1, F2, N1, N2."""
    for m in range(ENTRY_M + 1, FLAT_M):
        if m not in bars:
            continue
        b = bars[m]; op = opt_px(orows, m)
        if op is None:
            continue
        if rule in ("F1", "N1", "N2") and op <= entry_px * 0.5:
            return op, m, "stop50"
        if rule == "F1" and op >= entry_px * 1.3:
            return op, m, "tp30"
        if rule in ("N1", "N2"):
            hit_t = (b["h"] >= tgt) if direction > 0 else (b["l"] <= tgt)
            if hit_t:
                return op, m, "node_tgt"
            if rule == "N1":
                hit_s = (b["l"] <= stp) if direction > 0 else (b["h"] >= stp)
                if hit_s:
                    return op, m, "node_stop"
    op = opt_px(orows, FLAT_M)
    return (op, FLAT_M, "flat") if op is not None else (None, None, "noprice")


def pnl(entry, exit_):
    return ((exit_ - SLIP) - (entry + SLIP)) * 100 - 2 * COMM


def mean(x): return float(np.mean(x)) if len(x) else float("nan")
def tstat(x): return float(np.mean(x) / (np.std(x, ddof=1) / math.sqrt(len(x)))) if len(x) > 1 and np.std(x, ddof=1) > 0 else float("nan")
def pf(x): g, l = sum(v for v in x if v > 0), -sum(v for v in x if v < 0); return g / l if l else float("inf")


def main():
    period = sys.argv[1]; lo, hi = PERIODS[period]
    plan = {(p["T"], p["d"], p["id"][len(p["T"]) + 6]): p for p in json.load(open(os.path.join(HERE, "results_management_only_plan.json")))}
    rng = random.Random(2026)
    recs, skipped = [], {"board": 0, "levels": 0, "option": 0, "bars": 0}
    days = sorted({d for (_, d, _) in plan if lo <= d <= hi})
    for d in days:
        bf = os.path.join(BOARDS, f"{d}.json")
        if not os.path.exists(bf):
            skipped["board"] += 1; continue
        board = {s["symbol"]: s for s in json.load(open(bf))["data"]["symbols"]}
        for sym in ("SPY", "QQQ"):
            direction = rng.choice((-1, 1))          # the coin, drawn in a fixed order regardless of data availability
            bars = bars_for(sym, d)
            if bars is None or sym not in board:
                skipped["bars"] += 1; continue
            spot = bars[ENTRY_M - 2]["c"] if ENTRY_M - 2 in bars else None
            if spot is None:
                skipped["bars"] += 1; continue
            for dirn, tag in ((direction, "coin"), (-direction, "mirror")):
                cp = "C" if dirn > 0 else "P"
                p = plan.get((sym, d, cp))
                orows = opt(p["id"], d) if p else None
                if not orows:
                    skipped["option"] += 1; continue
                entry = opt_px(orows, ENTRY_M)
                if entry is None or entry < 0.05:
                    skipped["option"] += 1; continue
                lv = levels(board[sym], d, spot, dirn, "front") or levels(board[sym], d, spot, dirn, "agg")
                if lv is None:
                    skipped["levels"] += 1; continue
                tgt, stp = lv
                rec = {"sym": sym, "d": d, "sample": tag, "dir": dirn, "entry": entry, "tgt_dist": abs(tgt / spot - 1), "stp_dist": abs(stp / spot - 1)}
                for rule in ("F1", "F2", "N1", "N2"):
                    ex, m, how = run_trade(bars, orows, dirn, entry, tgt, stp, rule)
                    rec[rule] = pnl(entry, ex) if ex is not None else None; rec[rule + "_how"] = how
                rec["_bars"] = None  # placeholder, filled below for placebo
                recs.append((rec, bars, orows, spot))
    # distance-matched placebo: N1 with target/stop distances taken from another trade's levels (200 shuffles)
    coin = [(r, b, o, s) for r, b, o, s in recs if r["sample"] == "coin" and r["N1"] is not None]
    dists = [(r["tgt_dist"], r["stp_dist"]) for r, *_ in coin]
    prng = random.Random(99); placebo_means = []
    for _ in range(200):
        perm = dists[:]; prng.shuffle(perm); vals = []
        for (r, bars, orows, spot), (td, sd) in zip(coin, perm):
            tgt = spot * (1 + td) if r["dir"] > 0 else spot * (1 - td); stp = spot * (1 - sd) if r["dir"] > 0 else spot * (1 + sd)
            ex, m, how = run_trade(bars, orows, r["dir"], r["entry"], tgt, stp, "N1")
            if ex is not None:
                vals.append(pnl(r["entry"], ex))
        placebo_means.append(mean(vals))
    placebo_means.sort()
    out_recs = [{k: v for k, v in r.items() if k != "_bars"} for r, *_ in recs]
    json.dump({"period": period, "trades": out_recs, "skipped": skipped, "placebo_means": placebo_means}, open(os.path.join(OUT, f"{period}.json"), "w"), indent=1)
    print(f"{period} {lo}→{hi}: {len(coin)} coin trades ({len(out_recs)} incl. mirror); skipped {skipped}\n")
    for tag in ("coin", "mirror"):
        rows = [r for r, *_ in recs if r["sample"] == tag]
        print(f"[{tag}]  {'rule':4s} {'n':>4s} {'mean $':>8s} {'t':>6s} {'PF':>6s} {'win':>5s} {'worst':>8s}  exits")
        for rule in ("F1", "F2", "N1", "N2"):
            x = [r[rule] for r in rows if r[rule] is not None]
            hows = {}
            for r in rows: hows[r[rule + "_how"]] = hows.get(r[rule + "_how"], 0) + 1
            print(f"        {rule:4s} {len(x):4d} {mean(x):+8.2f} {tstat(x):6.2f} {pf(x):6.2f} {sum(v>0 for v in x)/max(1,len(x))*100:4.0f}% {min(x) if x else float('nan'):+8.2f}  {hows}")
    c = [r for r, *_ in coin]
    d1 = [r["N1"] - r["F1"] for r in c if r["F1"] is not None]; d2 = [r["N1"] - r["F2"] for r in c if r["F2"] is not None]
    n1 = mean([r["N1"] for r in c])
    q = lambda p: placebo_means[min(len(placebo_means) - 1, int(p * len(placebo_means)))]
    print(f"\ncoin: N1−F1 mean {mean(d1):+.2f} t {tstat(d1):.2f} | N1−F2 mean {mean(d2):+.2f} t {tstat(d2):.2f} | N1 mean {n1:+.2f} vs placebo 95th {q(0.95):+.2f} / 97.5th {q(0.975):+.2f} (placebo median {q(0.5):+.2f})")
    if period == "build":
        crit = {"N1−F1 t≥2": tstat(d1) >= 2, "N1−F2 t≥2": tstat(d2) >= 2, "N1 > placebo 97.5": n1 > q(0.975)}
    else:
        crit = {"N1−F1 t≥1.65": tstat(d1) >= 1.65, "N1 > placebo 95": n1 > q(0.95)}
    print("Primary:", crit, "→", "PASS" if all(crit.values()) else "FAIL")


if __name__ == "__main__":
    main()
