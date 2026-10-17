#!/usr/bin/env python3
"""DESIGN_reactive_nodes.md engine — Skylit 1-minute replay frames (~/gex-data-replay-reader/data)."""
import json, os, sys, math, glob
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); DATA = os.path.expanduser('~/gex-data-replay-reader/data')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_reactive'); SMOKE = '--smoke' in sys.argv; ZERO = '--zero' in sys.argv
BEND, HST = '2026-02-27', '2026-03-02'
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
A, B, Cc = [], [], []
files = sorted(glob.glob(os.path.join(DATA, 'gex-replay-*.json')))
if SMOKE: files = files[:3]
for f in files:
    day = os.path.basename(f)[11:21]; j = json.load(open(f))
    for T in ['SPXW', 'SPY', 'QQQ']:
        ser = []
        for fr in j['frames']:
            x = fr.get('tickers', {}).get(T)
            if not x or not x.get('strikes'): continue
            m = emin(fr['timestamp'])
            if m < 570 or m > 959: continue
            g = {}
            for k, row in zip(x['strikes'], x['gammaValues']):
                vals = [v or 0 for v in row]
                g[float(k)] = (vals[0] if ZERO else sum(vals))
            ser.append((m, float(x['spotPrice']), g))
        if len(ser) < 300: continue
        ser.sort(key=lambda r: r[0]); idx = {r[0]: i for i, r in enumerate(ser)}
        def nodes(i):
            m, s, g = ser[i]; near = {k: v for k, v in g.items() if abs(k / s - 1) <= 0.02}
            if not near: return [], None
            kg = max(near.items(), key=lambda kv: abs(kv[1]))
            return [k for k, v in near.items() if abs(v) >= 0.3 * abs(kg[1]) and abs(kg[1]) > 0], kg[0]
        def d15(i, k):
            j0 = idx.get(ser[i][0] - 15)
            if j0 is None: return None
            a, b0 = ser[i][2].get(k), ser[j0][2].get(k)
            if a is None or not b0: return None
            return abs(a) / abs(b0) - 1
        NODES = [nodes(i) for i in range(len(ser))]
        # A — touches
        last = {}
        for i in range(15, len(ser) - 15):
            m, s, g = ser[i]; b = 0.0005 * s
            for N in NODES[i][0]:
                if abs(s - N) > b: continue
                side = None
                for t in range(i - 15, i):
                    if abs(ser[t][1] - N) >= 3 * b: side = 1 if ser[t][1] > N else -1
                if side is None: continue
                key = (N, side)
                if key in last and m - last[key] < 60: continue
                last[key] = m; dv = d15(i, N)
                brk = any(-side * (ser[t][1] - N) >= 2 * b for t in range(i + 1, min(len(ser), i + 16)))
                A.append(dict(d=day, T=T, d15=dv, brk=int(brk)))
        # B — breaks
        seen = set(); end = max(i for i, r in enumerate(ser) if r[0] <= 955)
        for i in range(1, len(ser)):
            m, s, g = ser[i]
            if m < 585 or m > 900: continue
            p = ser[i - 1][1]
            for N in NODES[i][0]:
                up, dn = p <= N < s, p >= N > s
                if not (up or dn): continue
                dr = 1 if up else -1
                if (N, dr) in seen: continue
                seen.add((N, dr))
                beyond = sorted([k for k in NODES[i][0] if dr * (k - N) > 0], key=lambda k: dr * (k - N))
                if not beyond or abs(beyond[0] - N) / N < 0.004: continue
                N2 = beyond[0]; stop = N * (1 - dr * 0.0015); tgt = N2 * (1 - dr * 0.0002); R0 = abs(s - stop)
                if R0 <= 0: continue
                out = None
                for t in range(i + 1, end + 1):
                    q = ser[t][1]
                    if dr * (q - stop) <= 0: out = dr * (stop - s) / R0; break
                    if dr * (q - tgt) >= 0: out = dr * (tgt - s) / R0; break
                if out is None: out = dr * (ser[end][1] - s) / R0
                B.append(dict(d=day, T=T, d15=d15(i, N), R=out))
        # C — king migration
        for i in range(1, len(ser) - 35):
            m = ser[i][0]
            if m < 585 or m > 900: continue
            k0, k1 = NODES[i - 1][1], NODES[i][1]
            if k1 is None or k0 is None or k1 == k0: continue
            if any(NODES[t][1] != k1 for t in range(i, i + 5)): continue
            te = i + 4; s0 = ser[te][1]; s30 = ser[min(len(ser) - 1, te + 30)][1]
            if abs(s0 - k1) < 0.0005 * s0: continue
            Cc.append(dict(d=day, T=T, toward=int(abs(s30 - k1) < abs(s0 - k1))))
    print(day, len(A), len(B), len(Cc), file=sys.stderr)
if SMOKE:
    print(json.dumps(dict(touches=len(A), breaks=len(B), migrations=len(Cc)))); sys.exit()
def mean(v): return sum(v) / len(v) if v else float('nan')
def clus(rows, key):
    by = {}
    for r in rows: by.setdefault(r['d'], []).append(r[key])
    return by
def st_mean(rows, key):
    if len(rows) < 20: return dict(n=len(rows), m=float('nan'), t=float('nan'))
    m = mean([r[key] for r in rows]); by = clus(rows, key); G = len(by)
    se = math.sqrt(sum(sum(x - m for x in v) ** 2 for v in by.values()) * G / max(1, G - 1)) / len(rows)
    return dict(n=len(rows), m=m, t=m / se if se > 0 else float('nan'))
def diff(a, b, key):
    sa, sb = st_mean(a, key), st_mean(b, key)
    if not (a and b): return dict(m=float('nan'), t=float('nan'), na=len(a), nb=len(b))
    sea = abs(sa['m'] / sa['t']) if sa['t'] and not math.isnan(sa['t']) else float('nan'); seb = abs(sb['m'] / sb['t']) if sb['t'] and not math.isnan(sb['t']) else float('nan')
    d = sa['m'] - sb['m']; se = math.sqrt(sea ** 2 + seb ** 2) if not (math.isnan(sea) or math.isnan(seb)) else float('nan')
    return dict(m=d, t=d / se if se and se > 0 else float('nan'), na=len(a), nb=len(b), a=sa['m'], b=sb['m'])
def per(rows, lo, hi): return [r for r in rows if lo <= r['d'] <= hi]
shr = lambda r: r['d15'] is not None and r['d15'] <= -0.2; grw = lambda r: r['d15'] is not None and r['d15'] >= 0.2
res = []
for name, rng in [('build', ('0', BEND)), ('holdout', (HST, '9'))]:
    a, b, c = per(A, *rng), per(B, *rng), per(Cc, *rng)
    h1 = diff([r for r in a if shr(r)], [r for r in a if grw(r)], 'brk')
    h2 = st_mean([r for r in b if shr(r)], 'R'); h3 = diff([r for r in b if shr(r)], [r for r in b if grw(r)], 'R')
    t4 = st_mean(c, 'toward'); h4 = dict(n=t4['n'], m=t4['m'] - 0.5, t=(t4['m'] - 0.5) / abs(t4['m'] / t4['t']) if t4['t'] else float('nan'), p=t4['m'])
    h5 = st_mean(b, 'R')
    pt = {T: dict(shrinkBreak=mean([r['brk'] for r in a if r['T'] == T and shr(r)]), growBreak=mean([r['brk'] for r in a if r['T'] == T and grw(r)]), shrinkR=mean([r['R'] for r in b if r['T'] == T and shr(r)])) for T in ['SPXW', 'SPY', 'QQQ']}
    res.append(dict(period=name, H1=h1, H2=h2, H3=h3, H4=h4, H5=h5, perTicker=pt, baseBreak=mean([r['brk'] for r in a])))
Phi = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
H = res[1]; ps = {k: (1 - Phi(H[k]['t']) if not math.isnan(H[k]['t']) else 1) for k in ['H1', 'H2', 'H3', 'H4', 'H5']}
o = sorted(ps.items(), key=lambda kv: kv[1]); kmax = -1
for r, (k, p) in enumerate(o):
    if p <= (r + 1) / len(o) * 0.1: kmax = r
passed = [k for k, _ in o[:kmax + 1] if H[k]['m'] > 0]
os.makedirs(OUT, exist_ok=True); fn = 'summary_0dte.md' if ZERO else 'summary.md'
f3 = lambda x: '—' if x is None or (isinstance(x, float) and math.isnan(x)) else f'{x:+.3f}'
L = [f"# Reactive Skylit nodes — results{' (0DTE column only)' if ZERO else ''}", f"\n{len(files)} sessions · SPXW/SPY/QQQ · touches {len(A)}, breaks {len(B)}, king migrations {len(Cc)}\n",
     f"**Validated (holdout, BH q = 0.10 across 5): {', '.join(passed) or 'none'}**\n", '| test | build | holdout |', '|---|---|---|']
lab = dict(H1='touch → break rate: shrinking minus growing node', H2='breaks of SHRINKING nodes: mean R', H3='shrinking-node breaks minus growing-node breaks (R)', H4='king migration: price moves toward the new king (minus 50%)', H5='all breaks (static-style baseline): mean R')
for k in ['H1', 'H2', 'H3', 'H4', 'H5']:
    cell = lambda r: f"{f3(r[k]['m'])} (t {r[k]['t']:.2f}{', ' + ' vs '.join(f3(r[k][q]) for q in ('a','b') if q in r[k]) if 'a' in r[k] else ''}{', n ' + str(r[k].get('n', r[k].get('na', ''))) })"
    L.append(f"| {lab[k]} | {cell(res[0])} | **{cell(res[1])}** |")
L.append(f"\nBase break rate at touches: build {res[0]['baseBreak']:.1%}, holdout {res[1]['baseBreak']:.1%}.\n\n## Holdout per ticker\n\n| ticker | break rate, shrinking node | break rate, growing node | mean R, shrinking-node breaks |\n|---|---|---|---|")
for T, v in res[1]['perTicker'].items(): L.append(f"| {T} | {v['shrinkBreak']:.1%} | {v['growBreak']:.1%} | {f3(v['shrinkR'])} |")
open(os.path.join(OUT, fn), 'w').write('\n'.join(L) + '\n'); print('\n'.join(L))
