"""Session 4: foundational GEX/VEX physics on the raw 64-day surface archive.
Does GEX regime predict forward INDEX behavior (no options, no fires)?
H1 pin/trend: negGEX -> larger forward move; posGEX -> smaller (pin).
H2 mean-reversion: posGEX -> forward move toward dominant node.
Sampled every 5-min frame for SPY/QQQ/SPXW, forward horizon 30 min.
"""
import gzip, json, os
from datetime import datetime
import numpy as np
import pandas as pd

rng = np.random.default_rng(4)
GEX = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ARCHIVE = os.path.join(GEX, 'data/skylit-archive/intraday')
TICKERS = ['SPY', 'QQQ', 'SPXW']
DAYS = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))

def to_ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

rows = []
for day in DAYS:
    for tic in TICKERS:
        p = os.path.join(ARCHIVE, day, f'{tic}.jsonl.gz')
        if not os.path.exists(p):
            continue
        frames = []
        for l in gzip.open(p).read().decode().strip().split('\n'):
            r = json.loads(l)
            st = r.get('strikes') or []
            if not st:
                continue
            K = np.array([s['strike'] for s in st], float)
            G = np.array([s.get('gamma') or 0.0 for s in st], float)
            frames.append((to_ms(r['requestedTs']), r['spot'], K, G))
        frames.sort()
        ts = [f[0] for f in frames]
        sp = [f[1] for f in frames]
        for i, (t, S, K, G) in enumerate(frames):
            tot = np.abs(G).sum()
            if tot <= 0:
                continue
            # net local GEX within +-1%
            m = (K >= S * 0.99) & (K <= S * 1.01)
            net_local = G[m].sum() / tot
            # dominant node (wall) location
            wall = K[int(np.argmax(np.abs(G)))]
            # forward 30-min move
            tgt = t + 30 * 60_000
            j = i
            while j < len(frames) - 1 and ts[j] < tgt:
                j += 1
            if ts[j] < t + 20 * 60_000:  # need >=20m forward data
                continue
            fwd_move_bps = (sp[j] - S) / S * 1e4
            toward_wall = np.sign(fwd_move_bps) == np.sign(wall - S) if wall != S else 0
            rows.append(dict(day=day, tic=tic, net_local=net_local,
                             abs_fwd=abs(fwd_move_bps), fwd=fwd_move_bps,
                             wall_dist=(wall - S) / S * 1e4, toward_wall=int(toward_wall)))

d = pd.DataFrame(rows)
print(f"samples: {len(d)} frames across {d.day.nunique()} days x {d.tic.nunique()} tickers")

# H1: forward |move| by GEX tercile
print("\n=== H1 pin/trend: median forward-30m |move| (bps) by net-local-GEX tercile ===")
def h1(sub, label):
    q = pd.qcut(sub['net_local'], 3, labels=['neg', 'mid', 'pos'], duplicates='drop')
    med = {t: sub[q == t]['abs_fwd'].median() for t in ['neg', 'mid', 'pos']}
    mono = med['neg'] > med['mid'] > med['pos']
    print(f"  {label:16} neg {med['neg']:5.1f}  mid {med['mid']:5.1f}  pos {med['pos']:5.1f}  "
          f"{'MONOTONE(neg>pos ✓)' if mono else 'not monotone'}")
    return med
overall = h1(d, 'ALL')
for tic in TICKERS:
    h1(d[d.tic == tic], tic)
dd = sorted(d.day.unique())
h1(d[d.day.isin(dd[::2])], 'odd days')
h1(d[d.day.isin(dd[1::2])], 'even days')

# placebo: shuffle net_local within ticker, recompute neg-minus-pos median gap
real_gap = overall['neg'] - overall['pos']
gaps = []
for _ in range(1000):
    s = d.copy()
    s['net_local'] = s.groupby('tic')['net_local'].transform(lambda x: rng.permutation(x.values))
    q = pd.qcut(s['net_local'], 3, labels=['neg', 'mid', 'pos'], duplicates='drop')
    gaps.append(s[q == 'neg']['abs_fwd'].median() - s[q == 'pos']['abs_fwd'].median())
pct = (real_gap > np.array(gaps)).mean() * 100
print(f"  real neg-minus-pos gap = {real_gap:+.1f}bps | placebo-pctl {pct:.0f}")

# H2: mean-reversion toward dominant node by regime
print("\n=== H2 mean-reversion: P(forward move toward dominant node) by GEX sign ===")
for gl, gm in (('posGEX (net>0)', d.net_local > 0), ('negGEX (net<0)', d.net_local < 0)):
    s = d[gm & (d.wall_dist.abs() > 3)]  # exclude wall≈spot
    print(f"  {gl:16} n={len(s):5}  P(toward wall)={s.toward_wall.mean()*100:.1f}%  "
          f"median fwd|move| {s.abs_fwd.median():.1f}bps")
# baseline
base = d[d.wall_dist.abs() > 3].toward_wall.mean() * 100
print(f"  baseline P(toward wall) = {base:.1f}%")
