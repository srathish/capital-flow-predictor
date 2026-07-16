#!/usr/bin/env python3
# Exit-fix study on REAL fires + REAL option price paths. RESEARCH ONLY.
import json, os, datetime, statistics as st

SCRATCH = "/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad"
CACHE1 = "/Users/saiyeeshrathish/the final plan/apps/gex/research/exit-study/cache"   # raw array files
CACHE2 = os.path.join(SCRATCH, "cache")                                                # {data:[...]} files
HAIRCUT = 0.0055   # exit fill = mid * (1 - 0.0055)  [bid side of a 1.1% spread]

fires = json.load(open(os.path.join(SCRATCH, "real_fires.json")))

def ms(iso):
    return int(datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()*1000)

def load_path(sym, day):
    # returns normalized bars: list of (ts_ms, close, high). Handles OHLC and light {ts,close} schemas.
    for base in (CACHE2, CACHE1):
        p = os.path.join(base, f"{sym}_{day}.json")
        if not os.path.exists(p): continue
        d = json.load(open(p))
        rows = d.get("data", []) if isinstance(d, dict) else d
        if not rows: continue
        out = []
        for r in rows:
            if "start_time" in r:
                t = ms(r["start_time"]); c = float(r["close"]); h = float(r.get("high", r["close"]))
            elif "ts" in r:
                t = int(r["ts"]); c = float(r["close"]); h = c   # light schema: no intra-min high
            else:
                continue
            out.append((t, c, h))
        if out:
            out.sort(key=lambda x: x[0])
            return out
    return []

def fill(g):
    return (1.0 + g) * (1.0 - HAIRCUT) - 1.0

def trail_leg(gs, arm, gb, stop=None):
    peak = -1e9; armed = False
    for g in gs:
        if g > peak: peak = g
        if not armed and peak >= arm: armed = True
        if stop is not None and g <= -abs(stop):
            return g
        if armed and (1.0 + g) <= (1.0 + peak) * (1.0 - gb):
            return g
    return gs[-1]

def first_idx(gs, thr):
    for i, g in enumerate(gs):
        if g >= thr: return i
    return None

rows_out = []
for f in fires:
    sym, day = f["option_symbol"], f["trading_day"]
    allbars = load_path(sym, day)
    entry = f["entry_ask"] if f.get("entry_ask") else f["entry_mark"]
    fire_min = (f["fire_ts_ms"]//60000)*60000
    bars = [b for b in allbars if b[0] >= fire_min]
    if not bars:
        rows_out.append({"id": f["play_id"], "day": day, "ticker": f["ticker"], "pat": f["pattern_name"], "nbars": 0}); continue
    closes = [b[1] for b in bars]; highs = [b[2] for b in bars]
    gs = [c/entry - 1.0 for c in closes]
    gh = [h/entry - 1.0 for h in highs]
    eod = gs[-1]; peak_close = max(gs); peak_high = max(gh); path_peak_mark = max(highs)
    bm = f.get("best_mark") or 0
    ratio = (path_peak_mark/bm) if bm else None
    cm = f.get("close_mark")
    x0 = fill(cm/entry - 1.0) if cm else fill(eod)
    iA = first_idx(gs, 0.30); iB = first_idx(gs, 0.60)
    lA = fill(gs[iA]) if iA is not None else fill(eod)
    lB = fill(gs[iB]) if iB is not None else fill(eod)
    lC = fill(trail_leg(gs, 0.60, 0.25)); x1 = (lA+lB+lC)/3.0
    iA2 = first_idx(gs, 0.50); iB2 = first_idx(gs, 1.00)
    lA2 = fill(gs[iA2]) if iA2 is not None else fill(eod)
    lB2 = fill(gs[iB2]) if iB2 is not None else fill(eod)
    lC2 = fill(trail_leg(gs, 1.00, 0.30)); x2 = (lA2+lB2+lC2)/3.0
    i50 = first_idx(gs, 0.50)
    x3 = fill(gs[i50]) if i50 is not None else x0
    # sensitivity: same "cap else structural" family at +40 and +45
    i40 = first_idx(gs, 0.40); i45 = first_idx(gs, 0.45)
    x3b = fill(gs[i40]) if i40 is not None else x0
    x3c = fill(gs[i45]) if i45 is not None else x0
    x4 = None
    for g in gs:
        if g >= 0.40: x4 = fill(g); break
        if g <= -0.30: x4 = fill(g); break
    if x4 is None: x4 = fill(eod)
    peak_net = fill(peak_close)
    rows_out.append({
        "id": f["play_id"], "day": day, "ticker": f["ticker"], "pat": f["pattern_name"],
        "typ": f["option_type"], "strike": f["strike"], "entry": entry, "nbars": len(bars),
        "best_mark": bm, "path_peak_mark": path_peak_mark, "peak_ratio": ratio,
        "peak_close_g": peak_close, "peak_high_g": peak_high, "peak_net": peak_net, "eod_g": eod,
        "X0": x0, "X1": x1, "X2": x2, "X3": x3, "X4": x4, "X3b40": x3b, "X3c45": x3c,
        "hit30": first_idx(gs,0.30) is not None, "hit40": i40 is not None, "hit45": i45 is not None,
        "hit50": i50 is not None, "hit60": iB is not None, "hit100": iB2 is not None,
        "legs_x1": (lA, lB, lC, iA is not None, iB is not None),
        "best_mark_ts": f.get("best_mark_ts_ms"), "close_ts": f.get("close_ts_ms"),
        "close_reason": f.get("close_reason"),
    })

json.dump(rows_out, open(os.path.join(SCRATCH, "results.json"), "w"), indent=1)

def agg(rows, key):
    v = [r[key] for r in rows if r.get(key) is not None]
    if not v: return None
    return {"n": len(v), "mean": st.mean(v), "median": st.median(v), "total": sum(v),
            "win": sum(1 for x in v if x > 0)/len(v)}

good = [r for r in rows_out if r.get("nbars", 0) > 0]
print(f"fires with path: {len(good)}/{len(rows_out)}")
# peak sanity via CLOSE (apples-to-apples with best_mark; both ~mid marks)
def close_peak_mark(r): return r["entry"]*(1+r["peak_close_g"])
rc = [close_peak_mark(r)/r["best_mark"] for r in good if r["best_mark"]]
within_c = sum(1 for x in rc if 0.85 <= x <= 1.20)
print(f"peak sanity CLOSE: max(close)/best_mark  median={st.median(rc):.3f} mean={st.mean(rc):.3f} within[.85,1.20]={within_c}/{len(rc)}")
# how often did the TRUE peak occur after the system's close (=> best_mark truncates the move)?
after = sum(1 for r in good if r["close_ts"] and r["best_mark_ts"] and r["close_ts"] > r["best_mark_ts"] and close_peak_mark(r) > r["best_mark"]*1.05)
exceed = sum(1 for r in good if close_peak_mark(r) > r["best_mark"]*1.05)
print(f"fires whose fire->EOD close-peak exceeds best_mark by >5%: {exceed}/{len(good)}  (system exited before the true peak)")
# threshold hit-rates
for thr in ["hit30","hit40","hit45","hit50","hit60","hit100"]:
    h=sum(1 for r in good if r[thr]); print(f"  reached {thr[3:]}%+ on a close bar: {h}/{len(good)} ({h/len(good)*100:.0f}%)")

def block(label, rows):
    print(f"\n===== {label}  (n={len(rows)}) =====")
    print(f"{'var':7} {'mean':>8} {'median':>8} {'total':>9} {'win%':>6} {'cap%':>7} {'leakPk':>7}")
    pk_mean = agg(rows,"peak_net")["mean"]
    for v in ["X0","X1","X2","X3","X4","X3b40","X3c45"]:
        a = agg(rows, v)
        caps = [r[v]/r["peak_net"] for r in rows if r["peak_net"] and r["peak_net"] > 0.02]
        cap = st.mean(caps) if caps else float('nan')
        leak = pk_mean - a["mean"]   # avg gap to best single-exit net
        print(f"{v:7} {a['mean']*100:>7.1f}% {a['median']*100:>7.1f}% {a['total']*100:>8.1f}% {a['win']*100:>5.0f}% {cap*100:>6.0f}% {leak*100:>6.1f}%")
    pa = agg(rows, "peak_net")
    print(f"{'PK*':7} {pa['mean']*100:>7.1f}% {pa['median']*100:>7.1f}% {pa['total']*100:>8.1f}% {'--':>6} {'100%':>7} {'0.0%':>7}  (best single-exit net, ref)")

block("ALL REAL FIRES", good)
block("reverse_rug (calls)", [r for r in good if r["pat"]=="reverse_rug"])
block("rug_setup (puts)", [r for r in good if r["pat"]=="rug_setup"])
block("other puts trapdoor+vanna", [r for r in good if r["pat"] in ("trapdoor","vanna_persistent_bear")])

print("\n===== WORKED EXAMPLES (7/15) =====")
for pid in (180, 182):
    r = next(x for x in good if x["id"]==pid)
    print(f"\nplay {pid}: {r['ticker']} {r['pat']} {r['typ']} {r['strike']:.0f}  entry_ask={r['entry']:.2f}  peak_close=+{r['peak_close_g']*100:.0f}% eod={r['eod_g']*100:.0f}%")
    print(f"  best_mark={r['best_mark']:.2f} path_peak={r['path_peak_mark']:.2f} ratio={r['peak_ratio']:.2f}")
    for v in ["X0","X1","X2","X3","X4"]:
        print(f"    {v}: {r[v]*100:>7.1f}%")
    lg=r['legs_x1']; print(f"    X1 legs A(+30)={lg[0]*100:.0f}% B(+60)={lg[1]*100:.0f}% C(trail)={lg[2]*100:.0f}%  hitA={lg[3]} hitB={lg[4]}")
