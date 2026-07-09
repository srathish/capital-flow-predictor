"""
Wall vs Escalator v3 — ROLL-DETECTION AS A DEFENSIVE HOLD-EXTENDER.

For plays the system actually takes (final-system fires, at-fire entry),
when a structural exit (anchor-hardening / pin) triggers, check whether a
ROLL is forming above the blocking wall. If yes → suppress that exit and
keep holding (trail stop + later structural exits + 15:55 EOD still
apply). Priced in REAL option dollars via the UW 1-min candles.

No false-entry cost: we only ever act on positions already open.

Run: uv run --with numpy,pandas,tabulate python research/wall-escalator/study_v3.py
"""
import gzip, json, os
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
CAND = os.path.join(GEX, 'research', 'uw', 'candles')
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
ET = timezone(timedelta(hours=-4)); HOLIDAYS = {'2026-06-19'}

# live-rule thresholds (mirror plays.js / thresholds.json)
TRAIL_ARM, TRAIL_GIVE = 0.50, 0.15
ANCHOR_RATIO, ANCHOR_GAIN, ANCHOR_MIN = 1.5, 0.05, 0.08
PIN_DIST, PIN_MIN, PIN_RATIO = 0.005, 0.18, 1.5
# roll-forming condition (checked ONLY at the moment an exit triggers)
ROLL_NEXT_MIN_RELSIG = 0.06
ROLL_NEXT_MIN_GROWTH = 0.02   # +2pp vs 15 min ago
MAX_SUPPRESSIONS = 3

def load_frames(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    out = []
    for l in gzip.open(p).read().decode().strip().split('\n'):
        s = json.loads(l)
        tot = sum(abs(x['gamma']) for x in s['strikes']) or 1
        out.append({'t': int(datetime.fromisoformat(s['requestedTs'].replace('Z','+00:00')).timestamp()*1000),
                    'spot': s['spot'],
                    'nodes': [(x['strike'], x['gamma'], abs(x['gamma'])/tot) for x in s['strikes']]})
    return out
_F = {}
def F(day, t):
    if (day, t) not in _F: _F[(day, t)] = load_frames(day, t)
    return _F[(day, t)]

def occ_symbol(t, day, d, K):
    y, m, dd = day.split('-')
    return f"{t}{y[2:]}{m}{dd}{'C' if d>0 else 'P'}{int(round(K*1000)):08d}"
def load_candles(occ, day):
    p = os.path.join(CAND, f'{occ}_{day}.json')
    if not os.path.exists(p): return None
    out = []
    for c in json.load(open(p)):
        ts = c.get('start_time'); close = float(c.get('close') or 0)
        if not ts or close <= 0: continue
        out.append((int(datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp()*1000), close))
    return sorted(out)

def hour(ts):
    tm = datetime.fromtimestamp(ts/1000, ET); return tm.hour + tm.minute/60

# ---- structural invalidate check vs fire baseline (python port) ----
def invalidate(baseline, f, direction):
    spot = f['spot']
    base = {k: rs for k, g, rs in baseline['nodes'] if g > 0}
    # pin
    pin = [(k, rs) for k, g, rs in f['nodes']
           if g > 0 and abs(k - spot)/spot <= PIN_DIST and rs >= PIN_MIN]
    for k, rs in sorted(pin, key=lambda x: -x[1]):
        b = base.get(k, 0)
        if b > 0 and rs >= b * PIN_RATIO:
            return ('pin', k)
    # opposing anchor (calls: pika at/above spot; puts: at/below)
    opp = [(k, rs) for k, g, rs in f['nodes']
           if g > 0 and (k >= spot if direction > 0 else k <= spot) and rs >= ANCHOR_MIN]
    if opp:
        k, rs = max(opp, key=lambda x: x[1])
        b = base.get(k, 0)
        if b > 0 and rs >= b * ANCHOR_RATIO and rs - b >= ANCHOR_GAIN:
            return ('anchor', k)
    return None

def roll_forming(fr, idx, wallK, direction):
    """At exit moment: is the NEXT node beyond the wall already building?"""
    f = fr[idx]
    prev = fr[max(0, idx - 3)]
    if direction > 0:
        beyond = [(k, rs) for k, g, rs in f['nodes'] if g > 0 and k > wallK]
    else:
        beyond = [(k, rs) for k, g, rs in f['nodes'] if g > 0 and k < wallK]
    if not beyond: return False
    k, rs = max(beyond, key=lambda x: x[1])
    prs = next((r for kk, g, r in prev['nodes'] if kk == k and g > 0), 0)
    return rs >= ROLL_NEXT_MIN_RELSIG and rs - prs >= ROLL_NEXT_MIN_GROWTH

# ---- final-system plays ----
cands = [os.path.join(GEX,'scripts','out',f) for f in os.listdir(os.path.join(GEX,'scripts','out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))
days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
prior = {}
for i in range(1, len(days)):
    for t in ['SPY','QQQ','SPXW']:
        fr = F(days[i-1], t)
        if fr: prior[(days[i], t)] = fr[-1]['spot']
plays = sorted([p for p in plays if p['day'] not in HOLIDAYS], key=lambda p: p['fireTsMs'])
open_until, final = {}, []
for p in plays:
    if hour(p['fireTsMs']) >= 15.25: continue
    if p['dir'] < 0:
        pc = prior.get((p['day'], p['ticker']))
        if pc is None or p['entrySpot'] >= pc: continue
    k = (p['day'], p['ticker'], p['dir'])
    if p['fireTsMs'] < open_until.get(k, 0): continue
    open_until[k] = p['exitTsMs']; final.append(p)

# ---- simulate both arms per play ----
def simulate(p, extend):
    fr = F(p['day'], p['ticker'])
    occ = occ_symbol(p['ticker'], p['day'], p['dir'], p['K'])
    cd = load_candles(occ, p['day'])
    if not fr or not cd: return None
    entry = next((c for c in cd if c[0] >= p['fireTsMs'] and c[0] - p['fireTsMs'] <= 4*60_000), None)
    if not entry: return None
    eT, e = entry
    i0 = next((ix for ix, f in enumerate(fr) if f['t'] >= p['fireTsMs']), None)
    if i0 is None or i0 == 0: return None
    baseline = fr[i0-1] if fr[i0-1]['t'] <= p['fireTsMs'] else fr[i0]
    eod = None
    for tms, c in cd:
        if hour(tms) <= 15.92: eod = (tms, c)
    if eod is None: return None
    # frame walk with candle-level trail between frames
    peak = e; suppressed = 0
    ci = 0
    exit_t, exit_m, via = eod[0], eod[1], 'EOD'
    for ix in range(i0, len(fr)):
        f = fr[ix]
        if hour(f['t']) > 15.92: break
        # trail on candles up to this frame
        while ci < len(cd) and cd[ci][0] <= f['t']:
            tms, c = cd[ci]; ci += 1
            if tms <= eT: continue
            if c > peak: peak = c
            if (peak - e)/e >= TRAIL_ARM and c <= peak * (1 - TRAIL_GIVE):
                return dict(entry=e, exit=c, via='TRAIL', suppressed=suppressed,
                            pnl=(c - e)*100, exit_t=tms)
        inv = invalidate(baseline, f, p['dir'])
        if inv:
            kind, wallK = inv
            if extend and suppressed < MAX_SUPPRESSIONS and roll_forming(fr, ix, wallK, p['dir']):
                suppressed += 1
                continue
            m = None
            for tms, c in cd:
                if tms <= f['t']: m = c
                else: break
            if m is not None:
                return dict(entry=e, exit=m, via='STRUCT_' + kind, suppressed=suppressed,
                            pnl=(m - e)*100, exit_t=f['t'])
    return dict(entry=e, exit=exit_m, via=via, suppressed=suppressed,
                pnl=(exit_m - e)*100, exit_t=exit_t)

rows = []
for p in final:
    a = simulate(p, extend=False)
    b = simulate(p, extend=True)
    if not a or not b: continue
    rows.append({'day': p['day'], 'ticker': p['ticker'], 'dir': p['dir'],
                 'entry': a['entry'],
                 'pnl_base': a['pnl'], 'via_base': a['via'],
                 'pnl_ext': b['pnl'], 'via_ext': b['via'], 'suppressed': b['suppressed'],
                 'changed': abs(a['pnl'] - b['pnl']) > 0.01})
df = pd.DataFrame(rows)
cap = (df['entry']*100).sum()
print(f"plays priced: {len(df)} · capital ${cap:,.0f}\n")
print(f"{'arm':26} {'pnl':>10} {'ret':>7} {'win%':>6}")
for arm, col in [('BASELINE (exit as-is)', 'pnl_base'), ('HOLD-EXTENDER (v3)', 'pnl_ext')]:
    pnl = df[col].sum()
    print(f'{arm:26} {pnl:>+10,.0f} {pnl/cap*100:>+6.1f}% {(df[col]>0).mean()*100:>5.0f}%')
ch = df[df['changed']]
print(f"\nplays where the extender actually changed the outcome: {len(ch)} ({len(ch)/len(df)*100:.0f}%)")
if len(ch):
    dcap = (ch['entry']*100).sum()
    print(f"  on those: baseline {ch['pnl_base'].sum():+,.0f} → extended {ch['pnl_ext'].sum():+,.0f} "
          f"(Δ {ch['pnl_ext'].sum()-ch['pnl_base'].sum():+,.0f} on ${dcap:,.0f})")
    print(f"  extender helped: {(ch['pnl_ext']>ch['pnl_base']).sum()} plays · hurt: {(ch['pnl_ext']<ch['pnl_base']).sum()} plays")
    print(f"  avg Δ when helped: {ch.loc[ch['pnl_ext']>ch['pnl_base'], 'pnl_ext'].sub(ch['pnl_base']).mean():+,.0f} · "
          f"avg Δ when hurt: {ch.loc[ch['pnl_ext']<ch['pnl_base'], 'pnl_ext'].sub(ch['pnl_base']).mean():+,.0f}")
print('\nholdouts (ret on cap, %):')
mid = sorted(df['day'].unique())[len(df['day'].unique())//2]
for lab, m in [('odd', df['day'].str[-2:].astype(int)%2==1), ('even', df['day'].str[-2:].astype(int)%2==0),
               ('H1', df['day']<mid), ('H2', df['day']>=mid)]:
    s = df[m]; c2 = (s['entry']*100).sum()
    print(f"  {lab:5} base {s['pnl_base'].sum()/c2*100:+6.1f}%  ext {s['pnl_ext'].sum()/c2*100:+6.1f}%")
df.to_csv(os.path.join(OUT, 'hold_extender.csv'), index=False)
print(f"\n→ {os.path.join(OUT, 'hold_extender.csv')}")
