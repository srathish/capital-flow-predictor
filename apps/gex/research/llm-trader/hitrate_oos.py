#!/usr/bin/env python3
"""SUPPORTIVE-KING GATE (G1) — OUT-OF-SAMPLE TEST. RESEARCH ONLY (Clause 0). Paper.

Frozen config from HITRATE_70_2026-07-14.md / hitrate_sweep.py, run UNCHANGED on all
backfill days EXCEPT 2026-07-14 (the tuning day), all 3 tickers.

ENTRY = swing-ghost directional signal (V-reclaim LONG / rally-reject SHORT) that PASSES
        G1 supportive-king (real dealer node, growing on 5m AND 15m, within 0.15% on the
        supportive side).
EXIT  = next structural node target + 0.05%/1-min structural-break stop + EOD flat.
P&L   = real UW option-contract intraday, ATM at entry, 3% round-trip haircut.

Controls: dedup (effective independence), mirror (same events, opposite bet), random
(same contract, random entry minute), walk-forward, day-block bootstrap, regime split,
baseline (no G1). NOTHING is tuned here.
"""
import gzip, json, os, subprocess, statistics, random
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BF = os.path.join(HERE, "..", "velocity-capture", "backfill")
CACHE = os.path.join(HERE, "..", "velocity-capture", "pipeline", "prices_v0")
os.makedirs(CACHE, exist_ok=True)
TICKERS = ["SPXW", "SPY", "QQQ"]
INC = {"SPXW": 5, "SPY": 1, "QQQ": 1}
HAIRCUT = 0.015
random.seed(20260715)

# ==== FROZEN signal params (verbatim from hitrate_sweep.py) ====
R = 0.0025
CONFIRM = 2
COOL = 5
STOP_PCT = 0.0005
STOP_MIN = 1
# ==== FROZEN gate thresholds ====
G1_PROX = 0.0015
REAL_GROW = 0.15
NODE_MIN_SHARE = 5.0

DAYS = sorted([d for d in os.listdir(BF)
               if os.path.isdir(os.path.join(BF, d)) and d != "2026-07-14"])

# ---------- frozen helpers ----------
def et_of_m(m):
    tot = m + 570
    return f"{tot//60:02d}:{tot%60:02d}"

def et_from_ts(ts):
    s = ts.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def load_day(tk, day):
    f = os.path.join(BF, day, f"{tk}.jsonl.gz")
    raw = gzip.open(f).read().decode().strip()
    if not raw:
        return []   # empty backfill file (e.g. 2026-05-21 SPY/QQQ) -> no data for this ticker-day
    rows = [json.loads(l) for l in raw.split("\n") if l.strip()]
    frames = []
    for r in rows:
        hh, mm = r["requestedTs"][11:16].split(":")
        m = (int(hh) * 60 + int(mm)) - 810
        if m < 0 or m > 390:
            continue
        strikes = [(float(s["strike"]), float(s.get("gamma") or 0.0)) for s in r["strikes"]]
        tot = sum(abs(g) for _, g in strikes) or 1.0
        share = {k: abs(g) / tot * 100 for k, g in strikes}
        gmap = {k: g for k, g in strikes}
        frames.append({"m": m, "spot": float(r["spot"]), "share": share, "gmap": gmap,
                       "et": et_from_ts(r["requestedTs"])})
    frames.sort(key=lambda x: x["m"])
    return frames

def occ_of(tk, strike, cp, day):
    yymmdd = day[2:].replace("-", "")
    return f"{tk}{yymmdd}{cp}{int(strike*1000):08d}"

_KEY = None
FETCH_STATS = {"live": 0, "cache": 0, "empty": 0, "err": 0}
def get_key():
    with open("/Users/saiyeeshrathish/the final plan/.env") as f:
        for line in f:
            if line.startswith("UNUSUAL_WHALES_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")

def fetch_opt(occ, day):
    cp = os.path.join(CACHE, f"{occ}_{day}.json")
    if os.path.exists(cp):
        FETCH_STATS["cache"] += 1
        return json.load(open(cp))
    global _KEY
    if _KEY is None:
        _KEY = get_key()
    url = f"https://api.unusualwhales.com/api/option-contract/{occ}/intraday?date={day}"
    out = subprocess.run(["curl", "-s", url, "-H", f"Authorization: Bearer {_KEY}",
                          "-H", "User-Agent: bellwether-research/1.0"],
                         capture_output=True, text=True).stdout
    try:
        j = json.loads(out)
        rows = j.get("data", [])
    except Exception:
        rows = []
        FETCH_STATS["err"] += 1
    m = {}
    for r in rows:
        e = et_from_ts(r["start_time"])
        try:
            m[e] = {"close": float(r["close"]), "high": float(r["high"]), "low": float(r["low"])}
        except Exception:
            continue
    FETCH_STATS["live"] += 1
    if not m:
        FETCH_STATS["empty"] += 1
    json.dump(m, open(cp, "w"))
    return m

def strong_nodes(fr, sign=None):
    out = []
    for k, sh in fr["share"].items():
        if sh < NODE_MIN_SHARE:
            continue
        g = fr["gmap"][k]
        if sign == "pika" and g <= 0:
            continue
        if sign == "barney" and g >= 0:
            continue
        out.append((k, sh, g))
    return out

def share_delta(frames, i, strike, back):
    j = i - back
    if j < 0:
        return None
    a = frames[i]["share"].get(strike)
    b = frames[j]["share"].get(strike)
    if a is None or b is None:
        return None
    return a - b

def net_gamma_1pct(fr):
    spot = fr["spot"]
    return sum(g for k, g in fr["gmap"].items() if abs(k - spot) / spot <= 0.01)

def gate_G1(frames, i, side):
    """FROZEN. long-> real pika floor within 0.15% below; short-> real growing node within 0.15% above."""
    fr = frames[i]; spot = fr["spot"]
    for k, sh, g in strong_nodes(fr):
        if side == "long":
            if g > 0 and 0 <= (spot - k) / spot <= G1_PROX:
                d5 = share_delta(frames, i, k, 5); d15 = share_delta(frames, i, k, 15)
                if d5 is not None and d15 is not None and d5 >= REAL_GROW and d15 >= REAL_GROW:
                    return True
        else:
            if 0 <= (k - spot) / spot <= G1_PROX:
                d5 = share_delta(frames, i, k, 5); d15 = share_delta(frames, i, k, 15)
                if d5 is not None and d15 is not None and d5 >= REAL_GROW and d15 >= REAL_GROW:
                    return True
    return False

def gen_signals(frames):
    """FROZEN swing-ghost zigzag, one entry per swing per side, 5-min cooldown."""
    closes = [f["spot"] for f in frames]
    n = len(frames)
    dir = 0
    runHigh = closes[0]; runLow = closes[0]
    pivotHigh = None; pivotLow = None
    used_low = None; used_high = None
    lastLong = -99; lastShort = -99
    day_lo = min(closes); day_hi = max(closes)
    sigs = []
    def rising(i):
        for k in range(CONFIRM):
            if not (closes[i-k] > closes[i-k-1]):
                return False
        return True
    def falling(i):
        for k in range(CONFIRM):
            if not (closes[i-k] < closes[i-k-1]):
                return False
        return True
    for i in range(max(2, CONFIRM), n):
        s = closes[i]; m = frames[i]["m"]
        if dir >= 0:
            if s > runHigh: runHigh = s
            if (runHigh - s) / runHigh >= R:
                dir = -1; pivotHigh = runHigh; runLow = s
        if dir <= 0:
            if s < runLow: runLow = s
            if (s - runLow) / runLow >= R:
                dir = 1; pivotLow = runLow; runHigh = s
        if m < 30 or m > 360:
            continue
        if dir == -1 and rising(i) and (m - lastLong >= COOL) and runLow != used_low:
            sigs.append({"i": i, "side": "long", "pivot": runLow})
            used_low = runLow; lastLong = m
        if dir == 1 and falling(i) and (m - lastShort >= COOL) and runHigh != used_high:
            sigs.append({"i": i, "side": "short", "pivot": runHigh})
            used_high = runHigh; lastShort = m
    return sigs, day_lo, day_hi

def net_pnl(entry, exit):
    if entry <= 0:
        return None
    return (exit * (1 - HAIRCUT)) / (entry * (1 + HAIRCUT)) - 1

def simulate(frames, side, i0, pivot, opt):
    """FROZEN exit sim (next-node target only path used). Returns next-node outcome dict."""
    fr0 = frames[i0]; spot0 = fr0["spot"]
    et0 = et_of_m(fr0["m"])
    okeys = sorted(opt.keys())
    ekeys = [k for k in okeys if k >= et0]
    if not ekeys:
        return None
    e_et = et0 if et0 in opt else ekeys[0]
    entry_px = opt[e_et]["close"]
    if entry_px <= 0:
        return None
    nodes = strong_nodes(fr0)
    if side == "long":
        ahead = sorted([k for k, sh, g in nodes if k > spot0])
    else:
        ahead = sorted([k for k, sh, g in nodes if k < spot0], reverse=True)
    node_target = ahead[0] if ahead else None
    stop_run = 0
    pending = None
    last_opt_et = e_et; last_opt_close = entry_px
    for j in range(i0 + 1, len(frames)):
        fr = frames[j]; s = fr["spot"]; m = fr["m"]
        et = et_of_m(m)
        o = opt.get(et)
        if o is not None:
            last_opt_et = et; last_opt_close = o["close"]
        eod = (m >= 375)
        beyond = (s < pivot * (1 - STOP_PCT)) if side == "long" else (s > pivot * (1 + STOP_PCT))
        stop_run = stop_run + 1 if beyond else 0
        stop_hit = stop_run >= STOP_MIN
        if node_target is not None:
            reached = (s >= node_target) if side == "long" else (s <= node_target)
            if reached and o is not None:
                pending = ("target", net_pnl(entry_px, o["close"]), et); break
        if stop_hit and o is not None:
            pending = ("stop", net_pnl(entry_px, o["close"]), et); break
        if eod and o is not None:
            pending = ("eod", net_pnl(entry_px, o["close"]), et); break
    if pending is None:
        pending = ("eod", net_pnl(entry_px, last_opt_close), last_opt_et)
    reason, pnl, xet = pending
    return {"entry_et": e_et, "entry_px": entry_px, "spot0": spot0,
            "node_target": node_target, "reason": reason, "pnl": pnl, "exit_et": xet}

# ---------- driver ----------
def build():
    """Generate all candidates across OOS days. Returns list of candidate dicts."""
    cands = []          # real-direction signals (for G1, baseline)
    regime = {}         # day -> mean net_gamma_1pct on SPXW (regime label)
    frames_cache = {}
    for day in DAYS:
        for tk in TICKERS:
            frames = load_day(tk, day)
            if not frames:
                continue   # empty backfill (2026-05-21 SPY/QQQ)
            frames_cache[(day, tk)] = frames
            if tk == "SPXW":
                trad = [net_gamma_1pct(f) for f in frames if 30 <= f["m"] <= 360]
                regime[day] = statistics.mean(trad) if trad else 0.0
            sigs, day_lo, day_hi = gen_signals(frames)
            for sig in sigs:
                i = sig["i"]; side = sig["side"]; fr = frames[i]
                spot = fr["spot"]
                strike = int(round(spot / INC[tk]) * INC[tk])
                cp = "C" if side == "long" else "P"
                opt = fetch_opt(occ_of(tk, strike, cp, day), day)
                if not opt:
                    continue
                sim = simulate(frames, side, i, sig["pivot"], opt)
                if sim is None:
                    continue
                g1 = gate_G1(frames, i, side)
                cands.append({
                    "day": day, "tk": tk, "side": side, "i": i, "m": fr["m"],
                    "et": et_of_m(fr["m"]), "spot": spot, "strike": strike, "cp": cp,
                    "pivot": sig["pivot"], "G1": g1, "sim": sim,
                    "opt_occ": occ_of(tk, strike, cp, day),
                })
    return cands, regime, frames_cache

def wr_stats(pnls):
    pnls = [p for p in pnls if p is not None]
    n = len(pnls)
    if n == 0:
        return None
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    return {"n": n, "wr": len(wins)/n, "total": sum(pnls), "exp": sum(pnls)/n,
            "avg_win": (sum(wins)/len(wins) if wins else 0.0),
            "avg_loss": (sum(losses)/len(losses) if losses else 0.0),
            "worst": min(pnls), "best": max(pnls)}

def fmt(s):
    if not s: return "N=0"
    return (f"N={s['n']}  WR={s['wr']*100:.0f}%  exp={s['exp']*100:+.1f}%/tr  "
            f"total={s['total']*100:+.0f}%  avgW={s['avg_win']*100:+.0f}%  "
            f"avgL={s['avg_loss']*100:+.0f}%  worst={s['worst']*100:+.0f}%")

def main():
    cands, regime, frames_cache = build()
    g1 = [c for c in cands if c["G1"]]
    base = cands
    print(f"OOS DAYS = {len(DAYS)}  ({DAYS[0]} .. {DAYS[-1]})")
    print(f"fetch: live={FETCH_STATS['live']} cache={FETCH_STATS['cache']} "
          f"empty={FETCH_STATS['empty']} err={FETCH_STATS['err']}")
    print(f"raw signals scored = {len(cands)} | G1-gated = {len(g1)}")

    # ---- 1. HEADLINE (G1, next-node) ----
    s_g1 = wr_stats([c["sim"]["pnl"] for c in g1])
    ndays_g1 = len(set(c["day"] for c in g1))
    print("\n=== 1. HEADLINE  G1 + next-node (pooled, all tickers) ===")
    print(f"  {fmt(s_g1)}  |  N days={ndays_g1}")

    # ---- 8. BASELINE (no gate) ----
    s_base = wr_stats([c["sim"]["pnl"] for c in base])
    print("\n=== 8. BASELINE  no-G1 (same signals) ===")
    print(f"  {fmt(s_base)}")

    # ---- 2. DEDUP (effective independence) ----
    ev = {}
    for c in g1:
        key = (c["day"], c["m"], c["side"])
        ev.setdefault(key, []).append(c["sim"]["pnl"])
    dedup_pnls = [statistics.mean([p for p in v if p is not None]) for v in ev.values()
                  if any(p is not None for p in v)]
    s_dd = wr_stats(dedup_pnls)
    print("\n=== 2. DEDUPED (collapse same-day-same-minute-same-dir across tickers) ===")
    print(f"  {fmt(s_dd)}  |  N events={len(ev)}")

    # ---- 3. MIRROR (same G1-gated events, opposite bet) ----
    mir = []
    for c in g1:
        frames = frames_cache[(c["day"], c["tk"])]
        i = c["i"]; mside = "short" if c["side"] == "long" else "long"
        entry_spot = c["spot"]
        mpivot = 2 * entry_spot - c["pivot"]   # reflect pivot to opposite side (same stop distance)
        mcp = "P" if c["cp"] == "C" else "C"
        opt = fetch_opt(occ_of(c["tk"], c["strike"], mcp, c["day"]), c["day"])
        if not opt:
            continue
        sim = simulate(frames, mside, i, mpivot, opt)
        if sim is None:
            continue
        mir.append(sim["pnl"])
    s_mir = wr_stats(mir)
    print("\n=== 3. MIRROR CONTROL (identical G1 events, direction FLIPPED, opposite ATM option) ===")
    print(f"  {fmt(s_mir)}")

    # ---- 4. RANDOM CONTROL (same contract, K random entry minutes, same exit) ----
    rand = []
    K = 30
    for c in g1:
        frames = frames_cache[(c["day"], c["tk"])]
        opt = fetch_opt(c["opt_occ"], c["day"])
        if not opt:
            continue
        elig = [f for f in frames if 30 <= f["m"] <= 360 and et_of_m(f["m"]) in opt]
        if len(elig) < 5:
            continue
        for _ in range(K):
            f = random.choice(elig)
            sim = simulate(frames, c["side"], frames.index(f), f["spot"], opt)
            if sim and sim["pnl"] is not None:
                rand.append(sim["pnl"])
    s_rand = wr_stats(rand)
    print("\n=== 4. RANDOM CONTROL (G1 contracts, random entry minute, same side+exit, K=30) ===")
    print(f"  {fmt(s_rand)}")

    # ---- 5. WALK-FORWARD (chronological halves) ----
    mid = DAYS[len(DAYS)//2]
    h1_days = set(DAYS[:len(DAYS)//2]); h2_days = set(DAYS[len(DAYS)//2:])
    s_h1 = wr_stats([c["sim"]["pnl"] for c in g1 if c["day"] in h1_days])
    s_h2 = wr_stats([c["sim"]["pnl"] for c in g1 if c["day"] in h2_days])
    print("\n=== 5. WALK-FORWARD (chronological halves) ===")
    print(f"  H1 {DAYS[0]}..{DAYS[len(DAYS)//2-1]}: {fmt(s_h1)}")
    print(f"  H2 {mid}..{DAYS[-1]}: {fmt(s_h2)}")

    # ---- 6. DAY-BLOCK BOOTSTRAP ----
    by_day = {}
    for c in g1:
        by_day.setdefault(c["day"], []).append(c["sim"]["pnl"])
    days_l = [d for d in by_day if by_day[d]]
    B = 5000; means = []
    for _ in range(B):
        draw = [random.choice(days_l) for _ in days_l]
        pooled = []
        for d in draw:
            pooled += [p for p in by_day[d] if p is not None]
        if pooled:
            means.append(statistics.mean(pooled))
    means.sort()
    p_pos = sum(1 for x in means if x > 0) / len(means)
    print("\n=== 6. DAY-BLOCK BOOTSTRAP (resample days, B=5000) ===")
    print(f"  P(mean exp>0)={p_pos*100:.1f}%  90%CI=[{means[int(0.05*len(means))]*100:+.1f}%,"
          f"{means[int(0.95*len(means))]*100:+.1f}%]  med={means[len(means)//2]*100:+.1f}%  "
          f"| indep days={len(days_l)}")

    # ---- 7. REGIME SPLIT ----
    pos_days = {d for d in DAYS if regime.get(d, 0) > 0}
    neg_days = {d for d in DAYS if regime.get(d, 0) <= 0}
    s_pos = wr_stats([c["sim"]["pnl"] for c in g1 if c["day"] in pos_days])
    s_neg = wr_stats([c["sim"]["pnl"] for c in g1 if c["day"] in neg_days])
    print("\n=== 7. REGIME SPLIT (day classified by SPXW mean net near-spot gamma sign) ===")
    print(f"  +gamma (pin/chop) days={len(pos_days)}: {fmt(s_pos)}")
    print(f"  -gamma (trend)    days={len(neg_days)}: {fmt(s_neg)}")

    # ---- write OOS events jsonl ----
    def et_to_utc(hhmm):
        h, m = map(int, hhmm.split(":"))
        return f"{(h+4)%24:02d}:{m:02d}"
    outp = os.path.join(HERE, "hitrate70_events_OOS.jsonl")
    with open(outp, "w") as f:
        for c in sorted(g1, key=lambda x: (x["day"], x["tk"], x["m"])):
            sim = c["sim"]
            f.write(json.dumps({
                "day": c["day"], "ticker": c["tk"], "minute": et_to_utc(c["et"]),
                "strike:spot@entry": f"{c['strike']}:{round(c['spot'],2)}", "kind": "h70",
                "implied": "up" if c["side"] == "long" else "down",
                "exit_minute": et_to_utc(sim["exit_et"]),
                "outcome": "win" if (sim["pnl"] is not None and sim["pnl"] > 0) else "loss",
                "pnl_pct": round(sim["pnl"]*100, 1) if sim["pnl"] is not None else None,
            }) + "\n")
    print(f"\nwrote {len(g1)} OOS events -> {outp}")

    # dump a compact machine summary for the writeup
    summ = {
        "days": len(DAYS), "day_range": [DAYS[0], DAYS[-1]],
        "fetch": FETCH_STATS,
        "headline_g1": s_g1, "ndays_g1": ndays_g1,
        "baseline": s_base, "deduped": s_dd, "dedup_events": len(ev),
        "mirror": s_mir, "random": s_rand,
        "wf_h1": s_h1, "wf_h2": s_h2, "wf_mid": mid,
        "bootstrap": {"p_pos": p_pos, "lo": means[int(0.05*len(means))],
                      "hi": means[int(0.95*len(means))], "med": means[len(means)//2],
                      "indep_days": len(days_l)},
        "regime_pos": s_pos, "regime_neg": s_neg,
        "n_pos_days": len(pos_days), "n_neg_days": len(neg_days),
        "regime_by_day": {d: regime[d] for d in sorted(regime)},
    }
    json.dump(summ, open(os.path.join(HERE, "hitrate_oos_summary.json"), "w"), indent=1)
    print("wrote hitrate_oos_summary.json")

if __name__ == "__main__":
    main()
