#!/usr/bin/env python3
"""HITRATE-70 sweep. RESEARCH ONLY (Clause 0). Paper.

Goal: find a selective, structurally-principled config that would have hit >=70%
WIN RATE on 2026-07-14 (pooled SPXW+SPY+QQQ) with positive total P&L on REAL option
prints, and honestly separate principled gates from single-day curve-fit.

ENTRY  = directional swing signal (V-reclaim LONG / rally-reject SHORT, swing-ghost
         zigzag on 1-min closes) that ALSO passes a structural confluence gate combo.
GATES  = G1 supportive king, G2 king-flip (crown migration), G3 clear path (air pocket,
         target>=2x stop), G4 not-fading-velocity, G5 regime (pin->fade extremes).
EXIT   = structural-break stop (close beyond defining level 0.05% for 1 min)
         + profit target grid T in {next-node, +40%, +60%, +80%} + EOD flat (15:45).
P&L    = real UW option-contract intraday prints, ATM at entry, 3% round-trip haircut.

Emits candidates with per-target P&L; the sweep (gate-combo x target) is done in-memory.
"""
import gzip, json, os, subprocess, itertools, statistics
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BF = os.path.join(HERE, "..", "velocity-capture", "backfill")
CACHE = os.path.join(HERE, "..", "velocity-capture", "pipeline", "prices_v0")
os.makedirs(CACHE, exist_ok=True)
DAY = "2026-07-14"
TICKERS = ["SPXW", "SPY", "QQQ"]
INC = {"SPXW": 5, "SPY": 1, "QQQ": 1}
HAIRCUT = 0.015

# ---- signal params (swing-ghost frozen lean) ----
R = 0.0025        # swing reversal threshold 0.25%
CONFIRM = 2       # consecutive closes to confirm a turn
COOL = 5          # minutes between entries per side
STOP_PCT = 0.0005 # structural stop 0.05% beyond defining level
STOP_MIN = 1      # for 1 consecutive minute (validated +4.3% lean)

# ---- gate thresholds ----
G1_PROX = 0.0015    # supportive node within 0.15%
REAL_GROW = 0.15    # pp share growth to count as "growing" on a window
G2_MIGRATE = 0.001  # king must migrate >=0.1% of spot in trade dir over 15m
G3_MULT = 2.0       # target distance >= 2x stop distance
AIR_MAX_SHARE = 3.0 # intervening strikes share < 3% => air pocket
NODE_MIN_SHARE = 5.0# a "strong node" (floor/ceiling/target) share >= 5%
G4_EXPLODE = 3.0    # opposing node 15m share delta >= +3pp => exploding, don't fade
EXTREME_FRAC = 0.33 # pin regime: entry must be in bottom/top third of day range


def et_of_m(m):
    tot = m + 570
    return f"{tot//60:02d}:{tot%60:02d}"

def et_from_ts(ts):
    s = ts.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def load_day(tk):
    f = os.path.join(BF, DAY, f"{tk}.jsonl.gz")
    rows = [json.loads(l) for l in gzip.open(f).read().decode().strip().split("\n")]
    frames = []
    for r in rows:
        hh, mm = r["requestedTs"][11:16].split(":")
        m = (int(hh) * 60 + int(mm)) - 810  # 810 = 13:30 UTC = 09:30 ET
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

# ---- option prices ----
def occ_of(tk, strike, cp):
    yymmdd = DAY[2:].replace("-", "")
    return f"{tk}{yymmdd}{cp}{int(strike*1000):08d}"

def get_key():
    with open("/Users/saiyeeshrathish/the final plan/.env") as f:
        for line in f:
            if line.startswith("UNUSUAL_WHALES_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")
KEY = None

def fetch_opt(occ):
    cp = os.path.join(CACHE, f"{occ}_{DAY}.json")
    if os.path.exists(cp):
        return json.load(open(cp))
    global KEY
    if KEY is None:
        KEY = get_key()
    url = f"https://api.unusualwhales.com/api/option-contract/{occ}/intraday?date={DAY}"
    out = subprocess.run(["curl", "-s", url, "-H", f"Authorization: Bearer {KEY}",
                          "-H", "User-Agent: bellwether-research/1.0"],
                         capture_output=True, text=True).stdout
    try:
        rows = json.loads(out).get("data", [])
    except Exception:
        rows = []
    m = {}
    for r in rows:
        e = et_from_ts(r["start_time"])
        try:
            m[e] = {"close": float(r["close"]), "high": float(r["high"]),
                    "low": float(r["low"])}
        except Exception:
            continue
    json.dump(m, open(cp, "w"))
    return m

# ---- structural helpers ----
def strong_nodes(fr, sign=None):
    """return list of (strike, share, gamma) with share>=NODE_MIN_SHARE, optional gamma sign filter."""
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

def king(fr):
    return max(fr["gmap"].items(), key=lambda kv: abs(kv[1]))[0]

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

# ---- gates ----
def gate_G1(frames, i, side):
    """supportive king: long-> real pika floor within 0.15% below; short-> real node ceiling within 0.15% above."""
    fr = frames[i]; spot = fr["spot"]
    for k, sh, g in strong_nodes(fr):
        if side == "long":
            if g > 0 and 0 <= (spot - k) / spot <= G1_PROX:
                d5 = share_delta(frames, i, k, 5); d15 = share_delta(frames, i, k, 15)
                if d5 is not None and d15 is not None and d5 >= REAL_GROW and d15 >= REAL_GROW:
                    return True
        else:  # short: resistance node above (barney accel or ceiling), growing
            if 0 <= (k - spot) / spot <= G1_PROX:
                d5 = share_delta(frames, i, k, 5); d15 = share_delta(frames, i, k, 15)
                if d5 is not None and d15 is not None and d5 >= REAL_GROW and d15 >= REAL_GROW:
                    return True
    return False

def gate_G2(frames, i, side):
    """king-flip: crown migrated in trade dir >=0.1% of spot over last 15m and king now real (growing)."""
    if i - 15 < 0:
        return False
    fr = frames[i]; spot = fr["spot"]
    k_now = king(fr); k_15 = king(frames[i - 15])
    d5 = share_delta(frames, i, k_now, 5); d15 = share_delta(frames, i, k_now, 15)
    real = (d5 is not None and d15 is not None and d5 >= REAL_GROW and d15 >= REAL_GROW)
    if not real:
        return False
    move = (k_now - k_15) / spot
    if side == "long":
        return move >= G2_MIGRATE  # crown moved up (upside magnet)
    else:
        return move <= -G2_MIGRATE  # crown moved down (downside magnet)

def gate_G3(frames, i, side):
    """clear path: nearest strong node in trade dir is an air-pocket span away, target>=2x stop."""
    fr = frames[i]; spot = fr["spot"]
    stop_dist = spot * STOP_PCT + 1e-9  # stop trigger distance from entry (approx = pivot dist; use level below)
    # use structural stop distance proxy = distance to pivot handled at candidate; here use 0.10% floor
    stop_dist = max(stop_dist, spot * 0.001)
    nodes = strong_nodes(fr)
    if side == "long":
        ahead = sorted([(k, sh) for k, sh, g in nodes if k > spot], key=lambda x: x[0])
    else:
        ahead = sorted([(k, sh) for k, sh, g in nodes if k < spot], key=lambda x: -x[0])
    if not ahead:
        return False
    target = ahead[0][0]
    tdist = abs(target - spot)
    if tdist < G3_MULT * stop_dist:
        return False
    # air pocket: intervening strikes (strictly between spot and target) all share < AIR_MAX_SHARE
    lo, hi = (spot, target) if side == "long" else (target, spot)
    for k, sh in fr["share"].items():
        if lo < k < hi and sh >= AIR_MAX_SHARE:
            return False
    return True

def gate_G4(frames, i, side):
    """not-fading-velocity: PASS unless the opposing node is exploding (15m share delta>=+3pp)."""
    fr = frames[i]; spot = fr["spot"]
    nodes = strong_nodes(fr)
    if side == "long":
        opp = sorted([(k, sh) for k, sh, g in nodes if k > spot], key=lambda x: x[0])  # ceiling above
    else:
        opp = sorted([(k, sh) for k, sh, g in nodes if k < spot], key=lambda x: -x[0])  # floor below
    if not opp:
        return True
    k = opp[0][0]
    d15 = share_delta(frames, i, k, 15)
    if d15 is not None and d15 >= G4_EXPLODE:
        return False  # opposing wall exploding -> don't fade into it
    return True

def gate_G5(frames, i, side, day_lo, day_hi):
    """regime: +gamma pin -> only fades at range extremes; -gamma -> take breaks."""
    fr = frames[i]; spot = fr["spot"]
    net = net_gamma_1pct(fr)
    rng = day_hi - day_lo or 1.0
    pos = (spot - day_lo) / rng  # 0=low,1=high
    if net > 0:  # pin regime: fade extremes only
        if side == "long":
            return pos <= EXTREME_FRAC       # long near day low
        else:
            return pos >= 1 - EXTREME_FRAC   # short near day high
    else:  # -gamma: take breaks (directional continuation ok anywhere)
        return True

GATES = {"G1": gate_G1, "G2": gate_G2, "G3": gate_G3, "G4": gate_G4}
# G5 handled separately (needs day range)

# ---- signal generation (zigzag, one entry per swing per side) ----
def gen_signals(frames):
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
        # V-reclaim LONG: in a down-swing off the high, confirmed rising close
        if dir == -1 and rising(i) and (m - lastLong >= COOL) and runLow != used_low:
            sigs.append({"i": i, "side": "long", "pivot": runLow})
            used_low = runLow; lastLong = m
        # rally-reject SHORT: in an up-swing off the low, confirmed falling close
        if dir == 1 and falling(i) and (m - lastShort >= COOL) and runHigh != used_high:
            sigs.append({"i": i, "side": "short", "pivot": runHigh})
            used_high = runHigh; lastShort = m
    return sigs, day_lo, day_hi

# ---- exit simulation on real option prints ----
def net_pnl(entry, exit):
    if entry <= 0:
        return None
    return (exit * (1 - HAIRCUT)) / (entry * (1 + HAIRCUT)) - 1

def simulate(frames, sig, tk, opt):
    """Return dict of per-target-rule outcomes. Uses underlying closes for stop/next-node,
    option prints for +X% targets. Conservative: within a minute, stop is checked before target."""
    i0 = sig["i"]; side = sig["side"]; pivot = sig["pivot"]
    fr0 = frames[i0]; spot0 = fr0["spot"]
    et0 = et_of_m(fr0["m"])
    # entry option price = close at entry minute (or first print after)
    okeys = sorted(opt.keys())
    ekeys = [k for k in okeys if k >= et0]
    if not ekeys:
        return None
    e_et = et0 if et0 in opt else ekeys[0]
    entry_px = opt[e_et]["close"]
    if entry_px <= 0:
        return None
    # next-node target (structural), from entry frame
    nodes = strong_nodes(fr0)
    if side == "long":
        ahead = sorted([k for k, sh, g in nodes if k > spot0])
    else:
        ahead = sorted([k for k, sh, g in nodes if k < spot0], reverse=True)
    node_target = ahead[0] if ahead else None
    # walk minutes forward
    stop_run = 0
    results = {}
    targets_pct = {"+40%": 0.40, "+60%": 0.60, "+80%": 0.80}
    pending = {"next-node": None, "+40%": None, "+60%": None, "+80%": None}
    last_opt_et = e_et; last_opt_close = entry_px
    for j in range(i0 + 1, len(frames)):
        fr = frames[j]; s = fr["spot"]; m = fr["m"]
        et = et_of_m(m)
        o = opt.get(et)
        if o is not None:
            last_opt_et = et; last_opt_close = o["close"]
        # EOD flat
        eod = (m >= 375)
        # structural stop on underlying close
        beyond = (s < pivot * (1 - STOP_PCT)) if side == "long" else (s > pivot * (1 + STOP_PCT))
        stop_run = stop_run + 1 if beyond else 0
        stop_hit = stop_run >= STOP_MIN
        # resolve each still-pending target this minute
        for name in list(pending.keys()):
            if pending[name] is not None:
                continue
            if name == "next-node":
                if node_target is not None:
                    reached = (s >= node_target) if side == "long" else (s <= node_target)
                    if reached and o is not None:
                        pending[name] = ("target", net_pnl(entry_px, o["close"]), et)
                        continue
                # stop / eod
                if stop_hit and o is not None:
                    pending[name] = ("stop", net_pnl(entry_px, o["close"]), et)
                elif eod and o is not None:
                    pending[name] = ("eod", net_pnl(entry_px, o["close"]), et)
            else:
                tgt_px = entry_px * (1 + targets_pct[name])
                # conservative: stop checked before target within the minute
                if stop_hit and o is not None:
                    pending[name] = ("stop", net_pnl(entry_px, o["close"]), et)
                elif o is not None and o["high"] >= tgt_px:
                    pending[name] = ("target", net_pnl(entry_px, tgt_px), et)
                elif eod and o is not None:
                    pending[name] = ("eod", net_pnl(entry_px, o["close"]), et)
        if all(v is not None for v in pending.values()):
            break
    # any still-pending -> close at last option print
    for name in pending:
        if pending[name] is None:
            pending[name] = ("eod", net_pnl(entry_px, last_opt_close), last_opt_et)
    for name, (reason, pnl, xet) in pending.items():
        results[name] = {"reason": reason, "pnl": pnl, "exit_et": xet}
    return {"entry_et": e_et, "entry_px": entry_px, "spot0": spot0,
            "node_target": node_target, "results": results}


def main():
    all_cands = []
    for tk in TICKERS:
        frames = load_day(tk)
        sigs, day_lo, day_hi = gen_signals(frames)
        for sig in sigs:
            i = sig["i"]; side = sig["side"]; fr = frames[i]
            spot = fr["spot"]
            strike = int(round(spot / INC[tk]) * INC[tk])
            cp = "C" if side == "long" else "P"
            opt = fetch_opt(occ_of(tk, strike, cp))
            if not opt:
                continue
            sim = simulate(frames, sig, tk, opt)
            if sim is None:
                continue
            gflags = {g: fn(frames, i, side) for g, fn in GATES.items()}
            gflags["G5"] = gate_G5(frames, i, side, day_lo, day_hi)
            all_cands.append({
                "tk": tk, "side": side, "i": i, "m": fr["m"], "et": et_of_m(fr["m"]),
                "spot": spot, "strike": strike, "cp": cp, "pivot": sig["pivot"],
                "gates": gflags, "sim": sim,
            })
    json.dump(all_cands, open(os.path.join(HERE, "hitrate_candidates.json"), "w"), indent=1)
    print(f"generated {len(all_cands)} candidates (pooled 3 tickers)")
    # summary of raw candidates
    for c in all_cands:
        g = c["gates"]; gs = "".join(k[-1] if g[k] else "." for k in ["G1","G2","G3","G4","G5"])
        base = c["sim"]["results"]["next-node"]
        print(f"  {c['tk']:4s} {c['side']:5s} {c['et']} K{c['strike']}{c['cp']} gates[{gs}] "
              f"nn={base['pnl']*100:+.0f}%({base['reason']})")

if __name__ == "__main__":
    main()
