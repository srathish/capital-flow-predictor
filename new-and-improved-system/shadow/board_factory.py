#!/usr/bin/env python3
"""DESIGN_board_factory.md engine."""
import json, os, glob, math, sys
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); DATA = os.path.expanduser('~/gex-data-replay-reader/data'); OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_board')
BEND, HST = '2026-02-27', '2026-03-02'; SMOKE = '--smoke' in sys.argv
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
rows = []
files = sorted(glob.glob(os.path.join(DATA, 'gex-replay-*.json')))
if SMOKE: files = files[:4]
for f in files:
    day = os.path.basename(f)[11:21]; j = json.load(open(f))
    for T in ['SPXW', 'SPY', 'QQQ']:
        ser = {}
        for fr in j['frames']:
            x = fr.get('tickers', {}).get(T)
            if not x or not x.get('strikes'): continue
            m = emin(fr['timestamp'])
            if 570 <= m <= 959:
                g = {}; g0 = {}; va = {}
                for k, gr, vr in zip(x['strikes'], x['gammaValues'], x['vannaValues']):
                    gs = [v or 0 for v in gr]; vs = [v or 0 for v in vr]; k = float(k); g[k] = sum(gs); g0[k] = gs[0]; va[k] = sum(vs)
                ser[m] = (float(x['spotPrice']), g, g0, va)
        if len(ser) < 300: continue
        mins = sorted(ser); first = ser[mins[0]][0]
        def at(m):
            c = [q for q in mins if q <= m]
            return ser[c[-1]] if c else None
        for snap in range(600, 901, 15):
            S = at(snap); P30 = at(snap - 30)
            if not S or not P30: continue
            s, g, g0, va = S
            def tilt(d, w):
                ab = sum(abs(v) for k, v in d.items() if s < k <= s * (1 + w)); be = sum(abs(v) for k, v in d.items() if s * (1 - w) <= k < s); tot = ab + be
                return (ab - be) / tot if tot else None
            def tilt_signed(d, w):
                ab = sum(v for k, v in d.items() if s < k <= s * (1 + w)); be = sum(v for k, v in d.items() if s * (1 - w) <= k < s); tot = sum(abs(v) for k, v in d.items() if abs(k / s - 1) <= w)
                return (ab - be) / tot if tot else None
            ps, pg = P30[0], P30[1]
            f1 = tilt(g, 0.01)
            f1p = (lambda: (lambda ab, be: (ab - be) / (ab + be) if ab + be else None)(sum(abs(v) for k, v in pg.items() if ps < k <= ps * 1.01), sum(abs(v) for k, v in pg.items() if ps * 0.99 <= k < ps)))()
            near = {k: v for k, v in g.items() if abs(k / s - 1) <= 0.02}
            if not near: continue
            kk, kv = max(near.items(), key=lambda kv: abs(kv[1]))
            f4 = (abs(kv) / abs(pg[kk]) - 1) if pg.get(kk) else None
            n0 = {k: v for k, v in g0.items() if abs(k / s - 1) <= 0.005}; f5 = (sum(n0.values()) / sum(abs(v) for v in n0.values())) if n0 and sum(abs(v) for v in n0.values()) else None
            vel = sum((abs(v) - abs(pg.get(k, 0))) * (1 if k > s else -1) for k, v in g.items() if abs(k / s - 1) <= 0.01 and k != s); tot = sum(abs(v) for k, v in g.items() if abs(k / s - 1) <= 0.01)
            big = [k for k, v in near.items() if abs(v) >= 0.3 * abs(kv)]; ab = [k for k in big if k > s]; be = [k for k in big if k < s]
            f8 = (s - max(be)) / (min(ab) - max(be)) if ab and be else None
            o30 = at(min(959, snap + 30)); o60 = at(min(959, snap + 60))
            r30 = math.log(o30[0] / s); r60 = math.log(o60[0] / s)
            rows.append(dict(d=day, T=T, snap=snap, F1=f1, F2=(f1 - f1p) if f1 is not None and f1p is not None else None, F3=(kk - s) / s, F4=f4, F5=f5, F6=tilt_signed(va, 0.01), F7=vel / tot if tot else None, F8=f8, F9=math.log(s / first), r30=r30, r60=r60, a30=abs(r30)))
    print(day, len(rows), file=sys.stderr)
if SMOKE: print(json.dumps(dict(rows=len(rows), sample=rows[:2]))); sys.exit()
os.makedirs(OUT, exist_ok=True); json.dump(rows, open(os.path.join(OUT, 'snapshots.json'), 'w'))
def ranks(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
    for pos, i in enumerate(o): r[i] = pos / (len(v) - 1) - 0.5
    return r
def ic(sub, F, Y):
    a = [r for r in sub if r[F] is not None and r[Y] is not None]
    if len(a) < 100: return dict(n=len(a), ic=float('nan'), t=float('nan'))
    rf, ry = ranks([r[F] for r in a]), ranks([r[Y] for r in a]); prod = [x * y for x, y in zip(rf, ry)]
    by = {}
    for r, p in zip(a, prod): by.setdefault(r['d'], []).append(p)
    dm = [sum(v) / len(v) for v in by.values()]; m = sum(dm) / len(dm); sd = math.sqrt(sum((x - m) ** 2 for x in dm) / (len(dm) - 1))
    return dict(n=len(a), ic=12 * sum(prod) / len(prod), t=m / (sd / math.sqrt(len(dm))) if sd else float('nan'))
B = [r for r in rows if r['d'] <= BEND]; H = [r for r in rows if r['d'] >= HST]
tests = [(F, Y) for F in ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'] for Y in ['r30', 'r60']] + [('F5', 'a30')]
res = []
for F, Y in tests:
    b, h = ic(B, F, Y), ic(H, F, Y); sgn = 1 if b['ic'] >= 0 else -1
    tt = sgn * h['t'] if not math.isnan(h['t']) else float('nan'); p = 0.5 * math.erfc(tt / math.sqrt(2)) if not math.isnan(tt) else 1
    res.append(dict(F=F, Y=Y, b=b, h=h, p=p, same=(h['ic'] * b['ic'] > 0)))
o = sorted(range(len(res)), key=lambda i: res[i]['p']); kmax = -1
for r, i in enumerate(o):
    if res[i]['p'] <= (r + 1) / len(res) * 0.1: kmax = r
pas = {o[r] for r in range(kmax + 1)}
for i, r in enumerate(res): r['ok'] = i in pas and r['same'] and abs(r['h']['t']) >= 2
lab = dict(F1='gamma tilt ±1% (more gamma above = +)', F2='change in gamma tilt, last 30m', F3='king above (+) / below (−) price, distance', F4='king growing, last 30m', F5='0DTE net gamma near price (+ = long gamma)', F6='vanna tilt ±1%', F7='nodes growing above vs below (velocity tilt)', F8='position inside the gap between nodes (0 = at lower node)', F9='day trend so far (benchmark)')
L = ['# Intraday board factory — results', f"\n{len(set(r['d'] for r in rows))} sessions · {len(rows)} snapshots (every 15 min, 10:00–15:00) · SPXW/SPY/QQQ pooled\n", f"**Validated (holdout |t| ≥ 2, same sign as build, BH q = 0.10 across 19): {', '.join(r['F'] + '→' + r['Y'] for r in res if r['ok']) or 'none'}**\n",
     '| feature | outcome | build IC (t) | holdout IC (t) | same sign |', '|---|---|---|---|---|']
for r in res: L.append(f"| {r['F']} {lab[r['F']]} | {r['Y']} | {r['b']['ic']:+.3f} ({r['b']['t']:.2f}) | **{r['h']['ic']:+.3f} ({r['h']['t']:.2f})** | {'yes' if r['same'] else 'no'} |")
L.append('\nIC = rank correlation between the feature and the next 30/60-minute return (or move size for a30); t from day-clustered means.')
open(os.path.join(OUT, 'summary.md'), 'w').write('\n'.join(L) + '\n'); print('\n'.join(L))
