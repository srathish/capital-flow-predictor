#!/usr/bin/env python3
"""Per-minute Skylit boards for SPXW/SPY/QQQ from the replay archive, two versions per frame:
 g0  = front (0DTE) expiration column only   (what Garma / the KBs say to use for 0DTE)
 gA  = sum of the 5 listed expirations       (what all our earlier tests used)
Strikes within ±3% of spot. Output: .cache/garma_boards/<day>.json  {T: [[m, spot, [strikes], [g0], [gA]], ...]}"""
import json, os, glob, sys
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); DATA = os.path.expanduser('~/gex-data-replay-reader/data')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.cache', 'garma_boards'); os.makedirs(OUT, exist_ok=True)
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
n = 0
for f in sorted(glob.glob(os.path.join(DATA, 'gex-replay-*.json'))):
    day = os.path.basename(f)[11:21]; o = os.path.join(OUT, day + '.json')
    if os.path.exists(o): continue
    try: j = json.load(open(f))
    except Exception as e: print(day, 'unreadable', e); continue
    res = {}
    for T in ['SPXW', 'SPY', 'QQQ']:
        rows = []
        for fr in j.get('frames', []):
            x = (fr.get('tickers') or {}).get(T)
            if not x or not x.get('strikes'): continue
            m = emin(fr['timestamp'])
            if not 570 <= m <= 960: continue
            s = float(x['spotPrice']); exps = x.get('expirations') or []
            front0 = 1 if exps and exps[0] == day else 0
            ks, g0, gA = [], [], []
            for k, row in zip(x['strikes'], x['gammaValues']):
                if abs(float(k) / s - 1) > 0.03: continue
                row = [v or 0 for v in row]
                ks.append(float(k)); g0.append(round(row[0] if front0 else 0.0, 1)); gA.append(round(sum(row), 1))
            rows.append([m, round(s, 3), ks, g0, gA, front0])
        rows.sort(key=lambda r: r[0]); res[T] = rows
    if all(len(v) >= 300 for v in res.values()):
        json.dump(res, open(o, 'w'), separators=(',', ':')); n += 1; print(day, {T: len(v) for T, v in res.items()}, 'front=0DTE' if res['SPY'][0][5] else 'NO 0DTE column')
    else: print(day, 'skipped (short)', {T: len(v) for T, v in res.items()})
print('written', n)
