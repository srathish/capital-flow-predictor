"""Session 2: LIVE trend trigger for exit patience (0DTE SPY/QQQ/SPXW).
Pre-registered in JOURNAL.md. At the system's actual exit moment, hold to
15:55 instead IF trigger (computable live from the spot stream) fires.
PRIMARY: aligned move-from-open >= 40bps AND efficiency ratio >= 0.40.
"""
import gzip, json, os, bisect
from datetime import datetime
import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
GEX = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CANDLES = os.path.join(GEX, 'research/uw/candles')
ARCHIVE = os.path.join(GEX, 'data/skylit-archive/intraday')

def to_ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

_cache = {}
def stream(day, tic):
    key = (day, tic)
    if key not in _cache:
        p = os.path.join(ARCHIVE, day, f'{tic}.jsonl.gz')
        ts, sp = [], []
        if os.path.exists(p):
            rows = [json.loads(l) for l in gzip.open(p).read().decode().strip().split('\n')]
            pairs = sorted((to_ms(r['requestedTs']), r['spot']) for r in rows)
            ts = [a for a, _ in pairs]; sp = [b for _, b in pairs]
        if len(_cache) > 60:
            _cache.clear()
        _cache[key] = (ts, sp)
    return _cache[key]

def tape_state(day, tic, tsms):
    """Live-computable at tsms: aligned move from open (bps) + efficiency ratio."""
    ts, sp = stream(day, tic)
    if not ts:
        return None
    i = bisect.bisect_right(ts, tsms) - 1
    if i < 1:
        return None
    o, cur = sp[0], sp[i]
    move_bps = (cur - o) / o * 1e4
    path = sum(abs(sp[j] - sp[j - 1]) for j in range(1, i + 1))
    er = abs(cur - o) / path if path > 0 else 0.0
    return dict(move_bps=move_bps, er=er)

def mark_1555(occ, day):
    p = os.path.join(CANDLES, f'{occ}_{day}.json')
    if not os.path.exists(p):
        return None
    best, best_m = None, None
    for r in json.load(open(p)):
        t = r.get('start_time', '')
        if t[:10] != day:
            continue
        d = datetime.fromisoformat(t.replace('Z', '+00:00'))
        m = d.hour * 60 + d.minute
        if 19 * 60 + 25 <= m <= 19 * 60 + 55 and (best_m is None or m > best_m):
            best, best_m = float(r['close']), m
    return best

df = pd.read_parquet(os.path.join(GEX, 'research/gexvex-structure/outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy()

rows = []
for _, r in fs.iterrows():
    m55 = mark_1555(r['occ'], r['day'])
    if m55 is None:
        continue
    st = tape_state(r['day'], r['ticker'], int(r['exitTsMs']))
    if st is None:
        continue
    exit_et_min = datetime.utcfromtimestamp(r['exitTsMs'] / 1000).hour * 60 + \
                  datetime.utcfromtimestamp(r['exitTsMs'] / 1000).minute - 4 * 60  # EDT
    rows.append(dict(
        day=r['day'], ticker=r['ticker'], dirn=int(r['dir']), cap=r['entry_atfire'] * 100,
        pnl_sys=r['pnl_atfire'], pnl_hold=(m55 - r['entry_atfire']) * 100,
        aligned_move=st['move_bps'] * r['dir'], er=st['er'],
        late_exit=exit_et_min >= 15 * 60 + 25))
h = pd.DataFrame(rows)
h['delta'] = h['pnl_hold'] - h['pnl_sys']
print(f'coverage: {len(h)}/{len(fs)} fires | exits already >=15:25 ET: {h.late_exit.mean()*100:.0f}%')

def policy(move_thr, er_thr, mode='both'):
    if mode == 'both':
        return (h['aligned_move'] >= move_thr) & (h['er'] >= er_thr)
    if mode == 'move':
        return h['aligned_move'] >= move_thr
    if mode == 'er':
        return h['er'] >= er_thr
    raise ValueError(mode)

def report(mask, label, placebo=False):
    t = h[mask]
    if not len(t):
        print(f'{label:44} n=0'); return
    cap = t['cap'].sum()
    dl = t['delta'].sum() / cap * 100
    sys_all, pol_all = h['pnl_sys'].sum(), h['pnl_sys'].sum() + t['delta'].sum()
    cap_all = h['cap'].sum()
    line = (f'{label:44} n={len(t):3} trig-delta {dl:+7.1f}pp | '
            f'system {sys_all/cap_all*100:+5.1f}% -> {pol_all/cap_all*100:+5.1f}%')
    days = sorted(t['day'].unique()); half = max(1, len(days) // 2)
    cuts = []
    for sel in (days[::2], days[1::2], days[:half], days[half:]):
        s = t[t['day'].isin(sel)]
        cuts.append(s['delta'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else float('nan'))
    line += f' | odd {cuts[0]:+.0f} even {cuts[1]:+.0f} H1 {cuts[2]:+.0f} H2 {cuts[3]:+.0f}'
    if placebo:
        k = len(t); real = dl; worse = 0
        for _ in range(1000):
            idx = rng.choice(len(h), k, replace=False)
            s = h.iloc[idx]
            if s['delta'].sum() / s['cap'].sum() * 100 >= real:
                worse += 1
        line += f' | placebo-pctl {100 - worse/10:.0f}'
    print(line)

print('\n=== PRIMARY (pre-registered): aligned_move>=40bps AND ER>=0.40 ===')
report(policy(40, 0.40), 'PRIMARY', placebo=True)
print('\n=== sensitivity grid (same-sign required) ===')
for mv in (30, 40, 50):
    for e in (0.30, 0.40, 0.50):
        report(policy(mv, e), f'move>={mv} & ER>={e}')
print('\n=== ablations ===')
report(policy(40, 0, 'move'), 'move-only >=40bps')
report(policy(0, 0.40, 'er'), 'ER-only >=0.40')
report(~policy(40, 0.40), 'complement (trigger OFF fires)')
print('\n=== per-ticker + direction (triggered subset) ===')
trig = policy(40, 0.40)
for t in ['SPY', 'QQQ', 'SPXW']:
    report(trig & (h.ticker == t), f'  {t}')
for d, lbl in ((1, 'bulls'), (-1, 'bears')):
    report(trig & (h.dirn == d), f'  {lbl}')
# how much of the hindsight upper bound does the live trigger capture?
print(f"\nhindsight trend-day delta captured: trigger fires on {trig.sum()} plays; "
      f"triggered delta ${h[trig]['delta'].sum():+,.0f} vs s1 trend-day total ${263*0:+d}(see s1)")
h.to_parquet(os.path.join(GEX, 'research/sessions/outputs_s2_holds.parquet'))
