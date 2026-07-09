"""Systematic edge scan: every structure feature terciled against real option
dollars on final-system fires. A feature is flagged only if the best-vs-worst
tercile gap is material AND the direction holds on odd/even days and both halves.
"""
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(__file__)
df = pd.read_parquet(os.path.join(HERE, 'outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy()
fs['cap'] = fs['entry_atfire'] * 100

META = {'day', 'ticker', 'state', 'dir', 'K', 'fireTsMs', 'exitTsMs', 'entrySpot', 'hr',
        'g7_gate', 'final_sys', 'occ', 'entry_atfire', 'pnl_atfire', 'confirmed',
        'entry_confirm', 'pnl_confirm', 'pnl_nextexp', 'mfe_pct', 'mae_pct', 't_peak_min',
        'cap', 'wall_up_strike', 'wall_dn_strike', 'flip_strike', 'open_spot', 'orh', 'orl',
        'twap', 'pdh', 'pdl', 'daytype', 'gex_state', 'premium_band', 'gex_regime'}
feats = [c for c in df.columns if c not in META and df[c].dtype != object
         and df[c].notna().mean() > 0.5 and df[c].nunique() > 3]

def ev(s):
    return s['pnl_atfire'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else np.nan

days = sorted(fs['day'].unique()); half = len(days) // 2
CUTS = {'odd': fs['day'].isin(days[::2]), 'even': fs['day'].isin(days[1::2]),
        'H1': fs['day'].isin(days[:half]), 'H2': fs['day'].isin(days[half:])}

rows = []
for f in feats:
    v = fs.dropna(subset=[f])
    if len(v) < 150:
        continue
    try:
        v = v.assign(q=pd.qcut(v[f], 3, labels=['lo', 'mid', 'hi'], duplicates='drop'))
    except ValueError:
        continue
    if v['q'].nunique() < 3:
        continue
    e = {q: ev(v[v['q'] == q]) for q in ['lo', 'mid', 'hi']}
    gap = e['hi'] - e['lo']
    best, worst = ('hi', 'lo') if gap > 0 else ('lo', 'hi')
    # stability: does best tercile beat worst tercile in each cut?
    holds = 0
    for cname, cmask in CUTS.items():
        sub = v[cmask.reindex(v.index, fill_value=False)]
        eb, ew = ev(sub[sub['q'] == best]), ev(sub[sub['q'] == worst])
        if eb == eb and ew == ew and eb > ew:
            holds += 1
    # monotonic?
    seq = [e['lo'], e['mid'], e['hi']]
    mono = all(np.diff(seq) > 0) or all(np.diff(seq) < 0)
    rows.append(dict(feature=f, n=len(v), ev_lo=e['lo'], ev_mid=e['mid'], ev_hi=e['hi'],
                     gap=abs(gap), best=best, mono=mono, holds4=holds))

res = pd.DataFrame(rows).sort_values(['holds4', 'gap'], ascending=False)
pd.set_option('display.width', 200)
print('=== EDGE SCAN: final-system fires, real dollars, tercile EV%, stability holds (of 4 cuts) ===')
print(res.to_string(index=False, float_format=lambda x: f'{x:+.1f}'))
res.to_csv(os.path.join(HERE, 'outputs/edge_scan.csv'), index=False)
print('\nsurvivors (holds4==4 and gap>=8pp):')
print(res[(res.holds4 == 4) & (res.gap >= 8)]['feature'].tolist())
