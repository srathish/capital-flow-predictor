#!/usr/bin/env python3
"""DESIGN_orb_lowgamma.md — direction-free opening-range breakout with a 1R chandelier trail, split by prior-day local gamma balance.
Untouched period 2023-11-09 → 2025-10-31. Thresholds frozen from DESIGN_flux_runners."""
import json, os, math
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); C = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.cache')
import sys
REPL = '--replicate' in sys.argv
TICKERS = (['IWM', 'DIA'] + ['ALGN', 'BROS', 'CCJ', 'CMCSA', 'CVX', 'GE', 'RH', 'STX', 'UAMY', 'ZS']) if REPL else ['SPY', 'QQQ']
TH = {'SPY': -0.328, 'QQQ': -0.541}; START, END = ('2023-11-16', '2026-10-02') if REPL else (('2025-11-01', '2026-10-16') if '--recent' in sys.argv else ('2023-11-09', '2025-10-31')) if True else None
def emin(t): d = datetime.fromtimestamp(t, tz=ZoneInfo('UTC')).astimezone(ET); return d.hour * 60 + d.minute
rows = []
for T in TICKERS:
    G = {}
    for l in open(os.path.join(C, 'uwgreeks', f'{T}.jsonl')):
        if l.strip(): j = json.loads(l); G[j['d']] = j['s']
    files = sorted(f[:10] for f in os.listdir(os.path.join(C, 'uw', 'm1', T)) if f.endswith('.json'))
    prev_close = None; prev_day = None
    for d in files:
        bars = {}
        for b in json.load(open(os.path.join(C, 'uw', 'm1', T, d + '.json'))):
            if b.get('m') == 'r':
                m = emin(b['t'])
                if 570 <= m < 960: bars[m] = b
        if len(bars) < 300: prev_close = None; continue
        pc, pd = prev_close, prev_day; prev_close = bars[max(bars)]['c']; prev_day = d
        if not (START <= d <= END) or pc is None or pd not in G: continue
        A = N = 0.0
        for r in G[pd]:
            if abs(r[0] / pc - 1) <= 0.02: g = r[1] + r[2]; A += abs(g); N += g
        if A <= 0: continue
        B = N / A
        orb = [bars[m] for m in range(570, 600) if m in bars]
        if len(orb) < 25: continue
        H, L = max(b['h'] for b in orb), min(b['l'] for b in orb); W = H - L
        if W <= 0: continue
        ms = sorted(m for m in bars if m >= 600)
        for i, m in enumerate(ms):
            if m > 840 or i + 1 >= len(ms): break
            c = bars[m]['c']; side = 1 if c > H else -1 if c < L else 0
            if not side: continue
            e = bars[ms[i + 1]]['o']; R = 0.5 * W; stop = e - side * R; best = e; r = None
            for mm in ms[i + 1:]:
                cc = bars[mm]['c']
                if mm >= 955: r = side * (cc - e) / R; break
                if (cc <= stop) if side > 0 else (cc >= stop): r = side * (cc - e) / R; break
                best = max(best, cc) if side > 0 else min(best, cc)
                stop = max(stop, best - R) if side > 0 else min(stop, best + R)
            if r is None: r = side * (bars[ms[-1]]['c'] - e) / R
            rows.append({'T': T, 'd': d, 'B': B, 'low': B < TH[T] if T in TH else None, 'r': r}); break
def stats(v, cost=0.0):
    if len(v) < 3: return f'n {len(v)}'
    by = {}
    for x in v: by.setdefault(x['d'], []).append(x['r'] - cost)
    dm = [sum(a) / len(a) for a in by.values()]; k = len(dm); mu = sum(dm) / k; sd = math.sqrt(sum((y - mu) ** 2 for y in dm) / (k - 1))
    W = [x['r'] - cost for x in v if x['r'] - cost > 0]; Lo = [cost - x['r'] for x in v if x['r'] - cost <= 0]
    return f"n {len(v):4d} | mean {mu:+.3f}R t {mu / sd * math.sqrt(k):5.2f} | win {len(W) / len(v) * 100:3.0f}% | avg win {sum(W) / len(W):.2f}R / avg loss {sum(Lo) / len(Lo):.2f}R | PF {sum(W) / sum(Lo):.2f}"
if REPL:
    for T in TICKERS:
        bs = sorted(x['B'] for x in rows if x['T'] == T)
        if bs:
            th = bs[len(bs) // 3]
            for x in rows:
                if x['T'] == T: x['low'] = x['B'] < th
print(f"{'REPLICATION' if REPL else 'Untouched period'} {START} → {END}")
if REPL:
    groups = (('R1 IWM+DIA', ('IWM', 'DIA')), ('R2 10 stocks', tuple(TICKERS[2:])))
    for gname, tk in groups:
        sub = [x for x in rows if x['T'] in tk]
        print(f"\n{gname}")
        for lab, f in (('low-B', lambda x: x['low']), ('all', lambda x: True), ('high (not low)', lambda x: not x['low'])):
            v = [x for x in sub if f(x)]; print(f"  {lab:16s} {stats(v)}")
            if lab == 'low-B':
                print(f"  {'  after -0.02R':16s} {stats(v, 0.02)}")
                for T in tk:
                    vt = [x for x in v if x['T'] == T]
                    if len(vt) >= 3: print(f"      {T:5s} {stats(vt)}")
    json.dump(rows, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_orb_lowgamma_replication.json'), 'w'))
    raise SystemExit
for lab, f in (('O1-low  (primary, low-B days)', lambda x: x['low']), ('O1-all  (all days)', lambda x: True), ('O1-high (not low-B)', lambda x: not x['low'])):
    v = [x for x in rows if f(x)]
    print(f"  {lab:32s} {stats(v)}")
    print(f"  {'   … after −0.02R costs':32s} {stats(v, 0.02)}")
    for y in ('2023', '2024', '2025', '2026'):
        vy = [x for x in v if x['d'].startswith(y)]
        if len(vy) >= 3: print(f"      {y}: {stats(vy)}")
json.dump(rows, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_orb_lowgamma_recent.json' if '--recent' in sys.argv else 'results_orb_lowgamma.json'), 'w'))
