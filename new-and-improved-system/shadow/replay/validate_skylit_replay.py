#!/usr/bin/env python3
"""Validates skylit_replay_data.json (+ raw Skylit frames) per session → validation.json and VALIDATION.md."""
import json, os, statistics as stt
from datetime import datetime
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.expanduser('~/gex-data-replay-reader/data'); ET = ZoneInfo('America/New_York')
import sys
SRC = sys.argv[1] if len(sys.argv) > 1 else 'skylit_replay_data.json'
D = json.load(open(os.path.join(HERE, SRC)))
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
rep = []
for s in D['sessions']:
    d, T = s['d'], s['T']; j = json.load(open(os.path.join(DATA, f'gex-replay-{d}.json')))
    spot = {}
    for fr in j['frames']:
        x = fr.get('tickers', {}).get(T)
        if x and x.get('spotPrice'): spot[emin(fr['timestamp'])] = float(x['spotPrice'])
    bars = {b[0]: b for b in s['bars']}
    # 1 spot vs candle: Skylit spot at minute m vs UW candle close at m-1 and m (frame timing)
    diffs = {lag: [abs(spot[m] - bars[m - lag][4]) / spot[m] * 1e4 for m in spot if (m - lag) in bars] for lag in (0, 1)}
    best = min(diffs, key=lambda k: stt.median(diffs[k]) if diffs[k] else 9e9); med = stt.median(diffs[best]) if diffs[best] else None; p95 = sorted(diffs[best])[int(0.95 * (len(diffs[best]) - 1))] if diffs[best] else None
    inside = sum(1 for m in spot if m in bars and bars[m][3] - 0.02 <= spot[m] <= bars[m][2] + 0.02) / max(1, sum(1 for m in spot if m in bars))
    # 2 coverage
    mins = set(range(570, 960)); miss_sky = len([m for m in mins if m not in spot]); miss_bar = len([m for m in mins if m not in bars])
    # 3 map sanity
    kd = [abs(x[1] / spot[x[0]] - 1) * 100 for x in s['maps'] if x[1] and x[0] in spot]; nn = [len([n for n in x[2] if abs(n[1]) >= 0.3]) for x in s['maps']]
    # 4/5 trades
    tr = []
    for x in s['breaks']:
        o = x.get('opt'); issues = []
        # recheck on UW candles from the entry minute: which of stop / target is touched first
        res = None
        for m in range(x['m'], 956):
            b = bars.get(m)
            if not b: continue
            hit_s = (b[3] <= x['stop']) if x['dir'] > 0 else (b[2] >= x['stop']); hit_t = (b[2] >= x['target']) if x['dir'] > 0 else (b[3] <= x['target'])
            if hit_s and hit_t: res = ('both', m); break
            if hit_s: res = ('stop', m); break
            if hit_t: res = ('target', m); break
        res = res or ('close', 955)
        if res[0] != x['how'] and not (res[0] == 'both' and x['how'] == 'stop'): issues.append(f"engine (Skylit spot) says {x['how']} {x['exitM']//60:02d}:{x['exitM']%60:02d}; UW candles say {res[0]} {res[1]//60:02d}:{res[1]%60:02d}")
        if o:
            ent = x['entry']; intrinsic = max(0, (ent - o['strike']) if o['type'] == 'call' else (o['strike'] - ent))
            if o['entryPx'] < intrinsic - 0.05: issues.append(f"option entry ${o['entryPx']} below intrinsic ${intrinsic:.2f}")
            if o['entryPx'] > 0.012 * ent: issues.append(f"option entry ${o['entryPx']} unusually high for ATM 0DTE")
            if abs(o['strike'] - ent) > 1: issues.append('strike more than $1 from price')
        else: issues.append('no option prices')
        tr.append(dict(m=x['m'], issues=issues))
    flags = []
    if med is None or med > 3 or (p95 or 0) > 8: flags.append(f'Skylit price vs UW candles off by {med} bp median / {p95} bp 95th')
    if miss_sky > 20: flags.append(f'{miss_sky} Skylit minutes missing')
    if miss_bar > 5: flags.append(f'{miss_bar} UW candle minutes missing')
    if kd and stt.median(kd) > 1.5: flags.append(f'king typically {stt.median(kd):.1f}% from price')
    nt = sum(1 for t in tr if t['issues'])
    status = 'ok' if not flags and nt == 0 else ('check' if not flags else 'issue')
    rep.append(dict(d=d, T=T, status=status, lagMin=best, medBp=round(med, 2) if med is not None else None, p95Bp=round(p95, 2) if p95 is not None else None, inside=round(inside, 3), missSky=miss_sky, missBar=miss_bar, kingDistMed=round(stt.median(kd), 2) if kd else None, nodesMed=stt.median(nn) if nn else 0, trades=len(tr), tradeIssues=[dict(m=t['m'], issues=t['issues']) for t in tr if t['issues']], flags=flags))
json.dump(rep, open(os.path.join(HERE, 'validation.json'), 'w'), indent=1)
L = ['# Skylit replay — data validation (March 2026)', '', '| date | ticker | status | Skylit vs UW price (median / 95th, bp) | Skylit price inside UW candle | missing minutes (Skylit / UW) | king distance (median) | trades | trade notes |', '|---|---|---|---|---|---|---|---|---|']
for r in rep: L.append(f"| {r['d']} | {r['T']} | {r['status']} | {r['medBp']} / {r['p95Bp']} (frame = candle {'+1' if r['lagMin'] else '0'} min) | {r['inside']:.0%} | {r['missSky']} / {r['missBar']} | {r['kingDistMed']}% | {r['trades']} | {'; '.join(f'{t[chr(109)]//60:02d}:{t[chr(109)]%60:02d} ' + ', '.join(t['issues']) for t in r['tradeIssues']) or '—'} |")
open(os.path.join(HERE, 'VALIDATION.md'), 'w').write('\n'.join(L) + '\n'); print('\n'.join(L))
