"""
VIX phase 2 — decision tests: (1) exit accelerator, (2) sizing tilt.
Bar: must improve option-EV proxy on the 64-day replay, both market regimes.
"""
import gzip, json, os
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
ET = timezone(timedelta(hours=-4))

def load_spots(day, ticker):
    p = os.path.join(ARCHIVE, day, f'{ticker}.jsonl.gz')
    if not os.path.exists(p): return {}
    out = {}
    for line in gzip.open(p).read().decode().strip().split('\n'):
        s = json.loads(line)
        out[int(datetime.fromisoformat(s['requestedTs'].replace('Z','+00:00')).timestamp()*1000)] = s['spot']
    return out

days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
S = {}
for day in days:
    for t in ['VIX','SPY','QQQ','SPXW']:
        S[(day,t)] = load_spots(day, t)

cands = [os.path.join(GEX,'scripts','out',f) for f in os.listdir(os.path.join(GEX,'scripts','out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))

# final-system subset: G7-PC + dedupe (mirror of live config)
prior = {}
for i, day in enumerate(days):
    for t in ['SPY','QQQ','SPXW']:
        if i > 0 and S.get((days[i-1], t)):
            prior[(day,t)] = list(S[(days[i-1], t)].values())[-1]
def hour(p):
    tm = datetime.fromtimestamp(p['fireTsMs']/1000, ET); return tm.hour + tm.minute/60
def g7(p):
    if hour(p) >= 15.25: return False
    if p['dir'] > 0: return True
    pc = prior.get((p['day'], p['ticker']))
    return pc is not None and p['entrySpot'] < pc
base = sorted([p for p in plays if g7(p)], key=lambda p: p['fireTsMs'])
open_until, final = {}, []
for p in base:
    k = (p['day'], p['ticker'], p['dir'])
    if p['fireTsMs'] < open_until.get(k, 0): continue
    open_until[k] = p['exitTsMs']; final.append(p)

PREM = 30.0
def optev(bps): return max(-1.0, bps / PREM)
def grid_ts(ts_ms): return ts_ms - (ts_ms % 300000)

ret = {}
for day in days:
    sp = S.get((day,'SPY'), {})
    if sp:
        v = list(sp.values()); ret[day] = (v[-1]-v[0])/v[0]*100
down = {d for d,r in ret.items() if r <= -0.5}; up = {d for d,r in ret.items() if r >= 0.5}

def report(rows, label):
    n = len(rows)
    ev = sum(r['ev'] for r in rows)/n*100
    net = sum(r['bps'] for r in rows)
    print(f'{label:52} n={n:4} net={net:+8.0f}bps  optEV={ev:+6.1f}%')

# --- Test 1: exit accelerator ---
# walk 5-min frames fire→exit; if VIX moved against the play ≥ THR since
# entry, exit at that frame's spot instead.
def simulate(thr):
    rows = []
    for p in final:
        day, t = p['day'], p['ticker']
        vix0 = S[(day,'VIX')].get(grid_ts(p['fireTsMs']))
        out_bps = p['capturedBps']
        if vix0 is not None:
            ts = grid_ts(p['fireTsMs']) + 300000
            while ts <= grid_ts(p['exitTsMs']):
                v = S[(day,'VIX')].get(ts); sp = S[(day,t)].get(ts)
                if v is not None and sp is not None:
                    against = (v - vix0) if p['dir'] > 0 else (vix0 - v)
                    if against >= thr:
                        out_bps = p['dir'] * (sp - p['entrySpot']) / p['entrySpot'] * 1e4
                        break
                ts += 300000
        rows.append({'bps': out_bps, 'ev': optev(out_bps), 'day': day})
    return rows

baseline = [{'bps': p['capturedBps'], 'ev': optev(p['capturedBps']), 'day': p['day']} for p in final]
report(baseline, 'BASELINE (final system, structural exits)')
for thr in [0.2, 0.3, 0.5, 0.8]:
    rows = simulate(thr)
    report(rows, f'  + VIX exit accelerator (against ≥ {thr})')
    report([r for r in rows if r['day'] in down], f'      down days')
    report([r for r in rows if r['day'] in up], f'      up days')

# --- Test 2: sizing tilt ---
# weight plays by VIX tercile at fire: bulls upsized in high VIX.
vlevels = [S[(p['day'],'VIX')].get(grid_ts(p['fireTsMs'])) for p in final]
valid = [(p, v) for p, v in zip(final, vlevels) if v is not None]
vs = sorted(v for _, v in valid)
t1, t2 = vs[len(vs)//3], vs[2*len(vs)//3]
print(f'\nVIX terciles: <{t1:.1f} / {t1:.1f}-{t2:.1f} / >{t2:.1f}')
def tilt_ev(wlow, wmid, whigh, bear_w=1.0):
    tot_w, tot = 0, 0
    for p, v in valid:
        w = (wlow if v < t1 else wmid if v < t2 else whigh) if p['dir'] > 0 else bear_w
        tot += w * optev(p['capturedBps']); tot_w += w
    return tot/tot_w*100, tot*100  # EV per unit risk, total weighted EV
ev0, tot0 = tilt_ev(1,1,1)
print(f'flat sizing:            EV/unit={ev0:+.1f}%  totalEV={tot0:+.0f}')
for w in [(0.5,1,1.5), (0.75,1,1.25), (0.5,0.75,1.5)]:
    ev, tot = tilt_ev(*w)
    print(f'bull tilt {w}:  EV/unit={ev:+.1f}%  totalEV={tot:+.0f}')
