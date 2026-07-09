"""
Wall vs Escalator v2 — ROLL DETECTION FOR RE-ENTRY.

v1 established: walls reject 57% / roll 10%, and the split is worth
~58bps. Predicting the roll ex-ante failed. v2 asks the tradeable
question instead: once a wall event exists, can a detector CONFIRM the
roll in progress early enough that entering long AT CONFIRMATION still
captures profit — while staying quiet on rejections?

For each wall event, scan the next 90 min frame-by-frame; the first
frame satisfying a detector definition = confirmation. Measure per
detector: fire rate, precision vs eventual outcome, latency, and the
money metric — forward bps from CONFIRMATION (not from the event).

Run: uv run --with numpy,pandas,tabulate python research/wall-escalator/study_v2.py
"""
import gzip, json, os
from datetime import timezone, timedelta
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
TICKERS = ['SPY', 'QQQ', 'SPXW']
WALL_MIN_RELSIG = 0.12
WINDOW = 18            # 90 min event horizon
FWD = 12               # 60 min payoff window from confirmation
COOLDOWN_FRAMES = 6

def frames(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    out = []
    for l in gzip.open(p).read().decode().strip().split('\n'):
        s = json.loads(l)
        tot = sum(abs(x['gamma']) for x in s['strikes']) or 1
        out.append({'spot': s['spot'],
                    'nodes': [(x['strike'], x['gamma'], abs(x['gamma'])/tot) for x in s['strikes']]})
    return out

def pika_at(f, K):
    return next((rs for k, g, rs in f['nodes'] if k == K and g > 0), 0.0)
def gamma_at(f, K):
    return next((g for k, g, rs in f['nodes'] if k == K), 0.0)
def dom_above(f, K):
    vals = [(k, rs) for k, g, rs in f['nodes'] if g > 0 and k > K]
    if not vals: return (None, 0.0)
    return max(vals, key=lambda x: x[1])

# ---- detector definitions (checked at frame j after the event) ----
def det_dominance(fr, i, j, wallK):
    f = fr[i+j]
    k, rs = dom_above(f, wallK)
    return rs > pika_at(f, wallK) and f['spot'] >= wallK * (1 - 5/1e4)

def det_surge(fr, i, j, wallK):
    if j < 2: return False
    f, f2 = fr[i+j], fr[i+j-2]
    k, rs = dom_above(f, wallK)
    if k is None: return False
    return rs >= 0.08 and rs - pika_at(f2, k) >= 0.03

def det_breach_build(fr, i, j, wallK):
    f = fr[i+j]
    k, rs = dom_above(f, wallK)
    return f['spot'] >= wallK and rs >= 0.06

def det_dollar_surge(fr, i, j, wallK):
    if j < 3: return False
    f, f3 = fr[i+j], fr[i+j-3]
    k, rs = dom_above(f, wallK)
    if k is None: return False
    now = abs(gamma_at(f, k)); then = abs(gamma_at(f3, k)); wall = abs(gamma_at(f, wallK))
    return then > 0 and now >= 2 * then and now >= 0.25 * wall and f['spot'] >= wallK * (1 - 10/1e4)

DETECTORS = {'C1 dominance-handoff': det_dominance,
             'C2 relsig-surge': det_surge,
             'C3 breach+build': det_breach_build,
             'C4 dollar-surge': det_dollar_surge}

days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
rows = []
drift_samples = []
for day in days:
    for t in TICKERS:
        fr = frames(day, t)
        if not fr or len(fr) < WINDOW + FWD + 4: continue
        # baseline drift: fwd60 from every 6th frame
        for i in range(3, len(fr) - FWD, 6):
            drift_samples.append((fr[i+FWD]['spot'] - fr[i]['spot']) / fr[i]['spot'] * 1e4)
        last_evt = -99
        for i in range(3, len(fr) - WINDOW - FWD):
            if i - last_evt < COOLDOWN_FRAMES: continue
            f = fr[i]; spot = f['spot']
            pikas = [(k, rs) for k, g, rs in f['nodes'] if g > 0 and spot <= k <= spot * (1 + 50/1e4)]
            if not pikas: continue
            wallK, wallSig = max(pikas, key=lambda x: x[1])
            if wallSig < WALL_MIN_RELSIG: continue
            last_evt = i
            # eventual outcome at +90m (v1 definition)
            end = fr[i + WINDOW]
            kA, rsA = dom_above(end, wallK)
            rolled = rsA > pika_at(end, wallK) and end['spot'] > wallK
            rejected = (not rolled) and end['spot'] <= wallK * (1 - 10/1e4)
            outcome = 'ROLLED' if rolled else 'REJECTED' if rejected else 'CHOP'
            for name, det in DETECTORS.items():
                conf_j = None
                for j in range(1, WINDOW + 1):
                    try:
                        if det(fr, i, j, wallK): conf_j = j; break
                    except Exception: break
                if conf_j is None:
                    rows.append({'day': day, 'ticker': t, 'det': name, 'confirmed': False,
                                 'outcome': outcome, 'lat_min': None, 'fwd60': None})
                else:
                    ci = i + conf_j
                    fwd = (fr[ci + FWD]['spot'] - fr[ci]['spot']) / fr[ci]['spot'] * 1e4
                    rows.append({'day': day, 'ticker': t, 'det': name, 'confirmed': True,
                                 'outcome': outcome, 'lat_min': conf_j * 5, 'fwd60': fwd})
df = pd.DataFrame(rows)
drift = float(np.mean(drift_samples))
n_events = len(df) // len(DETECTORS)
print(f'events: {n_events} · baseline 60m drift: {drift:+.1f}bps\n')
print(f"{'detector':22} {'fires':>6} {'fire%':>6} {'P(roll|fire)':>12} {'med lat':>8} {'fwd60/fire':>11} {'win%':>6} {'net/QUIET-on-reject':>20}")
for name in DETECTORS:
    sub = df[df['det'] == name]
    fired = sub[sub['confirmed']]
    if not len(fired):
        print(f'{name:22} {"0":>6}'); continue
    p_roll = (fired['outcome'] == 'ROLLED').mean() * 100
    quiet_on_rej = 100 - (sub[(sub['outcome'] == 'REJECTED')]['confirmed']).mean() * 100
    print(f'{name:22} {len(fired):>6} {len(fired)/n_events*100:>5.0f}% {p_roll:>11.0f}% '
          f'{fired["lat_min"].median():>7.0f}m {fired["fwd60"].mean():>+10.1f}bps '
          f'{(fired["fwd60"]>0).mean()*100:>5.0f}% {quiet_on_rej:>19.0f}%')
print('\nfwd60 by eventual outcome, per detector (does firing on a REJECTED wall hurt?):')
for name in DETECTORS:
    fired = df[(df['det'] == name) & df['confirmed']]
    if not len(fired): continue
    parts = []
    for o in ['ROLLED', 'CHOP', 'REJECTED']:
        s = fired[fired['outcome'] == o]['fwd60']
        parts.append(f'{o} {s.mean():+.1f}bps(n={len(s)})' if len(s) else f'{o} n=0')
    print(f'  {name:22} ' + ' · '.join(parts))
df.to_csv(os.path.join(OUT, 'roll_detection.csv'), index=False)
print(f"\n→ {os.path.join(OUT, 'roll_detection.csv')}")
