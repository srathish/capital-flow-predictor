#!/usr/bin/env python3
"""Sweep gate-combos x target grid over the 7/14 candidates. RESEARCH ONLY (Clause 0)."""
import json, os, itertools

HERE = os.path.dirname(os.path.abspath(__file__))
cands = json.load(open(os.path.join(HERE, "hitrate_candidates.json")))
GATE_NAMES = ["G1", "G2", "G3", "G4", "G5"]
TARGETS = ["next-node", "+40%", "+60%", "+80%"]

def passes(c, combo):
    return all(c["gates"][g] for g in combo)

def stats(cs, target):
    pnls = [c["sim"]["results"][target]["pnl"] for c in cs]
    pnls = [p for p in pnls if p is not None]
    n = len(pnls)
    if n == 0:
        return None
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    return {
        "n": n, "wr": len(wins) / n,
        "avg_win": sum(wins) / len(wins) if wins else 0.0,
        "avg_loss": sum(losses) / len(losses) if losses else 0.0,
        "total": sum(pnls), "exp": sum(pnls) / n,
        "worst": min(pnls), "best": max(pnls),
    }

def combos_all():
    out = [()]  # base (no gates)
    for r in range(1, 6):
        for c in itertools.combinations(GATE_NAMES, r):
            out.append(c)
    return out

rows = []
for combo in combos_all():
    cs = [c for c in cands if passes(c, combo)]
    for tgt in TARGETS:
        s = stats(cs, tgt)
        if s:
            rows.append({"combo": combo, "target": tgt, **s})

def label(combo):
    return "+".join(combo) if combo else "BASE"

# ---- full frontier: every config, sorted by win rate desc then expectancy ----
print("="*118)
print("FULL SWEEP — every gate-combo x target (n>=4). Sorted: win-rate desc, then expectancy desc")
print("="*118)
print(f"{'config':22s} {'target':10s} {'N':>3s} {'WR':>6s} {'avgW':>7s} {'avgL':>7s} {'TOTAL':>8s} {'exp':>7s} {'worst':>7s}")
frontier = [r for r in rows if r["n"] >= 4]
frontier.sort(key=lambda r: (-r["wr"], -r["exp"]))
for r in frontier:
    print(f"{label(r['combo']):22s} {r['target']:10s} {r['n']:3d} {r['wr']*100:5.0f}% "
          f"{r['avg_win']*100:+6.0f}% {r['avg_loss']*100:+6.0f}% {r['total']*100:+7.0f}% "
          f"{r['exp']*100:+6.0f}% {r['worst']*100:+6.0f}%")

# ---- >=70% win rate AND positive total ----
print("\n" + "="*118)
print(">=70% WIN RATE  AND  POSITIVE TOTAL P&L  (candidates for the demonstration config)")
print("="*118)
qual = [r for r in rows if r["wr"] >= 0.70 and r["total"] > 0]
# prefer: most trades, then fewest gates
qual.sort(key=lambda r: (-r["n"], len(r["combo"]), -r["exp"]))
print(f"{'config':22s} {'target':10s} {'N':>3s} {'WR':>6s} {'avgW':>7s} {'avgL':>7s} {'TOTAL':>8s} {'exp':>7s} {'worst':>7s} {'#gates':>6s}")
for r in qual:
    print(f"{label(r['combo']):22s} {r['target']:10s} {r['n']:3d} {r['wr']*100:5.0f}% "
          f"{r['avg_win']*100:+6.0f}% {r['avg_loss']*100:+6.0f}% {r['total']*100:+7.0f}% "
          f"{r['exp']*100:+6.0f}% {r['worst']*100:+6.0f}% {len(r['combo']):6d}")

# ---- honesty: high-hit-rate-but-worthless flag (>=80% WR but big worst loser vs avg win) ----
print("\n" + "="*118)
print("HONESTY FLAG — high hit rate but a single loser bigger than several wins (worthless despite the %)")
print("="*118)
for r in sorted([r for r in rows if r["wr"] >= 0.80 and r["n"] >= 4], key=lambda r:-r["n"]):
    ratio = abs(r["worst"]) / (r["avg_win"] + 1e-9)
    flag = "  <-- WORST LOSER > %.1f avg-wins" % ratio if ratio > 2 else ""
    print(f"{label(r['combo']):22s} {r['target']:10s} N={r['n']:2d} WR={r['wr']*100:.0f}% "
          f"avgW={r['avg_win']*100:+.0f}% worst={r['worst']*100:+.0f}% total={r['total']*100:+.0f}%{flag}")

# ---- base (no gates) reference at each target ----
print("\n" + "="*118)
print("BASELINE — raw directional signals, NO structural gate, at each target")
print("="*118)
for tgt in TARGETS:
    s = stats(cands, tgt)
    print(f"  BASE {tgt:10s} N={s['n']} WR={s['wr']*100:.0f}% total={s['total']*100:+.0f}% exp={s['exp']*100:+.1f}% worst={s['worst']*100:+.0f}%")
