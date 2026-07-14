#!/usr/bin/env python3
import json, os
import os as _os
SP = _os.path.dirname(_os.path.abspath(__file__))
prices = json.load(open(os.path.join(SP,"prices.json")))
ARM=0.50; GB=0.15

def minutes_from(m, start_et):
    return [k for k in sorted(m.keys()) if k >= start_et]

def sim_trail(name, entry_et, use="close"):
    m = prices[name]
    ks = minutes_from(m, entry_et)
    if entry_et not in m:
        # find next available
        entry_et = ks[0]
    entry = m[entry_et]["close"]
    peak = entry; peak_et = entry_et; armed=False
    exit_et=None; exit_mark=None; reason=None
    for k in ks:
        c = m[k]["close"]  # close = last print of the minute ~ polled mid
        if c > peak:
            peak = c; peak_et = k
        if not armed and peak >= entry*(1+ARM):
            armed=True
        if armed and c <= peak*(1-GB):
            exit_et=k; exit_mark=round(c,2); reason=f"TRAIL 15% off peak {peak:.2f}@{peak_et}"
            break
    if exit_et is None:
        last=ks[-1]; exit_et=last; exit_mark=m[last]["close"]; reason="EOD"
    pnl=(exit_mark-entry)/entry
    peakpnl=(peak-entry)/entry
    print(f"{name} entry@{entry_et}={entry:.2f}  peak={peak:.2f}(+{peakpnl*100:.0f}%)@{peak_et}  "
          f"exit@{exit_et}={exit_mark:.2f}  PnL={pnl*100:+.0f}%  [{reason}]  armed={armed}")
    return {"name":name,"entry_et":entry_et,"entry":entry,"peak":peak,"peak_et":peak_et,
            "peakpnl":peakpnl,"exit_et":exit_et,"exit_mark":exit_mark,"pnl":pnl,"reason":reason}

print("=== NOON SPX BULLISH FLIP — ATM 7530C ===")
sim_trail("SPXW7530C","12:03")   # raw first flip
sim_trail("SPXW7530C","12:13")   # debounced (3-min persist confirmed 12:11-13)
sim_trail("SPXW7530C","12:11")   # settled flip minute

print("\n=== reference: live fires ===")
sim_trail("SPXW7530C","09:30")   # 09:30 fire (7530C)
sim_trail("SPXW7540C","11:51")   # 11:51 SPXW fire
sim_trail("QQQ720C","09:45")     # QQQ loser 1
sim_trail("QQQ720C","11:51")     # QQQ loser 2
sim_trail("QQQ720C","15:11")     # QQQ winner

print("\n=== peak scan 7530C 12:00-16:00 ===")
m=prices["SPXW7530C"]
best=max(((k,m[k]['high']) for k in m if '12:03'<=k<='16:00'), key=lambda x:x[1])
print("peak high:", best)
