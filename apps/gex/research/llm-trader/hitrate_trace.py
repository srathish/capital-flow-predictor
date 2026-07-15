#!/usr/bin/env python3
"""Trace the best config (G1, next-node) trade-by-trade and emit terrain-viewer events."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
cands = json.load(open(os.path.join(HERE, "hitrate_candidates.json")))
BEST_GATES = ["G1"]
TARGET = "next-node"

def passes(c):
    return all(c["gates"][g] for g in BEST_GATES)

sel = [c for c in cands if passes(c)]
print(f"BEST CONFIG = {'+'.join(BEST_GATES)} | target={TARGET} | N={len(sel)}")
print(f"{'tk':4s} {'side':5s} {'entry':5s} {'K':>6s} {'gates':6s} {'spot0':>8s} {'node':>7s} "
      f"{'exit':5s} {'reason':9s} {'entryPx':>7s} {'pnl':>6s}")
wins = 0; total = 0.0; events = []
for c in sorted(sel, key=lambda x: (x["tk"], x["m"])):
    g = c["gates"]; gs = "".join(k[-1] if g[k] else "." for k in ["G1","G2","G3","G4","G5"])
    res = c["sim"]["results"][TARGET]
    pnl = res["pnl"]; total += pnl
    if pnl > 0: wins += 1
    nt = c["sim"]["node_target"]
    print(f"{c['tk']:4s} {c['side']:5s} {c['et']:5s} {c['strike']:6d}{c['cp']} [{gs}] "
          f"{c['spot']:8.2f} {nt if nt else 0:7.1f} {res['exit_et']:5s} {res['reason']:9s} "
          f"{c['sim']['entry_px']:7.2f} {pnl*100:+5.0f}%")
    events.append({
        "day": "2026-07-14", "ticker": c["tk"], "minute": c["et"],
        "strike:spot@entry": f"{c['strike']}:{round(c['spot'],2)}", "kind": "h70",
        "implied": "up" if c["side"] == "long" else "down",
        "exit_minute": res["exit_et"],
        "outcome": "win" if pnl > 0 else "loss",
        "pnl_pct": round(pnl*100, 1),
    })
print(f"\nWIN RATE {wins}/{len(sel)} = {wins/len(sel)*100:.0f}%  |  TOTAL {total*100:+.0f}%  |  exp {total/len(sel)*100:+.1f}%/trade")

# emit events (convert ET entry/exit minutes to UTC HH:MM for the terrain viewer)
def et_to_utc(hhmm):
    h, m = map(int, hhmm.split(":"))
    return f"{(h+4)%24:02d}:{m:02d}"
for e in events:
    e["minute"] = et_to_utc(e["minute"])
    e["exit_minute"] = et_to_utc(e["exit_minute"])
with open(os.path.join(HERE, "hitrate70_events_2026-07-14.jsonl"), "w") as f:
    for e in events:
        f.write(json.dumps(e) + "\n")
print(f"wrote {len(events)} events -> hitrate70_events_2026-07-14.jsonl (UTC minutes)")
