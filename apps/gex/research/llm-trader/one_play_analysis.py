#!/usr/bin/env python3
"""Reusable aggregator for the charts-first 'one confident play per day' system.
Recomputes, over ALL cf_events_*.jsonl present, the causal one-shot metrics and the
gate. Re-run any time new blind days land. RESEARCH ONLY (Clause 0)."""
import json, gzip, glob, os, sys, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__))
BF = os.path.join(HERE, '..', 'velocity-capture', 'backfill')

def surf(day, tk='SPXW'):
    p = os.path.join(BF, day, f'{tk}.jsonl.gz')
    if not os.path.exists(p): return None
    rows = []
    for l in gzip.open(p, 'rt'):
        r = json.loads(l); m = (int(r['requestedTs'][11:13]) * 60 + int(r['requestedTs'][14:16])) - 810
        if 0 <= m <= 390: rows.append((m, r['spot'], {x['strike']: (x.get('gamma') or 0) for x in r.get('strikes', [])}))
    return rows

def netg(day, tmin):
    s = surf(day)
    if not s: return None
    fr = [x for x in s if x[0] <= tmin]
    if not fr: return None
    m, spot, stt = fr[-1]
    return sum(g for k, g in stt.items() if abs(k - spot) / spot <= 0.005) / 1e6

def load(pattern='cf_events_2026-*_SPXW.jsonl'):
    byday = {}
    for f in sorted(glob.glob(os.path.join(HERE, pattern))):
        for l in open(f):
            if not l.strip(): continue
            e = json.loads(l); t = e['minute']; t = t.split('T')[1] if 'T' in t else t
            em = (int(t[:2]) * 60 + int(t[3:5])) - (13 * 60 + 30)
            ng = netg(e['day'], em)
            if ng is None: continue
            byday.setdefault(e['day'], []).append({'m': em, 'pnl': e.get('pnl_pct', 0), 'netg': ng})
    return byday

def one_shot(byday, gate=40):
    """Causal: first gate-open (netg<=gate) trade per day, else no trade."""
    res = []
    for d in sorted(byday):
        v = sorted(byday[d], key=lambda x: x['m'])
        pick = next((x for x in v if x['netg'] <= gate), None)
        if pick: res.append((d, pick['pnl']))
    return res

def summ(label, pnls):
    if not pnls: print(f"{label}: no trades"); return
    w = sum(1 for p in pnls if p > 0)
    print(f"{label:<40} n={len(pnls):>2}  win {w}/{len(pnls)} ({w*100//len(pnls)}%)  "
          f"avg {sum(pnls)/len(pnls):+.1f}%  sum {sum(pnls):+.0f}%  median {st.median(pnls):+.0f}%")

if __name__ == '__main__':
    byday = load()
    days = sorted(byday)
    print(f"=== {len(days)} trade-days: {days[0]}..{days[-1]} ===\n")
    all_trades = [t['pnl'] for d in byday for t in byday[d]]
    summ("ALL trades (trade everything)", all_trades)
    summ("ONE-SHOT causal (first gate-open/day)", [p for _, p in one_shot(byday)])
    # gate sensitivity
    print()
    for g in (0, 20, 40, 60, 100, 9999):
        summ(f"one-shot, gate netg<={g}M", [p for _, p in one_shot(byday, g)])
    # train/test split (chronological) to preview OOS degradation
    if len(days) >= 8:
        half = len(days) // 2
        tr = {d: byday[d] for d in days[:half]}; te = {d: byday[d] for d in days[half:]}
        print(f"\n=== chronological split (train {days[0]}..{days[half-1]} | test {days[half]}..{days[-1]}) ===")
        summ("TRAIN one-shot", [p for _, p in one_shot(tr)])
        summ("TEST  one-shot (out-of-sample)", [p for _, p in one_shot(te)])
