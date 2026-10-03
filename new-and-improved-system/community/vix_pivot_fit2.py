#!/usr/bin/env python3
"""Second pass on TheArchitect's VIX pivot:
 1) widen extraction: any author's post that names the day's VIX pivot (same-day before 10:30 ET, or prior-evening 'tomorrow' posts),
    plus his T1/T2 levels when present
 2) test the user's hypothesis that the pivot comes from shorter-dated implied vol: fit against Cboe VIX, VIX9D, VIX1D, VIX3M
    (Yahoo daily) and Tempest's SPXW SVX tenors, using many candidate transforms
 3) report the best fits; save the posted table for the effectiveness test.
"""
import json, glob, re, os, math, datetime as dt
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
ET = dt.timedelta(hours=-4)

def et(iso): return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")) + ET

# ---------- 1) extraction ----------
PIV = re.compile(r"(?:vix[^0-9\n]{0,30}pivot|pivot[^0-9\n]{0,12}vix|vix\s*pivot)[^0-9$\n]{0,30}\$?\s?(\d{1,2}\.\d{1,2})", re.I)
PIV2 = re.compile(r"\bpivot\b[^0-9$\n]{0,25}\$?\s?(\d{1,2}\.\d{1,2})", re.I)
TLV = re.compile(r"\bT\s?([123])\b[^0-9$\n]{0,25}\$?\s?(\d{1,2}\.\d{1,2})", re.I)
cands = defaultdict(list)
for f in glob.glob(os.path.join(HERE, "dumps", "dc_*.json")):
    for m in json.load(open(f)):
        t = (m.get("text") or ""); a = (m.get("author") or "")
        if not m.get("time") or "pivot" not in t.lower(): continue
        # use only the message's own text (drop quoted reply prefix: everything before the last ' / ' block is often the quote)
        own = t
        mt = PIV.search(own) or (PIV2.search(own) if "vix" in own.lower() else None)
        if not mt: continue
        v = float(mt.group(1))
        if not (9 <= v <= 60): continue
        e = et(m["time"]); hm = e.strftime("%H:%M")
        if hm <= "10:30": day = e.date()
        elif hm >= "15:00" and re.search(r"tomorrow|tmrw|tmr\b|monday|tomm", own, re.I):
            day = e.date() + dt.timedelta(days=1)
            while day.weekday() >= 5: day += dt.timedelta(days=1)
        else: continue
        tl = {f"T{k}": float(x) for k, x in TLV.findall(own) if 9 <= float(x) <= 60}
        cands[str(day)].append({"pivot": v, "author": a.split("(")[0].strip()[:14], "time": m["time"], **tl})
posted = {}
for d, lst in cands.items():
    arch = [c for c in lst if c["author"].startswith("TheArchitect")]
    pick = sorted(arch or lst, key=lambda c: c["time"])[0]
    posted[d] = pick
days = sorted(posted)
print(f"posted pivots: {len(days)} days ({days[0]} → {days[-1]}), by TheArchitect: {sum(1 for d in days if posted[d]['author'].startswith('TheArchitect'))}, with T levels: {sum(1 for d in days if any(k.startswith('T') for k in posted[d]))}")

# ---------- 2) data ----------
def yahoo(sym):
    j = json.load(open(os.path.join(ROOT, ".cache", "vix", f"{sym}.json")))["chart"]["result"][0]
    q = j["indicators"]["quote"][0]; out = {}
    for i, ts in enumerate(j["timestamp"]):
        d = str((dt.datetime.utcfromtimestamp(ts) + ET).date())
        if None in (q["open"][i], q["high"][i], q["low"][i], q["close"][i]): continue
        out[d] = {"o": q["open"][i], "h": q["high"][i], "l": q["low"][i], "c": q["close"][i]}
    return out
S = {s: yahoo(s) for s in ["VIX", "VIX9D", "VIX1D", "VIX3M"]}
tj = json.load(open(os.path.join(ROOT, ".cache", "vix", "tempest_spxw_history.json")))
td = tj["data"]["symbols"][0] if "symbols" in tj.get("data", {}) else tj["data"]
cols, dates = td["columns"], td["dates"]
for name in [k for k in cols if re.match(r"svx(1d|9|30|3m)(_adj)?$", k)]:
    S["SVX:" + name] = {d: {"c": v} for d, v in zip(dates, cols[name]) if v is not None}
cal = sorted(S["VIX"])
def prev(d):
    i = cal.index(d) if d in cal else None
    return cal[i - 1] if i else None

# ---------- 3) fit ----------
def transforms(series):
    def p(d, k):  # prior day's field
        pd_ = prev(d); b = series.get(pd_) if pd_ else None
        return b.get(k) if b else None
    def today(d, k):
        b = series.get(d); return b.get(k) if b else None
    T = {
        "prior close": lambda d: p(d, "c"),
        "today open": lambda d: today(d, "o"),
        "prior (H+L+C)/3": lambda d: (p(d, "h") + p(d, "l") + p(d, "c")) / 3 if p(d, "h") is not None else None,
        "prior (H+L)/2": lambda d: (p(d, "h") + p(d, "l")) / 2 if p(d, "h") is not None else None,
        "(todayO + pH + pL + pC)/4": lambda d: (today(d, "o") + p(d, "h") + p(d, "l") + p(d, "c")) / 4 if p(d, "h") is not None and today(d, "o") is not None else None,
    }
    # 5-day / weekly anchors (weekly implied-move idea)
    def wk(d, fn):
        pts = [x for x in cal if x < d][-5:]; vals = [series[x]["c"] for x in pts if x in series and series[x].get("c") is not None]
        return fn(vals) if len(vals) == 5 else None
    T["avg of prior 5 closes"] = lambda d: wk(d, lambda v: sum(v) / 5)
    T["prior week (H+L+C)/3 (5d)"] = lambda d: (lambda pts: (max(series[x].get("h", series[x]["c"]) for x in pts) + min(series[x].get("l", series[x]["c"]) for x in pts) + series[pts[-1]]["c"]) / 3 if len(pts) == 5 and all(x in series for x in pts) else None)([x for x in cal if x < d][-5:])
    return T
rows = []
for sname, series in S.items():
    for tname, fn in transforms(series).items():
        err = []
        for d in days:
            try: v = fn(d)
            except Exception: v = None
            if v is None: continue
            err.append(abs(v - posted[d]["pivot"]))
        if len(err) < 15: continue
        err.sort()
        rows.append((sum(err) / len(err), err[len(err) // 2], sum(e <= 0.05 for e in err) / len(err), sum(e <= 0.25 for e in err) / len(err), len(err), sname, tname))
rows.sort()
print("\n=== best formula fits to his posted pivot (lower error = closer) ===")
print(f"  {'source':<14} {'transform':<30} {'n':>3} {'mean|err|':>9} {'median':>7} {'≤0.05':>6} {'≤0.25':>6}")
for mae, med, w05, w25, n, s, t in rows[:14]:
    print(f"  {s:<14} {t:<30} {n:>3} {mae:>9.3f} {med:>7.3f} {w05*100:>5.0f}% {w25*100:>5.0f}%")
json.dump(posted, open(os.path.join(HERE, "ledgers", "vix_pivots_posted.json"), "w"), indent=1)
print("\nsaved ledgers/vix_pivots_posted.json")
