#!/usr/bin/env python3
"""Skylit 1-minute replay data (March 2026): per-minute Skylit aggregate gamma map (SPY, QQQ), UW candles, and the
reactive engine's events (DESIGN_reactive_nodes.md definitions): touches, breaks, king migrations."""
import json, os, glob
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); DATA = os.path.expanduser('~/gex-data-replay-reader/data'); HERE = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(HERE, '..', '..', '.cache')
def emin(ts): d = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET); return d.hour * 60 + d.minute
def sig3(x): return float(f'{x:.3g}')
out = []
for f in sorted(glob.glob(os.path.join(DATA, 'gex-replay-2026-03-*.json'))):
    day = os.path.basename(f)[11:21]; j = json.load(open(f))
    for T in ['SPY', 'QQQ']:
        mf = os.path.join(C, 'uw', 'm1', T, day + '.json')
        if not os.path.exists(mf): continue
        bars = []
        for b in json.load(open(mf)):
            if b.get('m') != 'r': continue
            m = emin(datetime.utcfromtimestamp(b['t']).isoformat() + 'Z')
            if 570 <= m < 960: bars.append([m, b['o'], b['h'], b['l'], b['c']])
        bars.sort()
        ser = []
        for fr in j['frames']:
            x = fr.get('tickers', {}).get(T)
            if not x or not x.get('strikes'): continue
            m = emin(fr['timestamp'])
            if 570 <= m <= 959: ser.append((m, float(x['spotPrice']), {float(k): sum(v or 0 for v in row) for k, row in zip(x['strikes'], x['gammaValues'])}))
        if len(ser) < 300 or len(bars) < 300: continue
        ser.sort(key=lambda r: r[0]); idx = {r[0]: i for i, r in enumerate(ser)}; BAR = {r[0]: r for r in bars}
        maps, kings, NOD = [], [], []
        for i, (m, s, g) in enumerate(ser):
            near = {k: v for k, v in g.items() if abs(k / s - 1) <= 0.02}
            if not near: maps.append([m, None, []]); kings.append(None); NOD.append([]); continue
            kk, kv = max(near.items(), key=lambda kv: abs(kv[1])); j0 = idx.get(m - 15)
            nodes = []
            for k, v in near.items():
                rel = v / abs(kv) if kv else 0
                if abs(rel) < 0.12: continue
                d15 = None
                if j0 is not None:
                    b0 = ser[j0][2].get(k)
                    if b0: d15 = round((abs(v) / abs(b0) - 1) * 100)
                nodes.append([k, round(rel, 3), d15])
            maps.append([m, kk, nodes]); kings.append(kk); NOD.append([n[0] for n in nodes if abs(n[1]) >= 0.3])
        d15f = lambda i, k: next((n[2] for n in maps[i][2] if n[0] == k), None)
        touches, brks, migs = [], [], []
        last = {}
        for i in range(15, len(ser) - 15):
            m, s, _ = ser[i]; b = 0.0005 * s
            for N in NOD[i]:
                if abs(s - N) > b: continue
                side = None
                for t in range(i - 15, i):
                    if abs(ser[t][1] - N) >= 3 * b: side = 1 if ser[t][1] > N else -1
                if side is None or ((N, side) in last and m - last[(N, side)] < 60): continue
                last[(N, side)] = m
                brk = any(-side * (ser[t][1] - N) >= 2 * b for t in range(i + 1, min(len(ser), i + 16)))
                touches.append(dict(m=m, level=N, side=side, d15=d15f(i, N), broke=int(brk)))
        seen = set(); end = max(i for i, r in enumerate(ser) if r[0] <= 955)
        for i in range(1, len(ser)):
            m, s, _ = ser[i]
            if m < 585 or m > 900: continue
            p = ser[i - 1][1]
            for N in NOD[i]:
                up, dn = p <= N < s, p >= N > s
                if not (up or dn): continue
                dr = 1 if up else -1
                if (N, dr) in seen: continue
                seen.add((N, dr)); beyond = sorted([k for k in NOD[i] if dr * (k - N) > 0], key=lambda k: dr * (k - N))
                if not beyond or abs(beyond[0] - N) / N < 0.004: continue
                N2 = beyond[0]; stop = N * (1 - dr * 0.0015); tgt = N2 * (1 - dr * 0.0002); R0 = abs(s - stop); res = None
                # outcome scored on UW 1-minute candles (highs/lows; stop first if both in one candle). Skylit frame m ≈ candle m-1 close,
                # so the trade is live from candle m onward (validation 2026-10-17: Skylit 1/min spot missed intrabar stops)
                if R0 <= 0: continue
                for bm in range(m, 956):
                    bb = BAR.get(bm)
                    if not bb: continue
                    if (bb[3] <= stop) if dr > 0 else (bb[2] >= stop): res = (bm, stop, 'stop'); break
                    if (bb[2] >= tgt) if dr > 0 else (bb[3] <= tgt): res = (bm, tgt, 'target'); break
                if res is None: lastb = max(k for k in BAR if k <= 955); res = (lastb, BAR[lastb][4], 'close')
                g0n, g0t = abs(ser[i][2].get(N, 0)) or None, abs(ser[i][2].get(N2, 0)) or None
                path = []
                for t in range(i + 1, len(ser)):
                    mt, st_, gt = ser[t]
                    if mt > 955: break
                    path.append([mt, round(abs(gt.get(N2, 0)) / g0t, 3) if g0t else None, round(abs(gt.get(N, 0)) / g0n, 3) if g0n else None, round(st_, 2)])
                brks.append(dict(path=path, m=m, dir=dr, level=N, next=N2, entry=round(s, 2), stop=round(stop, 2), target=round(tgt, 2), exitM=res[0], exit=round(res[1], 2), how=res[2], R=round(dr * (res[1] - s) / R0, 2), d15=d15f(i, N)))
        for i in range(1, len(ser) - 35):
            m = ser[i][0]; k0, k1 = kings[i - 1], kings[i]
            if m < 585 or m > 900 or k1 is None or k0 is None or k1 == k0 or any(kings[t] != k1 for t in range(i, i + 5)): continue
            te = i + 4; s0 = ser[te][1]; s30 = ser[min(len(ser) - 1, te + 30)][1]
            if abs(s0 - k1) < 0.0005 * s0: continue
            migs.append(dict(m=ser[te][0], frm=k0, to=k1, toward=int(abs(s30 - k1) < abs(s0 - k1))))
        out.append(dict(d=day, T=T, bars=[[r[0], round(r[1], 2), round(r[2], 2), round(r[3], 2), round(r[4], 2)] for r in bars], maps=maps, touches=touches, breaks=brks, migrations=migs))
        print(day, T, 'touches', len(touches), 'breaks', len(brks), 'migrations', len(migs))
json.dump(dict(built=datetime.now().isoformat(), source='Skylit Trinity 1-minute replay frames (aggregate of 5 expirations); UW 1-minute candles', sessions=out), open(os.path.join(HERE, 'skylit_replay_data.json'), 'w'), separators=(',', ':'))
