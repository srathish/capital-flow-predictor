#!/usr/bin/env python3
import json, os, subprocess
from datetime import datetime, timedelta, timezone

def get_key():
    p = "/Users/saiyeeshrathish/the final plan/.env"
    with open(p) as f:
        for line in f:
            if line.startswith("UNUSUAL_WHALES_API_KEY="):
                return line.split("=",1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")

KEY = get_key()
import os as _os
SP = _os.path.dirname(_os.path.abspath(__file__))

def et(ts_iso):
    s = ts_iso.replace("Z","+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def fetch(occ):
    url = f"https://api.unusualwhales.com/api/option-contract/{occ}/intraday?date=2026-07-14"
    out = subprocess.run(["curl","-s",url,"-H",f"Authorization: Bearer {KEY}",
                          "-H","User-Agent: bellwether-research/1.0"],
                         capture_output=True, text=True).stdout
    d = json.loads(out)
    rows = d.get("data", [])
    # map ET minute -> {close, avg, high, low, open}
    m = {}
    for r in rows:
        e = et(r["start_time"])
        m[e] = {"close": float(r["close"]), "avg": float(r["avg_price"]),
                "high": float(r["high"]), "low": float(r["low"]), "open": float(r["open"])}
    return m

CONTRACTS = {
    "SPXW7530C": "SPXW260714C07530000",
    "SPXW7540C": "SPXW260714C07540000",
    "QQQ720C":  "QQQ260714C00720000",
}
allp = {}
for name, occ in CONTRACTS.items():
    m = fetch(occ)
    allp[name] = m
    mins = sorted(m.keys())
    print(f"{name} ({occ}): {len(m)} minutes, {mins[0] if mins else '-'}..{mins[-1] if mins else '-'}")

with open(os.path.join(SP,"prices.json"),"w") as f:
    json.dump(allp, f)
print("[saved prices.json]")

# quick print of key windows
def show(name, lo, hi):
    m = allp[name]
    print(f"\n{name} close prints {lo}-{hi}:")
    e = lo
    for k in sorted(m.keys()):
        if lo <= k <= hi:
            print(f"  {k} O={m[k]['open']:.2f} H={m[k]['high']:.2f} L={m[k]['low']:.2f} C={m[k]['close']:.2f} avg={m[k]['avg']:.2f}")

show("SPXW7530C","12:00","12:15")
show("SPXW7530C","15:55","16:00")
