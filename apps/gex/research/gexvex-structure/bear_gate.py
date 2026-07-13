"""BEAR tape gate backtest — mirror of the validated bull tape gate.

Bull gate (armed): block BULL fires when SPY+QQQ+SPXW ALL below prior close.
Strict mirror BEAR gate (under test): block BEAR fires when SPY+QQQ+SPXW
ALL ABOVE prior close (buying puts into unanimously green tape).

We reconstruct the per-fire 3-index tape context from the Skylit archive
exactly the way the live gate reads it (bull-tape-gate.js): for each index
ticker, current spot at fire time vs prior-session close (last frame of the
prior archive day). We first RE-VALIDATE the published bull cell
(0/3 above, n=117, -15% EV) to prove the reconstruction is faithful, then
compute the bear mirror and the incremental-over-G7-PC question.
"""
import gzip, json, os, bisect
from datetime import datetime
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX_ROOT, 'data/skylit-archive/intraday')
FIRES = os.path.join(HERE, 'outputs/fires_structure.parquet')
TAPE_TICKERS = ['SPY', 'QQQ', 'SPXW']

def to_ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

ARCH_DAYS = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))

_spot_cache = {}
def spot_series(day, ticker):
    """(ts[], spot[]) for a ticker-day, ascending ts."""
    key = (day, ticker)
    if key in _spot_cache:
        return _spot_cache[key]
    p = os.path.join(ARCHIVE, day, f'{ticker}.jsonl.gz')
    ts, sp = [], []
    if os.path.exists(p):
        for line in gzip.open(p).read().decode().strip().split('\n'):
            if not line:
                continue
            r = json.loads(line)
            if r.get('spot') is None:
                continue
            ts.append(to_ms(r['requestedTs'])); sp.append(float(r['spot']))
        order = np.argsort(ts)
        ts = [ts[i] for i in order]; sp = [sp[i] for i in order]
    _spot_cache[key] = (ts, sp)
    return ts, sp

def spot_at(day, ticker, tsms):
    ts, sp = spot_series(day, ticker)
    if not ts:
        return None
    i = bisect.bisect_right(ts, tsms) - 1
    return sp[i] if i >= 0 else None

def prior_close(day, ticker):
    """Last archived spot of the prior archive day (prior session close)."""
    if day not in ARCH_DAYS:
        return None
    di = ARCH_DAYS.index(day)
    if di == 0:
        return None
    ts, sp = spot_series(ARCH_DAYS[di - 1], ticker)
    return sp[-1] if sp else None

# ---------- load fires ----------
df = pd.read_parquet(FIRES)
fs = df[df['final_sys']].copy().reset_index(drop=True)
fs['cap'] = fs['entry_atfire'] * 100

def ev(s):
    return s['pnl_atfire'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else np.nan
def winrate(s):
    return (s['pnl_atfire'] > 0).mean() * 100 if len(s) else np.nan

# ---------- reconstruct 3-index tape per fire ----------
n_above, miss = [], []
per_idx_above = {t: [] for t in TAPE_TICKERS}
for _, r in fs.iterrows():
    day, tsms = r['day'], int(r['fireTsMs'])
    cnt = 0; missing = False
    for t in TAPE_TICKERS:
        s = spot_at(day, t, tsms); pc = prior_close(day, t)
        if s is None or pc is None:
            missing = True; per_idx_above[t].append(np.nan); continue
        ab = s > pc
        per_idx_above[t].append(1.0 if ab else 0.0)
        cnt += 1 if ab else 0
    n_above.append(np.nan if missing else cnt)
    miss.append(missing)

fs['n_idx_above'] = n_above
fs['tape_missing'] = miss
for t in TAPE_TICKERS:
    fs[f'{t}_above'] = per_idx_above[t]

cov = fs['n_idx_above'].notna().mean() * 100
print(f'Fires: {len(fs)} final_sys ({int((fs.dir>0).sum())} bull / {int((fs.dir<0).sum())} bear)')
print(f'3-index tape reconstructed with coverage {cov:.0f}% '
      f'(missing {int(fs.tape_missing.sum())})')

bulls = fs[fs['dir'] > 0]
bears = fs[fs['dir'] < 0]

# ---------- (A) RE-VALIDATE bull cell to prove faithful reconstruction ----------
print('\n=== (A) BULL gate re-validation (reconstruction check) ===')
for k in [0, 1, 2, 3]:
    c = bulls[bulls['n_idx_above'] == k]
    print(f'  bulls {k}/3 above: n={len(c):3}  EV={ev(c):+6.1f}%  win={winrate(c):4.0f}%')
print(f'  [published: bulls 0/3 above n=117, EV -15.0%, win 43%]')

# ---------- (B) BEAR mirror cell: 3/3 ABOVE prior close ----------
print('\n=== (B) BEAR mirror: puts into unanimously GREEN tape (3/3 above) ===')
for k in [0, 1, 2, 3]:
    c = bears[bears['n_idx_above'] == k]
    print(f'  bears {k}/3 above: n={len(c):3}  EV={ev(c):+6.1f}%  win={winrate(c):4.0f}%')
bear_block = bears[bears['n_idx_above'] == 3]        # strict all-3 bear gate blocks these
bear_keep = bears[bears['n_idx_above'] < 3]
print(f'\n  STRICT bear gate blocks bears 3/3-above: n={len(bear_block)} '
      f'EV={ev(bear_block):+.1f}% win={winrate(bear_block):.0f}%')
print(f'  bears kept:                              n={len(bear_keep)} '
      f'EV={ev(bear_keep):+.1f}%')
print(f'  all bears system: n={len(bears)} EV={ev(bears):+.1f}% -> kept EV={ev(bear_keep):+.1f}%')

# ---------- (C) INCREMENTAL over G7-PC ----------
# G7-PC already requires the FIRED ticker's own spot < its prior close.
# So a bear fire that G7-PC ALLOWS already has (fired ticker above? -> would be
# blocked by G7-PC). Reconstruct the fired ticker's own above/below.
print('\n=== (C) Incremental value over G7-PC (fired-ticker spot<prior_close) ===')
fired_above = []
for _, r in bears.iterrows():
    t = r['ticker']
    s = spot_at(r['day'], t, int(r['fireTsMs'])); pc = prior_close(r['day'], t)
    fired_above.append(np.nan if (s is None or pc is None) else (1.0 if s > pc else 0.0))
bears = bears.copy()
bears['fired_above'] = fired_above
# G7-PC ALLOWS a bear only when fired ticker spot < prior close (fired_above==0)
g7_allowed = bears[bears['fired_above'] == 0]
g7_blocked = bears[bears['fired_above'] == 1]
print(f'  G7-PC bear requirement (fired ticker < prior close):')
print(f'    G7-PC ALLOWS: n={len(g7_allowed):3} EV={ev(g7_allowed):+6.1f}%  '
      f'(fired ticker below its prior close)')
print(f'    G7-PC BLOCKS: n={len(g7_blocked):3} EV={ev(g7_blocked):+6.1f}%  '
      f'(fired ticker already above -> never reaches strict gate)')
# The strict all-3 gate only ADDS blocking among G7-PC-ALLOWED bears that are
# nonetheless 3/3-above. But if fired ticker is below its prior close, can all
# 3 be above? Only if the fired ticker is NOT one of SPY/QQQ/SPXW... but all
# fires ARE one of these. So fired_above==0 => that index is below => n_above<=2.
incr = g7_allowed[g7_allowed['n_idx_above'] == 3]
print(f'\n  Bears that G7-PC ALLOWS *and* strict-all-3 gate would ALSO block:')
print(f'    n={len(incr)}  (these are the ONLY incremental blocks)')
print(f'    -> mechanically: a G7-PC-allowed bear has its own index below prior')
print(f'       close, so n_idx_above<=2 by construction; all-3-above is impossible.')

# cross-tab to make the no-op explicit
print('\n  Cross-tab bears: fired_above x n_idx_above')
ct = pd.crosstab(bears['fired_above'], bears['n_idx_above'], dropna=False)
print(ct.to_string())

# ---------- (D) Stability cuts on the bear mirror cell ----------
print('\n=== (D) Stability cuts: strict bear gate (block bears 3/3-above) ===')
days = sorted(fs['day'].unique()); half = len(days) // 2
CUTS = [('odd', set(days[::2])), ('even', set(days[1::2])),
        ('H1', set(days[:half])), ('H2', set(days[half:]))]
bmask = (fs['dir'] < 0) & (fs['n_idx_above'] == 3)
kmask_bear = (fs['dir'] < 0) & (fs['n_idx_above'] < 3)
for cname, dset in CUTS:
    dm = fs['day'].isin(dset)
    b = fs[bmask & dm]; k = fs[kmask_bear & dm]
    ok = (ev(b) < ev(k)) if (ev(b) == ev(b) and ev(k) == ev(k)) else None
    print(f'  {cname:4} blocked n={len(b):2} EV={ev(b):+7.1f}% vs kept n={len(k):3} '
          f'EV={ev(k):+6.1f}%  {"OK" if ok else ("FAIL" if ok is False else "n/a")}')
print('  per-ticker (bear 3/3-above blocked cell):')
for t in TAPE_TICKERS:
    tm = fs['ticker'] == t
    b = fs[bmask & tm]
    print(f'    {t:4} blocked n={len(b):2} EV={ev(b):+7.1f}%')

# ---------- (E) sanity: does ANY bull comparison show the mirror asymmetry ----------
print('\n=== (E) Symmetry reference: bull worst-cell vs bear worst-cell ===')
print(f'  bull 0/3-above (blocked by armed gate): n={len(bulls[bulls.n_idx_above==0])} '
      f'EV={ev(bulls[bulls.n_idx_above==0]):+.1f}%')
print(f'  bear 3/3-above (strict mirror target):  n={len(bear_block)} '
      f'EV={ev(bear_block):+.1f}%')
