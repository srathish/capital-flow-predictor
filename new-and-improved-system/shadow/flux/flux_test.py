#!/usr/bin/env python3
"""DESIGN_flux.md — Flux Field outer/extreme band fades and level-reclaim trend, vs scaled-band twins and a plain running-mean line.
python3 flux_test.py [--holdout]"""
import json, os, sys, math
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); HERE = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(HERE, '..', '..', '.cache', 'flux')
HOLD = '--holdout' in sys.argv
def et(t):
    d = datetime.fromtimestamp(t if t < 1e12 else t / 1000, tz=ZoneInfo('UTC')).astimezone(ET); return d.strftime('%Y-%m-%d'), d.hour * 60 + d.minute

def sessions(T):
    S = {}
    for p in json.load(open(os.path.join(C, f'{T}.json'))):
        d, m = et(p['time'])
        if 570 <= m < 960: S.setdefault(d, {})[m] = p
    return S

def band(p, k, side, scale=1.0):
    return p['level'] + scale * (p[k]['upper' if side > 0 else 'lower'] - p['level'])

def walk(P, ms, i0, side, entry, stop, tgt):
    """side = trade direction (+1 long). Close-basis exits; returns R."""
    risk = abs(entry - stop)
    if risk <= 0: return None
    for m in ms[i0:]:
        c = P[m]['price']
        if m >= 955: return side * (c - entry) / risk
        if (c <= stop) if side > 0 else (c >= stop): return side * (c - entry) / risk
        if (c >= tgt) if side > 0 else (c <= tgt): return side * (c - entry) / risk
    return side * (P[ms[-1]]['price'] - entry) / risk

def fade(P, ms, inner_k, outer_k, scale, gap_stop):
    out = []
    for side_px in (1, -1):  # side_px = which band was breached (+1 upper)
        for i, m in enumerate(ms):
            if m < 600 or m > 900 or i + 1 >= len(ms): continue
            p = P[m]; b = band(p, inner_k, side_px, scale)
            if p[inner_k]['upper'] == p[inner_k]['lower']: continue
            if (p['price'] > b) if side_px > 0 else (p['price'] < b):
                e = P[ms[i + 1]]['price']; side = -side_px
                if gap_stop:  # F2: stop = extreme + (extreme - outer), target = outer
                    ext, outb = band(p, 'extreme', side_px, scale), band(p, 'outer', side_px, scale); stop = ext + (ext - outb); tgt = outb
                else:  # F1: stop = extreme +0.02%, target = level
                    stop = band(p, 'extreme', side_px, scale) * (1 + side_px * 0.0002); tgt = p['level']
                r = walk(P, ms, i + 1, side, e, stop, tgt)
                if r is not None: out.append(r)
                break
    return out

def reclaim(P, ms, plain):
    out = []; run = []; cum = 0.0
    lvl = {}
    for i, m in enumerate(ms):
        cum += P[m]['price']; lvl[m] = cum / (i + 1) if plain else P[m]['level']
    for side in (1, -1):
        for i, m in enumerate(ms):
            if m < 630 or m > 900 or i < 16 or i + 1 >= len(ms): continue
            c, L = P[m]['price'], lvl[m]
            prior = [P[ms[j]]['price'] - lvl[ms[j]] for j in range(i - 15, i)]
            crossed = (c > L and all(x < 0 for x in prior)) if side > 0 else (c < L and all(x > 0 for x in prior))
            if not crossed: continue
            p = P[m]
            if p['inner']['upper'] == p['inner']['lower']: break
            e = P[ms[i + 1]]['price']; half_in = (p['inner']['upper'] - p['level']); half_out = (p['outer']['upper'] - p['level'])
            stop = L - side * half_in; tgt = L + side * half_out
            r = walk(P, ms, i + 1, side, e, stop, tgt)
            if r is not None: out.append(r)
            break
    return out

def clustered(rows):
    by = {}
    for d, v in rows: by.setdefault(d, []).append(v)
    dm = [sum(v) / len(v) for v in by.values()]; n = len(dm)
    if n < 3: return n, float('nan'), float('nan')
    mu = sum(dm) / n; sd = math.sqrt(sum((x - mu) ** 2 for x in dm) / (n - 1))
    return n, mu, mu / sd * math.sqrt(n) if sd else float('nan')

def pullback(P, ms, mode):
    out = []; cum = 0.0; lvl = {}
    for i, m in enumerate(ms):
        cum += P[m]['price']; p = P[m]; half = p['inner']['upper'] - p['level']
        lvl[m] = cum / (i + 1) if mode == 'plain' else p['level'] + (0.5 * half if mode == 'up' else -0.5 * half if mode == 'dn' else 0)
    i = 30; n = 0
    while i < len(ms) - 1 and n < 3:
        m = ms[i]
        if m < 615 or m > 900: i += 1; continue
        p = P[m]; c, L = p['price'], lvl[m]
        if p['inner']['upper'] == p['inner']['lower']: i += 1; continue
        prior = [P[ms[j]]['price'] - lvl[ms[j]] for j in range(i - 30, i)]
        side = 1 if all(x > 0 for x in prior) else -1 if all(x < 0 for x in prior) else 0
        if side and abs(c / L - 1) <= 0.0003:
            e = P[ms[i + 1]]['price']; half_in = p['inner']['upper'] - p['level']; half_out = p['outer']['upper'] - p['level']
            stop = L - side * half_in; tgt = L + side * half_out
            r = walk(P, ms, i + 1, side, e, stop, tgt)
            if r is not None:
                out.append(r); n += 1
                # skip to after the exit (approx: advance until stop/target/close reached)
                j = i + 1
                while j < len(ms):
                    cc = P[ms[j]]['price']
                    if ms[j] >= 955 or ((cc <= stop or cc >= tgt) if side > 0 else (cc >= stop or cc <= tgt)): break
                    j += 1
                i = j + 1; continue
        i += 1
    return out

res = {k: [] for k in ['F1', 'F1_x0.75', 'F1_x1.25', 'F2', 'F2_x0.75', 'F2_x1.25', 'F3', 'F3_plain', 'F4', 'F4_plain', 'F4_shift']}
ndays = 0
for T in ['SPY', 'QQQ']:
    S = sessions(T)
    for d, P in sorted(S.items()):
        if (d < '2026-07-01') == HOLD or len(P) < 300: continue
        ndays += 1; ms = sorted(P)
        for s, tag in ((1.0, ''), (0.75, '_x0.75'), (1.25, '_x1.25')):
            for r in fade(P, ms, 'outer', 'extreme', s, False): res['F1' + tag].append((d, r))
            for r in fade(P, ms, 'extreme', 'extreme', s, True): res['F2' + tag].append((d, r))
        for r in reclaim(P, ms, False): res['F3'].append((d, r))
        for r in reclaim(P, ms, True): res['F3_plain'].append((d, r))
        for r in pullback(P, ms, 'flux'): res['F4'].append((d, r))
        for r in pullback(P, ms, 'plain'): res['F4_plain'].append((d, r))
        for md in ('up', 'dn'):
            for r in pullback(P, ms, md): res['F4_shift'].append((d, r))
print(f"{'HOLDOUT Jul 1 – Nov 5 2026' if HOLD else 'BUILD Nov 7 2025 – Jun 30 2026'}: {ndays} ticker-days (SPY+QQQ); R per trade, close-basis exits\n")
for k, v in res.items():
    n, mu, t = clustered(v); win = sum(1 for _, r in v if r > 0) / max(1, len(v))
    print(f"  {k:10s} trades {len(v):4d} | mean {mu:+.3f}R | t {t:5.2f} | win {win * 100:4.1f}%")
json.dump(res, open(os.path.join(HERE, 'results_holdout.json' if HOLD else 'results_build.json'), 'w'))
