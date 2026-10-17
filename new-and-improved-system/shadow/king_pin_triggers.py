#!/usr/bin/env python3
"""DESIGN_king_pin_fly.md: find triggers in the Skylit frames → results_kingfly/triggers.json"""
import json, os, glob
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); DATA = os.path.expanduser('~/gex-data-replay-reader/data'); OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_kingfly')
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
trig = []
for f in sorted(glob.glob(os.path.join(DATA, 'gex-replay-*.json'))):
    day = os.path.basename(f)[11:21]; j = json.load(open(f))
    for T in ['SPY', 'QQQ']:
        ser = []
        for fr in j['frames']:
            x = fr.get('tickers', {}).get(T)
            if not x or not x.get('strikes'): continue
            m = emin(fr['timestamp'])
            if not 570 <= m <= 959: continue
            s = float(x['spotPrice']); near = {float(k): sum(v or 0 for v in row) for k, row in zip(x['strikes'], x['gammaValues']) if abs(float(k) / s - 1) <= 0.02}
            if not near: continue
            kk, kv = max(near.items(), key=lambda kv: abs(kv[1])); ser.append((m, s, kk, kv))
        if len(ser) < 300: continue
        for i, (m, s, kk, kv) in enumerate(ser):
            if m < 660 or m > 870: continue
            prev = [r for r in ser if m - 15 <= r[0] < m]
            if len(prev) < 12 or any(r[2] != kk for r in prev): continue
            if kv > 0 and abs(s - kk) <= 0.5:
                trig.append(dict(d=day, T=T, m=m, king=kk, spot=round(s, 2), ctrl=kk + 2 if s < kk else kk - 2)); break
os.makedirs(OUT, exist_ok=True); json.dump(trig, open(os.path.join(OUT, 'triggers.json'), 'w'), indent=0)
print('triggers', len(trig), 'build', sum(1 for t in trig if t['d'] <= '2026-02-27'), 'holdout', sum(1 for t in trig if t['d'] >= '2026-03-02'))
