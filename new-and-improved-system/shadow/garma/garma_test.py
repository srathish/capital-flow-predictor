#!/usr/bin/env python3
"""DESIGN_garma.md — H1 (GMD direction over the next hour) and H2 (IB golden-zone trade gated by GMD), front-expiration boards vs 5-expiration.
Usage: python3 garma_test.py            (build period only)
       python3 garma_test.py --holdout  (March, run once)"""
import json, os, sys, math, glob
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
HERE = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(HERE, '..', '..', '.cache')
HOLD = '--holdout' in sys.argv
SLIP = 0.02
def emin(t): d = datetime.fromtimestamp(t, tz=ZoneInfo('UTC')).astimezone(ET); return d.hour * 60 + d.minute

def vote(now, prev, key):
    """Garma vote for one index between two frames. key 3 = front (g0), 4 = 5-expiration (gA)."""
    s = now[1]; ks, g = now[2], now[key]
    win = [(k, v) for k, v in zip(ks, g) if abs(k / s - 1) <= 0.015]
    if not win: return 0
    king = max(abs(v) for _, v in win)
    if king <= 0: return 0
    pg = dict(zip(prev[2], prev[key]))
    U = sum(abs(v) - abs(pg.get(k, 0.0)) for k, v in win if k > s) / king
    D = sum(abs(v) - abs(pg.get(k, 0.0)) for k, v in win if k < s) / king
    a = 1 if U - D >= 0.10 else (-1 if D - U >= 0.10 else 0)
    def cf(row):
        sp = row[1]; w = [(k, v) for k, v in zip(row[2], row[key]) if abs(k / sp - 1) <= 0.015]
        if not w: return None, None
        kg = max(abs(v) for _, v in w)
        nodes = [(k, abs(v)) for k, v in w if kg > 0 and abs(v) >= 0.2 * kg]
        up = [x for x in nodes if x[0] > sp]; dn = [x for x in nodes if x[0] < sp]
        return (max(up, key=lambda x: x[1])[0] if up else None), (max(dn, key=lambda x: x[1])[0] if dn else None)
    c1, f1 = cf(now); c0, f0 = cf(prev)
    b = 0
    if c1 is not None and c0 is not None: b += (c1 > c0) - (c1 < c0)
    if f1 is not None and f0 is not None: b += (f1 > f0) - (f1 < f0)
    b = (b > 0) - (b < 0)
    t = a + b
    return (t > 0) - (t < 0)

def gmd(boards, m, key, only=None):
    vs = []
    for T in (only or ['SPXW', 'SPY', 'QQQ']):
        F = boards[T]; now = F.get(m); prev = F.get(m - 20)
        if not now or not prev: return None
        if key == 3 and (not now[5] or not prev[5]): return None
        vs.append(vote(now, prev, key))
    if only: return vs[0]
    up, dn = vs.count(1), vs.count(-1)
    if up >= 2 and dn == 0: return 1
    if dn >= 2 and up == 0: return -1
    return 0

def opt_rows(d, K, cp):
    f = os.path.join(C, 'uwopt_intraday', f"SPY{d[2:4]}{d[5:7]}{d[8:10]}{cp}{int(round(K * 1000)):08d}_{d}.json")
    if not os.path.exists(f): return None
    return {r['m']: r for r in json.load(open(f))}

days = sorted(os.path.basename(f)[:10] for f in glob.glob(os.path.join(C, 'garma_boards', '*.json')))
days = [d for d in days if (d.startswith('2026-03') if HOLD else ('2025-12-15' <= d <= '2026-02-27'))]
H1 = {'front': [], 'agg': [], 'spy_only': []}; H2 = {'gated_front': [], 'ungated': [], 'gated_agg': []}; freq = {'n': 0, 'on': 0}; miss = {}
for d in days:
    bf = os.path.join(C, 'uw', 'm1', 'SPY', d + '.json')
    if not os.path.exists(bf): miss['bars'] = miss.get('bars', 0) + 1; continue
    bars = {}
    for b in json.load(open(bf)):
        if b.get('m') != 'r': continue
        m = emin(b['t'])
        if 570 <= m < 960: bars[m] = b
    if len(bars) < 300: miss['shortbars'] = miss.get('shortbars', 0) + 1; continue
    raw = json.load(open(os.path.join(C, 'garma_boards', d + '.json')))
    boards = {T: {r[0]: r for r in raw[T]} for T in raw}
    close = lambda m: bars[m]['c'] if m in bars else None
    # H1
    for t in range(600, 871, 15):
        p0, p1 = close(t - 1), close(t + 59)
        if p0 is None or p1 is None: continue
        ret = (p1 / p0 - 1) * 1e4
        g = gmd(boards, t, 3); freq['n'] += 1
        if g: freq['on'] += 1; H1['front'].append((d, g * ret))
        ga = gmd(boards, t, 4)
        if ga: H1['agg'].append((d, ga * ret))
        gs = gmd(boards, t, 3, only=['SPY'])
        if gs: H1['spy_only'].append((d, gs * ret))
    # H2
    ib = [bars[m] for m in range(570, 600) if m in bars]
    if len(ib) < 25: continue
    H, L = max(b['h'] for b in ib), min(b['l'] for b in ib); R = H - L
    if R <= 0: continue
    bias = 1 if bars[599]['c'] >= (H + L) / 2 else -1
    if bias > 0: zt, zb, ent, stop, tgt = H - 0.618 * R, H - 0.786 * R, H - 0.618 * R, H - 0.886 * R, H + 0.5 * R
    else: zb, zt, ent, stop, tgt = L + 0.618 * R, L + 0.786 * R, L + 0.618 * R, L + 0.886 * R, L - 0.5 * R
    def node_near(m):
        fr = boards['SPY'].get(m)
        if not fr or not fr[5]: return False
        s = fr[1]; w = [(k, v) for k, v in zip(fr[2], fr[3]) if abs(k / s - 1) <= 0.015]
        if not w: return False
        kg = max(abs(v) for _, v in w)
        return any(abs(v) >= 0.2 * kg and zb - 0.5 <= k <= zt + 0.5 for k, v in w)
    def run(gate):
        for m in range(600, 811):
            b = bars.get(m)
            if not b or b['l'] > zt or b['h'] < zb: continue
            if not node_near(m): continue
            if gate:
                g = gmd(boards, m, 3 if gate == 'front' else 4)
                if g != bias: continue
            fill = min(ent, b['o']) if bias > 0 else max(ent, b['o'])
            K = round(fill); cp = 'C' if bias > 0 else 'P'; O = opt_rows(d, K, cp)
            if not O: miss['opt'] = miss.get('opt', 0) + 1; return None
            oe = next((O[x] for x in range(m, m + 3) if x in O), None)
            if not oe: miss['optprint'] = miss.get('optprint', 0) + 1; return None
            exit_m, how = None, None
            for mm in range(m, 956):
                bb = bars.get(mm)
                if not bb: continue
                if (bb['l'] <= stop) if bias > 0 else (bb['h'] >= stop): exit_m, how = mm, 'stop'; break
                if mm > m and ((bb['h'] >= tgt) if bias > 0 else (bb['l'] <= tgt)): exit_m, how = mm, 'target'; break
            if exit_m is None: exit_m, how = max(x for x in bars if x <= 955), 'close'
            ox = next((O[x] for x in range(exit_m, exit_m - 6, -1) if x in O), None)
            if not ox: return None
            under = (({'stop': stop, 'target': tgt}.get(how) or bars[exit_m]['c']) - fill) * bias / (abs(fill - stop) or 1)
            return {'d': d, 'm': m, 'bias': bias, 'how': how, 'r': (ox['c'] - SLIP) / (oe['c'] + SLIP) - 1, 'R': under}
        return None
    for name, gate in (('gated_front', 'front'), ('ungated', None), ('gated_agg', 'agg')):
        t = run(gate)
        if t: H2[name].append(t)

def clustered(rows):
    by = {}
    for d, v in rows: by.setdefault(d, []).append(v)
    dm = [sum(v) / len(v) for v in by.values()]; n = len(dm)
    if n < 3: return n, float('nan'), float('nan')
    mu = sum(dm) / n; sd = math.sqrt(sum((x - mu) ** 2 for x in dm) / (n - 1))
    return n, mu, (mu / sd * math.sqrt(n) if sd else float('nan'))
print(f"{'HOLDOUT (March)' if HOLD else 'BUILD (Dec 15 – Feb 27)'}: {len(days)} days | skipped {miss} | front-board 2-of-3 agreement at {freq['on']}/{freq['n']} checks ({freq['on'] / max(1, freq['n']) * 100:.0f}%)\n")
print('H1  direction over the next 60 minutes (signed SPY bps; t clustered by day)')
for k, lab in (('front', 'GMD, front (0DTE) boards, 2 of 3'), ('agg', 'GMD, 5-expiration boards, 2 of 3'), ('spy_only', 'SPY front board alone')):
    rows = H1[k]; n, mu, t = clustered(rows); hit = sum(1 for _, v in rows if v > 0) / max(1, len(rows))
    print(f"  {lab:36s} calls {len(rows):4d} on {n:2d} days | mean {mu:+6.1f} bps | t {t:5.2f} | right {hit * 100:4.1f}%")
print('\nH2  IB golden-zone trade, SPY 0DTE ATM option (after $0.02/side), one per day')
for k, lab in (('gated_front', 'gated by GMD (front boards)'), ('ungated', 'no gate'), ('gated_agg', 'gated by GMD (5-expiration)')):
    rows = H2[k]; n, mu, t = clustered([(x['d'], x['r']) for x in rows]); nR, muR, tR = clustered([(x['d'], x['R']) for x in rows])
    hows = {}
    for x in rows: hows[x['how']] = hows.get(x['how'], 0) + 1
    print(f"  {lab:30s} trades {len(rows):3d} | option mean {mu * 100 if rows else float('nan'):+6.1f}% t {t:5.2f} | win {sum(1 for x in rows if x['r'] > 0) / max(1, len(rows)) * 100:4.0f}% | underlying {muR:+.2f}R | exits {hows}")
json.dump({'H1': H1, 'H2': H2}, open(os.path.join(HERE, 'results_holdout.json' if HOLD else 'results_build.json'), 'w'))
