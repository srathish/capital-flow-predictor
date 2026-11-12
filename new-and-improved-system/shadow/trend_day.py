"""Trend-day continuation, Stage A (shadow/DESIGN_trend_day.md). Underlying only.

    python shadow/trend_day.py build      # 2023-01-03 → 2025-04-30
    python shadow/trend_day.py holdout    # 2025-05-01 → 2026-10-16 (sealed; run once)
Writes shadow/results_trend_day/<period>.json and prints the pre-registered metrics.
"""
import glob
import json
import math
import os
import random
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "gammalab"))
from gammalab.contract.calendar import EARLY_CLOSES  # noqa: E402

M1 = os.path.join(HERE, "..", ".cache", "uw", "m1")
OUT = os.path.join(HERE, "results_trend_day"); os.makedirs(OUT, exist_ok=True)
ET = ZoneInfo("America/New_York")
PERIODS = {"build": ("2023-01-03", "2025-04-30"), "holdout": ("2025-05-01", "2026-10-16")}
THETAS = (0.01, 0.0075, 0.015)
SIGNAL_MINS = {"10:30": 630, "11:30": 690, "12:30": 750}


def emin(t):
    d = datetime.fromtimestamp(t, timezone.utc).astimezone(ET)
    return d.hour * 60 + d.minute


def load_day(sym, d):
    f = os.path.join(M1, sym, f"{d}.json")
    if not os.path.exists(f) or d in EARLY_CLOSES:
        return None
    bars = {}
    for b in json.load(open(f)):
        if b.get("m") != "r":
            continue
        m = emin(b["t"])
        if 570 <= m < 960:
            bars[m] = b
    return bars if len(bars) >= 300 else None


def last_close(bars, m):
    """Close of the last bar that CLOSED by minute m (bar starting at m-1 closes at m)."""
    for k in range(m - 1, 569, -1):
        if k in bars:
            return bars[k]["c"]
    return None


def vwap_to(bars, m):
    pv = v = 0.0
    for k in range(570, m):
        if k in bars:
            pv += bars[k]["c"] * bars[k]["v"]; v += bars[k]["v"]
    return pv / v if v else None


def evaluate(sym, d, bars, sig_min):
    o = bars[min(bars)]["o"] if 570 in bars else None
    if o is None:
        return None
    c_sig, vw, c_end = last_close(bars, sig_min), vwap_to(bars, sig_min), last_close(bars, 960)
    if None in (c_sig, vw, c_end):
        return None
    f = c_sig / o - 1
    hold = (c_sig - vw) * f > 0
    cont = (c_end - c_sig) / c_sig
    return {"sym": sym, "d": d, "f": f, "vwap_hold": hold, "cont_signed": math.copysign(1, f) * cont, "cont_raw": cont}


def mean(x): return sum(x) / len(x) if x else float("nan")


def tstat(x):
    n = len(x)
    if n < 2:
        return float("nan")
    mu = mean(x); sd = math.sqrt(sum((v - mu) ** 2 for v in x) / (n - 1))
    return mu / (sd / math.sqrt(n)) if sd else float("nan")


def binom_p_ge(k, n, p=0.5):
    """One-sided P(X >= k)."""
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def summarize(rows, theta, label):
    trig = [r for r in rows if abs(r["f"]) >= theta and r["vwap_hold"]]
    others = [r for r in rows if not (abs(r["f"]) >= theta and r["vwap_hold"])]
    c = [r["cont_signed"] for r in trig]
    n = len(c); wins = sum(v > 0 for v in c)
    rng = random.Random(7)
    null = []
    for _ in range(1000):
        null.append(mean([v * rng.choice((-1, 1)) for v in c]) if c else float("nan"))
    null.sort()
    res = {
        "label": label, "theta": theta, "n": n, "p_cont": wins / n if n else float("nan"),
        "binom_p": binom_p_ge(wins, n) if n else float("nan"),
        "mean_c": mean(c), "t": tstat(c), "median_c": sorted(c)[n // 2] if n else float("nan"),
        "mean_win": mean([v for v in c if v > 0]), "mean_loss": mean([v for v in c if v <= 0]),
        "share_ge_0p5": sum(v >= 0.005 for v in c) / n if n else float("nan"),
        "null_97p5": null[int(0.975 * len(null))] if n else float("nan"),
        "base_rate_untriggered": mean([1.0 if r["cont_signed"] > 0 else 0.0 for r in others if r["f"] != 0]),
        "by_sym": {s: {"n": sum(1 for r in trig if r["sym"] == s),
                       "p_cont": mean([1.0 if r["cont_signed"] > 0 else 0.0 for r in trig if r["sym"] == s]),
                       "mean_c": mean([r["cont_signed"] for r in trig if r["sym"] == s])} for s in ("SPY", "QQQ")},
        "days": [{"sym": r["sym"], "d": r["d"], "f": round(r["f"], 5), "c": round(r["cont_signed"], 5)} for r in trig],
    }
    return res


def main():
    period = sys.argv[1]
    lo, hi = PERIODS[period]
    rows = {k: [] for k in SIGNAL_MINS}
    days_used = 0
    for sym in ("SPY", "QQQ"):
        for f in sorted(glob.glob(os.path.join(M1, sym, "*.json"))):
            d = os.path.basename(f)[:10]
            if not (lo <= d <= hi):
                continue
            bars = load_day(sym, d)
            if bars is None:
                continue
            days_used += 1
            for k, m in SIGNAL_MINS.items():
                r = evaluate(sym, d, bars, m)
                if r:
                    rows[k].append(r)
    out = {"period": period, "range": [lo, hi], "symbol_days": days_used, "results": []}
    for theta in THETAS:
        for k in SIGNAL_MINS:
            out["results"].append(summarize(rows[k], theta, f"{k} theta={theta:.4f}"))
    json.dump(out, open(os.path.join(OUT, f"{period}.json"), "w"), indent=1)
    print(f"{period} {lo}→{hi}: {days_used} symbol-days\n")
    print(f"{'signal':24s} {'n':>4s} {'P(c>0)':>7s} {'binom p':>8s} {'mean c':>8s} {'t':>6s} {'med':>7s} {'≥0.5%':>6s} {'null97.5':>9s} {'base':>6s}  SPY n/P/mean    QQQ n/P/mean")
    for r in out["results"]:
        s, q = r["by_sym"]["SPY"], r["by_sym"]["QQQ"]
        print(f"{r['label']:24s} {r['n']:4d} {r['p_cont']*100:6.1f}% {r['binom_p']:8.3f} {r['mean_c']*100:+7.2f}% {r['t']:6.2f} "
              f"{r['median_c']*100:+6.2f}% {r['share_ge_0p5']*100:5.0f}% {r['null_97p5']*100:+8.2f}% {r['base_rate_untriggered']*100:5.1f}%  "
              f"{s['n']:3d}/{s['p_cont']*100:4.0f}/{s['mean_c']*100:+.2f}   {q['n']:3d}/{q['p_cont']*100:4.0f}/{q['mean_c']*100:+.2f}")
    primary = next(r for r in out["results"] if r["label"].startswith("10:30") and r["theta"] == 0.01)
    crit = {"P≥58%": primary["p_cont"] >= 0.58, "n≥40": primary["n"] >= 40, "binom p<0.05": primary["binom_p"] < 0.05,
            "mean>0 & t≥2": primary["mean_c"] > 0 and primary["t"] >= 2, "mean>null97.5": primary["mean_c"] > primary["null_97p5"]}
    if period == "holdout":
        crit = {"P≥55%": primary["p_cont"] >= 0.55, "binom p<0.05": primary["binom_p"] < 0.05, "mean>0 & t≥1.65": primary["mean_c"] > 0 and primary["t"] >= 1.65}
    print("\nPrimary (10:30, θ=1%) criteria:", crit, "→", "PASS" if all(crit.values()) else "FAIL")


if __name__ == "__main__":
    main()
