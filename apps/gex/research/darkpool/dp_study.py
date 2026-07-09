"""
Dark pool print study — do big DP print levels deflect or absorb price?
Isolated research module (see README). No lookahead: session D uses prints
as of D-1. Placebo control: each real level is compared against offset
pseudo-levels under identical touch logic.

Run: uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/darkpool/dp_study.py
"""
import gzip, json, os, random
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd
from scipy import stats as sps
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
DATA = os.path.join(HERE, 'data')
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
random.seed(42)

TOUCH_EPS = 0.0005   # within 0.05% counts as a touch
RESOLVE_BPS = 10.0   # first to move 10bps beyond/away decides deflect vs break
WINDOW = 6           # 6 x 5min = 30m resolution window
PLACEBOS = 3

def load_spots(day, ticker):
    p = os.path.join(ARCHIVE, day, f'{ticker}.jsonl.gz')
    if not os.path.exists(p): return None
    out = []
    for line in gzip.open(p).read().decode().strip().split('\n'):
        s = json.loads(line)
        out.append(s['spot'])
    return out

# ---------- touch classification ----------
def classify_touches(spots, level):
    """All touches of `level` in a 5-min spot series.
    Returns list of dicts: approach ('support' from above / 'resistance' from below),
    outcome ('deflect' | 'break' | 'unresolved')."""
    res = []
    L = level
    for i in range(1, len(spots)):
        prev, cur = spots[i-1], spots[i]
        if abs(cur - L) / L > TOUCH_EPS: continue
        if abs(prev - L) / L <= TOUCH_EPS: continue  # already at level — not a fresh approach
        approach = 'support' if prev > L else 'resistance'
        outcome = 'unresolved'
        for j in range(i+1, min(i+1+WINDOW, len(spots))):
            move_bps = (spots[j] - L) / L * 1e4
            if approach == 'support':
                if move_bps >= RESOLVE_BPS: outcome = 'deflect'; break     # bounced up off support
                if move_bps <= -RESOLVE_BPS: outcome = 'break'; break      # sold through
            else:
                if move_bps <= -RESOLVE_BPS: outcome = 'deflect'; break    # rejected at resistance
                if move_bps >= RESOLVE_BPS: outcome = 'break'; break       # bought up through
        res.append({'idx': i, 'approach': approach, 'outcome': outcome})
    return res

rows = []
files = sorted(os.listdir(DATA))
for f in files:
    meta = json.load(open(os.path.join(DATA, f)))
    day, ticker = meta['day'], meta['ticker']
    spots = load_spots(day, ticker)
    if not spots: continue
    for lb, prints in [('lb1', meta['lookback1']), ('lb5', meta['lookback5'])]:
        # dedupe near-identical levels (within 0.05%)
        seen = []
        for p in sorted(prints, key=lambda x: -x['notional']):
            if any(abs(p['price'] - s) / s < 0.0005 for s in seen): continue
            seen.append(p['price'])
            for t in classify_touches(spots, p['price']):
                rows.append({'day': day, 'ticker': ticker, 'lb': lb, 'kind': 'real',
                             'level': p['price'], 'notional': p['notional'],
                             'approach': t['approach'], 'outcome': t['outcome']})
            # placebo levels — same magnitude offsets both sides
            for _ in range(PLACEBOS):
                off = random.uniform(0.003, 0.007) * random.choice([-1, 1])
                for t in classify_touches(spots, p['price'] * (1 + off)):
                    rows.append({'day': day, 'ticker': ticker, 'lb': lb, 'kind': 'placebo',
                                 'level': p['price'] * (1 + off), 'notional': p['notional'],
                                 'approach': t['approach'], 'outcome': t['outcome']})
df = pd.DataFrame(rows)
df_res = df[df['outcome'] != 'unresolved'].copy()
df_res['deflect'] = (df_res['outcome'] == 'deflect').astype(int)
print(f'touches: {len(df)} total, {len(df_res)} resolved '
      f'({(df["kind"]=="real").sum()} at real levels, {(df["kind"]=="placebo").sum()} at placebo)')

def rate(sub):
    return len(sub), sub['deflect'].mean() * 100 if len(sub) else np.nan

# ---------- headline: real vs placebo ----------
out_lines = []
def emit(s):
    print(s); out_lines.append(s)

emit('\n== deflection rate: real DP levels vs placebo ==')
tab = []
for kind in ['real', 'placebo']:
    for lb in ['lb1', 'lb5']:
        n, r = rate(df_res[(df_res['kind'] == kind) & (df_res['lb'] == lb)])
        tab.append({'kind': kind, 'lookback': lb, 'touches': n, 'deflect_%': round(r, 1)})
t1 = pd.DataFrame(tab)
emit(t1.to_markdown(index=False))
# significance real vs placebo (pooled)
a = df_res[df_res['kind'] == 'real']['deflect']; b = df_res[df_res['kind'] == 'placebo']['deflect']
z = sps.mannwhitneyu(a, b, alternative='two-sided')
emit(f'real {a.mean()*100:.1f}% vs placebo {b.mean()*100:.1f}%  (Mann-Whitney p={z.pvalue:.4f})')

emit('\n== by approach direction (real levels) ==')
tab = []
for ap in ['support', 'resistance']:
    for kind in ['real', 'placebo']:
        n, r = rate(df_res[(df_res['approach'] == ap) & (df_res['kind'] == kind)])
        tab.append({'approach': ap, 'kind': kind, 'touches': n, 'deflect_%': round(r, 1)})
emit(pd.DataFrame(tab).to_markdown(index=False))

emit('\n== by notional tercile (real levels only) ==')
real = df_res[df_res['kind'] == 'real'].copy()
real['not_t'] = pd.qcut(real['notional'], 3, labels=['small', 'mid', 'large'], duplicates='drop')
tab = []
for nt in ['small', 'mid', 'large']:
    sub = real[real['not_t'] == nt]
    n, r = rate(sub)
    tab.append({'notional': nt, 'median_$B': round(sub['notional'].median()/1e9, 2), 'touches': n, 'deflect_%': round(r, 1)})
emit(pd.DataFrame(tab).to_markdown(index=False))

emit('\n== by ticker (real vs placebo) ==')
tab = []
for tk in ['SPY', 'QQQ']:
    for kind in ['real', 'placebo']:
        n, r = rate(df_res[(df_res['ticker'] == tk) & (df_res['kind'] == kind)])
        tab.append({'ticker': tk, 'kind': kind, 'touches': n, 'deflect_%': round(r, 1)})
emit(pd.DataFrame(tab).to_markdown(index=False))

# ---------- fires near DP levels ----------
cands = [os.path.join(GEX, 'scripts', 'out', f) for f in os.listdir(os.path.join(GEX, 'scripts', 'out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))
levels = {}
for f in files:
    meta = json.load(open(os.path.join(DATA, f)))
    levels[(meta['day'], meta['ticker'])] = [p['price'] for p in meta['lookback1'] + meta['lookback5']]
PREM = 30.0
prow = []
for p in plays:
    if p['ticker'] not in ('SPY', 'QQQ'): continue
    lv = levels.get((p['day'], p['ticker']), [])
    if not lv: continue
    dmin = min(abs(p['entrySpot'] - L) / p['entrySpot'] for L in lv)
    prow.append({'near_dp': dmin <= 0.001, 'dist_bps': dmin * 1e4, 'dir': p['dir'],
                 'ev': max(-1.0, p['capturedBps'] / PREM), 'bps': p['capturedBps']})
tp = pd.DataFrame(prow)
emit(f'\n== fires (SPY/QQQ, n={len(tp)}) near a DP level (≤10bps) vs not ==')
tab = []
for near in [True, False]:
    sub = tp[tp['near_dp'] == near]
    tab.append({'near_dp_level': near, 'n': len(sub), 'optEV_%': round(sub['ev'].mean()*100, 1),
                'win_%': round((sub['bps'] > 0).mean()*100, 1)})
emit(pd.DataFrame(tab).to_markdown(index=False))

# ---------- chart ----------
fig, axes = plt.subplots(1, 2, figsize=(11, 4))
g = df_res.groupby(['kind', 'lb'])['deflect'].mean().mul(100).unstack()
g.plot(kind='bar', ax=axes[0], rot=0)
axes[0].set_ylabel('deflection rate %'); axes[0].set_title('Real DP levels vs placebo')
axes[0].axhline(50, color='k', lw=0.5, ls='--')
rn = real.groupby('not_t', observed=True)['deflect'].mean().mul(100)
rn.plot(kind='bar', ax=axes[1], rot=0, color='tab:green')
axes[1].set_ylabel('deflection rate %'); axes[1].set_title('Real levels by print notional')
axes[1].axhline(df_res[df_res['kind']=='placebo']['deflect'].mean()*100, color='r', lw=1, ls='--', label='placebo baseline')
axes[1].legend()
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'dp_deflection.png'), dpi=150); plt.close(fig)

df_res.to_csv(os.path.join(OUT, 'touches.csv'), index=False)
open(os.path.join(OUT, 'DP_STUDY_RAW.md'), 'w').write('\n'.join(str(x) for x in out_lines))
print('\nwritten:', OUT)
