#!/usr/bin/env python3
"""EXTREME-PROBE (1-min): asymmetric quick-abort extreme entry. RESEARCH ONLY (Clause 0).

Part A = forensics of the day's true extremes (descriptive; idealized hindsight entry AT the
extreme to measure what the turn PAID, plus terrain-at-the-turn and why the live system missed it).
Part B = PRE-REGISTERED "Extreme-Probe" rule family: fire many cheap probes at range extremes,
abort fast when wrong, let winners run. Grid A in {0.15,0.25} x G in {0.25,0.40}. Controls:
(a) random-timing matched frequency, (b) live tracked_plays on same days, (c) probes w/o abort.
Day-block bootstrap, Bonferroni over 4 cells. Split calls/puts. n~9 days -> LEANS only.

Reuses pnl_v0 for UW option fetch (cached), atm_strike, occ_of, sim_trail (live trail).
Emits extreme_probe_results.json (all numbers) + appends probe_events.jsonl for the viewer.
"""
import gzip, json, os, glob, math, statistics, random, sqlite3
from datetime import datetime, timedelta, timezone
import pnl_v0

SP = os.path.dirname(os.path.abspath(__file__))
BASE = "/Users/saiyeeshrathish/the final plan/apps/gex"
BACKFILL = os.path.join(BASE, "research/velocity-capture/backfill")
OUT_RESULTS = os.path.join(SP, "extreme_probe_results.json")
OUT_JSONL = os.path.join(BASE, "research/velocity-capture/probe_events.jsonl")
DB = os.path.join(BASE, "data/gexester.db")
TICKERS = ["SPXW", "SPY", "QQQ"]
random.seed(20260714)

# ---------------- PRE-REGISTRATION (Part B, frozen before outcomes) ----------------
PREREG = {
    "start_et": "10:00",                 # probes only after 10:00 ET
    "end_et_entry": "15:30",             # no new probe entry after 15:30
    "uptick_confirm": 2,                 # 2 consecutive 1-min closes beyond the session extreme
    "abort_sweep": [0.15, 0.25],         # A: option mark drop that triggers abort
    "trail_arm": 0.50,                   # winner trail arms at +50%
    "trail_giveback": [0.25, 0.40],      # G: giveback of peak once armed
    "cooldown_min": 10,                  # >=10 min between probe entries per side
    "max_probes_side_day": 6,
    "haircut": 0.015,                    # 1.5% each side ~ 3% round trip (matches pnl_v0)
    "grid": "A in {0.15,0.25} x G in {0.25,0.40} = 4 cells; Bonferroni m=4",
    "control_c_trail": "live trail arm 0.50 / gb 0.15 (no abort)",
    "swing_reversal_frac": 0.0025,       # Part A: local extremum needs >=0.25% reversal after
}
HAIRCUT = PREREG["haircut"]

# ---------------- io ----------------
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
    """(date,ticker) with a >=385-frame gz surface."""
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

# ---------------- King + nodes (relSig>=0.10 sustained 5 min) ----------------
def gamma_at(frame, strike):
    for s in frame["strikes"]:
        if s["strike"] == strike:
            return s["gamma"]
    return 0.0

def king_series(frames):
    ks = []
    for fr in frames:
        strikes = fr["strikes"]
        tot = sum(abs(s["gamma"]) for s in strikes)
        if tot == 0:
            ks.append(None); continue
        kg = max(strikes, key=lambda s: abs(s["gamma"]))
        g = kg["gamma"]
        side = "above" if kg["strike"] > fr["spot"] else "below"
        ks.append({"strike": kg["strike"], "sign": "pika" if g > 0 else "barney",
                   "side": side, "share": abs(g) / tot})
    return ks

def find_nodes(frames):
    """First sustained-5min relSig>=0.10 window per strike -> node instance (arm_i..EOD)."""
    n = len(frames)
    strikes = set()
    tot = [0.0] * n
    for i, fr in enumerate(frames):
        s = 0.0
        for st in fr["strikes"]:
            s += abs(st["gamma"])
        tot[i] = s
        for st in fr["strikes"]:
            strikes.add(st["strike"])
    gser = {k: [0.0] * n for k in strikes}
    for i, fr in enumerate(frames):
        for st in fr["strikes"]:
            gser[st["strike"]][i] = st["gamma"]
    nodes = []
    thr, sus = 0.10, 5
    for k in strikes:
        gl = gser[k]
        rs = [(abs(gl[i]) / tot[i]) if tot[i] > 0 else 0.0 for i in range(n)]
        run = 0; armed = False
        for i in range(n):
            if rs[i] >= thr:
                run += 1
                if run >= sus and not armed:
                    win = list(range(i - sus + 1, i + 1))
                    nodes.append({"strike": k, "arm_i": i,
                                  "strength": statistics.mean(rs[j] for j in win),
                                  "sign": "pika" if statistics.mean(gl[j] for j in win) > 0 else "barney",
                                  "gser": gl})
                    armed = True
            else:
                run = 0
    return nodes

def nearest_strong_node(nodes, i, spot):
    """Nearest node ARMED by minute i, by strike distance."""
    cand = [nd for nd in nodes if nd["arm_i"] <= i]
    if not cand:
        return None
    nd = min(cand, key=lambda x: abs(x["strike"] - spot))
    # node velocity over prior 15 min (per-min slope of |gamma|)
    lb = max(0, i - 15)
    ser = [abs(nd["gser"][j]) for j in range(lb, i + 1)]
    vel = (ser[-1] - ser[0]) / max(1, (len(ser) - 1)) if len(ser) >= 2 else 0.0
    return {"strike": nd["strike"], "sign": nd["sign"], "strength": nd["strength"],
            "dist_frac": abs(nd["strike"] - spot) / spot, "node_vel_15": vel,
            "gamma_now": nd["gser"][i]}

# ---------------- option exit simulators ----------------
def net_of(entry, exit_mark):
    return (exit_mark * (1 - HAIRCUT)) / (entry * (1 + HAIRCUT)) - 1

def sim_probe(m, ets_after, spots_by_et, entry_et, entry_price, side, entry_extreme, A, G, arm=0.50):
    """Extreme-Probe exit: each minute after entry check ABORT (structural new-extreme OR mark<=entry*(1-A)),
    else arm at +50% and trail giveback G, else EOD. Returns net + diagnostics."""
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry_price <= 0:
        return None
    peak = entry_price; armed = False
    for k in ks:
        c = m[k]["close"]
        sp = spots_by_et.get(k)
        struct = False
        if sp is not None:
            if side == "call" and sp < entry_extreme:
                struct = True
            elif side == "put" and sp > entry_extreme:
                struct = True
        mark_abort = c <= entry_price * (1 - A)
        if struct or mark_abort:
            reason = "abort_struct" if struct else "abort_sweep"
            return {"net": net_of(entry_price, c), "exit": c, "exit_et": k, "reason": reason,
                    "outcome": "abort", "armed": armed}
        if c > peak:
            peak = c
        if not armed and peak >= entry_price * (1 + arm):
            armed = True
        if armed and c <= peak * (1 - G):
            return {"net": net_of(entry_price, c), "exit": c, "exit_et": k, "reason": "trail",
                    "outcome": "winner", "armed": True}
    last = ks[-1]
    return {"net": net_of(entry_price, m[last]["close"]), "exit": m[last]["close"], "exit_et": last,
            "reason": "EOD", "outcome": "winner" if m[last]["close"] > entry_price else "eod_loss", "armed": armed}

def sim_livetrail(m, ets_after, entry_et, entry_price, arm=0.50, gb=0.15):
    """Control (c): live trail only, no abort."""
    ks = [k for k in ets_after if k >= entry_et and k in m]
    if not ks or entry_price <= 0:
        return None
    peak = entry_price; armed = False
    for k in ks:
        c = m[k]["close"]
        if c > peak:
            peak = c
        if not armed and peak >= entry_price * (1 + arm):
            armed = True
        if armed and c <= peak * (1 - gb):
            return {"net": net_of(entry_price, c), "exit_et": k, "reason": "trail"}
    last = ks[-1]
    return {"net": net_of(entry_price, m[last]["close"]), "exit_et": last, "reason": "EOD"}

# ---------------- probe detection (pre-registered) ----------------
def detect_probes(spots, ets, side):
    """side='call' -> new session low then 2 upticks above it -> enter next minute.
       side='put'  -> new session high then 2 downticks below it -> enter next minute.
    Returns list of {trigger_i (entry minute index), extreme, extreme_i}. Cooldown+cap applied later."""
    n = len(spots)
    start_i = next((i for i, e in enumerate(ets) if e >= PREREG["start_et"]), n)
    probes = []
    if side == "call":
        runext = min(spots[:start_i + 1]) if start_i > 0 else spots[0]
        ext_i = min(range(start_i + 1), key=lambda j: spots[j]) if start_i > 0 else 0
    else:
        runext = max(spots[:start_i + 1]) if start_i > 0 else spots[0]
        ext_i = max(range(start_i + 1), key=lambda j: spots[j]) if start_i > 0 else 0
    # walk forward tracking running extreme; count consecutive closes beyond it
    up = 0
    i = start_i
    while i < n:
        s = spots[i]
        newext = (side == "call" and s < runext) or (side == "put" and s > runext)
        if newext:
            runext = s; ext_i = i; up = 0
        else:
            beyond = (side == "call" and s > runext) or (side == "put" and s < runext)
            if beyond:
                up += 1
            else:
                up = 0
            if up >= PREREG["uptick_confirm"]:
                entry_i = i + 1  # next minute's print
                if entry_i < n and ets[entry_i] <= PREREG["end_et_entry"]:
                    probes.append({"entry_i": entry_i, "extreme": runext, "extreme_i": ext_i,
                                   "confirm_i": i})
                up = 0  # reset; a fresh new-extreme is needed to re-arm
        i += 1
    return probes

def apply_cooldown(probes):
    kept = []
    last = -10 ** 9
    for p in probes:
        if p["entry_i"] - last < PREREG["cooldown_min"]:
            continue
        if len(kept) >= PREREG["max_probes_side_day"]:
            break
        kept.append(p); last = p["entry_i"]
    return kept

# ---------------- Part A: extremes forensics ----------------
def zigzag_extrema(spots, frac):
    """Return list of (i, kind) swing extrema where a >=frac reversal follows. kind in low/high."""
    n = len(spots)
    if n < 3:
        return []
    piv = []
    direction = 0  # +1 up, -1 down
    last_piv_i = 0; last_piv_v = spots[0]
    cur_ext_i = 0; cur_ext_v = spots[0]
    for i in range(1, n):
        v = spots[i]
        if direction >= 0:
            if v > cur_ext_v:
                cur_ext_v = v; cur_ext_i = i
            if v <= cur_ext_v * (1 - frac):
                piv.append((cur_ext_i, "high"))
                direction = -1; last_piv_i = cur_ext_i; last_piv_v = cur_ext_v
                cur_ext_v = v; cur_ext_i = i
        if direction <= 0:
            if v < cur_ext_v:
                cur_ext_v = v; cur_ext_i = i
            if v >= cur_ext_v * (1 + frac):
                piv.append((cur_ext_i, "low"))
                direction = 1; last_piv_i = cur_ext_i; last_piv_v = cur_ext_v
                cur_ext_v = v; cur_ext_i = i
    # dedup consecutive same kind keep the extremer
    out = []
    for p in piv:
        out.append(p)
    return out

def forensic_extreme(ticker, date, spots, ets, uts, i, kind, nodes, kseries):
    """What did the reversal pay + terrain at the turn. Idealized entry AT the extreme minute."""
    n = len(spots)
    spot = spots[i]
    # max favorable move to EOD (signed by reversal direction)
    if kind == "low":
        mfe = max((spots[j] - spot) / spot for j in range(i, n))
        side = "call"; implied = "up"
    else:
        mfe = max((spot - spots[j]) / spot for j in range(i, n))
        side = "put"; implied = "down"
    # ATM option realized under (i) live trail .50/.15 and (ii) loose runner .50/.40
    cp = "C" if side == "call" else "P"
    strike = pnl_v0.atm_strike(ticker, spot)
    occ = pnl_v0.occ_of(ticker, date, strike, cp)
    m = pnl_v0.fetch(occ, date)
    ets_after = [ets[j] for j in range(i, n)]
    entry_et = ets[i]
    live = loose = None
    entry_price = None
    if m:
        entry_price = pnl_v0.price_at(m, entry_et, "close")
        if entry_price and entry_price > 0:
            r1 = sim_livetrail(m, ets_after, entry_et, entry_price, arm=0.50, gb=0.15)
            r2 = sim_livetrail(m, ets_after, entry_et, entry_price, arm=0.50, gb=0.40)
            live = r1["net"] if r1 else None
            loose = r2["net"] if r2 else None
    # terrain
    node = nearest_strong_node(nodes, i, spot)
    king = kseries[i]
    approach_vel = (spots[i] - spots[i - 5]) / spots[i - 5] if i - 5 >= 0 else None
    return {"i": i, "et": ets[i], "kind": kind, "spot": round(spot, 2), "mfe": mfe,
            "atm_strike": strike, "entry_price": entry_price,
            "live_trail_net": live, "loose_runner_net": loose,
            "node": node, "king": king, "approach_vel": approach_vel, "side": side}

# ---------------- live fires ----------------
def load_fires():
    if not os.path.exists(DB):
        return {}
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT trading_day, ticker, fire_ts_ms, option_type, strike, spot_at_fire, "
        "entry_mark, close_mark, best_pct_gain, close_reason FROM tracked_plays "
        "WHERE trading_day >= '2026-07-01'").fetchall()
    con.close()
    out = {}
    for r in rows:
        e = datetime.fromtimestamp(r["fire_ts_ms"] / 1000, tz=timezone.utc) - timedelta(hours=4)
        et_ = e.strftime("%H:%M")
        realiz = None
        if r["entry_mark"] and r["entry_mark"] > 0 and r["close_mark"] is not None:
            realiz = (r["close_mark"] - r["entry_mark"]) / r["entry_mark"]
        out.setdefault((r["trading_day"], r["ticker"]), []).append(
            {"et": et_, "type": r["option_type"], "strike": r["strike"],
             "spot": r["spot_at_fire"], "realiz": realiz, "reason": r["close_reason"]})
    return out

# ---------------- stats ----------------
def summ(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    xs2 = sorted(xs)
    return {"n": len(xs), "mean": statistics.mean(xs), "median": statistics.median(xs),
            "pos": sum(1 for x in xs if x > 0) / len(xs),
            "p10": xs2[int(0.10 * len(xs2))], "p90": xs2[min(len(xs2) - 1, int(0.90 * len(xs2)))]}

def dayblock_boot(byday_vals, B=3000, agg="mean"):
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

# ---------------- main ----------------
def main():
    series = complete_series()
    days = sorted(set(d for d, _ in series))
    fires = load_fires()

    # preload frames/spots/ets/nodes/king per series
    S = {}
    for (date, t) in series:
        fr = load(os.path.join(BACKFILL, date, f"{t}.jsonl.gz"))
        spots = [x["spot"] for x in fr]
        ets = [et(x["requestedTs"]) for x in fr]
        uts = [utc_hhmm(x["requestedTs"]) for x in fr]
        S[(date, t)] = {"fr": fr, "spots": spots, "ets": ets, "uts": uts,
                        "nodes": find_nodes(fr), "king": king_series(fr)}

    # ================= PART A =================
    partA = []
    for (date, t) in series:
        d = S[(date, t)]
        spots, ets, uts = d["spots"], d["ets"], d["uts"]
        lo_i = min(range(len(spots)), key=lambda j: spots[j])
        hi_i = max(range(len(spots)), key=lambda j: spots[j])
        extremes = [(lo_i, "low"), (hi_i, "high")]
        # swings (dedup indices already covered by true hi/lo)
        for (si, kind) in zigzag_extrema(spots, PREREG["swing_reversal_frac"]):
            if si not in (lo_i, hi_i):
                extremes.append((si, kind))
        recs = []
        for (si, kind) in extremes:
            recs.append(forensic_extreme(t, date, spots, ets, uts, si, kind, d["nodes"], d["king"]))
        # control: terrain at non-turn minutes (>10 min from any extreme, after 10:00)
        turn_is = set(si for si, _ in extremes)
        ctrl_app = []; ctrl_nodedist = []; ctrl_kingshare = []
        for i in range(len(spots)):
            if ets[i] < "10:00" or i - 5 < 0:
                continue
            if any(abs(i - si) <= 10 for si in turn_is):
                continue
            av = abs((spots[i] - spots[i - 5]) / spots[i - 5])
            ctrl_app.append(av)
            nn = nearest_strong_node(d["nodes"], i, spots[i])
            if nn:
                ctrl_nodedist.append(nn["dist_frac"])
            if d["king"][i]:
                ctrl_kingshare.append(d["king"][i]["share"])
        partA.append({"date": date, "ticker": t,
                      "true_low": next(r for r in recs if r["i"] == lo_i and r["kind"] == "low"),
                      "true_high": next(r for r in recs if r["i"] == hi_i and r["kind"] == "high"),
                      "extremes": recs,
                      "control": {"approach_speed": summ(ctrl_app),
                                  "node_dist": summ(ctrl_nodedist),
                                  "king_share": summ(ctrl_kingshare)},
                      "fires": fires.get((date, t), [])})

    # terrain-at-turn vs control aggregate (approach speed, node dist, king share)
    turn_app = []; turn_nodedist = []; turn_kingshare = []
    ctrl_app_all = []; ctrl_nd_all = []; ctrl_ks_all = []
    for a in partA:
        for r in a["extremes"]:
            if r["approach_vel"] is not None:
                turn_app.append(abs(r["approach_vel"]))
            if r["node"]:
                turn_nodedist.append(r["node"]["dist_frac"])
            if r["king"]:
                turn_kingshare.append(r["king"]["share"])
        c = a["control"]
        # rebuild pooled control from per-series summaries is lossy; recompute pooled below
    # pooled control recompute
    for (date, t) in series:
        d = S[(date, t)]
        spots, ets = d["spots"], d["ets"]
        lo_i = min(range(len(spots)), key=lambda j: spots[j])
        hi_i = max(range(len(spots)), key=lambda j: spots[j])
        turn_is = {lo_i, hi_i}
        for (si, kind) in zigzag_extrema(spots, PREREG["swing_reversal_frac"]):
            turn_is.add(si)
        for i in range(len(spots)):
            if ets[i] < "10:00" or i - 5 < 0:
                continue
            if any(abs(i - si) <= 10 for si in turn_is):
                continue
            ctrl_app_all.append(abs((spots[i] - spots[i - 5]) / spots[i - 5]))
            nn = nearest_strong_node(d["nodes"], i, spots[i])
            if nn:
                ctrl_nd_all.append(nn["dist_frac"])
            if d["king"][i]:
                ctrl_ks_all.append(d["king"][i]["share"])
    terrain_cmp = {
        "turn_approach_speed": summ(turn_app), "ctrl_approach_speed": summ(ctrl_app_all),
        "turn_node_dist": summ(turn_nodedist), "ctrl_node_dist": summ(ctrl_nd_all),
        "turn_king_share": summ(turn_kingshare), "ctrl_king_share": summ(ctrl_ks_all),
    }

    # ================= PART B =================
    grid = [(A, G) for A in PREREG["abort_sweep"] for G in PREREG["trail_giveback"]]
    cellres = {}
    probe_log = []   # for JSONL
    # detect probes ONCE per (series, side); exits computed per (A,G) cell reusing fetched m
    detected = {}
    for (date, t) in series:
        d = S[(date, t)]
        spots, ets, uts = d["spots"], d["ets"], d["uts"]
        et2i = {ets[i]: i for i in range(len(ets))}
        spots_by_et = {ets[i]: spots[i] for i in range(len(ets))}
        for side in ("call", "put"):
            probs = apply_cooldown(detect_probes(spots, ets, side))
            entries = []
            for p in probs:
                ei = p["entry_i"]
                entry_et = ets[ei]
                cp = "C" if side == "call" else "P"
                spot = spots[ei]
                strike = pnl_v0.atm_strike(t, spot)
                occ = pnl_v0.occ_of(t, date, strike, cp)
                m = pnl_v0.fetch(occ, date)
                entry_price = pnl_v0.price_at(m, entry_et, "close") if m else None
                entries.append({"entry_i": ei, "entry_et": entry_et, "uts": uts[ei],
                                "extreme": p["extreme"], "side": side, "strike": strike,
                                "occ": occ, "m": m, "entry_price": entry_price,
                                "ets_after": [ets[j] for j in range(ei, len(ets))],
                                "spots_by_et": spots_by_et})
            detected[(date, t, side)] = entries

    # per-cell evaluation
    for (A, G) in grid:
        key = f"A{int(A*100)}_G{int(G*100)}"
        cell = {"A": A, "G": G}
        for side in ("call", "put", "all"):
            nets = []; aborts = []; winners = []; byday = {}
            abort_costs = []; winner_gains = []; n_priced = 0; n_total = 0; n_noprice = 0
            struct_aborts = 0; sweep_aborts = 0
            for (date, t) in series:
                for sd in (("call", "put") if side == "all" else (side,)):
                    for e in detected[(date, t, sd)]:
                        n_total += 1
                        if not e["m"] or not e["entry_price"] or e["entry_price"] <= 0:
                            n_noprice += 1; continue
                        r = sim_probe(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                                      e["entry_price"], sd, e["extreme"], A, G)
                        if not r:
                            n_noprice += 1; continue
                        n_priced += 1
                        nets.append(r["net"]); byday.setdefault(date, []).append(r["net"])
                        if r["outcome"] == "abort":
                            aborts.append(r["net"]); abort_costs.append(r["net"])
                            if r["reason"] == "abort_struct":
                                struct_aborts += 1
                            else:
                                sweep_aborts += 1
                        else:
                            winners.append(r["net"]); winner_gains.append(r["net"])
            cell[side] = {
                "n_total": n_total, "n_priced": n_priced, "n_noprice": n_noprice,
                "expectancy": statistics.mean(nets) if nets else None,
                "median": statistics.median(nets) if nets else None,
                "abort_rate": len(aborts) / n_priced if n_priced else None,
                "avg_abort_cost": statistics.mean(abort_costs) if abort_costs else None,
                "median_abort_cost": statistics.median(abort_costs) if abort_costs else None,
                "worst_abort": min(abort_costs) if abort_costs else None,
                "struct_aborts": struct_aborts, "sweep_aborts": sweep_aborts,
                "winner_rate": len(winners) / n_priced if n_priced else None,
                "avg_winner": statistics.mean(winner_gains) if winner_gains else None,
                "median_winner": statistics.median(winner_gains) if winner_gains else None,
                "best_winner": max(winner_gains) if winner_gains else None,
                "total_pnl_per_day": (sum(nets) / len(days)) if nets else None,
                "boot": dayblock_boot(byday),
                "hit": sum(1 for x in nets if x > 0) / len(nets) if nets else None,
            }
        cellres[key] = cell

    # ---- control (a): random-timing matched frequency ----
    # Reuse the SAME ATM contracts the probes bought (already fetched); randomize entry minute
    # within each contract's session (10:00-15:30), matched to probe count. Structural abort uses
    # the running session extreme at the random minute -> identical machinery, only timing differs.
    rand_cells = {}
    for (A, G) in grid:
        key = f"A{int(A*100)}_G{int(G*100)}"
        rc = {}
        for side in ("call", "put", "all"):
            nets = []; byday = {}
            for (date, t) in series:
                d = S[(date, t)]
                spots, ets = d["spots"], d["ets"]
                spots_by_et = {ets[i]: spots[i] for i in range(len(ets))}
                for sd in (("call", "put") if side == "all" else (side,)):
                    contracts = [e for e in detected[(date, t, sd)]
                                 if e["m"] and e["entry_price"] and e["entry_price"] > 0]
                    k = len(contracts)
                    if k == 0:
                        continue
                    for _ in range(20):  # 20 random draws of matched size
                        for _ in range(k):
                            e = random.choice(contracts)
                            m = e["m"]
                            valid = [ei for ei in range(len(ets))
                                     if PREREG["start_et"] <= ets[ei] <= PREREG["end_et_entry"]
                                     and ets[ei] in m]
                            if not valid:
                                continue
                            ei = random.choice(valid)
                            ep = m[ets[ei]]["close"]
                            if ep <= 0:
                                continue
                            ext = min(spots[:ei + 1]) if sd == "call" else max(spots[:ei + 1])
                            r = sim_probe(m, [ets[j] for j in range(ei, len(ets))], spots_by_et,
                                          ets[ei], ep, sd, ext, A, G)
                            if r:
                                nets.append(r["net"]); byday.setdefault(date, []).append(r["net"])
            rc[side] = {"n": len(nets), "expectancy": statistics.mean(nets) if nets else None,
                        "median": statistics.median(nets) if nets else None,
                        "hit": sum(1 for x in nets if x > 0) / len(nets) if nets else None,
                        "boot": dayblock_boot(byday)}
        rand_cells[key] = rc

    # ---- control (c): probes WITHOUT abort (live trail .50/.15) ----
    noabort = {}
    for side in ("call", "put", "all"):
        nets = []; byday = {}
        for (date, t) in series:
            for sd in (("call", "put") if side == "all" else (side,)):
                for e in detected[(date, t, sd)]:
                    if not e["m"] or not e["entry_price"] or e["entry_price"] <= 0:
                        continue
                    r = sim_livetrail(e["m"], e["ets_after"], e["entry_et"], e["entry_price"], 0.50, 0.15)
                    if r:
                        nets.append(r["net"]); byday.setdefault(date, []).append(r["net"])
        noabort[side] = {"n": len(nets), "expectancy": statistics.mean(nets) if nets else None,
                         "median": statistics.median(nets) if nets else None,
                         "hit": sum(1 for x in nets if x > 0) / len(nets) if nets else None,
                         "total_pnl_per_day": (sum(nets) / len(days)) if nets else None,
                         "boot": dayblock_boot(byday)}

    # ---- control (b): live tracked_plays on same days ----
    live_ctrl = {"call": [], "put": [], "all": []}
    live_byday = {"call": {}, "put": {}, "all": {}}
    for (date, t), fl in fires.items():
        if date not in days:
            continue
        for f in fl:
            if f["realiz"] is None:
                continue
            net = net_of(1.0, 1.0 + f["realiz"])  # apply haircut to realized mid-to-mid
            sd = "call" if f["type"] == "call" else "put"
            live_ctrl[sd].append(net); live_ctrl["all"].append(net)
            live_byday[sd].setdefault(date, []).append(net)
            live_byday["all"].setdefault(date, []).append(net)
    live_summary = {}
    for sd in ("call", "put", "all"):
        xs = live_ctrl[sd]
        live_summary[sd] = {"n": len(xs), "expectancy": statistics.mean(xs) if xs else None,
                            "median": statistics.median(xs) if xs else None,
                            "hit": sum(1 for x in xs if x > 0) / len(xs) if xs else None,
                            "total_pnl_per_day": (sum(xs) / len(days)) if xs else None,
                            "boot": dayblock_boot(live_byday[sd])}

    # ---- viewer JSONL: one line per probe with FULL outcome, using the BEST pre-registered cell ----
    # Best cell by expectancy/probe (all-side) = A15/G40 (A=0.15 sweep, G=0.40 giveback). Emitted for
    # EVERY filled probe regardless of the (negative) verdict — the operator wants to see them on the map.
    BEST_A, BEST_G = 0.15, 0.40
    probe_log = []
    for (date, t) in series:
        for side in ("call", "put"):
            for e in detected[(date, t, side)]:
                if not e["m"] or not e["entry_price"] or e["entry_price"] <= 0:
                    continue
                r = sim_probe(e["m"], e["ets_after"], e["spots_by_et"], e["entry_et"],
                              e["entry_price"], side, e["extreme"], BEST_A, BEST_G)
                if not r:
                    continue
                outcome = "abort" if r["reason"].startswith("abort") else ("win" if r["reason"] == "trail" else "eod")
                probe_log.append({
                    "day": date, "ticker": t, "minute": e["uts"],           # entry, UTC HH:MM
                    "strike": round(e["extreme"], 2),                        # session-extreme level probed
                    "kind": "probe", "implied": "up" if side == "call" else "down",
                    "exit_minute": et_to_utc(r["exit_et"]),                  # UTC HH:MM
                    "outcome": outcome, "pnl_pct": round(r["net"] * 100, 1)})  # realized %, after haircut
    probe_log.sort(key=lambda r: (r["day"], r["ticker"], r["minute"], r["implied"]))
    with open(OUT_JSONL, "w") as f:
        for r in probe_log:
            f.write(json.dumps(r) + "\n")

    res = {"prereg": PREREG, "days": days, "n_series": len(series),
           "partA": partA, "terrain_cmp": terrain_cmp,
           "cells": cellres, "rand_cells": rand_cells,
           "noabort": noabort, "live_ctrl": live_summary,
           "n_probes_logged": len(probe_log)}
    json.dump(res, open(OUT_RESULTS, "w"), indent=1, default=str)
    print_digest(res)
    return res

def print_digest(res):
    print("=" * 74)
    print("EXTREME-PROBE 1-MIN — DIGEST   days=%d series=%d probes_logged=%d"
          % (len(res["days"]), res["n_series"], res["n_probes_logged"]))
    print("days:", res["days"])
    print("\n--- PART B: expectancy/probe by cell (net, 3% haircut) ---")
    print("cell        side  n_pr  expect  median  abort%  avgAbort  win%  avgWin  $/day  boot90CI  p+")
    for key, cell in res["cells"].items():
        for side in ("all", "call", "put"):
            c = cell[side]
            b = c["boot"] or {}
            def pf(x, s=1, p=0):
                return "  n/a" if x is None else f"{x*s:+.{p}f}"
            print(f"{key:11s} {side:4s} {c['n_priced']:4d}  "
                  f"{pf(c['expectancy'],100)}%  {pf(c['median'],100)}%  "
                  f"{(c['abort_rate']*100 if c['abort_rate'] is not None else 0):4.0f}%  "
                  f"{pf(c['avg_abort_cost'],100)}%  "
                  f"{(c['winner_rate']*100 if c['winner_rate'] is not None else 0):3.0f}%  "
                  f"{pf(c['avg_winner'],100)}%  {pf(c['total_pnl_per_day'],100)}%  "
                  f"[{pf(b.get('lo'),100)}%,{pf(b.get('hi'),100)}%] "
                  f"{(b.get('p_pos',0)*100):.0f}%")
    print("\n--- CONTROL (a) random-timing matched (all side) ---")
    for key, rc in res["rand_cells"].items():
        c = rc["all"]; b = c["boot"] or {}
        e = c["expectancy"]
        print(f"  {key}: n={c['n']} expect={(e*100 if e is not None else 0):+.0f}% "
              f"hit={(c['hit']*100 if c['hit'] else 0):.0f}% "
              f"boot=[{(b.get('lo',0)*100):+.0f}%,{(b.get('hi',0)*100):+.0f}%]")
    print("\n--- CONTROL (c) probes WITHOUT abort (live trail .50/.15) ---")
    for side in ("all", "call", "put"):
        c = res["noabort"][side]; e = c["expectancy"]
        print(f"  {side}: n={c['n']} expect={(e*100 if e is not None else 0):+.0f}% "
              f"med={(c['median']*100 if c['median'] is not None else 0):+.0f}% "
              f"$/day={(c['total_pnl_per_day']*100 if c['total_pnl_per_day'] is not None else 0):+.0f}%")
    print("\n--- CONTROL (b) live tracked_plays (same days) ---")
    for side in ("all", "call", "put"):
        c = res["live_ctrl"][side]; e = c["expectancy"]
        print(f"  {side}: n={c['n']} expect={(e*100 if e is not None else 0):+.0f}% "
              f"med={(c['median']*100 if c['median'] is not None else 0):+.0f}%")
    print("\n--- PART A: terrain at turn vs control ---")
    tc = res["terrain_cmp"]
    for feat in ("approach_speed", "node_dist", "king_share"):
        tt = tc[f"turn_{feat}"]; cc = tc[f"ctrl_{feat}"]
        if tt and cc:
            print(f"  {feat:15s} turn mean={tt['mean']:.5f} (n={tt['n']})  ctrl mean={cc['mean']:.5f} (n={cc['n']})")
    print("=" * 74)

if __name__ == "__main__":
    main()
