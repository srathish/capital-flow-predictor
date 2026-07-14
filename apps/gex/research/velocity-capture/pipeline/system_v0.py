#!/usr/bin/env python3
"""System-v0 (1-min): price-structure ledger + KingFlip-v0 detector + extreme-gating
+ descriptive forward-drift by range bucket. RESEARCH ONLY (Clause 0).

Frozen rule = KING_FLIP_1MIN_2026-07-14.md §9 "KingFlip-v0", implemented exactly:
  - side dead-band = max(1 strike increment, 0.05% of spot); inside band -> side='at' (no side-flip)
  - category = sign x side ; sign: pika=+gamma, barney=-gamma
  - confirmed flip A->B: B persists >=3 consec frames  AND  dominance margin
        [ king_share(B_confirm) - king_share(A_last) >= 0.01  OR  ratio >= 1.10 ]
  - BULLISH = barney-above -> pika-below ; BEARISH = pika-below -> barney-above
  - velocity precondition (TESTED variant): over 15 min pre-confirm,
        slope(|g_incumbent|)<0 AND slope(|g_successor|)>0, gap monotonically closing

System-v0 gate (pre-registered): take a flip ONLY at the aligned range extreme:
  BULLISH requires pos_in_range <= 0.25 ; BEARISH requires >= 0.75 ; mid-range rejected.
  Range width gate: range_so_far >= 0.30 * median(10-day daily range).
System-v0b (secondary): at a range extreme with a PIKA King within 0.3% of spot (floor/ceiling).
"""
import gzip, json, os, glob, statistics
from datetime import datetime, timedelta, timezone

BASE = "/Users/saiyeeshrathish/the final plan/apps/gex"
BACKFILL = os.path.join(BASE, "research/velocity-capture/backfill")
TICKERS = ["SPXW", "SPY", "QQQ"]
SP = os.path.dirname(os.path.abspath(__file__))

# ---------- io ----------
def et(ts_iso):
    s = ts_iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)  # EDT
    return dt.strftime("%H:%M")

def load(path):
    frames = []
    with gzip.open(path, "rt") as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    frames.sort(key=lambda d: d["requestedTs"])
    return frames

def complete_days():
    """Return sorted list of dates whose 3 tickers each have a >=385-frame .jsonl.gz."""
    days = []
    for d in sorted(glob.glob(os.path.join(BACKFILL, "20*"))):
        date = os.path.basename(d)
        ok = True
        for t in TICKERS:
            gz = os.path.join(d, f"{t}.jsonl.gz")
            if not os.path.exists(gz):
                ok = False; break
            try:
                with gzip.open(gz, "rt") as f:
                    n = sum(1 for _ in f)
                if n < 385:
                    ok = False; break
            except Exception:
                ok = False; break
        if ok:
            days.append(date)
    return days

# ---------- king with dead-band ----------
def strike_increment(frame):
    ks = sorted(s["strike"] for s in frame["strikes"])
    diffs = [b - a for a, b in zip(ks, ks[1:]) if b - a > 0]
    return min(diffs) if diffs else 1.0

def king_db(frame, inc):
    spot = frame["spot"]; strikes = frame["strikes"]
    total = sum(abs(s["gamma"]) for s in strikes)
    if total == 0:
        return None
    kg = max(strikes, key=lambda s: abs(s["gamma"]))
    g = kg["gamma"]
    if g == 0:
        return None
    strike = kg["strike"]
    sign = "pika" if g > 0 else "barney"
    band = max(inc, 0.0005 * spot)
    if abs(strike - spot) < band:
        side = "at"
    else:
        side = "above" if strike > spot else "below"
    return {"strike": strike, "gamma": g, "abs": abs(g), "sign": sign,
            "side": side, "share": abs(g) / total, "spot": spot}

def gamma_at(frame, strike):
    for s in frame["strikes"]:
        if s["strike"] == strike:
            return s["gamma"]
    return 0.0

def pika_king_within(frame, inc, pct=0.003):
    """Is there a PIKA (positive-gamma) node within pct of spot that is the dominant
    same-side support? Returns the nearest pika strike within band or None. We look at
    the frame's overall King: if King is pika and |strike-spot|<=pct*spot -> support."""
    spot = frame["spot"]
    k = king_db(frame, inc)
    if k and k["sign"] == "pika" and abs(k["strike"] - spot) <= pct * spot:
        return k["strike"]
    return None

# ---------- price-structure ledger ----------
def price_structure(frames):
    """Per-minute: running day high/low, pos_in_range, opening-range (first 30 frames)."""
    rows = []
    hi = lo = None
    or_hi = or_lo = None
    for i, fr in enumerate(frames):
        spot = fr["spot"]
        hi = spot if hi is None else max(hi, spot)
        lo = spot if lo is None else min(lo, spot)
        if i < 30:  # first 30 min = opening range
            or_hi = spot if or_hi is None else max(or_hi, spot)
            or_lo = spot if or_lo is None else min(or_lo, spot)
        width = hi - lo
        pos = (spot - lo) / width if width > 0 else 0.5
        rows.append({"i": i, "ts": fr["requestedTs"], "et": et(fr["requestedTs"]), "spot": spot,
                     "day_hi": hi, "day_lo": lo, "range_sofar": width, "pos": pos,
                     "or_hi": or_hi, "or_lo": or_lo})
    return rows

def daily_range(frames):
    spots = [fr["spot"] for fr in frames]
    return max(spots) - min(spots)

# ---------- KingFlip-v0 confirmed-flip detector ----------
def build_cat_series(frames, inc):
    led = []
    for i, fr in enumerate(frames):
        k = king_db(fr, inc)
        row = {"i": i, "et": et(fr["requestedTs"]), "spot": fr["spot"]}
        if k:
            row.update({"king": k["strike"], "sign": k["sign"], "side": k["side"],
                        "cat": f"{k['sign']}-{k['side']}", "share": k["share"], "abs": k["abs"]})
        else:
            row.update({"king": None, "sign": None, "side": None, "cat": None, "share": None, "abs": 0})
        led.append(row)
    return led

def slope(ys):
    n = len(ys)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mx = sum(xs) / n; my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    return num / den if den else 0.0

def mono_frac_down(ys):
    diffs = [b - a for a, b in zip(ys, ys[1:])]
    if not diffs:
        return 1.0
    return sum(1 for d in diffs if d <= 0) / len(diffs)

def confirmed_flips(led, frames, P=3, margin=0.01, ratio=1.10, vel_lookback=15):
    """Debounced confirmed category transitions with dominance margin + velocity tag."""
    events = []
    stable = None; stable_share = None; stable_last_i = None; stable_king = None
    pending = None; prun = 0; pend_start = None
    for r in led:
        c = r["cat"]
        if c is None:
            continue
        if stable is None:
            stable = c; stable_share = r["share"]; stable_last_i = r["i"]; stable_king = r["king"]
            continue
        if c == stable:
            stable_share = r["share"]; stable_last_i = r["i"]; stable_king = r["king"]
            pending = None; prun = 0
            continue
        # c != stable
        if pending == c:
            prun += 1
        else:
            pending = c; prun = 1; pend_start = r["i"]
        if prun >= P:
            A = stable; B = c
            a_share = stable_share; b_share = r["share"]
            dom_ok = (b_share - a_share) >= margin or (a_share > 0 and b_share / a_share >= ratio)
            cls = None
            if A == "barney-above" and B == "pika-below":
                cls = "BULLISH"
            elif A == "pika-below" and B == "barney-above":
                cls = "BEARISH"
            # velocity precondition over [confirm-15 .. confirm]
            ci = r["i"]
            lb = max(0, ci - vel_lookback)
            inc_k = stable_king; suc_k = r["king"]
            inc_ser = [abs(gamma_at(frames[j], inc_k)) for j in range(lb, ci + 1)]
            suc_ser = [abs(gamma_at(frames[j], suc_k)) for j in range(lb, ci + 1)]
            gap_ser = [abs(a - b) for a, b in zip(inc_ser, suc_ser)]
            vel_pre = (slope(inc_ser) < 0 and slope(suc_ser) > 0 and mono_frac_down(gap_ser) >= 0.70)
            events.append({"confirm_i": ci, "confirm_et": r["et"], "spot": r["spot"],
                           "A": A, "B": B, "cls": cls, "a_share": round(a_share, 4),
                           "b_share": round(b_share, 4), "dom_ok": dom_ok,
                           "inc_king": inc_k, "suc_king": suc_k, "vel_pre": vel_pre,
                           "pend_start_i": pend_start})
            stable = c; stable_share = b_share; stable_last_i = r["i"]; stable_king = r["king"]
            pending = None; prun = 0
    return events

# ---------- System-v0b events (extreme + pika-King support), edge-triggered ----------
def v0b_events(frames, ps, inc, width_gate, cooldown=30):
    out = []
    last_fire = -10 ** 9
    for i, fr in enumerate(frames):
        p = ps[i]["pos"]; w = ps[i]["range_sofar"]
        if w < width_gate:
            continue
        pk = pika_king_within(fr, inc)
        if pk is None:
            continue
        cls = None
        if p <= 0.25:
            cls = "BULLISH"   # bounce off pika floor at the low
        elif p >= 0.75:
            cls = "BEARISH"   # rejection off pika ceiling at the high
        if cls is None:
            continue
        if i - last_fire < cooldown:
            continue
        out.append({"i": i, "et": ps[i]["et"], "spot": fr["spot"], "pos": round(p, 3),
                    "cls": cls, "pika_king": pk, "range_sofar": round(w, 2)})
        last_fire = i
    return out

# ---------- main ----------
def analyze():
    days = complete_days()
    print(f"[complete days used: {len(days)}] {days}")
    # median daily range (per ticker) across days
    day_ranges = {t: [] for t in TICKERS}
    all_frames = {}   # (date,ticker) -> frames
    all_ps = {}       # (date,ticker) -> price-structure rows
    all_inc = {}
    for date in days:
        for t in TICKERS:
            fr = load(os.path.join(BACKFILL, date, f"{t}.jsonl.gz"))
            all_frames[(date, t)] = fr
            all_inc[(date, t)] = strike_increment(fr[0])
            all_ps[(date, t)] = price_structure(fr)
            day_ranges[t].append(daily_range(fr))
    med_range = {t: statistics.median(day_ranges[t]) for t in TICKERS}
    width_gate = {t: 0.30 * med_range[t] for t in TICKERS}
    print("[median daily range / width-gate 0.30x]")
    for t in TICKERS:
        print(f"  {t}: median_range={med_range[t]:.2f}  width_gate={width_gate[t]:.2f}  "
              f"(days: {[round(x,1) for x in day_ranges[t]]})")

    # ---- prior-day levels (close/high/low) from the preceding complete day ----
    prior = {}  # (date,ticker) -> (close, high, low) or None
    for t in TICKERS:
        for j, date in enumerate(days):
            if j == 0:
                prior[(date, t)] = None
            else:
                pf = all_frames[(days[j - 1], t)]
                spots = [x["spot"] for x in pf]
                prior[(date, t)] = (pf[-1]["spot"], max(spots), min(spots))

    # ---- persist price-structure ledger per day ----
    for date in days:
        outp = os.path.join(BACKFILL, date, "price_structure.csv")
        with open(outp, "w") as f:
            f.write("ticker,et,ts,spot,day_hi,day_lo,range_sofar,pos_in_range,or_hi,or_lo,"
                    "prior_close,prior_high,prior_low,king,king_sign,king_side,king_share\n")
            for t in TICKERS:
                led = build_cat_series(all_frames[(date, t)], all_inc[(date, t)])
                pc = prior[(date, t)]
                pcs = ("", "", "") if pc is None else (f"{pc[0]:.2f}", f"{pc[1]:.2f}", f"{pc[2]:.2f}")
                for r, k in zip(all_ps[(date, t)], led):
                    f.write(f"{t},{r['et']},{r['ts']},{r['spot']:.2f},{r['day_hi']:.2f},"
                            f"{r['day_lo']:.2f},{r['range_sofar']:.2f},{r['pos']:.4f},"
                            f"{r['or_hi']:.2f},{r['or_lo']:.2f},{pcs[0]},{pcs[1]},{pcs[2]},"
                            f"{k['king']},{k['sign']},{k['side']},"
                            f"{'' if k['share'] is None else round(k['share'],4)}\n")
    print(f"[wrote price_structure.csv for {len(days)} days]")

    # ---- flips + gating ----
    all_flips = []
    for date in days:
        for t in TICKERS:
            fr = all_frames[(date, t)]; ps = all_ps[(date, t)]; inc = all_inc[(date, t)]
            led = build_cat_series(fr, inc)
            evs = confirmed_flips(led, fr)
            for e in evs:
                if e["cls"] is None:      # confirmed transition but not a composite flip
                    continue
                i = e["confirm_i"]
                pos = ps[i]["pos"]; w = ps[i]["range_sofar"]
                # System-v0 gate
                aligned = (e["cls"] == "BULLISH" and pos <= 0.25) or (e["cls"] == "BEARISH" and pos >= 0.75)
                width_ok = w >= width_gate[t]
                if not e["dom_ok"]:
                    bucket = "no_dom"           # fails dominance margin -> not a confirmed flip
                elif aligned and width_ok:
                    bucket = "taken"
                elif 0.25 < pos < 0.75:
                    bucket = "rej_midrange"
                elif not width_ok:
                    bucket = "rej_widthfail"
                else:
                    bucket = "rej_wrongextreme"
                all_flips.append({"date": date, "ticker": t, "et": e["confirm_et"],
                                  "cls": e["cls"], "spot": round(e["spot"], 2), "pos": round(pos, 3),
                                  "range_sofar": round(w, 2), "a_share": e["a_share"], "b_share": e["b_share"],
                                  "dom_ok": e["dom_ok"], "vel_pre": e["vel_pre"],
                                  "inc_king": e["inc_king"], "suc_king": e["suc_king"],
                                  "bucket": bucket, "confirm_i": i})
    # ---- v0b ----
    all_v0b = []
    for date in days:
        for t in TICKERS:
            evs = v0b_events(all_frames[(date, t)], all_ps[(date, t)], all_inc[(date, t)], width_gate[t])
            for e in evs:
                e2 = {"date": date, "ticker": t}; e2.update(e); all_v0b.append(e2)

    # ---- descriptive forward drift by pos bucket (spot only, all minutes) ----
    buckets = [(0.0, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 1.0001)]
    def new_drift():
        return {b: {"n": 0, "d30": [], "d60": []} for b in buckets}
    drift = new_drift()
    drift_t = {t: new_drift() for t in TICKERS}   # per-ticker
    for date in days:
        for t in TICKERS:
            ps = all_ps[(date, t)]; fr = all_frames[(date, t)]
            n = len(ps)
            for i in range(n):
                # require an established range (>= width_gate) so early degenerate ranges excluded
                if ps[i]["range_sofar"] < width_gate[t]:
                    continue
                p = ps[i]["pos"]
                for b in buckets:
                    if b[0] <= p < b[1]:
                        for D in (drift, drift_t[t]):
                            D[b]["n"] += 1
                            if i + 30 < n:
                                D[b]["d30"].append(fr[i + 30]["spot"] / fr[i]["spot"] - 1)
                            if i + 60 < n:
                                D[b]["d60"].append(fr[i + 60]["spot"] / fr[i]["spot"] - 1)
                        break

    # ---- write event json (consumed by pnl_v0.py) ----
    with open(os.path.join(SP, "system_v0_events.json"), "w") as f:
        json.dump({"days": days, "med_range": med_range, "width_gate": width_gate,
                   "flips": all_flips, "v0b": all_v0b}, f, indent=1)

    # ---- print summary ----
    print(f"\n===== CONFIRMED COMPOSITE FLIPS (KingFlip-v0) : {len(all_flips)} =====")
    print(f"{'date':11s} {'tkr':4s} {'et':5s} {'cls':7s} {'spot':>9s} {'pos':>5s} "
          f"{'rng':>6s} {'aShr':>5s} {'bShr':>5s} {'dom':>3s} {'vel':>3s} {'bucket':16s}")
    for e in all_flips:
        print(f"{e['date']:11s} {e['ticker']:4s} {e['et']:5s} {e['cls']:7s} {e['spot']:>9.2f} "
              f"{e['pos']:>5.2f} {e['range_sofar']:>6.1f} {e['a_share']:>5.2f} {e['b_share']:>5.2f} "
              f"{'Y' if e['dom_ok'] else 'n':>3s} {'Y' if e['vel_pre'] else 'n':>3s} {e['bucket']:16s}")
    from collections import Counter
    bc = Counter(e["bucket"] for e in all_flips)
    print("  bucket counts:", dict(bc))
    tk = [e for e in all_flips if e["bucket"] == "taken"]
    rej = [e for e in all_flips if e["bucket"].startswith("rej")]
    print(f"  taken(System-v0)={len(tk)}  rejected(all)={len(rej)}  "
          f"midrange={sum(1 for e in all_flips if e['bucket']=='rej_midrange')}")

    print(f"\n===== SYSTEM-v0b EVENTS (extreme + pika-King support) : {len(all_v0b)} =====")
    for e in all_v0b:
        print(f"  {e['date']} {e['ticker']:4s} {e['et']} {e['cls']:7s} pos={e['pos']:.2f} "
              f"pika_king={e['pika_king']} spot={e['spot']:.2f}")

    # velocity-precondition split among dom_ok flips
    domf = [e for e in all_flips if e["dom_ok"]]
    print(f"\n[velocity-precondition] dom_ok flips={len(domf)}  with vel_pre=True: "
          f"{sum(1 for e in domf if e['vel_pre'])}")

    def print_drift(D, label):
        print(f"\n--- forward drift ({label}) [+bps favors UP over next N min] ---")
        print(f"{'bucket':13s} {'n':>7s} {'mean30bps':>10s} {'med30bps':>9s} {'n60':>6s} "
              f"{'mean60bps':>10s} {'med60bps':>9s}")
        for b in buckets:
            d = D[b]; d30 = d["d30"]; d60 = d["d60"]
            m30 = 1e4 * statistics.mean(d30) if d30 else 0
            md30 = 1e4 * statistics.median(d30) if d30 else 0
            m60 = 1e4 * statistics.mean(d60) if d60 else 0
            md60 = 1e4 * statistics.median(d60) if d60 else 0
            print(f"[{b[0]:.2f},{min(b[1],1.0):.2f})   {d['n']:>7d} {m30:>10.1f} {md30:>9.1f} "
                  f"{len(d60):>6d} {m60:>10.1f} {md60:>9.1f}")

    print("\n===== DESCRIPTIVE: forward underlying drift by pos-in-range bucket (all minutes) =====")
    print_drift(drift, "ALL tickers pooled")
    for t in TICKERS:
        print_drift(drift_t[t], f"{t} only")
    return {"days": days, "flips": all_flips, "v0b": all_v0b, "drift": drift,
            "drift_t": drift_t, "width_gate": width_gate}

if __name__ == "__main__":
    analyze()
