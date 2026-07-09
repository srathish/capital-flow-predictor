"""Full stability + placebo verification of the candidate RULES that emerged:
  R1: bulls require spot above gamma flip (flip reclaim)
  R2: never fire against an opening-range break
  R3: OR-breakout fires require non-dense GEX ahead (density_100bps low)
  R4: dn_vex_mass poison — per-ticker tercile decomposition (study 57 anomaly)
"""
import os
import numpy as np
import pandas as pd

rng = np.random.default_rng(23)
HERE = os.path.dirname(__file__)
df = pd.read_parquet(os.path.join(HERE, 'outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy().reset_index(drop=True)
fs['cap'] = fs['entry_atfire'] * 100

def ev(s):
    return s['pnl_atfire'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else np.nan

days = sorted(fs['day'].unique()); half = len(days) // 2
CUTS = [('odd', fs['day'].isin(days[::2])), ('even', fs['day'].isin(days[1::2])),
        ('H1', fs['day'].isin(days[:half])), ('H2', fs['day'].isin(days[half:]))]

def verify(name, bad_mask, n_placebo=500):
    """bad_mask = fires the rule would BLOCK."""
    bad_mask = bad_mask.fillna(False)
    blocked, kept = fs[bad_mask], fs[~bad_mask]
    print(f'\n{name}')
    print(f'  blocks n={len(blocked)} @ {ev(blocked):+.1f}% | keeps n={len(kept)} @ {ev(kept):+.1f}% | system {ev(fs):+.1f}% -> {ev(kept):+.1f}%')
    holds = 0
    for cname, cmask in CUTS:
        b, k = fs[bad_mask & cmask], fs[~bad_mask & cmask]
        ok = ev(b) < ev(k) if (ev(b) == ev(b) and ev(k) == ev(k)) else False
        holds += ok
        print(f'    {cname:4} blocked {ev(b):+6.1f}% vs kept {ev(k):+6.1f}%  {"OK" if ok else "FAIL"}')
    for t in ['SPY', 'QQQ', 'SPXW']:
        tm = fs['ticker'] == t
        print(f'    {t:4} blocked {ev(fs[bad_mask & tm]):+6.1f}% (n={int((bad_mask & tm).sum()):3}) vs kept {ev(fs[~bad_mask & tm]):+6.1f}%')
    # placebo: random masks of same size
    k = int(bad_mask.sum()); reals = ev(fs[bad_mask])
    worse = 0
    for _ in range(n_placebo):
        m = np.zeros(len(fs), bool); m[rng.choice(len(fs), k, replace=False)] = True
        if ev(fs[m]) <= reals:
            worse += 1
    print(f'    placebo: blocked-set is worse than {100 - 100 * worse / n_placebo:.0f}% of random same-size sets; holds {holds}/4')

verify('R1: block bulls below gamma flip',
       (fs['dir'] > 0) & (fs['flip_dist_bps'] >= 0))
verify('R2: block fires AGAINST opening-range break',
       (fs['or_break_dir'] * fs['dir']) < 0)
verify('R3: block OR-breakout fires into dense GEX (density_100bps top tercile)',
       ((fs['or_break_dir'] * fs['dir']) > 0) & (fs['density_100bps'] > fs['density_100bps'].quantile(0.67)))

print('\nR4: dn_vex_mass terciles PER TICKER (study 57 anomaly decomposition)')
for t in ['SPY', 'QQQ', 'SPXW']:
    s = fs[fs['ticker'] == t].dropna(subset=['dn_vex_mass'])
    q = pd.qcut(s['dn_vex_mass'], 3, labels=False, duplicates='drop')
    print(f'  {t:5} lo {ev(s[q == 0]):+6.1f}%({(q == 0).sum()})  mid {ev(s[q == 1]):+6.1f}%({(q == 1).sum()})  hi {ev(s[q == 2]):+6.1f}%({(q == 2).sum()})')
# and with GLOBAL terciles (as the aggregate scan used)
qlo, qhi = fs['dn_vex_mass'].quantile(1/3), fs['dn_vex_mass'].quantile(2/3)
for t in ['SPY', 'QQQ', 'SPXW']:
    s = fs[fs['ticker'] == t]
    print(f'  {t:5} GLOBAL cuts: lo {ev(s[s.dn_vex_mass <= qlo]):+6.1f}%({(s.dn_vex_mass <= qlo).sum()})  '
          f'mid {ev(s[(s.dn_vex_mass > qlo) & (s.dn_vex_mass < qhi)]):+6.1f}%  hi {ev(s[s.dn_vex_mass >= qhi]):+6.1f}%({(s.dn_vex_mass >= qhi).sum()})')

print('\nCombined: R1+R2 together on top of system')
combo = (((fs['dir'] > 0) & (fs['flip_dist_bps'] >= 0)) | ((fs['or_break_dir'] * fs['dir']) < 0)).fillna(False)
kept = fs[~combo]
print(f'  system {ev(fs):+.1f}% (n={len(fs)}) -> {ev(kept):+.1f}% (n={len(kept)})')
for cname, cmask in CUTS:
    print(f'    {cname:4} {ev(fs[cmask]):+6.1f}% -> {ev(fs[~combo & cmask]):+6.1f}%')
z = fs[fs['nflags'] == 0]
zk = z[~combo.reindex(z.index, fill_value=False)]
print(f'  flags_eq_0: {ev(z):+.1f}% (n={len(z)}) -> {ev(zk):+.1f}% (n={len(zk)})')
