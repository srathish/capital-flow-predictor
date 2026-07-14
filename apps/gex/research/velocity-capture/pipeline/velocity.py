#!/usr/bin/env python3
"""Velocity ledger, noon zoom, lead-lag, 5-min alias, flicker/debounce."""
import gzip, json, os
from datetime import datetime, timedelta, timezone
from king import load, build_ledger, king_of, count_transitions, classify_flip, et, ONEMIN, FIVEMIN, TICKERS

import os as _os
SP = _os.path.dirname(_os.path.abspath(__file__))

def strike_series(frames):
    """dict strike -> list of (idx, gamma, vanna) across frames; also spot list."""
    ser = {}
    spots = []
    for i, fr in enumerate(frames):
        spots.append(fr["spot"])
        for s in fr["strikes"]:
            ser.setdefault(s["strike"], [None]*len(frames))
    for i, fr in enumerate(frames):
        m = {s["strike"]: s for s in fr["strikes"]}
        for k in ser:
            g = m.get(k, {}).get("gamma", 0.0)
            ser[k][i] = g
    return ser, spots

def gamma_of(frames, strike, i):
    for s in frames[i]["strikes"]:
        if s["strike"] == strike:
            return s["gamma"]
    return 0.0

def zoom(frames, led, lo_et, hi_et, watch_strikes):
    print(f"\n--- ZOOM {lo_et}-{hi_et}  watch={watch_strikes} ---")
    hdr = "  time   spot     King(sign-side)@k    share   " + "  ".join(f"g{k}" for k in watch_strikes)
    print(hdr)
    for i, r in enumerate(led):
        if lo_et <= r["et"] <= hi_et:
            gs = "  ".join(f"{gamma_of(frames,k,i):>10.0f}" for k in watch_strikes)
            kingstr = f"{r['cat']}@{r['king']}" if r['king'] else "None"
            print(f"  {r['et']} {r['spot']:>8.2f}  {kingstr:<22s} {str(r['share']):>6s}  {gs}")

def velocity_events(frames, min_run=5, top_n=8):
    """Per-strike v(t)=Δ|gamma|/min. Find sustained build/drain runs of >=min_run min."""
    ser, spots = strike_series(frames)
    builds, drains = [], []
    for k, gl in ser.items():
        absg = [abs(x) if x is not None else 0.0 for x in gl]
        # sliding sustained monotone-ish runs: measure best window of length>=min_run
        n = len(absg)
        # compute per-window net change and require mostly-monotone
        for w in (min_run, 8, 12):
            for start in range(0, n - w):
                seg = absg[start:start+w+1]
                delta = seg[-1] - seg[0]
                if seg[0] < 1 and delta < 1:
                    continue
                # net velocity per min
                vel = delta / w
                # monotonicity fraction
                diffs = [seg[j+1]-seg[j] for j in range(len(seg)-1)]
                up = sum(1 for d in diffs if d > 0)
                dn = sum(1 for d in diffs if d < 0)
                mono_up = up/len(diffs)
                mono_dn = dn/len(diffs)
                rec = {"strike": k, "start": start, "w": w, "delta": delta, "vel": vel,
                       "g0": seg[0], "g1": seg[-1], "et0": et(frames[start]["requestedTs"]),
                       "et1": et(frames[start+w]["requestedTs"]),
                       "spot0": spots[start], "spot1": spots[start+w],
                       "mono_up": mono_up, "mono_dn": mono_dn}
                if delta > 0 and mono_up >= 0.7:
                    builds.append(rec)
                if delta < 0 and mono_dn >= 0.7:
                    drains.append(rec)
    builds.sort(key=lambda r: r["vel"], reverse=True)
    drains.sort(key=lambda r: r["vel"])
    # de-dup overlapping same-strike windows: keep strongest per (strike within 10-min cluster)
    def dedup(lst):
        out, seen = [], []
        for r in lst:
            dup = False
            for s in seen:
                if s[0] == r["strike"] and abs(s[1]-r["start"]) < 6:
                    dup = True; break
            if not dup:
                out.append(r); seen.append((r["strike"], r["start"]))
            if len(out) >= top_n:
                break
        return out
    return dedup(builds), dedup(drains)

def lead_lag(frames, led, cat_changes, lookback=15):
    """For each composite flip, look back for divergence: incumbent draining while successor building."""
    results = []
    for (i, a, b) in cat_changes:
        cls = classify_flip(a, b)
        if cls not in ("BULLISH_COMPOSITE", "BEARISH_COMPOSITE"):
            continue
        incumbent = a["king"]; successor = b["king"]
        # gamma abs series around the change
        lb = max(0, i - lookback)
        inc_series = [abs(gamma_of(frames, incumbent, j)) for j in range(lb, i+1)]
        suc_series = [abs(gamma_of(frames, successor, j)) for j in range(lb, i+1)]
        # find first minute (scanning back->forward) where successor starts sustained rise AND incumbent falling
        lead_min = None
        for off in range(len(inc_series)-1):
            # successor rising over next 3, incumbent falling over next 3
            j = off
            if j+3 < len(suc_series):
                suc_rise = suc_series[j+3] - suc_series[j]
                inc_fall = inc_series[j+3] - inc_series[j]
                if suc_rise > 0 and inc_fall < 0:
                    lead_min = (i - (lb + j))
                    lead_at = et(frames[lb+j]["requestedTs"])
                    break
        results.append({
            "et": b["et"], "cls": cls, "from": a["cat"], "to": b["cat"],
            "incumbent": incumbent, "successor": successor,
            "inc_series": [round(x) for x in inc_series],
            "suc_series": [round(x) for x in suc_series],
            "lead_min": lead_min, "lead_at": lead_at if lead_min else None,
        })
    return results

def flicker_stats(led):
    """Count how many cat-changes reverse within k minutes (round-trips)."""
    cats = [r["cat"] for r in led]
    n = len(cats)
    # flicker = cat[i] != cat[i-1] but cat[i+w]==cat[i-1] for some w<=3 (round trip)
    round_trips = {1:0,2:0,3:0}
    total_changes = 0
    for i in range(1, n):
        if cats[i] is None or cats[i-1] is None: continue
        if cats[i] != cats[i-1]:
            total_changes += 1
            for w in (1,2,3):
                if i+w < n and cats[i+w] == cats[i-1]:
                    round_trips[w] += 1
                    break
    # debounce simulation: require cat to persist >=P minutes before accepting
    def debounce(P):
        accepted = 0
        stable = cats[0]
        run = 1
        pending = None; prun = 0
        seq = []
        for c in cats[1:]:
            if c == stable:
                run += 1; pending=None; prun=0
            else:
                if pending == c:
                    prun += 1
                else:
                    pending = c; prun = 1
                if prun >= P:
                    accepted += 1
                    stable = c; run = prun; pending=None; prun=0
        return accepted
    deb = {P: debounce(P) for P in (1,2,3,4,5)}
    return {"total_changes": total_changes, "round_trips": round_trips, "debounced_accepts": deb}

def five_min_compare(t):
    """Compare 1-min flips to what 5-min sampling would have shown."""
    f1 = load(os.path.join(ONEMIN, f"{t}.jsonl.gz"))
    f5 = load(os.path.join(FIVEMIN, f"{t}.jsonl.gz"))
    l1 = build_ledger(f1); l5 = build_ledger(f5)
    _,_,_, cc1 = count_transitions(l1)
    _,_,_, cc5 = count_transitions(l5)
    # composite flips at each res
    comp1 = [(b["et"], classify_flip(a,b)) for (i,a,b) in cc1 if classify_flip(a,b) in ("BULLISH_COMPOSITE","BEARISH_COMPOSITE")]
    comp5 = [(b["et"], classify_flip(a,b)) for (i,a,b) in cc5 if classify_flip(a,b) in ("BULLISH_COMPOSITE","BEARISH_COMPOSITE")]
    # 5-min king category at each 5-min mark vs 1-min truth
    cat5 = {r["et"]: r["cat"] for r in l5}
    return {"n_cc1": len(cc1), "n_cc5": len(cc5), "comp1": comp1, "comp5": comp5,
            "l5": l5, "cat5": cat5}

if __name__ == "__main__":
    for t in TICKERS:
        frames = load(os.path.join(ONEMIN, f"{t}.jsonl.gz"))
        led = build_ledger(frames)
        _,_,_, cc = count_transitions(led)
        print(f"\n########## {t} ##########")
        fs = flicker_stats(led)
        print("FLICKER:", json.dumps(fs))
        builds, drains = velocity_events(frames)
        print("TOP BUILD events (fastest sustained |gamma| growth):")
        for r in builds:
            print(f"  {r['et0']}-{r['et1']} k={r['strike']} vel={r['vel']:.0f}/min  "
                  f"|g| {r['g0']:.0f}->{r['g1']:.0f}  spot {r['spot0']:.2f}->{r['spot1']:.2f}  mono_up={r['mono_up']:.2f}")
        print("TOP DRAIN events (fastest sustained |gamma| decay):")
        for r in drains:
            print(f"  {r['et0']}-{r['et1']} k={r['strike']} vel={r['vel']:.0f}/min  "
                  f"|g| {r['g0']:.0f}->{r['g1']:.0f}  spot {r['spot0']:.2f}->{r['spot1']:.2f}  mono_dn={r['mono_dn']:.2f}")
        ll = lead_lag(frames, led, cc)
        if ll:
            print("LEAD-LAG (composite flips):")
            for r in ll:
                print(f"  {r['et']} {r['cls']} inc{r['incumbent']} suc{r['successor']} lead={r['lead_min']}min @{r['lead_at']}")
                print(f"      inc|g|:{r['inc_series']}")
                print(f"      suc|g|:{r['suc_series']}")
    # SPXW noon zoom
    fspx = load(os.path.join(ONEMIN, "SPXW.jsonl.gz"))
    lspx = build_ledger(fspx)
    zoom(fspx, lspx, "11:55", "12:20", [7520, 7550, 7560, 7530, 7540])
    # 5-min compare
    print("\n########## 1-MIN vs 5-MIN ALIAS ##########")
    for t in TICKERS:
        c = five_min_compare(t)
        print(f"\n{t}: cat_changes 1min={c['n_cc1']} 5min={c['n_cc5']}")
        print(f"  composite flips @1min: {c['comp1']}")
        print(f"  composite flips @5min: {c['comp5']}")
