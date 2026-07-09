"""Placebo battery (studies 71-77) on the edge-scan survivors.
For each candidate feature: real tercile gap vs
  - date-shuffle (feature values permuted across days, within ticker)
  - direction-shuffle (bull/bear labels flipped at random for dir-relative feats)
  - ticker-shuffle (feature values swapped across tickers, same day)
  - threshold sensitivity (gap at nearby tercile boundaries 30/70, 40/60)
A real edge: real gap >> the shuffle distribution (report percentile).
"""
import os
import numpy as np
import pandas as pd

rng = np.random.default_rng(7)
HERE = os.path.dirname(__file__)
df = pd.read_parquet(os.path.join(HERE, 'outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy().reset_index(drop=True)
fs['cap'] = fs['entry_atfire'] * 100

def ev(p, c):
    return p.sum() / c.sum() * 100 if c.sum() > 0 else np.nan

def gap(vals, pnl, cap, qlo=1/3, qhi=2/3):
    m = ~np.isnan(vals)
    v, p, c = vals[m], pnl[m], cap[m]
    lo, hi = np.quantile(v, qlo), np.quantile(v, qhi)
    return ev(p[v >= hi], c[v >= hi]) - ev(p[v <= lo], c[v <= lo])

CANDS = ['vex_asym', 'gex_asym', 'dn_vex_mass', 'wall_dn_thick', 'net_gex_local',
         'spot_vs_twap_bps', 'm30_px_move_bps', 'open_field', 'rev_gex_pct']
N = 500
pnl, cap = fs['pnl_atfire'].values, fs['cap'].values
days_arr = fs['day'].values
tick = fs['ticker'].values

print(f'=== PLACEBO BATTERY ({N} shuffles each) — real gap vs shuffle percentile ===')
for f in CANDS:
    vals = fs[f].values.astype(float)
    real = gap(vals, pnl, cap)
    # date-shuffle: permute whole-day blocks of feature values within ticker
    date_gaps = []
    for _ in range(N):
        shuf = vals.copy()
        for t in np.unique(tick):
            tm = tick == t
            udays = np.unique(days_arr[tm])
            perm = dict(zip(udays, rng.permutation(udays)))
            # move each day's values to another day's fires (by rank alignment)
            by_day = {d: vals[tm & (days_arr == d)] for d in udays}
            out = shuf[tm].copy()
            pos = 0
            idxs = np.where(tm)[0]
            for d in udays:
                tgt = by_day[perm[d]]
                n = (days_arr[idxs] == d).sum()
                src = np.resize(tgt, n) if len(tgt) else np.full(n, np.nan)
                out[days_arr[idxs] == d] = src
            shuf[tm] = out
        date_gaps.append(gap(shuf, pnl, cap))
    date_pct = (np.abs(real) > np.abs(np.array(date_gaps))).mean() * 100
    # simple full permutation placebo
    perm_gaps = [gap(rng.permutation(vals), pnl, cap) for _ in range(N)]
    perm_pct = (np.abs(real) > np.abs(np.array(perm_gaps))).mean() * 100
    # ticker-shuffle: rotate feature values among tickers within same day
    tick_gaps = []
    for _ in range(N):
        shuf = vals.copy()
        for d in np.unique(days_arr):
            dm = days_arr == d
            shuf[dm] = rng.permutation(vals[dm])
        tick_gaps.append(gap(shuf, pnl, cap))
    tick_pct = (np.abs(real) > np.abs(np.array(tick_gaps))).mean() * 100
    # threshold sensitivity
    g37 = gap(vals, pnl, cap, 0.30, 0.70)
    g46 = gap(vals, pnl, cap, 0.40, 0.60)
    same_sign = np.sign(real) == np.sign(g37) == np.sign(g46)
    print(f'{f:20} real={real:+6.1f}pp | perm-pctl={perm_pct:3.0f} date-pctl={date_pct:3.0f} '
          f'within-day-pctl={tick_pct:3.0f} | thr 30/70={g37:+5.1f} 40/60={g46:+5.1f} stable={"Y" if same_sign else "N"}')

# direction-shuffle (study 74): flip dir labels; direction-relative features recompute impossible,
# so instead test whether |asym| signal is direction-CONDITIONAL: real signed edge for dir-aligned version
print('\n=== direction test: vex_asym aligned with fire direction ===')
fs['vex_asym_dir'] = fs['vex_asym'] * fs['dir']   # + = vex mass in fire direction
for f in ['vex_asym_dir']:
    real = gap(fs[f].values.astype(float), pnl, cap)
    perm_gaps = [gap(rng.permutation(fs[f].values.astype(float)), pnl, cap) for _ in range(N)]
    pct = (np.abs(real) > np.abs(np.array(perm_gaps))).mean() * 100
    print(f'{f:20} real={real:+6.1f}pp perm-pctl={pct:3.0f}')
