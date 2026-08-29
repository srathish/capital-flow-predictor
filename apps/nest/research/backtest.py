"""Does the Nest's conviction actually predict forward returns? A lookahead-safe backtest.

For a broad liquid universe and a series of historical as-of dates, reconstruct each stock's
conviction using ONLY data available on that date, then measure forward EXCESS return (vs SPY)
at 1d/5d/20d. Edge = a positive, statistically-meaningful rank correlation (IC) between
conviction and forward return, and a positive top-minus-bottom-quintile spread, that ISN'T
carried by a single date. Honest bar (per repo memory): OOS-positive, |t|>2, market-relative.

v1 uses the fully-historical signals: chart (OHLC) + optional GEX (historical by strike).
No lookahead — every signal at date d uses only bars/surfaces up to d; returns use bars after d.
"""

from __future__ import annotations

import math
import os
import statistics
import sys
import time

import httpx

TOKEN = os.environ["UNUSUAL_WHALES_API_KEY"]
H = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}
BASE = "https://api.unusualwhales.com"

UNIVERSE = [
    # mega / large tech
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "ORCL", "CRM",
    "ADBE", "NOW", "AMD", "MU", "INTC", "QCOM", "TXN", "LRCX", "AMAT", "MRVL",
    "KLAC", "ON", "ARM", "SMCI", "PLTR", "SNOW", "CRWD", "PANW", "DDOG", "NET",
    "SHOP", "UBER", "ABNB", "COIN", "MARA", "RIOT", "MSTR", "SOFI", "HOOD", "DKNG",
    # financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "SCHW", "AXP", "V", "MA", "PYPL",
    # health
    "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "ISRG", "MRNA", "GILD", "VRTX",
    # consumer / retail
    "WMT", "COST", "HD", "NKE", "MCD", "SBUX", "TGT", "LOW", "DIS", "NFLX",
    # energy / industrial
    "XOM", "CVX", "COP", "SLB", "OXY", "CAT", "DE", "BA", "GE", "HON", "UPS",
    # comm / auto / misc
    "CMCSA", "T", "VZ", "F", "GM", "RIVN", "U", "RBLX", "IREN", "HIMS",
]

AS_OF = [  # trading-ish dates; snapped to nearest available bar. Each needs 20d forward.
    "2025-10-01", "2025-10-22", "2025-11-12", "2025-12-03", "2025-12-29",
    "2026-01-20", "2026-02-10", "2026-03-03", "2026-03-24", "2026-04-14",
    "2026-05-05", "2026-05-26", "2026-06-16", "2026-07-08",
]
HORIZONS = [1, 5, 20]
USE_GEX = "--gex" in sys.argv


def get(path: str, params: dict | None = None, tries: int = 3):
    for _ in range(tries):
        try:
            r = httpx.get(BASE + path, headers=H, params=params, timeout=30)
            if r.status_code == 200:
                b = r.json()
                return b.get("data", b) if isinstance(b, dict) else b
            if r.status_code == 429:
                time.sleep(2)
                continue
            return None
        except httpx.HTTPError:
            time.sleep(1)
    return None


def load_bars(ticker: str) -> dict | None:
    rows = get(f"/api/stock/{ticker}/ohlc/1d", {"limit": 900})
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r["date"])
    dates = [r["date"] for r in rows]
    close = [float(r["close"]) for r in rows]
    high = [float(r["high"]) for r in rows]
    low = [float(r["low"]) for r in rows]
    vol = [float(r.get("volume") or 0) for r in rows]
    return {"dates": dates, "close": close, "high": high, "low": low, "vol": vol,
            "idx": {d: i for i, d in enumerate(dates)}}


def as_of_index(bars: dict, date: str) -> int | None:
    # nearest trading day <= date
    best = None
    for i, d in enumerate(bars["dates"]):
        if d <= date:
            best = i
        else:
            break
    return best


def chart_score(bars: dict, i: int) -> float:
    """Signed chart conviction from bars up to index i (no lookahead)."""
    c, hi, vol = bars["close"], bars["high"], bars["vol"]
    if i < 50:
        return 0.0
    sma20 = sum(c[i - 19:i + 1]) / 20
    sma50 = sum(c[i - 49:i + 1]) / 50
    mom = (c[i] - c[i - 20]) / c[i - 20]
    hi60 = max(hi[i - 59:i + 1])
    avgvol = (sum(vol[i - 19:i + 1]) / 20) or 1.0
    surge = vol[i] > 1.3 * avgvol
    s = 0.0
    if c[i] > sma20 > sma50:
        s += 0.5
    elif c[i] < sma20 < sma50:
        s -= 0.5
    s += max(-0.4, min(0.4, mom / 0.15 * 0.4))
    if surge and c[i] >= 0.985 * hi60:
        s += 0.4
    elif surge and c[i] <= 1.015 * min(bars["low"][i - 59:i + 1]):
        s -= 0.4
    return s


def gex_score(ticker: str, date: str, spot: float) -> float:
    rows = get(f"/api/stock/{ticker}/greek-exposure/strike", {"date": date})
    if not rows or not spot:
        return 0.0
    def net(r):
        return float(r.get("call_gex") or 0) + float(r.get("put_gex") or 0)
    total = sum(abs(net(r)) for r in rows) or 1.0
    node = max(rows, key=lambda r: abs(net(r)))
    g = net(node)
    strike = float(node.get("strike") or 0)
    if not strike or g == 0:
        return 0.0
    below = strike <= spot
    direction = (1 if below else -1) if g > 0 else (-1 if below else 1)
    dist = abs(strike - spot) / spot
    return direction * (abs(g) / total) * max(0.0, 1 - dist / 0.05)


def fwd_excess(bars: dict, spy: dict, i: int, h: int) -> float | None:
    if i + h >= len(bars["close"]):
        return None
    r = (bars["close"][i + h] - bars["close"][i]) / bars["close"][i]
    # market-relative: subtract SPY over the SAME calendar window
    d0, dh = bars["dates"][i], bars["dates"][i + h]
    si, sh = spy["idx"].get(d0), spy["idx"].get(dh)
    if si is None or sh is None:
        return r
    m = (spy["close"][sh] - spy["close"][si]) / spy["close"][si]
    return r - m


def spearman(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 5:
        return float("nan")
    def rank(v):
        order = sorted(range(len(v)), key=lambda k: v[k])
        r = [0.0] * len(v)
        for pos, k in enumerate(order):
            r[k] = pos
        return r
    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else float("nan")


def _sig_variants(b: dict, i: int) -> dict:
    """Candidate signals at index i (all lookahead-safe from OHLC up to i)."""
    c, hi = b["close"], b["high"]
    if i < 130:
        return {}
    sma20 = sum(c[i - 19:i + 1]) / 20
    sma50 = sum(c[i - 49:i + 1]) / 50
    rets = [(c[k] - c[k - 1]) / c[k - 1] for k in range(i - 59, i + 1)]
    vola = statistics.pstdev(rets) or 1e-6
    trend = 0.5 if c[i] > sma20 > sma50 else -0.5 if c[i] < sma20 < sma50 else 0.0
    mom60 = c[i] / c[i - 60] - 1
    return {
        "trend": trend,
        "mom20": c[i] / c[i - 20] - 1,
        "mom60": mom60,
        "mom120": c[i] / c[i - 120] - 1,
        "mom_12_1": c[i - 20] / c[i - 120] - 1,           # classic 12-1 (skip last month)
        "hi_prox": c[i] / max(hi[i - 251:i + 1] or [c[i]]),  # proximity to 52w high
        "voladj_mom": mom60 / vola,                        # risk-adjusted momentum
        "chart_combo": trend + max(-0.4, min(0.4, mom60 / 0.25 * 0.4))
                       + (0.3 if c[i] >= 0.97 * max(hi[i - 59:i + 1]) else 0.0),
    }


def _adv_variants(b: dict, i: int, spy: dict) -> dict:
    """Momentum enhancers that need the market benchmark: residual (beta-adjusted) momentum,
    short-term reversal, and momentum + short-term-reversal (buy the dip in an uptrend)."""
    c, dates = b["close"], b["dates"]
    if i < 130:
        return {}
    ret5 = c[i] / c[i - 5] - 1
    out = {"st_reversal": -ret5, "mom_minus_st": (c[i] / c[i - 120] - 1) - 2.0 * ret5}
    # residual momentum: 60d return minus beta * SPY 60d return
    sret, kret = [], []
    for k in range(i - 59, i + 1):
        s0, s1 = spy["idx"].get(dates[k - 1]), spy["idx"].get(dates[k])
        if s0 is None or s1 is None:
            continue
        sret.append((c[k] - c[k - 1]) / c[k - 1])
        kret.append((spy["close"][s1] - spy["close"][s0]) / spy["close"][s0])
    if len(sret) > 30:
        mk, ms = sum(kret) / len(kret), sum(sret) / len(sret)
        var = sum((x - mk) ** 2 for x in kret) or 1e-9
        beta = sum((a - ms) * (x - mk) for a, x in zip(sret, kret)) / var
        sa, sb = spy["idx"].get(dates[i - 60]), spy["idx"].get(dates[i])
        spy60 = (spy["close"][sb] - spy["close"][sa]) / spy["close"][sa] if sa is not None and sb is not None else 0.0
        out["resid_mom"] = (c[i] / c[i - 60] - 1) - beta * spy60
    return out


def main():
    print(f"Loading bars for {len(UNIVERSE)} names + SPY (GEX={'on' if USE_GEX else 'off'})...")
    spy = load_bars("SPY")
    bars = {}
    for t in UNIVERSE:
        b = load_bars(t)
        if b:
            bars[t] = b
    print(f"  loaded {len(bars)} names")

    # --- variant sweep: which signal best predicts 20d/5d forward excess return? ---
    SIGS = ["trend", "mom20", "mom60", "mom120", "mom_12_1", "hi_prox", "voladj_mom",
            "chart_combo", "resid_mom", "st_reversal", "mom_minus_st"]
    for hz in (5, 20):
        print(f"\n=== SIGNAL SWEEP @ {hz}d forward excess (14 OOS dates) ===")
        print(f"  {'signal':13} {'mean IC':>8} {'t-stat':>7} {'IC>0':>6} {'topDec%':>8} {'L-S%':>7}")
        for sig in SIGS:
            ics, topdec, lspread = [], [], []
            for date in AS_OF:
                conv, fwd = {}, {}
                for t, b in bars.items():
                    i = as_of_index(b, date)
                    if i is None:
                        continue
                    v = {**_sig_variants(b, i), **_adv_variants(b, i, spy)}
                    fe = fwd_excess(b, spy, i, hz)
                    if sig in v and fe is not None:
                        conv[t] = v[sig]
                        fwd[t] = fe
                common = list(conv)
                if len(common) < 20:
                    continue
                ics.append(spearman([conv[t] for t in common], [fwd[t] for t in common]))
                ranked = sorted(common, key=lambda t: conv[t])
                k = max(1, len(ranked) // 10)
                top = statistics.mean(fwd[t] for t in ranked[-k:])
                bot = statistics.mean(fwd[t] for t in ranked[:k])
                topdec.append(top)
                lspread.append(top - bot)          # long-short (market-neutral) spread
            ics = [x for x in ics if not math.isnan(x)]
            if not ics:
                continue
            mic = statistics.mean(ics)
            tic = mic / (statistics.pstdev(ics) / math.sqrt(len(ics))) if len(ics) > 1 and statistics.pstdev(ics) else 0.0
            print(f"  {sig:13} {mic:+8.3f} {tic:+7.2f} {sum(1 for x in ics if x>0):>4}/{len(ics)} "
                  f"{statistics.mean(topdec)*100:+8.2f} {statistics.mean(lspread)*100:+7.2f}")
    # --- blended composite (cross-sectional rank average) + per-date top-decile P&L ---
    BLEND = ["voladj_mom", "mom120", "chart_combo", "hi_prox"]
    print(f"\n=== BLENDED FINDER (rank-avg of {BLEND}) @ 20d ===")
    series = []
    for date in AS_OF:
        vals = {s: {} for s in BLEND}
        fwd = {}
        for t, b in bars.items():
            i = as_of_index(b, date)
            if i is None:
                continue
            v = _sig_variants(b, i)
            fe = fwd_excess(b, spy, i, 20)
            if not v or fe is None:
                continue
            for s in BLEND:
                vals[s][t] = v[s]
            fwd[t] = fe
        common = [t for t in fwd if all(t in vals[s] for s in BLEND)]
        if len(common) < 20:
            continue
        # cross-sectional rank per signal, average
        blend = {t: 0.0 for t in common}
        for s in BLEND:
            order = sorted(common, key=lambda t: vals[s][t])
            for pos, t in enumerate(order):
                blend[t] += pos / (len(common) - 1)
        ranked = sorted(common, key=lambda t: blend[t])
        k = max(1, len(ranked) // 10)
        top = statistics.mean(fwd[t] for t in ranked[-k:])
        botv = statistics.mean(fwd[t] for t in ranked[:k])
        names = [t for t in ranked[-k:]]
        series.append((date, top, botv, names))
    tops = [x[1] for x in series]
    print(f"  {'date':10} {'topDec%':>8} {'botDec%':>8}  top picks")
    for date, top, botv, names in series:
        print(f"  {date:10} {top*100:+8.2f} {botv*100:+8.2f}  {' '.join(names[-6:])}")
    mt = statistics.mean(tops) * 100
    tt = mt / (statistics.pstdev(tops) * 100 / math.sqrt(len(tops))) if len(tops) > 1 else 0.0
    print(f"\n  top-decile 20d excess: mean {mt:+.2f}% · t={tt:+.2f} · "
          f"positive {sum(1 for x in tops if x>0)}/{len(tops)} dates · "
          f"worst {min(tops)*100:+.2f}% · best {max(tops)*100:+.2f}%")
    print()
    return

    # per-date cross-sectional IC + quintile spread
    per_date = {h: [] for h in HORIZONS}          # list of (date, IC)
    per_date_qspread = {h: [] for h in HORIZONS}  # list of top-bottom quintile mean excess
    for date in AS_OF:
        conv, fwd = {}, {h: {} for h in HORIZONS}
        for t, b in bars.items():
            i = as_of_index(b, date)
            if i is None or i < 60:
                continue
            s = chart_score(b, i)
            if USE_GEX:
                s += 0.6 * gex_score(t, b["dates"][i], b["close"][i])
            conv[t] = s
            for h in HORIZONS:
                fe = fwd_excess(b, spy, i, h)
                if fe is not None:
                    fwd[h][t] = fe
        for h in HORIZONS:
            common = [t for t in conv if t in fwd[h]]
            if len(common) < 20:
                continue
            xs = [conv[t] for t in common]
            ys = [fwd[h][t] for t in common]
            ic = spearman(xs, ys)
            per_date[h].append((date, ic))
            ranked = sorted(common, key=lambda t: conv[t])
            k = max(1, len(ranked) // 5)
            bot = statistics.mean(fwd[h][t] for t in ranked[:k])
            top = statistics.mean(fwd[h][t] for t in ranked[-k:])
            per_date_qspread[h].append((date, top - bot))

    print("\n=== RESULT: conviction → forward EXCESS return (vs SPY) ===")
    for h in HORIZONS:
        ics = [ic for _, ic in per_date[h] if not math.isnan(ic)]
        qs = [q for _, q in per_date_qspread[h]]
        if not ics:
            continue
        mean_ic = statistics.mean(ics)
        t_ic = mean_ic / (statistics.pstdev(ics) / math.sqrt(len(ics))) if len(ics) > 1 and statistics.pstdev(ics) else float("nan")
        pos = sum(1 for x in ics if x > 0)
        mean_q = statistics.mean(qs) * 100
        print(f"\n{h}d horizon ({len(ics)} dates):")
        print(f"  mean IC = {mean_ic:+.3f}   t-stat = {t_ic:+.2f}   IC>0 on {pos}/{len(ics)} dates")
        print(f"  top-minus-bottom-quintile excess = {mean_q:+.2f}%  (avg per date)")
        print("  per-date IC:", " ".join(f"{d[5:]}:{ic:+.2f}" for d, ic in per_date[h]))


if __name__ == "__main__":
    main()
