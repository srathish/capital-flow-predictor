"""Deep dive on edge-scan survivors:
1. direction-conditioned (must work for bulls AND bears, not proxy tape)
2. incremental over known signals (study 77: beyond nflags/flow/tape-gate)
3. MFE/MAE + never-worked-loser prediction (studies 51-53)
4. flags_eq_0 interactions (studies 31-40)
"""
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(__file__)
df = pd.read_parquet(os.path.join(HERE, 'outputs/fires_structure.parquet'))
conf = pd.read_parquet(os.path.join(HERE, '../uw/studies/outputs/fires_with_confluence.parquet'))
df['xt'] = conf['xt'].reindex(df.index)
fs = df[df['final_sys']].copy()
fs['cap'] = fs['entry_atfire'] * 100

def ev(s):
    return s['pnl_atfire'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else np.nan

def tercile_line(v, f, label):
    v = v.dropna(subset=[f])
    if len(v) < 40:
        print(f'  {label:34} n<40'); return
    try:
        q = pd.qcut(v[f], 3, labels=['lo', 'mid', 'hi'], duplicates='drop')
    except ValueError:
        q = pd.qcut(v[f], 3, labels=False, duplicates='drop').map({0: 'lo', 1: 'mid', 2: 'hi'})
    parts = [f"{t}:{ev(v[q == t]):+6.1f}%({(q == t).sum()})" for t in ['lo', 'mid', 'hi']]
    print(f'  {label:34} ' + '  '.join(parts))

SURV = ['vex_asym', 'gex_asym', 'up_gex_mass', 'dn_vex_mass', 'wall_dn_thick',
        'net_gex_local', 'net_gex_global', 'flip_dist_bps', 'spot_vs_twap_bps',
        'm30_px_move_bps', 'gex_curv', 'density_100bps', 'wall_up_isolation',
        'room_consumed_pct', 'wall_confluence', 'pin_score', 'open_field',
        'fwd_wall_thick', 'm30_fwd_wall_mig_bps', 'stale_move_bps', 'frame_age_min',
        'rev_gex_pct', 'accel_zone_gex']

print('=== 1. DIRECTION-CONDITIONED (feature must work within bulls AND within bears) ===')
for f in SURV:
    print(f'{f}:')
    tercile_line(fs[fs['dir'] > 0], f, 'bulls')
    tercile_line(fs[fs['dir'] < 0], f, 'bears')

print('\n=== 2. INCREMENTAL OVER KNOWN SIGNALS (study 77) ===')
print('-- within nflags==0 (n=%d):' % (fs['nflags'] == 0).sum())
for f in SURV:
    tercile_line(fs[fs['nflags'] == 0], f, f)
print('-- within nflags>=1 (n=%d):' % (fs['nflags'] >= 1).sum())
for f in ['vex_asym', 'gex_asym', 'net_gex_local', 'spot_vs_twap_bps', 'm30_px_move_bps']:
    tercile_line(fs[fs['nflags'] >= 1], f, f)
print('-- within tape-gate-passing fires (bulls xt>=1, bears any):')
gated = fs[~((fs['dir'] > 0) & (fs['xt'] == 0))]
for f in ['vex_asym', 'gex_asym', 'net_gex_local', 'spot_vs_twap_bps', 'dn_vex_mass', 'wall_dn_thick']:
    tercile_line(gated, f, f)
# correlation among the asymmetry family + with tape
print('\nasymmetry-family correlations (is it one signal?):')
fam = ['vex_asym', 'gex_asym', 'up_gex_mass', 'dn_vex_mass', 'net_gex_local', 'spot_vs_twap_bps', 'm30_px_move_bps']
print(fs[fam].corr().round(2).to_string())

print('\n=== 3. MFE/MAE + NEVER-WORKED LOSERS (studies 51-53) ===')
fs['never_worked'] = (fs['mfe_pct'] < 0.05).astype(int)   # never up 5%+
print(f"never-worked rate overall: {fs['never_worked'].mean() * 100:.0f}%")
for f in ['vex_asym', 'gex_asym', 'net_gex_local', 'pin_score', 'open_field', 'density_100bps', 'fwd_wall_thick']:
    v = fs.dropna(subset=[f])
    q = pd.qcut(v[f], 3, labels=['lo', 'mid', 'hi'], duplicates='drop')
    nw = [f"{t}:{v[q == t]['never_worked'].mean() * 100:3.0f}%" for t in ['lo', 'mid', 'hi']]
    mfe = [f"{t}:{v[q == t]['mfe_pct'].median() * 100:+4.0f}%" for t in ['lo', 'mid', 'hi']]
    print(f'  {f:24} never-worked ' + ' '.join(nw) + '   median MFE ' + ' '.join(mfe))

print('\n=== 4. flags_eq_0 UPGRADES (studies 31-40; n is small — directional evidence only) ===')
z = fs[fs['nflags'] == 0]
print(f'base flags_eq_0: n={len(z)}, ev={ev(z):+.1f}%, win={(z.pnl_atfire > 0).mean() * 100:.0f}%')
CANDS = {
    'vex_asym > median': z['vex_asym'] > fs['vex_asym'].median(),
    'gex_asym > median': z['gex_asym'] > fs['gex_asym'].median(),
    'net_gex_local < 0': z['net_gex_local'] < 0,
    'not stale (move<15bps)': z['stale_move_bps'] < 15,
    'wall migrating away (m30>0)': z['m30_fwd_wall_mig_bps'] > 0,
    'room_consumed < 70%': z['room_consumed_pct'] < 0.7,
    'open_field hi (>median)': z['open_field'] > fs['open_field'].median(),
    'wall_confluence <= 1': z['wall_confluence'] <= 1,
    'pin_score <= 1': z['pin_score'] <= 1,
}
days = sorted(fs['day'].unique()); half = len(days) // 2
for name, m in CANDS.items():
    s = z[m.fillna(False)]
    o = s[s['day'].isin(days[::2])]; e = s[s['day'].isin(days[1::2])]
    print(f'  {name:30} n={len(s):3} ev={ev(s):+6.1f}% win={(s.pnl_atfire > 0).mean() * 100:3.0f}%'
          f'  odd={ev(o):+.1f}% even={ev(e):+.1f}%')
# tail dependency (study 40): top-3-trade share of profits
for name, m in [('base', z['nflags'] == 0), ('with vex_asym>med', z['vex_asym'] > fs['vex_asym'].median())]:
    s = z[m.fillna(False)]
    pos = s[s.pnl_atfire > 0]['pnl_atfire'].sort_values(ascending=False)
    if len(pos) >= 3 and s.pnl_atfire.sum() > 0:
        print(f'  tail-dependency {name:22}: top-3 trades = {pos.iloc[:3].sum() / s.pnl_atfire.sum() * 100:.0f}% of net P&L')
