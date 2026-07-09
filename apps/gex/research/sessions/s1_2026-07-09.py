"""Session 1: R1 ingest + Item 1 (trend-day exit patience) + Item 2
(red-streak bull overlap). Pre-registered in JOURNAL.md before this ran."""
import gzip, json, os
from datetime import datetime
import numpy as np
import pandas as pd

GEX = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CANDLES = os.path.join(GEX, 'research/uw/candles')
ARCHIVE = os.path.join(GEX, 'data/skylit-archive/intraday')
OBS = os.path.join(GEX, 'research/uw/outputs/live_observations/live_fire_observations_2026-07-09.csv')

# ---------- R1: forward-validation ingest ----------
print('=== R1: forward-validation ingest (2026-07-09) ===')
if os.path.exists(OBS):
    o = pd.read_csv(OBS)
    ex = o['notes_json'].str.contains('"executed":true', na=False) if 'notes_json' in o else None
    print(f'  live fires observed today: {len(o)}  '
          f'(executed {int(ex.sum()) if ex is not None else "?"} / blocked {int((~ex).sum()) if ex is not None else "?"})')
    if 'red_flag_count' in o:
        print(f'  red-flag distribution: {o.red_flag_count.value_counts().sort_index().to_dict()}')
    if 'policy_flags_eq_0_pass' in o:
        print(f'  flags_eq_0 candidates today: {int((o.policy_flags_eq_0_pass == True).sum())}')
else:
    print('  no observation file for today')
days_archived = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
print(f'  archive: {len(days_archived)} days, latest {days_archived[-1]}')

df = pd.read_parquet(os.path.join(GEX, 'research/gexvex-structure/outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy()
fs['cap'] = fs['entry_atfire'] * 100
ev = lambda s: s['pnl_atfire'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else float('nan')

# ---------- Item 1: trend-day exit patience ----------
print('\n=== Item 1: trend-day exit patience (hold-to-15:55 vs actual exits, real $) ===')
def mark_1555(occ, day):
    p = os.path.join(CANDLES, f'{occ}_{day}.json')
    if not os.path.exists(p):
        return None
    rows = json.load(open(p))
    best, best_ts = None, None
    for r in rows:
        ts = r.get('start_time', '')
        if not ts or ts[:10] != day:
            continue
        t = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        mins = t.hour * 60 + t.minute
        if mins <= 19 * 60 + 55 and mins >= 19 * 60 + 25:   # 15:25-15:55 ET window
            if best_ts is None or mins > best_ts:
                best, best_ts = float(r['close']), mins
    return best

rows = []
for _, r in fs.iterrows():
    m = mark_1555(r['occ'], r['day'])
    if m is None:
        continue
    pnl_hold = (m - r['entry_atfire']) * 100
    rows.append(dict(day=r['day'], trend=bool(r['trend_day']), daytype=r['daytype'],
                     dirn=r['dir'], cap=r['cap'], pnl_sys=r['pnl_atfire'], pnl_hold=pnl_hold))
h = pd.DataFrame(rows)
print(f'  coverage: {len(h)}/{len(fs)} fires priced at 15:25-15:55 (rest: no late trades in contract)')

def delta_line(s, label):
    if not len(s):
        print(f'  {label:34} n=0'); return None
    cap = s['cap'].sum()
    e_sys, e_hold = s['pnl_sys'].sum() / cap * 100, s['pnl_hold'].sum() / cap * 100
    print(f'  {label:34} n={len(s):4} sys {e_sys:+6.1f}%  hold1555 {e_hold:+6.1f}%  delta {e_hold - e_sys:+6.1f}pp')
    return e_hold - e_sys

d_tr = delta_line(h[h.trend], 'TREND days')
d_nt = delta_line(h[~h.trend], 'non-trend days')
udays = sorted(h['day'].unique()); half = len(udays) // 2
for lbl, sel in [('trend odd', udays[::2]), ('trend even', udays[1::2]),
                 ('trend H1', udays[:half]), ('trend H2', udays[half:])]:
    delta_line(h[h.trend & h['day'].isin(sel)], f'  {lbl}')
for dt in ['up', 'flat', 'down']:
    delta_line(h[h.trend & (h.daytype == dt)], f'  trend x {dt} days')

# ---------- Item 2: red-streak bull overlap ----------
print('\n=== Item 2: red-streak bulls — absorbed by bull tape gate? ===')
ret = {}
for d in days_archived:
    p = os.path.join(ARCHIVE, d, 'SPY.jsonl.gz')
    if not os.path.exists(p):
        continue
    v = [json.loads(l)['spot'] for l in gzip.open(p).read().decode().strip().split('\n')]
    ret[d] = (v[-1] - v[0]) / v[0] * 100
rets = pd.Series(ret).sort_index()
neg = rets < 0
streak = {d for i, d in enumerate(rets.index) if i > 0 and neg.iloc[i] and neg.iloc[i - 1]}
sb = fs[(fs['dir'] > 0) & fs['day'].isin(streak)]
blocked = sb[sb['xt'] == 0]
residual = sb[sb['xt'] > 0]
print(f'  red-streak bulls total: n={len(sb)} @ {ev(sb):+.1f}%')
print(f'  ...gate blocks (xt=0):  n={len(blocked)} @ {ev(blocked):+.1f}%')
print(f'  ...RESIDUAL (gate passes): n={len(residual)} @ {ev(residual):+.1f}%')
if len(residual):
    rd = sorted(residual['day'].unique())
    o = residual[residual['day'].isin(rd[::2])]; e = residual[residual['day'].isin(rd[1::2])]
    print(f'     residual odd {ev(o):+.1f}% (n={len(o)}) / even {ev(e):+.1f}% (n={len(e)})')
