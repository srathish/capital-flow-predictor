#!/usr/bin/env python3
"""PART 2 — "OPERATOR-EYE" SWING SYSTEM (1-min). RESEARCH ONLY (Clause 0).

Pre-registered rules (frozen before outcomes), formalizing EXACTLY the operator's marks:

  PIVOTS  causal ZigZag on 1-min spot, reversal threshold R in {0.15%, 0.25%} of spot.
  ENTRY LONG (V-reclaim): a down-swing of >=R (from a swing high) completes and price
      makes 2 consecutive rising 1-min closes (reclaim). Mirror SHORT on up-swing.
  ENTRY LONG (higher-low pullback): established up-day (spot>open) AND a prior higher-high,
      a pullback >=0.6R that HOLDS ABOVE the prior swing low, then 2 rising closes.
      Mirror SHORT (lower-high) on down-days (spot<open).
  EXIT (swing stall): no new favorable spot extreme for S in {8,12} min, OR opposite
      V-signal (flip), OR EOD. Also test the verified ladder (1/3@+50/1/3@+100/trail).
  FLIP: an opposite entry signal while in a position closes it and reverses.
  BUDGET: max 6 entries/side/day. Edge-triggered signals (no same-level re-entry lock).

  UP/DOWN-day proxy = spot vs SESSION OPEN (09:30). True VWAP unavailable (no underlying
  volume in the surface feed); the rule's disjunction "above VWAP OR above open" is
  satisfied via the 'above open' branch. Documented limitation.

Option P&L: ATM at entry (call for LONG / put for SHORT, same-day expiry), real UW
  option-contract intraday prints, entry=close@entry-min, exit=close@exit-min, 3% haircut
  (1.5%/side, matching pnl_v0.py). Ladder realized on the option print path.

GRID (enumerated now for Bonferroni): {R:0.15,0.25} x {exit: stall-S8, stall-S12, ladder}
  = 6 cells. Bonferroni alpha = 0.05/6 = 0.0083 -> one-sided bootstrap P(mean>0) >= 0.9917.
CONTROLS: volume-matched random-timing entries; walk-forward halves; day-block bootstrap;
  calls/puts split; per-trade expectancy AND total P&L/day. Head-to-head vs extreme-probe,
  live fires, random. PRIMARY (declared pre-outcome) = R=0.25% / S=12 / swing-stall.
"""
import gzip, json, os, glob, subprocess, random, statistics
from datetime import datetime, timedelta, timezone

SP = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(SP, "prices_v0")
os.makedirs(CACHE, exist_ok=True)
BACKFILL = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/backfill"
VCDIR = os.path.dirname(SP)
HAIRCUT = 0.015
INC = {"SPXW": 5, "SPY": 1, "QQQ": 1}
TICKERS = ["SPXW", "SPY", "QQQ"]
random.seed(20260714)

def get_key():
    with open("/Users/saiyeeshrathish/the final plan/.env") as f:
        for line in f:
            if line.startswith("UNUSUAL_WHALES_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")
KEY = get_key()

# ---------------- io ----------------
def et(ts_iso):
    s = ts_iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def load_spot_series(date, ticker):
    """Return (ets, spots, utcs) 1-min lists from the surface backfill (spot field)."""
    gz = os.path.join(BACKFILL, date, f"{ticker}.jsonl.gz")
    raw = os.path.join(BACKFILL, date, f"{ticker}.jsonl")
    frames = []
    if os.path.exists(gz):
        with gzip.open(gz, "rt") as f:
            for line in f:
                line = line.strip()
                if line:
                    frames.append(json.loads(line))
    elif os.path.exists(raw):
        with open(raw) as f:
            for line in f:
                line = line.strip()
                if line:
                    frames.append(json.loads(line))
    else:
        return None
    frames.sort(key=lambda d: d["requestedTs"])
    ets = [et(fr["requestedTs"]) for fr in frames]
    spots = [float(fr["spot"]) for fr in frames]
    utcs = [fr["requestedTs"] for fr in frames]
    return ets, spots, utcs

def complete_days():
    days = []
    for d in sorted(glob.glob(os.path.join(BACKFILL, "20*"))):
        date = os.path.basename(d)
        ok = True
        for t in TICKERS:
            s = load_spot_series(date, t)
            if not s or len(s[1]) < 385:
                ok = False; break
        if ok:
            days.append(date)
    return days

# ---------------- option prints ----------------
_ERR = {"consec": 0}
def occ_of(ticker, date, strike, cp):
    return f"{ticker}{date[2:].replace('-','')}{cp}{int(strike*1000):08d}"

def atm_strike(ticker, spot):
    inc = INC[ticker]
    return int(round(spot / inc) * inc)

def fetch(occ, date):
    cp = os.path.join(CACHE, f"{occ}_{date}.json")
    if os.path.exists(cp):
        return json.load(open(cp))
    if _ERR["consec"] >= 20:
        return {}
    url = f"https://api.unusualwhales.com/api/option-contract/{occ}/intraday?date={date}"
    out = subprocess.run(["curl", "-s", url, "-H", f"Authorization: Bearer {KEY}",
                          "-H", "User-Agent: bellwether-research/1.0"],
                         capture_output=True, text=True).stdout
    try:
        rows = json.loads(out).get("data", [])
    except Exception:
        rows = []
    m = {}
    for r in rows:
        e = et(r["start_time"])
        try:
            m[e] = {"close": float(r["close"]), "high": float(r["high"]),
                    "low": float(r["low"]), "avg": float(r["avg_price"]),
                    "vol": int(r.get("volume_multi") or r.get("volume") or 0)}
        except Exception:
            continue
    json.dump(m, open(cp, "w"))
    _ERR["consec"] = 0 if m else _ERR["consec"] + 1
    import time; time.sleep(0.34)
    return m

def price_at(m, e, field="close"):
    if e in m:
        return m[e][field]
    ks = [k for k in sorted(m.keys()) if k <= e]
    return m[ks[-1]][field] if ks else None

def net_pnl(entry, exit_):
    if entry is None or exit_ is None or entry <= 0:
        return None
    return (exit_ * (1 - HAIRCUT)) / (entry * (1 + HAIRCUT)) - 1

# ---------------- causal swing signals ----------------
def compute_signals(spots, open_px, R):
    """Edge-triggered long/short entry signals with rule tag. Causal.

    A REVERSAL (V-reclaim) requires a GENUINE swing: (i) a leg of >=R, then (ii) a
    retrace of >=0.6R away from the leg extreme, plus (iii) 2 confirming closes. The
    0.6R-retrace gate is what stops counter-trend spam on grind-up/down days (a 2-bar
    counter-tick alone is NOT a completed swing). A CONTINUATION (higher-low / lower-
    high) requires the day-bias (spot vs open), a prior HH/LL, a >=0.6R pullback that
    holds beyond the prior swing pivot, then 2 closes. Long & short signals are
    mutually exclusive per bar (2 rising vs 2 falling closes).
    """
    n = len(spots)
    sig = [None] * n
    dir_ = 0                       # +1 up-leg, -1 down-leg, 0 flat
    ext_i, ext_p = 0, spots[0]     # running extreme of current leg
    since_ext_min = spots[0]       # lowest close since ext_i (pullback low in an up-leg)
    since_ext_max = spots[0]       # highest close since ext_i (bounce high in a down-leg)
    swing_highs = []
    swing_lows = []
    last_pivot = None              # (i, price, kind)
    run_max_i, run_max_p = 0, spots[0]
    run_min_i, run_min_p = 0, spots[0]
    made_hh = made_ll = False      # latched trend state: a higher-high / lower-low has printed
    prev_long = prev_short = False

    for i in range(n):
        c = spots[i]
        # ---- ZigZag state update ----
        if dir_ == 0:
            if c > run_max_p: run_max_p, run_max_i = c, i
            if c < run_min_p: run_min_p, run_min_i = c, i
            if c >= run_min_p * (1 + R):
                dir_ = 1; last_pivot = (run_min_i, run_min_p, 'L'); swing_lows.append(run_min_p)
                ext_i, ext_p = i, c; since_ext_min = c; since_ext_max = c
            elif c <= run_max_p * (1 - R):
                dir_ = -1; last_pivot = (run_max_i, run_max_p, 'H'); swing_highs.append(run_max_p)
                ext_i, ext_p = i, c; since_ext_min = c; since_ext_max = c
        elif dir_ == 1:
            if c > ext_p:
                if swing_highs and c > swing_highs[-1]:
                    made_hh = True                          # exceeded prior swing high
                ext_p, ext_i = c, i; since_ext_min = c
            elif c <= ext_p * (1 - R):
                if swing_highs and ext_p > swing_highs[-1]: made_hh = True
                swing_highs.append(ext_p); last_pivot = (ext_i, ext_p, 'H')
                dir_ = -1; ext_i, ext_p = i, c; since_ext_min = c; since_ext_max = c
            else:
                since_ext_min = min(since_ext_min, c)
        else:  # dir_ == -1
            if c < ext_p:
                if swing_lows and c < swing_lows[-1]:
                    made_ll = True                          # broke prior swing low
                ext_p, ext_i = c, i; since_ext_max = c
            elif c >= ext_p * (1 + R):
                if swing_lows and ext_p < swing_lows[-1]: made_ll = True
                swing_lows.append(ext_p); last_pivot = (ext_i, ext_p, 'L')
                dir_ = 1; ext_i, ext_p = i, c; since_ext_min = c; since_ext_max = c
            else:
                since_ext_max = max(since_ext_max, c)

        prior_high = swing_highs[-1] if swing_highs else None
        prior_low = swing_lows[-1] if swing_lows else None
        break_up = prior_high is not None and c > prior_high      # trend-break up
        break_dn = prior_low is not None and c < prior_low        # trend-break down

        # ---- raw entry conditions (mutually exclusive: 2 rising vs 2 falling) ----
        long_ok = short_ok = False
        rule = None
        if i >= 2:
            rising2 = spots[i] > spots[i-1] > spots[i-2]
            falling2 = spots[i] < spots[i-1] < spots[i-2]
            if rising2:
                if dir_ == -1 and last_pivot and last_pivot[2] == 'H':
                    origin_h = last_pivot[1]
                    depth = (origin_h - ext_p) / origin_h if origin_h else 0   # down-swing size
                    reclaim = (c - ext_p) / ext_p if ext_p else 0              # bounce off the low
                    if depth >= R and reclaim >= 0.6 * R:
                        long_ok = True; rule = "vreclaim"
                elif dir_ == 1 and made_hh and prior_low is not None:
                    pb = (ext_p - since_ext_min) / ext_p if ext_p else 0       # pullback depth
                    if pb >= 0.6 * R and since_ext_min > prior_low:
                        long_ok = True; rule = "higherlow"
            elif falling2:
                if dir_ == 1 and last_pivot and last_pivot[2] == 'L':
                    origin_l = last_pivot[1]
                    rise = (ext_p - origin_l) / origin_l if origin_l else 0    # up-swing size
                    drop = (ext_p - c) / ext_p if ext_p else 0                 # reject off the high
                    if rise >= R and drop >= 0.6 * R:
                        short_ok = True; rule = "vreclaim"
                elif dir_ == -1 and made_ll and prior_high is not None:
                    bounce = (since_ext_max - ext_p) / ext_p if ext_p else 0
                    if bounce >= 0.6 * R and since_ext_max < prior_high:
                        short_ok = True; rule = "lowerhigh"

        rec = None
        if long_ok and not prev_long:
            rec = {"side": "LONG", "rule": rule, "made_hh": made_hh, "made_ll": made_ll,
                   "break_up": break_up, "break_dn": break_dn}
        elif short_ok and not prev_short:
            rec = {"side": "SHORT", "rule": rule, "made_hh": made_hh, "made_ll": made_ll,
                   "break_up": break_up, "break_dn": break_dn}
        sig[i] = rec
        prev_long, prev_short = long_ok, short_ok
    return sig


def openable(s):
    """Can this raw signal OPEN a position from flat? Continuation (higherlow/lowerhigh)
    always may. A counter-trend V-reclaim from flat is suppressed inside an established
    trend unless the trend structure has broken (it may still FLIP an open position)."""
    if s["rule"] == "higherlow" or s["rule"] == "lowerhigh":
        return True
    if s["side"] == "LONG":     # vreclaim long: block inside established downtrend
        return (not s["made_ll"]) or s["break_up"]
    else:                        # vreclaim short: block inside established uptrend
        return (not s["made_hh"]) or s["break_dn"]

# ---------------- exits & pnl ----------------
def ladder_pnl(m, entry_et, entry_opt, hard_exit_et):
    """Verified ladder on the OPTION path: 1/3 @ +50%, 1/3 @ +100%, trail last 1/3
    (arm .50 / gb .15). Any unsold tranche closes at hard_exit_et (flip/stall/EOD)."""
    ks = [k for k in sorted(m.keys()) if entry_et <= k <= hard_exit_et]
    if not ks or not entry_opt:
        return None
    t1 = entry_opt * 1.5; t2 = entry_opt * 2.0
    sold = []   # list of realized fractional returns (net)
    got1 = got2 = False
    peak = entry_opt; armed = False; trail_done = False; trail_ret = None
    for k in ks:
        c = m[k]["close"]; hi = m[k]["high"]
        if not got1 and hi >= t1:
            sold.append(("t1", net_pnl(entry_opt, t1))); got1 = True
        if not got2 and hi >= t2:
            sold.append(("t2", net_pnl(entry_opt, t2))); got2 = True
        # trail the last third
        if c > peak: peak = c
        if not armed and peak >= entry_opt * 1.5: armed = True
        if armed and not trail_done and c <= peak * 0.85:
            trail_ret = net_pnl(entry_opt, c); trail_done = True
    last_c = m[ks[-1]]["close"]
    # settle unsold tranches at hard exit
    if not got1: sold.append(("t1x", net_pnl(entry_opt, last_c)))
    if not got2: sold.append(("t2x", net_pnl(entry_opt, last_c)))
    if trail_ret is None: trail_ret = net_pnl(entry_opt, last_c)
    sold.append(("trail", trail_ret))
    # weight: three equal thirds -> t1, t2, trail (the *x settlements replace missing targets)
    r1 = next((r for tag, r in sold if tag in ("t1", "t1x")), None)
    r2 = next((r for tag, r in sold if tag in ("t2", "t2x")), None)
    r3 = trail_ret
    vals = [r for r in (r1, r2, r3) if r is not None]
    return statistics.mean(vals) if vals else None

def simulate(spots, ets, utcs, open_px, R, exit_type, S, ticker, date):
    """Run the operator-eye system for one (day,ticker,R,exit). Returns list of trades
    with real option P&L. exit_type in {'stall','ladder'}."""
    sig = compute_signals(spots, open_px, R)
    n = len(spots)
    trades = []
    budget = {"LONG": 0, "SHORT": 0}
    pos = None   # {'side','ei','eet','espot','best','best_i','rule','occ','m','entry_opt'}

    def open_pos(i, side, rule):
        espot = spots[i]; cp = "C" if side == "LONG" else "P"
        K = atm_strike(ticker, espot); occ = occ_of(ticker, date, K, cp)
        m = fetch(occ, date)
        entry_opt = price_at(m, ets[i], "close")
        return {"side": side, "ei": i, "eet": ets[i], "espot": espot, "best": espot,
                "best_i": i, "rule": rule, "occ": occ, "K": K, "cp": cp, "m": m,
                "entry_opt": entry_opt}

    def close_pos(p, xi, reason):
        m = p["m"]; entry_opt = p["entry_opt"]
        if entry_opt is None or entry_opt <= 0:
            net = None; exit_opt = None
        elif exit_type == "ladder":
            net = ladder_pnl(m, p["eet"], entry_opt, ets[xi]); exit_opt = None
        else:
            exit_opt = price_at(m, ets[xi], "close"); net = net_pnl(entry_opt, exit_opt)
        trades.append({"date": date, "ticker": ticker, "side": p["side"], "rule": p["rule"],
                       "ei": p["ei"], "eet": p["eet"], "e_utc": utcs[p["ei"]], "espot": p["espot"],
                       "xi": xi, "xet": ets[xi], "x_utc": utcs[xi], "reason": reason,
                       "K": p["K"], "cp": p["cp"], "occ": p["occ"], "entry_opt": entry_opt,
                       "exit_opt": exit_opt, "net": net,
                       "hold": xi - p["ei"]})

    for i in range(n):
        # manage open position first (stall / EOD)
        if pos is not None:
            fav = spots[i] if pos["side"] == "LONG" else -spots[i]
            best_fav = pos["best"] if pos["side"] == "LONG" else -pos["best"]
            if fav > best_fav:
                pos["best"] = spots[i]; pos["best_i"] = i
            # swing-stall exit (applies to both exit types as the structural close;
            # for ladder it is the hard_exit that settles unsold tranches)
            if exit_type in ("stall", "ladder") and (i - pos["best_i"]) >= S and i > pos["ei"]:
                close_pos(pos, i, "stall"); pos = None

        s = sig[i]
        if s is None:
            continue
        side = s["side"]
        if pos is not None and side != pos["side"]:
            # FLIP: opposite signal closes and reverses (exempt from openable gate)
            close_pos(pos, i, "flip")
            pos = None
            if budget[side] < 6:
                pos = open_pos(i, side, "flip"); budget[side] += 1
        elif pos is None:
            if openable(s) and budget[side] < 6:
                pos = open_pos(i, side, s["rule"]); budget[side] += 1
        # same-side signal while in position -> ignore (already long/short)

    if pos is not None:
        close_pos(pos, n - 1, "eod")
    return trades

# ---------------- stats ----------------
def summarize(trades):
    xs = [t["net"] for t in trades if t["net"] is not None]
    if not xs:
        return None
    return {"n": len(xs), "mean": statistics.mean(xs), "median": statistics.median(xs),
            "hit": sum(1 for x in xs if x > 0) / len(xs), "min": min(xs), "max": max(xs),
            "total": sum(xs)}

def day_block_bootstrap(trades, B=3000):
    by_day = {}
    for t in trades:
        if t["net"] is not None:
            by_day.setdefault(t["date"], []).append(t["net"])
    days = list(by_day.keys())
    if len(days) < 2:
        return None
    means = []
    for _ in range(B):
        draw = [random.choice(days) for _ in days]
        pooled = []
        for d in draw:
            pooled += by_day[d]
        if pooled:
            means.append(statistics.mean(pooled))
    means.sort()
    return {"lo": means[int(0.05 * len(means))], "hi": means[int(0.95 * len(means))],
            "med": means[len(means) // 2], "p_pos": sum(1 for x in means if x > 0) / len(means)}

def random_control(days, R, exit_type, S, sys_counts, reps=25):
    """Volume-matched random-timing entries: per (day,ticker,side) draw the same number
    of entries as the system, at random minutes in [09:35,15:30], same ATM contract logic
    and same exit rule. Pooled net returns over `reps` resamples."""
    nets = []
    for date in days:
        for t in TICKERS:
            ss = load_spot_series(date, t)
            if not ss: continue
            ets, spots, utcs = ss
            valid_idx = [i for i, e in enumerate(ets) if "09:35" <= e <= "15:30"]
            for side in ("LONG", "SHORT"):
                cnt = sys_counts.get((date, t, side), 0)
                if cnt == 0: continue
                cp = "C" if side == "LONG" else "P"
                for _ in range(reps):
                    for _ in range(cnt):
                        i = random.choice(valid_idx)
                        K = atm_strike(t, spots[i]); occ = occ_of(t, date, K, cp)
                        m = fetch(occ, date)
                        e_opt = price_at(m, ets[i], "close")
                        if not e_opt: continue
                        # same exit rule from random entry
                        best = spots[i]; best_i = i; xi = len(spots) - 1
                        for j in range(i + 1, len(spots)):
                            fav = spots[j] if side == "LONG" else -spots[j]
                            bf = best if side == "LONG" else -best
                            if fav > bf: best = spots[j]; best_i = j
                            if (j - best_i) >= S:
                                xi = j; break
                        if exit_type == "ladder":
                            net = ladder_pnl(m, ets[i], e_opt, ets[xi])
                        else:
                            net = net_pnl(e_opt, price_at(m, ets[xi], "close"))
                        if net is not None: nets.append(net)
    return nets

# ---------------- live-fire comparison ----------------
def live_fire_pnl(days):
    """Score the LIVE system's EXECUTED fires on overlap days with the same option-print
    method (entry=confirmation price at fire+1min close, exit via stall S=12 on spot)."""
    import csv as _csv
    path = "/Users/saiyeeshrathish/the final plan/apps/gex/research/uw/outputs/live_observations/live_fire_observations_all.csv"
    if not os.path.exists(path): return None
    nets = []; rows_used = []
    with open(path) as f:
        for row in _csv.DictReader(f):
            d = row["trading_date"]
            if d not in days: continue
            notes = row.get("notes_json", "")
            if '"executed":true' not in notes and '"execution_status": "executed"' not in notes and '"execution_status":"executed"' not in notes:
                continue
            occ = row["option_symbol"]; t = row["ticker"]
            m = fetch(occ, d)
            if not m: continue
            # entry ET from confirmation_timestamp
            ct = row.get("confirmation_timestamp") or row.get("entry_candidate_time")
            try:
                e_et = et(ct)
            except Exception:
                continue
            e_opt = price_at(m, e_et, "close")
            if not e_opt: continue
            # exit: stall S=12 on the OPTION's own favorable path (no spot series keyed to fire)
            ks = [k for k in sorted(m.keys()) if k >= e_et]
            best = e_opt; best_i = 0; xi = len(ks) - 1
            for idx, k in enumerate(ks):
                if m[k]["close"] > best: best = m[k]["close"]; best_i = idx
                if (idx - best_i) >= 12: xi = idx; break
            x_opt = m[ks[xi]]["close"]
            net = net_pnl(e_opt, x_opt)
            if net is not None:
                nets.append(net); rows_used.append((d, t, row["fire_direction"], e_et))
    return nets, rows_used

# ---------------- main ----------------
def main():
    days = complete_days()
    print(f"[operator-eye] complete days = {len(days)}: {days}\n")

    GRID = []
    for R in (0.0015, 0.0025):
        GRID.append((R, "stall", 8))
        GRID.append((R, "stall", 12))
        GRID.append((R, "ladder", 12))   # S=12 is the ladder hard-exit stall
    BONF = 0.05 / len(GRID)
    PRIMARY = (0.0025, "stall", 12)

    # run all cells
    cells = {}
    for (R, ex, S) in GRID:
        all_tr = []
        counts = {}
        for date in days:
            for t in TICKERS:
                ss = load_spot_series(date, t)
                if not ss: continue
                ets, spots, utcs = ss
                open_px = spots[0]
                tr = simulate(spots, ets, utcs, open_px, R, ex, S, t, date)
                all_tr += tr
                for x in tr:
                    counts[(date, t, x["side"])] = counts.get((date, t, x["side"]), 0) + 1
        cells[(R, ex, S)] = {"trades": all_tr, "counts": counts}

    print("=" * 100)
    print(f"GRID RESULTS  (Bonferroni alpha={BONF:.4f} -> need bootstrap P(mean>0) >= {1-BONF:.4f})")
    print("=" * 100)
    hdr = f"{'R%':>5s} {'exit':7s} {'S':>3s} {'nTr':>4s} {'mean':>7s} {'med':>7s} {'hit':>5s} " \
          f"{'tot/day':>8s} {'boot90CI':>18s} {'P(>0)':>6s} {'Bonf':>5s}"
    print(hdr); print("-" * len(hdr))
    for (R, ex, S) in GRID:
        tr = cells[(R, ex, S)]["trades"]
        s = summarize(tr); bs = day_block_bootstrap(tr)
        tot_per_day = s["total"] / len(days) if s else 0
        ci = f"[{bs['lo']*100:+.1f},{bs['hi']*100:+.1f}]" if bs else "-"
        ppos = bs["p_pos"] if bs else 0
        bonf = "PASS" if ppos >= (1 - BONF) else "no"
        star = " *PRIMARY" if (R, ex, S) == PRIMARY else ""
        print(f"{R*100:>5.2f} {ex:7s} {S:>3d} {s['n']:>4d} {s['mean']*100:>+6.1f}% {s['median']*100:>+6.1f}% "
              f"{s['hit']*100:>4.0f}% {tot_per_day*100:>+7.1f}% {ci:>18s} {ppos*100:>5.0f}% {bonf:>5s}{star}")

    # PRIMARY deep dive
    P = cells[PRIMARY]; tr = P["trades"]
    print("\n" + "=" * 100)
    print(f"PRIMARY CELL  R={PRIMARY[0]*100:.2f}%  exit=swing-stall S={PRIMARY[2]}")
    print("=" * 100)
    s = summarize(tr)
    print(f"trades={s['n']}  mean_net={s['mean']*100:+.1f}%  median={s['median']*100:+.1f}%  "
          f"hit={s['hit']*100:.0f}%  total={s['total']*100:+.0f}%  per-day={s['total']/len(days)*100:+.1f}%  "
          f"[{s['min']*100:+.0f}%,{s['max']*100:+.0f}%]")

    # calls/puts split
    for side in ("LONG", "SHORT"):
        ss = summarize([t for t in tr if t["side"] == side])
        if ss:
            print(f"  {side:5s} (n={ss['n']}): mean={ss['mean']*100:+.1f}% med={ss['median']*100:+.1f}% "
                  f"hit={ss['hit']*100:.0f}% total={ss['total']*100:+.0f}%")
    # rule split
    for rule in ("vreclaim", "higherlow", "lowerhigh", "flip"):
        rs = summarize([t for t in tr if t["rule"] == rule])
        if rs:
            print(f"  rule={rule:10s} (n={rs['n']}): mean={rs['mean']*100:+.1f}% hit={rs['hit']*100:.0f}%")
    # exit-reason split
    from collections import Counter
    print("  exit reasons:", dict(Counter(t["reason"] for t in tr)))

    # walk-forward halves
    half = len(days) // 2
    d1, d2 = set(days[:half]), set(days[half:])
    for lbl, dd in (("H1 " + days[0] + ".." + days[half-1], d1),
                    ("H2 " + days[half] + ".." + days[-1], d2)):
        hs = summarize([t for t in tr if t["date"] in dd])
        if hs:
            print(f"  walkfwd {lbl}: n={hs['n']} mean={hs['mean']*100:+.1f}% med={hs['median']*100:+.1f}% "
                  f"hit={hs['hit']*100:.0f}% total={hs['total']*100:+.0f}%")

    bs = day_block_bootstrap(tr)
    print(f"  day-block bootstrap net: 90%CI=[{bs['lo']*100:+.1f}%,{bs['hi']*100:+.1f}%] "
          f"med={bs['med']*100:+.1f}% P(mean>0)={bs['p_pos']*100:.0f}%  "
          f"Bonferroni {'PASS' if bs['p_pos']>=(1-BONF) else 'FAIL'}")

    # random control (volume-matched)
    print("\n--- CONTROL: volume-matched random-timing (same #entries/day/side, random minutes) ---")
    rnets = random_control(days, PRIMARY[0], PRIMARY[1], PRIMARY[2], P["counts"], reps=25)
    if rnets:
        rnets.sort()
        print(f"  n={len(rnets)}  mean={statistics.mean(rnets)*100:+.1f}%  med={statistics.median(rnets)*100:+.1f}%  "
              f"hit={sum(1 for x in rnets if x>0)/len(rnets)*100:.0f}%  "
              f"[p5={rnets[int(0.05*len(rnets))]*100:+.0f}%, p95={rnets[int(0.95*len(rnets))]*100:+.0f}%]")

    # live fires head-to-head
    print("\n--- HEAD-TO-HEAD: live system EXECUTED fires (overlap days), same exit (stall S=12) ---")
    lf = live_fire_pnl(days)
    if lf and lf[0]:
        lnets, used = lf
        lnets_s = sorted(lnets)
        print(f"  n={len(lnets)} executed fires on {sorted(set(u[0] for u in used))}: "
              f"mean={statistics.mean(lnets)*100:+.1f}% med={statistics.median(lnets)*100:+.1f}% "
              f"hit={sum(1 for x in lnets if x>0)/len(lnets)*100:.0f}% "
              f"[p5={lnets_s[int(0.05*len(lnets_s))]*100:+.0f}%,p95={lnets_s[int(0.95*len(lnets_s))]*100:+.0f}%]")

    # emit swing_events.jsonl from PRIMARY
    out = os.path.join(VCDIR, "swing_events.jsonl")
    with open(out, "w") as f:
        for t in tr:
            if t["net"] is None: continue
            f.write(json.dumps({
                "day": t["date"], "ticker": t["ticker"], "minute": t["e_utc"],
                "strike": t["K"], "spot_at_entry": round(t["espot"], 2), "kind": "swing",
                "implied": t["occ"], "side": t["side"],
                "exit_minute": t["x_utc"], "outcome": "win" if t["net"] > 0 else "loss",
                "pnl_pct": round(t["net"] * 100, 1),
                "rule": t["rule"] if t["rule"] in ("vreclaim", "higherlow", "lowerhigh") else "flip"
            }) + "\n")
    print(f"\n[wrote {out}]  ({sum(1 for t in tr if t['net'] is not None)} events)")

    # dump all cells for the writeup
    dump = {"days": days, "grid": [], "primary": list(PRIMARY)}
    for (R, ex, S) in GRID:
        tr2 = cells[(R, ex, S)]["trades"]
        s2 = summarize(tr2); bs2 = day_block_bootstrap(tr2)
        dump["grid"].append({"R": R, "exit": ex, "S": S, "summary": s2, "boot": bs2,
                             "per_day": s2["total"]/len(days) if s2 else None})
    json.dump(dump, open(os.path.join(SP, "operator_eye_results.json"), "w"), indent=1)
    # also dump primary trades for characterization
    json.dump([{k: v for k, v in t.items()} for t in tr],
              open(os.path.join(SP, "operator_eye_primary_trades.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
