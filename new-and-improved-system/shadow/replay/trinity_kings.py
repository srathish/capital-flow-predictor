#!/usr/bin/env python3
"""Per-minute king and spot for SPXW, SPY, QQQ from the Skylit Trinity replay frames (gamma summed over the 5 expirations,
king = largest |gamma| strike within ±2% of spot, same definition as build_skylit_replay.py). Usage: trinity_kings.py [glob] [out]"""
import json, os, glob, sys
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); DATA = os.path.expanduser('~/gex-data-replay-reader/data')
PAT = sys.argv[1] if len(sys.argv) > 1 else '2026-03-*'; OUT = sys.argv[2] if len(sys.argv) > 2 else 'trinity_kings_2026-03.json'
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
res = {}
for f in sorted(glob.glob(os.path.join(DATA, f'gex-replay-{PAT}.json'))):
    day = os.path.basename(f)[11:21]; j = json.load(open(f)); res[day] = {}
    for T in ['SPXW', 'SPY', 'QQQ']:
        rows = []
        for fr in j['frames']:
            x = fr.get('tickers', {}).get(T)
            if not x or not x.get('strikes'): continue
            m = emin(fr['timestamp'])
            if not 570 <= m <= 959: continue
            s = float(x['spotPrice']); g = {float(k): sum(v or 0 for v in row) for k, row in zip(x['strikes'], x['gammaValues'])}
            near = {k: v for k, v in g.items() if abs(k / s - 1) <= 0.02}
            if near: k = max(near.items(), key=lambda kv: abs(kv[1]))[0]; rows.append([m, round(s, 2), k])
        rows.sort(); res[day][T] = rows
    print(day, {T: len(v) for T, v in res[day].items()})
json.dump(res, open(OUT, 'w'), separators=(',', ':'))
