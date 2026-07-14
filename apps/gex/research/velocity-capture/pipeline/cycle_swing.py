#!/usr/bin/env python3
"""SWING-CYCLE (1-min): the operator's COMPOSITE loop. RESEARCH ONLY (Clause 0).

Loop under test: enter at the extreme/node touch -> exit into the peaks (verified ladder)
-> re-enter after the next touch of the defining level -> hard structural stop when the
level breaks (level dies). Two co-equal entry variants, pre-registered & mirror-controlled:

  VARIANT A (extreme-anchored): after 10:00 ET, a new SESSION extreme that breaks the
    opening range + 2 consecutive 1-min closes reclaiming it -> ATM (call at low / put at high).
  VARIANT B (pika-touch): a DOMINANT pika (relSig>=0.15 sustained>=5min) acting as floor
    (calls) / ceiling (puts); price touches the band and reclaims with 2 consecutive closes.

Shared: EXIT = verified scale-out ladder (1/3@+50, 1/3@+100, final third trails gb30, stop60).
  RE-ENTRY at the same defining level (touch+reclaim), max 3 cycles/level, 5-min cooldown.
  STRUCTURAL STOP = spot closes beyond the level by 0.10% for 2 consecutive min -> level dead.
  BUDGET = max 8 entries/side/day, >=50% reserved for post-12:00 (<=4 entries before 12:00).

Compares (same days, all-leg 3% haircut, day-block bootstrap, walk-forward halves):
  (a) THE CYCLE (full composite)  (b) single-shot ladder (no re-entry)  (c) single-shot plain
  trail (prior best)  (d) random-timing matched frequency  (e) live tracked_plays replay.
Variant B carries a MANDATORY phantom-band mirror + P(bounce|touch) vs weak-node baseline,
and a conditioned-vs-unconditioned split. Emits cycle_events.jsonl for the terrain viewer.

Reuses pnl_v0 (UW option fetch/cache, atm_strike, occ_of, price_at). n~12 days -> LEANS.
"""
import gzip, json, os, glob, math, statistics, random, sqlite3
from datetime import datetime, timedelta, timezone
import pnl_v0

SP = os.path.dirname(os.path.abspath(__file__))
BASE = "/Users/saiyeeshrathish/the final plan/apps/gex"
BACKFILL = os.path.join(BASE, "research/velocity-capture/backfill")
OUT_RESULTS = os.path.join(SP, "cycle_swing_results.json")
OUT_JSONL = os.path.join(BASE, "research/velocity-capture/cycle_events.jsonl")
DB = os.path.join(BASE, "data/gexester.db")
TICKERS = ["SPXW", "SPY", "QQQ"]
random.seed(20260714)

# ---------------- PRE-REGISTRATION (frozen before outcomes) ----------------
PRE = {
    "start_et": "10:00", "end_et_entry": "15:30", "noon_et": "12:00",
    "reclaim": 2,                       # consecutive 1-min closes reclaiming the level
    "ladder": {"t1": 0.50, "t2": 1.00, "runner_arm": 0.50, "runner_gb": 0.30, "stop": 0.60},
    "struct_break_frac": 0.0010,        # close beyond the level by 0.10% ...
    "struct_break_min": 2,              # ... for 2 consecutive minutes -> level dead
    "reentry_zone_A": 0.0010,           # re-touch within 0.10% of the extreme = same level
    "level_match_A": 0.0010,            # group A entries into levels by 0.10%
    "band_halfwidth": 0.0005,           # B: pika band = strike +- 0.05% of spot (terrain convention)
    "touch_near_A": 0.0002,             # A: "at the extreme" = within 0.02% of running extreme
    "pika_strong": 0.15,                # B: dominant pika sustained relSig
    "pika_weak_lo": 0.10,               # weak-node baseline band [0.10, 0.15)
    "node_sustain": 5,
    "max_cycles": 3, "cooldown_min": 5,
    "budget_side_day": 8, "reserve_post_noon": 4,   # <=4 entries before 12:00
    "haircut": 0.015,                   # 1.5%/leg ~ 3% round-trip, charged on EVERY leg (conservative)
}
HAIRCUT = PRE["haircut"]

# ---------------- io / time ----------------
def et(ts_iso):
    s = ts_iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def utc_hhmm(ts_iso):
    return ts_iso[11:16]

def et_to_utc(et_str):
    h, m = map(int, et_str.split(":"))
    return f"{(h + 4) % 24:02d}:{m:02d}"

def load(path):
    frames = []
    with gzip.open(path, "rt") as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    frames.sort(key=lambda d: d["requestedTs"])
    return frames

def complete_series():
    out = []
    for d in sorted(glob.glob(os.path.join(BACKFILL, "20*"))):
        date = os.path.basename(d)
        for t in TICKERS:
            gz = os.path.join(d, f"{t}.jsonl.gz")
            if not os.path.exists(gz):
                continue
            with gzip.open(gz, "rt") as f:
                n = sum(1 for _ in f)
            if n >= 385:
                out.append((date, t))
    return out

# ---------------- nodes (dominant pika) + King ----------------
def king_series(frames):
    ks = []
    for fr in frames:
        strikes = fr["strikes"]
        tot = sum(abs(s["gamma"]) for s in strikes)
        if tot == 0:
            ks.append(None); continue
        kg = max(strikes, key=lambda s: abs(s["gamma"]))
        g = kg["gamma"]
        ks.append({"strike": kg["strike"], "sign": "pika" if g > 0 else "barney",
                   "share": abs(g) / tot})
    return ks

def _first_sustained(flags, sus):
    """Index of the sus-th consecutive True in flags, else None."""
    run = 0
    for i, f in enumerate(flags):
        if f:
            run += 1
            if run >= sus:
                return i
        else:
            run = 0
    return None

def classify_pikas(frames):
    """Per-strike pika classification (peak-based, faithful to the operator's OR-conditions).
    A pika (gamma>0) strike is:
      DOMINANT if it sustains (>=5min) relSig>=0.15  OR  is the surface King (max|gamma|) while
                pika for >=5min  (the operator's 'relSig>=0.15 OR the King itself when pika').
      WEAK     if it merely arms (relSig>=0.10 sustained) but never reaches dominance.
    Returns (dominant, weak) lists of {strike, arm_i (dominance/arm start), strength(peak relSig)}.
    """
    n = len(frames)
    strikes = set()
    tot = [0.0] * n
    king_strike = [None] * n
    for i, fr in enumerate(frames):
        s = 0.0; kg = None
        for st in fr["strikes"]:
            s += abs(st["gamma"])
            if kg is None or abs(st["gamma"]) > abs(kg["gamma"]):
                kg = st
        tot[i] = s
        king_strike[i] = kg["strike"] if kg else None
        for st in fr["strikes"]:
            strikes.add(st["strike"])
    gser = {k: [0.0] * n for k in strikes}
    for i, fr in enumerate(frames):
        for st in fr["strikes"]:
            gser[st["strike"]][i] = st["gamma"]
    sus = PRE["node_sustain"]
    dominant = []; weak = []
    for k in strikes:
        gl = gser[k]
        rs = [(abs(gl[i]) / tot[i]) if tot[i] > 0 else 0.0 for i in range(n)]
        pika = [gl[i] > 0 for i in range(n)]
        # node arms at first sustained relSig>=0.10 while pika
        arm = _first_sustained([rs[i] >= PRE["pika_weak_lo"] and pika[i] for i in range(n)], sus)
        if arm is None:
            continue
        peak_rel = max(rs)
        # dominance windows
        i_strong = _first_sustained([rs[i] >= PRE["pika_strong"] and pika[i] for i in range(n)], sus)
        i_king = _first_sustained([king_strike[i] == k and pika[i] for i in range(n)], sus)
        dom_arm = None
        for x in (i_strong, i_king):
            if x is not None:
                dom_arm = x if dom_arm is None else min(dom_arm, x)
        if dom_arm is not None:
            dominant.append({"strike": k, "arm_i": dom_arm, "strength": peak_rel,
                             "via": ("relsig" if i_strong is not None else "king")})
        else:
            weak.append({"strike": k, "arm_i": arm, "strength": peak_rel})
    return dominant, weak

# ---------------- P&L primitives ----------------
def net_of(entry, exit_mark):
    return (exit_mark * (1 - HAIRCUT)) / (entry * (1 + HAIRCUT)) - 1

def sim_exit(m, ets_after, spots_by_et, entry_et, entry_price, side, level, mode):
    """Manage one ATM position to exit. mode:
        'ladder_struct'  = verified thirds ladder + operator structural stop (the composite exit)
        'ladder'         = thirds ladder, no structural stop
        'trail'          = plain live trail arm.50/gb.15/stop.60 (prior best), no struct
        'trail_struct'   = plain live trail + structural stop
    Returns {net, exit_et, outcome, peak_g, rung1, rung2, struct}."""
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry_price <= 0:
        return None
    L = PRE["ladder"]
    frac = 1.0; realized = 0.0
    peak_g = -1e9; armed = False
    rung1 = rung2 = struct = False
    sbf, sbn = PRE["struct_break_frac"], PRE["struct_break_min"]
    sc = 0  # consecutive structural-break minutes
    use_struct = mode in ("ladder_struct", "trail_struct")
    use_ladder = mode in ("ladder_struct", "ladder")
    arm_lv = L["runner_arm"] if use_ladder else 0.50
    gb_lv = L["runner_gb"] if use_ladder else 0.15
    exit_et = ks[-1]; outcome = "eod"
    for k in ks:
        c = m[k]["close"]; g = (c - entry_price) / entry_price
        sp = spots_by_et.get(k)
        if g > peak_g:
            peak_g = g
        # 1) operator structural stop (hard rule) -- checked first
        if use_struct and sp is not None and level:
            beyond = (side == "call" and sp <= level * (1 - sbf)) or \
                     (side == "put" and sp >= level * (1 + sbf))
            sc = sc + 1 if beyond else 0
            if sc >= sbn and frac > 0:
                realized += frac * net_of(entry_price, c); frac = 0.0
                struct = True; outcome = "struct_exit"; exit_et = k; break
        # 2) ladder rungs (limit fills at target)
        if use_ladder:
            if not rung1 and g >= L["t1"] and frac > 0:
                realized += (1/3) * net_of(entry_price, entry_price * (1 + L["t1"]))
                frac -= 1/3; rung1 = True
            if not rung2 and g >= L["t2"] and frac > 0:
                realized += (1/3) * net_of(entry_price, entry_price * (1 + L["t2"]))
                frac -= 1/3; rung2 = True
        # 3) runner trail on remaining fraction
        if not armed and peak_g >= arm_lv:
            armed = True
        if frac > 0 and armed and (1 + g) <= (1 + peak_g) * (1 - gb_lv):
            realized += frac * net_of(entry_price, c); frac = 0.0
            outcome = "trail"; exit_et = k; break
        if frac > 0 and g <= -L["stop"]:
            realized += frac * net_of(entry_price, c); frac = 0.0
            outcome = "trail"; exit_et = k; break
    if frac > 0:  # EOD on remaining
        realized += frac * net_of(entry_price, m[ks[-1]]["close"]); exit_et = ks[-1]
    # label precedence: struct > r2 > r1 > trail > eod
    if struct:
        outcome = "struct_exit"
    elif rung2:
        outcome = "ladder_r2"
    elif rung1:
        outcome = "ladder_r1"
    elif outcome != "trail":
        outcome = "eod"
    return {"net": realized, "exit_et": exit_et, "outcome": outcome,
            "peak_g": peak_g, "rung1": rung1, "rung2": rung2, "struct": struct}

# ---------------- entry detection: touch+reclaim episodes ----------------
def episodes_A(spots, ets, side, start_i, OR_lo, OR_hi):
    """VARIANT A: session-extreme touch+reclaim episodes. Yields dicts with the confirm
    index, the level (extreme value) and the entry index (next minute)."""
    n = len(spots); out = []
    if side == "call":
        runext = min(spots[:start_i + 1])
    else:
        runext = max(spots[:start_i + 1])
    pending = False; touch_level = runext; reclaim = 0
    for i in range(start_i, n):
        s = spots[i]
        if side == "call":
            if s < runext:
                runext = s
            near = s <= runext * (1 + PRE["touch_near_A"])
        else:
            if s > runext:
                runext = s
            near = s >= runext * (1 - PRE["touch_near_A"])
        if near:
            pending = True; touch_level = runext; reclaim = 0
        elif pending:
            beyond = (s > touch_level) if side == "call" else (s < touch_level)
            reclaim = reclaim + 1 if beyond else 0
            if reclaim >= PRE["reclaim"]:
                gate = (touch_level < OR_lo) if side == "call" else (touch_level > OR_hi)
                if gate and i + 1 < n:
                    out.append({"confirm_i": i, "entry_i": i + 1, "level": touch_level})
                pending = False; reclaim = 0
    return out

def episodes_B(spots, ets, side, start_i, node, band_hw):
    """VARIANT B: dominant-pika band touch+reclaim. node={strike,arm_i}. Calls: pika is a
    floor -> price in band then 2 closes ABOVE band. Puts: ceiling -> 2 closes BELOW band."""
    n = len(spots); out = []
    K = node["strike"]; arm = node["arm_i"]
    pending = False; reclaim = 0; approached = False
    for i in range(max(start_i, arm), n):
        s = spots[i]
        hw = band_hw * s
        lo, hi = K - hw, K + hw
        in_band = lo <= s <= hi
        if side == "call":
            above = s > hi; below = s < lo
            if above:
                approached = True  # price sits above the floor
            if in_band and approached:
                pending = True; reclaim = 0
            elif pending:
                reclaim = reclaim + 1 if above else 0
                if below:
                    pending = False; reclaim = 0  # fell through before reclaiming
                if reclaim >= PRE["reclaim"] and i + 1 < n:
                    out.append({"confirm_i": i, "entry_i": i + 1, "level": K})
                    pending = False; reclaim = 0
        else:
            below = s < lo; above = s > hi
            if below:
                approached = True  # price sits below the ceiling
            if in_band and approached:
                pending = True; reclaim = 0
            elif pending:
                reclaim = reclaim + 1 if below else 0
                if above:
                    pending = False; reclaim = 0
                if reclaim >= PRE["reclaim"] and i + 1 < n:
                    out.append({"confirm_i": i, "entry_i": i + 1, "level": K})
                    pending = False; reclaim = 0
    return out

# ---------------- the cycle state machine ----------------
def run_side(date, tkr, S, side, variant, max_cycles, mode, conditioned=False,
             node=None, phantom=False):
    """Walk episodes for one (day,ticker,side,variant), applying level-grouping, budget,
    cooldown, cycle caps, dead levels. Returns list of legs (each = one managed position)."""
    spots, ets, uts = S["spots"], S["ets"], S["uts"]
    n = len(spots)
    start_i = next((i for i, e in enumerate(ets) if e >= PRE["start_et"]), n)
    if start_i >= n:
        return []
    OR_lo = min(spots[j] for j in range(start_i)) if start_i else spots[0]
    OR_hi = max(spots[j] for j in range(start_i)) if start_i else spots[0]
    run_mean = []  # VWAP proxy (running mean of spot) for conditioned-B
    acc = 0.0
    for i in range(n):
        acc += spots[i]; run_mean.append(acc / (i + 1))
    spots_by_et = {ets[i]: spots[i] for i in range(n)}

    if variant == "A":
        eps = episodes_A(spots, ets, side, start_i, OR_lo, OR_hi)
        level_match = PRE["level_match_A"]
    else:
        eps = episodes_B(spots, ets, side, start_i, node, PRE["band_halfwidth"])
        level_match = PRE["reentry_zone_A"]  # 0.10% band grouping for B too

    legs = []
    levels = []  # {level, cycles, dead}
    entries_total = 0; entries_pre_noon = 0
    last_exit_i = -10**9
    for ep in eps:
        ei = ep["entry_i"]; lvl = ep["level"]; entry_et = ets[ei]
        if entry_et > PRE["end_et_entry"]:
            continue
        if entries_total >= PRE["budget_side_day"]:
            break
        pre_noon = entry_et < PRE["noon_et"]
        if pre_noon and entries_pre_noon >= PRE["reserve_post_noon"]:
            continue  # reserve slots for the afternoon
        if ei - last_exit_i < PRE["cooldown_min"]:
            continue
        # level grouping
        match = None
        for Lv in levels:
            if not Lv["dead"] and abs(Lv["level"] - lvl) / lvl <= level_match:
                match = Lv; break
        if match is None:
            match = {"level": lvl, "cycles": 0, "dead": False}
            levels.append(match)
        if match["dead"] or match["cycles"] >= max_cycles:
            continue
        cycle_no = match["cycles"] + 1
        # conditioned-B: direction must agree with day trend-so-far (VWAP proxy)
        if conditioned and variant == "B":
            trend_up = spots[ei] >= run_mean[ei]
            if (side == "call" and not trend_up) or (side == "put" and trend_up):
                continue
        # fetch ATM contract & price
        cp = "C" if side == "call" else "P"
        spot_e = spots[ei]
        strike = pnl_v0.atm_strike(tkr, spot_e)
        occ = pnl_v0.occ_of(tkr, date, strike, cp)
        m = pnl_v0.fetch(occ, date)
        entry_price = pnl_v0.price_at(m, entry_et, "close") if m else None
        if not entry_price or entry_price <= 0:
            continue
        ets_after = [ets[j] for j in range(ei, n)]
        r = sim_exit(m, ets_after, spots_by_et, entry_et, entry_price, side, lvl, mode)
        if not r:
            continue
        exit_i = next((j for j in range(ei, n) if ets[j] == r["exit_et"]), n - 1)
        legs.append({"day": date, "ticker": tkr, "side": side, "variant": variant,
                     "entry_i": ei, "entry_et": entry_et, "entry_utc": uts[ei],
                     "exit_et": r["exit_et"], "exit_utc": et_to_utc(r["exit_et"]),
                     "level": lvl, "cycle_no": cycle_no, "outcome": r["outcome"],
                     "net": r["net"], "peak_g": r["peak_g"],
                     "conditioned": conditioned, "phantom": phantom})
        entries_total += 1
        if pre_noon:
            entries_pre_noon += 1
        match["cycles"] = cycle_no
        if r["struct"]:
            match["dead"] = True
        last_exit_i = exit_i
    return legs

# ---------------- B mirror: phantom band + P(bounce|touch) ----------------
def bounce_stats(spots, start_i, nodes, band_hw, phantom_of=None):
    """P(bounce|touch) for a node set. bounce = enter band, exit SAME side within 5 min
    (dwell<=5), penetrating <=40% (terrain defn). Returns (touches, bounces)."""
    n = len(spots); touches = 0; bounces = 0
    for nd in nodes:
        K = nd["strike"]
        arm = nd["arm_i"]
        if phantom_of is not None:
            K = 2 * spots[arm] - K  # reflect across spot at arm
        i = max(start_i, arm)
        while i < n:
            s = spots[i]; hw = band_hw * s
            if abs(s - K) <= hw:  # entered band
                enter_side = 1 if s >= K else -1  # crude: which side we came from at entry
                # look up to 5 min for resolution
                j = i; resolved = False
                while j < n and j <= i + 5:
                    sj = spots[j]
                    if abs(sj - K) > hw:  # left the band
                        exit_side = 1 if sj > K else -1
                        touches += 1
                        if exit_side == enter_side:
                            bounces += 1
                        resolved = True; i = j
                        break
                    j += 1
                if not resolved:
                    i = i + 6
            else:
                i += 1
    return touches, bounces

# ---------------- live fires (control e) ----------------
def load_fires(days):
    if not os.path.exists(DB):
        return {}, {"call": [], "put": [], "all": []}, {"call": {}, "put": {}, "all": {}}
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT trading_day, ticker, fire_ts_ms, option_type, strike, spot_at_fire, "
        "entry_mark, close_mark, best_pct_gain, close_reason FROM tracked_plays "
        "WHERE trading_day >= '2026-06-26'").fetchall()
    con.close()
    by = {}
    ctrl = {"call": [], "put": [], "all": []}
    byday = {"call": {}, "put": {}, "all": {}}
    for r in rows:
        if r["trading_day"] not in days:
            continue
        realiz = None
        if r["entry_mark"] and r["entry_mark"] > 0 and r["close_mark"] is not None:
            realiz = (r["close_mark"] - r["entry_mark"]) / r["entry_mark"]
        if realiz is None:
            continue
        net = net_of(1.0, 1.0 + realiz)
        sd = "call" if r["option_type"] == "call" else "put"
        ctrl[sd].append(net); ctrl["all"].append(net)
        byday[sd].setdefault(r["trading_day"], []).append(net)
        byday["all"].setdefault(r["trading_day"], []).append(net)
    return by, ctrl, byday

# ---------------- stats ----------------
def summ(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    xs2 = sorted(xs)
    return {"n": len(xs), "mean": statistics.mean(xs), "median": statistics.median(xs),
            "pos": sum(1 for x in xs if x > 0) / len(xs)}

def dayblock_boot(byday_vals, B=3000):
    days = list(byday_vals.keys())
    if len(days) < 2:
        return None
    out = []
    for _ in range(B):
        pool = []
        for _ in days:
            pool += byday_vals[random.choice(days)]
        if pool:
            out.append(statistics.mean(pool))
    out.sort()
    return {"lo": out[int(0.05 * len(out))], "hi": out[int(0.95 * len(out))],
            "med": out[len(out) // 2], "p_pos": sum(1 for x in out if x > 0) / len(out)}

def leg_summary(legs, ndays, label):
    """Per-entry expectancy + per-day total P&L + bootstrap, split all/call/put."""
    res = {}
    for side in ("all", "call", "put"):
        sub = [l for l in legs if side == "all" or l["side"] == side]
        nets = [l["net"] for l in sub]
        byday = {}
        byday_tot = {}
        for l in sub:
            byday.setdefault(l["day"], []).append(l["net"])
        # per-day total = sum of leg nets that day (0 if no legs)
        alldays = set(l["day"] for l in legs)
        for d in alldays:
            byday_tot[d] = [sum(x["net"] for x in sub if x["day"] == d)]
        res[side] = {
            "n_legs": len(sub),
            "expectancy": statistics.mean(nets) if nets else None,
            "median": statistics.median(nets) if nets else None,
            "hit": (sum(1 for x in nets if x > 0) / len(nets)) if nets else None,
            "total_per_day": (sum(nets) / ndays) if nets else 0.0,
            "boot_exp": dayblock_boot(byday),
            "boot_day": dayblock_boot(byday_tot),
        }
    # cycle-count distribution
    from collections import Counter
    cyc = Counter(l["cycle_no"] for l in legs)
    res["cycle_dist"] = dict(sorted(cyc.items()))
    res["label"] = label
    return res

# ---------------- main ----------------
def main():
    series = complete_series()
    days = sorted(set(d for d, _ in series))
    ndays = len(days)
    S = {}
    dompikas = {}
    weakpikas = {}
    for (date, t) in series:
        fr = load(os.path.join(BACKFILL, date, f"{t}.jsonl.gz"))
        spots = [x["spot"] for x in fr]
        ets = [et(x["requestedTs"]) for x in fr]
        uts = [utc_hhmm(x["requestedTs"]) for x in fr]
        dom, weak = classify_pikas(fr)
        S[(date, t)] = {"spots": spots, "ets": ets, "uts": uts,
                        "king": king_series(fr)}
        dompikas[(date, t)] = dom
        weakpikas[(date, t)] = weak

    # ============ build legs for every config ============
    def build(variant, max_cycles, mode, conditioned=False, phantom=False):
        legs = []
        for (date, t) in series:
            Sd = S[(date, t)]
            for side in ("call", "put"):
                if variant == "A":
                    legs += run_side(date, t, Sd, side, "A", max_cycles, mode)
                else:
                    for nd in dompikas[(date, t)]:
                        if phantom:
                            nd2 = dict(nd)
                            nd2["strike"] = 2 * Sd["spots"][nd["arm_i"]] - nd["strike"]
                            legs += run_side(date, t, Sd, side, "B", max_cycles, mode,
                                             conditioned=conditioned, node=nd2, phantom=True)
                        else:
                            legs += run_side(date, t, Sd, side, "B", max_cycles, mode,
                                             conditioned=conditioned, node=nd)
        return legs

    configs = {}
    # VARIANT A
    configs["A_cycle"] = build("A", PRE["max_cycles"], "ladder_struct")
    configs["A_ss_ladder"] = build("A", 1, "ladder_struct")
    configs["A_ss_ladder_nostruct"] = build("A", 1, "ladder")
    configs["A_ss_trail"] = build("A", 1, "trail")
    # VARIANT B (unconditioned + conditioned + phantom mirror)
    configs["B_cycle"] = build("B", PRE["max_cycles"], "ladder_struct")
    configs["B_ss_ladder"] = build("B", 1, "ladder_struct")
    configs["B_ss_trail"] = build("B", 1, "trail")
    configs["B_cycle_cond"] = build("B", PRE["max_cycles"], "ladder_struct", conditioned=True)
    configs["B_cycle_phantom"] = build("B", PRE["max_cycles"], "ladder_struct", phantom=True)

    summaries = {k: leg_summary(v, ndays, k) for k, v in configs.items()}

    # ============ (d) random-timing matched frequency ============
    # Reuse the ATM contracts the A_cycle / B_cycle legs bought; randomize entry minute
    # 10:00-15:30; same ladder+struct machinery w/ running-extreme level. 20 draws.
    def random_control(cycle_legs, tag):
        # gather (date,ticker,side)->contract minute-maps actually used
        nets = []; byday = {}
        # count matched frequency per (day,ticker,side)
        from collections import Counter
        freq = Counter((l["day"], l["ticker"], l["side"]) for l in cycle_legs)
        for (date, t, side), k in freq.items():
            Sd = S[(date, t)]
            spots, ets = Sd["spots"], Sd["ets"]
            spots_by_et = {ets[i]: spots[i] for i in range(len(ets))}
            cp = "C" if side == "call" else "P"
            # candidate ATM contracts across the day (few distinct strikes)
            strikes = sorted(set(pnl_v0.atm_strike(t, spots[i]) for i in range(len(spots))
                                 if PRE["start_et"] <= ets[i] <= PRE["end_et_entry"]))
            ms = []
            for stk in strikes:
                occ = pnl_v0.occ_of(t, date, stk, cp)
                m = pnl_v0.fetch(occ, date)
                if m:
                    ms.append(m)
            if not ms:
                continue
            for _ in range(20):
                for _ in range(k):
                    m = random.choice(ms)
                    valid = [ets[i] for i in range(len(ets))
                             if PRE["start_et"] <= ets[i] <= PRE["end_et_entry"] and ets[i] in m
                             and m[ets[i]]["close"] > 0]
                    if not valid:
                        continue
                    e_et = random.choice(valid)
                    ep = m[e_et]["close"]
                    ei = next(i for i in range(len(ets)) if ets[i] == e_et)
                    lvl = min(spots[:ei + 1]) if side == "call" else max(spots[:ei + 1])
                    r = sim_exit(m, [ets[j] for j in range(ei, len(ets))], spots_by_et,
                                 e_et, ep, side, lvl, "ladder_struct")
                    if r:
                        nets.append(r["net"]); byday.setdefault(date, []).append(r["net"])
        return {"n": len(nets), "expectancy": statistics.mean(nets) if nets else None,
                "median": statistics.median(nets) if nets else None,
                "hit": (sum(1 for x in nets if x > 0) / len(nets)) if nets else None,
                "boot": dayblock_boot(byday), "tag": tag}

    rand_A = random_control(configs["A_cycle"], "random vs A_cycle freq")
    rand_B = random_control(configs["B_cycle"], "random vs B_cycle freq")

    # ============ (e) live tracked_plays ============
    _, live_ctrl, live_byday = load_fires(days)
    live_summary = {}
    for sd in ("call", "put", "all"):
        xs = live_ctrl[sd]
        live_summary[sd] = {"n": len(xs), "expectancy": statistics.mean(xs) if xs else None,
                            "median": statistics.median(xs) if xs else None,
                            "hit": (sum(1 for x in xs if x > 0) / len(xs)) if xs else None,
                            "total_per_day": (sum(xs) / ndays) if xs else None,
                            "boot": dayblock_boot(live_byday[sd])}

    # ============ B mirror physics: P(bounce|touch) ============
    bt_strong = [0, 0]; bt_weak = [0, 0]; bt_phantom = [0, 0]
    for (date, t) in series:
        Sd = S[(date, t)]
        spots = Sd["spots"]
        start_i = next((i for i, e in enumerate(Sd["ets"]) if e >= PRE["start_et"]), len(Sd["ets"]))
        tS, bS = bounce_stats(spots, start_i, dompikas[(date, t)], PRE["band_halfwidth"])
        tW, bW = bounce_stats(spots, start_i, weakpikas[(date, t)], PRE["band_halfwidth"])
        tP, bP = bounce_stats(spots, start_i, dompikas[(date, t)], PRE["band_halfwidth"],
                              phantom_of=True)
        bt_strong[0] += tS; bt_strong[1] += bS
        bt_weak[0] += tW; bt_weak[1] += bW
        bt_phantom[0] += tP; bt_phantom[1] += bP
    bounce_phys = {
        "dominant_pika": {"touches": bt_strong[0], "bounces": bt_strong[1],
                          "rate": bt_strong[1] / bt_strong[0] if bt_strong[0] else None},
        "weak_node": {"touches": bt_weak[0], "bounces": bt_weak[1],
                      "rate": bt_weak[1] / bt_weak[0] if bt_weak[0] else None},
        "phantom_dominant": {"touches": bt_phantom[0], "bounces": bt_phantom[1],
                             "rate": bt_phantom[1] / bt_phantom[0] if bt_phantom[0] else None},
    }

    # ============ walk-forward halves ============
    half = ndays // 2
    train_days = set(days[:half]); test_days = set(days[half:])
    def wf(legs):
        tr = [l["net"] for l in legs if l["day"] in train_days]
        te = [l["net"] for l in legs if l["day"] in test_days]
        return {"train_n": len(tr), "train_exp": statistics.mean(tr) if tr else None,
                "test_n": len(te), "test_exp": statistics.mean(te) if te else None}
    walkfwd = {k: wf(v) for k, v in configs.items()}

    # ============ case studies: 2026-07-14 SPXW + QQQ ============
    def case(date, t):
        out = {}
        for cfg in ("A_cycle", "B_cycle"):
            out[cfg] = [l for l in configs[cfg] if l["day"] == date and l["ticker"] == t]
        Sd = S.get((date, t))
        if Sd:
            spots = Sd["spots"]
            out["session_low"] = round(min(spots), 2)
            out["session_high"] = round(max(spots), 2)
            out["dom_pikas"] = [{"strike": nd["strike"], "peak_relsig": round(nd["strength"], 3),
                                 "via": nd.get("via"), "arm_et": Sd["ets"][nd["arm_i"]]}
                                for nd in dompikas[(date, t)]]
            out["b_cond"] = [l for l in configs["B_cycle_cond"]
                             if l["day"] == date and l["ticker"] == t]
        return out
    cases = {"SPXW": case("2026-07-14", "SPXW"), "QQQ": case("2026-07-14", "QQQ")}

    # ============ cycle_events.jsonl (both variants, real legs) ============
    ev = []
    for cfg in ("A_cycle", "B_cycle"):
        for l in configs[cfg]:
            ev.append({"day": l["day"], "ticker": l["ticker"], "minute": l["entry_utc"],
                       "strike": round(l["level"], 2), "kind": "cycle",
                       "implied": "up" if l["side"] == "call" else "down",
                       "exit_minute": l["exit_utc"], "outcome": l["outcome"],
                       "pnl_pct": round(l["net"] * 100, 1), "cycle_no": l["cycle_no"],
                       "variant": l["variant"]})
    ev.sort(key=lambda r: (r["day"], r["ticker"], r["variant"], r["minute"]))
    with open(OUT_JSONL, "w") as f:
        for r in ev:
            f.write(json.dumps(r) + "\n")

    res = {"prereg": PRE, "days": days, "ndays": ndays, "n_series": len(series),
           "summaries": summaries, "rand_A": rand_A, "rand_B": rand_B,
           "live": live_summary, "bounce_phys": bounce_phys, "walkfwd": walkfwd,
           "cases": cases, "n_events": len(ev)}
    json.dump(res, open(OUT_RESULTS, "w"), indent=1, default=str)
    print_digest(res, configs)
    return res

def pf(x, s=100, p=1):
    return "  n/a" if x is None else f"{x*s:+.{p}f}"

def print_digest(res, configs):
    print("=" * 92)
    print("SWING-CYCLE 1-MIN — DIGEST   days=%d series=%d events=%d"
          % (res["ndays"], res["n_series"], res["n_events"]))
    print("days:", res["days"])
    sm = res["summaries"]
    print("\n--- PER-ENTRY EXPECTANCY & PER-DAY P&L (net, all-leg 3%% haircut) ---")
    print("config                       side  legs  expect  median  hit  $/day  bootExp90CI       p+")
    order = ["A_cycle", "A_ss_ladder", "A_ss_ladder_nostruct", "A_ss_trail",
             "B_cycle", "B_ss_ladder", "B_ss_trail", "B_cycle_cond", "B_cycle_phantom"]
    for k in order:
        for side in ("all", "call", "put"):
            c = sm[k][side]; b = c["boot_exp"] or {}
            print(f"{k:28s} {side:4s} {c['n_legs']:4d}  {pf(c['expectancy'])}%  "
                  f"{pf(c['median'])}%  {(c['hit']*100 if c['hit'] is not None else 0):3.0f}% "
                  f"{pf(c['total_per_day'])}%  "
                  f"[{pf(b.get('lo'))}%,{pf(b.get('hi'))}%] {(b.get('p_pos',0)*100):3.0f}%")
        print(f"    cycle_dist: {sm[k]['cycle_dist']}")
    print("\n--- (d) RANDOM-TIMING matched frequency (all side, ladder+struct) ---")
    for rc in (res["rand_A"], res["rand_B"]):
        b = rc["boot"] or {}
        print(f"  {rc['tag']:24s} n={rc['n']} expect={pf(rc['expectancy'])}% "
              f"med={pf(rc['median'])}% boot=[{pf(b.get('lo'))}%,{pf(b.get('hi'))}%]")
    print("\n--- (e) LIVE tracked_plays (overlap days) ---")
    for sd in ("all", "call", "put"):
        c = res["live"][sd]
        print(f"  {sd:4s}: n={c['n']} expect={pf(c['expectancy'])}% med={pf(c['median'])}%")
    print("\n--- VARIANT B mirror physics: P(bounce|touch) ---")
    bp = res["bounce_phys"]
    for k in ("dominant_pika", "weak_node", "phantom_dominant"):
        d = bp[k]
        print(f"  {k:18s} touches={d['touches']:4d} bounces={d['bounces']:4d} "
              f"rate={(d['rate']*100 if d['rate'] is not None else 0):.0f}%")
    print("\n--- WALK-FORWARD halves (per-entry expectancy) ---")
    for k in order:
        w = res["walkfwd"][k]
        print(f"  {k:28s} train n={w['train_n']:3d} exp={pf(w['train_exp'])}%  "
              f"test n={w['test_n']:3d} exp={pf(w['test_exp'])}%")
    print("\n--- CASE STUDIES 2026-07-14 ---")
    for t in ("SPXW", "QQQ"):
        c = res["cases"][t]
        print(f"  {t}: session_low={c.get('session_low')} high={c.get('session_high')} "
              f"dom_pikas={[(p['strike'],p['peak_relsig'],p['via']) for p in c.get('dom_pikas',[])]}")
        for cfg in ("A_cycle", "B_cycle", "b_cond"):
            for l in c.get(cfg, []):
                tag = "Bcond" if cfg == "b_cond" else l['variant']
                print(f"    [{tag}] {l['side']:4s} entry {l['entry_utc']} "
                      f"lvl={round(l['level'],2)} cyc{l['cycle_no']} -> {l['exit_utc']} "
                      f"{l['outcome']:11s} {l['net']*100:+.0f}%")
    print("=" * 92)

if __name__ == "__main__":
    main()
