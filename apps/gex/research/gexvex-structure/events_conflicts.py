"""Event + interaction studies: 12 (flip reclaim/reject), 13 (compression->
expansion), 14 (structure reset), 25 (opening range), 26 (trend day x GEX),
41-47 (conflicts), 54 (theta drag), 57 (ticker x structure), 58 (next-expiry
defense). Plus interaction-level placebo for flags_eq_0 x open_field.
"""
import os
import numpy as np
import pandas as pd

rng = np.random.default_rng(11)
HERE = os.path.dirname(__file__)
df = pd.read_parquet(os.path.join(HERE, 'outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy()
fs['cap'] = fs['entry_atfire'] * 100

def ev(s):
    return s['pnl_atfire'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else np.nan

def line(s, label):
    print(f'  {label:46} n={len(s):4} ev={ev(s):+6.1f}% win={(s.pnl_atfire > 0).mean() * 100 if len(s) else float("nan"):3.0f}%')

print('=== STUDY 12: gamma-flip position as confirmation ===')
# spot above/below flip at fire, aligned with direction
above_flip = fs['flip_dist_bps'] < 0     # flip below spot -> spot has RECLAIMED above flip
line(fs[(fs['dir'] > 0) & above_flip], 'bulls with spot ABOVE flip (reclaimed)')
line(fs[(fs['dir'] > 0) & ~above_flip], 'bulls with spot BELOW flip')
line(fs[(fs['dir'] < 0) & ~above_flip], 'bears with spot BELOW flip (rejected)')
line(fs[(fs['dir'] < 0) & above_flip], 'bears with spot ABOVE flip')

print('\n=== STUDY 13: compression -> expansion ===')
rng_chg = fs['m30_wall_up_mig_bps'] - fs['m30_wall_dn_mig_bps']   # <0 = wall range compressed over 30m
v = fs.dropna(subset=['wall_range_bps']).copy()
v['compressed'] = rng_chg.reindex(v.index) < -5
v['tight'] = v['wall_range_bps'] < v['wall_range_bps'].median()
line(v[v['compressed'] & v['tight']], 'compressing AND tight range (squeeze)')
line(v[v['compressed'] & ~v['tight']], 'compressing, wide range')
line(v[~v['compressed'] & v['tight']], 'static tight range')
line(v[~v['compressed'] & ~v['tight']], 'static wide range')

print('\n=== STUDY 14: structure reset after displacement ===')
big = fs['big_open'] == True
line(fs[big], 'big-open days (displacement)')
line(fs[~big], 'normal days')
# do structure features still work after displacement? vex_asym gap in each
for lbl, m in (('big-open', big), ('normal', ~big)):
    s = fs[m].dropna(subset=['vex_asym'])
    if len(s) > 30:
        q = pd.qcut(s['vex_asym'], 3, labels=False, duplicates='drop')
        print(f'    vex_asym gap on {lbl}: hi-lo = {ev(s[q == 2]) - ev(s[q == 0]):+.1f}pp (n={len(s)})')

print('\n=== STUDY 25: opening range interaction ===')
line(fs[fs['fire_in_or'] == 1], 'fire INSIDE opening range')
osb = fs['or_break_dir'] * fs['dir']
line(fs[osb > 0], 'fire WITH opening-range break')
line(fs[osb < 0], 'fire AGAINST opening-range break')

print('\n=== STUDY 26: GEX sign x trend day ===')
for gs, gl in ((fs['net_gex_local'] > 0, 'posGEX'), (fs['net_gex_local'] <= 0, 'negGEX')):
    for td, tl in ((fs['trend_day'] == True, 'trend'), (fs['trend_day'] != True, 'non-trend')):
        line(fs[gs & td], f'{gl} x {tl}')

print('\n=== CONFLICT STUDIES 41-47 ===')
vix = fs.dropna(subset=['vixd15'])
pin_hi = vix['pin_score'] >= 2
vix_up = vix['vixd15'] > 0
line(vix[pin_hi & vix_up], '41: GEX says pin, VIX expanding')
line(vix[pin_hi & ~vix_up], '41: GEX says pin, VIX flat/down')
neg = vix['net_gex_local'] < 0
line(vix[neg & vix_up], '42: negGEX + VIX expanding')
line(vix[neg & ~vix_up], '42: negGEX + VIX compressing')
vex_hi = fs['vex_asym'] > fs['vex_asym'].median()
line(fs[vex_hi & (fs['flow_extreme'] == True)], '43: VEX good + flow EXTREME')
line(fs[vex_hi & (fs['flow_extreme'] != True)], '43: VEX good + flow normal')
fa = fs['flow_agree5'] == True
thick = fs['fwd_wall_thick'] > fs['fwd_wall_thick'].quantile(0.67)
line(fs[fa & thick], '44: flow says go, wall THICK ahead')
line(fs[fa & ~thick], '44: flow says go, wall thin ahead')
brk = (fs['or_break_dir'] * fs['dir']) > 0
dense = fs['density_100bps'] > fs['density_100bps'].quantile(0.67)
line(fs[brk & dense], '45: OR breakout INTO dense GEX')
line(fs[brk & ~dense], '45: OR breakout into open space')
good_struct = vex_hi & (fs['wall_dn_thick'] < fs['wall_dn_thick'].median())
rich = fs['prem_pct'] > fs['prem_pct'].quantile(0.67)
line(fs[good_struct & rich], '46: structure GO + premium rich')
line(fs[good_struct & ~rich], '46: structure GO + premium fair')
agree = (fa.astype(int) + vex_hi.astype(int) + brk.astype(int) +
         (fs['m30_px_move_bps'] * fs['dir'] > 0).astype(int))
for k in range(5):
    line(fs[agree == k], f'47: {k}/4 signals agree (lateness test)')

print('\n=== STUDY 54: positive GEX theta drag ===')
for gs, gl in ((fs['net_gex_local'] > 0, 'posGEX'), (fs['net_gex_local'] <= 0, 'negGEX')):
    s = fs[gs]
    hold_min = (s['exitTsMs'] - s['fireTsMs']) / 60000
    print(f'  {gl}: median hold {hold_min.median():.0f}m, median t_peak {s.t_peak_min.median():.0f}m, '
          f'ev {ev(s):+.1f}%, MFE med {s.mfe_pct.median():.0f}%, never-worked {(s.mfe_pct < 5).mean() * 100:.0f}%')

print('\n=== STUDY 57: ticker x structure (who pays when structure is good/bad) ===')
for t in ['SPY', 'QQQ', 'SPXW']:
    s = fs[fs['ticker'] == t]
    line(s[s['dn_vex_mass'] <= fs['dn_vex_mass'].median()], f'{t} clean structure (dn_vex low)')
    line(s[s['dn_vex_mass'] > fs['dn_vex_mass'].median()], f'{t} poison structure (dn_vex high)')

print('\n=== STUDY 58: next-expiry defense by regime ===')
ne = fs.dropna(subset=['pnl_nextexp'])
ne['cap'] = ne['entry_atfire'] * 100
for gs, gl in ((ne['net_gex_local'] > 0, 'posGEX/pin regime'), (ne['net_gex_local'] <= 0, 'negGEX/expansion')):
    s = ne[gs]
    e0 = s['pnl_atfire'].sum() / s['cap'].sum() * 100
    e1 = s['pnl_nextexp'].sum() / s['cap'].sum() * 100
    print(f'  {gl:24} n={len(s):3}  0DTE {e0:+6.1f}%  next-expiry {e1:+6.1f}%')

print('\n=== INTERACTION PLACEBO: flags_eq_0 x open_field (500 shuffles) ===')
z = fs[fs['nflags'] == 0].dropna(subset=['open_field'])
med = fs['open_field'].median()
real = ev(z[z['open_field'] > med]) - ev(z[z['open_field'] <= med])
gaps = []
for _ in range(500):
    sh = rng.permutation(z['open_field'].values)
    gaps.append(ev(z[sh > med]) - ev(z[sh <= med]))
pct = (abs(real) > np.abs(np.array(gaps))).mean() * 100
print(f'  real gap {real:+.1f}pp, placebo percentile {pct:.0f} (n={len(z)})')
z2 = fs[fs['nflags'] == 0].dropna(subset=['vex_asym'])
medv = fs['vex_asym'].median()
realv = ev(z2[z2['vex_asym'] > medv]) - ev(z2[z2['vex_asym'] <= medv])
gapsv = [ev(z2[rng.permutation(z2['vex_asym'].values) > medv]) -
         ev(z2[rng.permutation(z2['vex_asym'].values) <= medv]) for _ in range(500)]
print(f'  flags0 x vex_asym: real {realv:+.1f}pp, pctl {(abs(realv) > np.abs(np.array(gapsv))).mean() * 100:.0f}')
