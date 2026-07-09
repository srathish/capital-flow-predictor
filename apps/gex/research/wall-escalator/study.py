"""
Wall vs Escalator — when does a dominant wall REJECT price, and when does
it ROLL (hand off to the next strike up) and escort price higher?

Data: the 64-day index archive (5-min surfaces, local disk, zero API).
Event: strongest pika within [0, +50bps] of spot with relSig >= 12%.
Outcome over the next 90 min:
  ROLLED   — a strike ABOVE the wall becomes the dominant pika AND spot
             closes above the original wall level
  REJECTED — spot ends >= 10bps below the wall without holding above it
  CHOP     — neither
Features at event time (all ex-ante):
  handoff precursor: next-strike-up pika relSig / its 15m growth
  wall growth rate (15m), barney fuel above spot, spot vs prior close,
  time of day, day trend so far.

Run: uv run --with numpy,pandas,tabulate python research/wall-escalator/study.py
"""
import gzip, json, os
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
ET = timezone(timedelta(hours=-4))
TICKERS = ['SPY', 'QQQ', 'SPXW']
WALL_MIN_RELSIG = 0.12
WALL_BAND_BPS = (0, 50)         # wall sits 0-50bps above spot
WINDOW = 18                     # 18 x 5min = 90 min resolution
COOLDOWN_FRAMES = 6             # one event per ticker per 30 min

def frames(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    out = []
    for l in gzip.open(p).read().decode().strip().split('\n'):
        s = json.loads(l)
        tot = sum(abs(x['gamma']) for x in s['strikes']) or 1
        out.append({'ts': s['requestedTs'], 'spot': s['spot'],
                    'nodes': [(x['strike'], x['gamma'], abs(x['gamma'])/tot) for x in s['strikes']]})
    return out

days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
prior_close = {}
for i in range(1, len(days)):
    for t in TICKERS:
        fr = frames(days[i-1], t)
        if fr: prior_close[(days[i], t)] = fr[-1]['spot']

def hour(ts):
    h, m = int(ts[11:13]), int(ts[14:16]); return h - 4 + m/60

events = []
for day in days:
    for t in TICKERS:
        fr = frames(day, t)
        if not fr or len(fr) < WINDOW + 4: continue
        last_evt = -99
        for i in range(3, len(fr) - WINDOW):
            if i - last_evt < COOLDOWN_FRAMES: continue
            f = fr[i]; spot = f['spot']
            lo, hi = spot * (1 + WALL_BAND_BPS[0]/1e4), spot * (1 + WALL_BAND_BPS[1]/1e4)
            pikas = [(k, g, rs) for k, g, rs in f['nodes'] if g > 0 and lo <= k <= hi]
            if not pikas: continue
            wall = max(pikas, key=lambda x: x[2])
            if wall[2] < WALL_MIN_RELSIG: continue
            wallK, _, wallSig = wall
            # ex-ante features
            prev = fr[i-3]
            prevWall = next((rs for k, g, rs in prev['nodes'] if k == wallK and g > 0), 0)
            wall_growth = wallSig - prevWall
            ups = sorted([(k, rs) for k, g, rs in f['nodes'] if g > 0 and k > wallK], key=lambda x: x[0])
            nextK, nextSig = (ups[0] if ups else (None, 0))
            prevNext = next((rs for k, g, rs in prev['nodes'] if k == nextK and g > 0), 0) if nextK else 0
            next_growth = nextSig - prevNext
            fuel_above = sum(abs(g) for k, g, rs in f['nodes'] if g < 0 and spot < k <= spot*1.02)
            fuel_below = sum(abs(g) for k, g, rs in f['nodes'] if g < 0 and spot*0.98 <= k < spot)
            pc = prior_close.get((day, t))
            # outcome over WINDOW
            end = fr[i + WINDOW]
            end_spot = end['spot']
            end_pikas_above = [(k, rs) for k, g, rs in end['nodes'] if g > 0 and k > wallK]
            end_dom_above = max((rs for k, rs in end_pikas_above), default=0)
            end_wall_sig = next((rs for k, g, rs in end['nodes'] if k == wallK and g > 0), 0)
            rolled = end_dom_above > end_wall_sig and end_spot > wallK
            rejected = (not rolled) and end_spot <= wallK * (1 - 10/1e4)
            outcome = 'ROLLED' if rolled else 'REJECTED' if rejected else 'CHOP'
            fwd_bps = (end_spot - spot) / spot * 1e4
            events.append({'day': day, 'ticker': t, 'hr': round(hour(f['ts']), 2),
                           'wallK': wallK, 'wallSig': wallSig, 'wall_growth': wall_growth,
                           'nextSig': nextSig, 'next_growth': next_growth,
                           'handoff_precursor': nextSig >= 0.04 and next_growth > 0,
                           'fuel_ratio': fuel_above / fuel_below if fuel_below > 0 else np.inf,
                           'above_prior_close': (spot > pc) if pc else None,
                           'outcome': outcome, 'fwd_bps': fwd_bps})
            last_evt = i
df = pd.DataFrame(events)
print(f'wall events: {len(df)} across {df["day"].nunique()} days\n')
print('outcomes:'); print(df['outcome'].value_counts().to_string())
print(f"\nfwd 90m by outcome (bps): "
      f"ROLLED {df[df.outcome=='ROLLED'].fwd_bps.mean():+.1f} · "
      f"REJECTED {df[df.outcome=='REJECTED'].fwd_bps.mean():+.1f} · "
      f"CHOP {df[df.outcome=='CHOP'].fwd_bps.mean():+.1f}")

def roll_rate(sub): return (sub['outcome'] == 'ROLLED').mean() * 100
print('\n== does the HANDOFF PRECURSOR (next strike already building) predict rolling? ==')
for v in [True, False]:
    sub = df[df['handoff_precursor'] == v]
    print(f'  precursor={v}:  n={len(sub)}  ROLLED {roll_rate(sub):.0f}%  REJECTED {(sub.outcome=="REJECTED").mean()*100:.0f}%  fwd {sub.fwd_bps.mean():+.1f}bps')
print('\n== by tape (above/below prior close) ==')
for v in [True, False]:
    sub = df[df['above_prior_close'] == v]
    print(f'  above_pc={v}:  n={len(sub)}  ROLLED {roll_rate(sub):.0f}%  fwd {sub.fwd_bps.mean():+.1f}bps')
print('\n== combined: precursor AND above prior close ==')
both = df[(df['handoff_precursor']) & (df['above_prior_close'] == True)]
neither = df[(~df['handoff_precursor']) & (df['above_prior_close'] == False)]
print(f'  BOTH:    n={len(both)}  ROLLED {roll_rate(both):.0f}%  fwd {both.fwd_bps.mean():+.1f}bps')
print(f'  NEITHER: n={len(neither)}  ROLLED {roll_rate(neither):.0f}%  fwd {neither.fwd_bps.mean():+.1f}bps')
print('\n== fuel ratio (barney above/below) terciles ==')
fin = df[np.isfinite(df['fuel_ratio'])]
fin = fin.assign(ft=pd.qcut(fin['fuel_ratio'].rank(method='first'), 3, labels=['low','mid','high']))
for v in ['low','mid','high']:
    sub = fin[fin['ft'] == v]
    print(f'  fuel {v}:  n={len(sub)}  ROLLED {roll_rate(sub):.0f}%  fwd {sub.fwd_bps.mean():+.1f}bps')
print('\n== by time of day ==')
for lo, hi_, lab in [(9.5,10.5,'open'),(10.5,12,'mid-morning'),(12,13.5,'lunch'),(13.5,16,'afternoon')]:
    sub = df[(df['hr'] >= lo) & (df['hr'] < hi_)]
    print(f'  {lab:12}: n={len(sub)}  ROLLED {roll_rate(sub):.0f}%  fwd {sub.fwd_bps.mean():+.1f}bps')
df.to_csv(os.path.join(OUT, 'wall_events.csv'), index=False)
print(f'\nevents → {os.path.join(OUT, "wall_events.csv")}')
