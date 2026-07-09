"""Session 2 item 2: trigger-conditioned TRAIL-PRESERVING hold.
Pre-registered in BACKLOG #1 (s2 refinement): on trigger (aligned move
>=40bps AND ER>=0.40 at the system's exit moment), suppress the exit but
keep a trail stop armed, simulated on UW 1-min candles from exit time to
15:55. Trail: peak-tracking from hold start, exit when mark drops
{15,25,35}% off peak. Bar: delta >+15pp, ALL four cuts positive,
placebo >=95th, giveback grid same-sign.
"""
import gzip, json, os
from datetime import datetime
import numpy as np
import pandas as pd

rng = np.random.default_rng(99)
GEX = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CANDLES = os.path.join(GEX, 'research/uw/candles')

df = pd.read_parquet(os.path.join(GEX, 'research/gexvex-structure/outputs/fires_structure.parquet'))
fs = df[df['final_sys']].copy()
holds = pd.read_parquet(os.path.join(GEX, 'research/sessions/outputs_s2_holds.parquet'))
# rebuild the trigger mask in fire order (same construction as s2)
key = ['day', 'ticker']
fs = fs.reset_index(drop=True)

def candle_path(occ, day, from_ms):
    """Minute marks (close) strictly after from_ms through 15:55 ET, ascending."""
    p = os.path.join(CANDLES, f'{occ}_{day}.json')
    if not os.path.exists(p):
        return []
    out = []
    for r in json.load(open(p)):
        t = r.get('start_time', '')
        if t[:10] != day:
            continue
        d = datetime.fromisoformat(t.replace('Z', '+00:00'))
        ms = int(d.timestamp() * 1000)
        mins = d.hour * 60 + d.minute
        if ms > from_ms and mins <= 19 * 60 + 55:
            out.append((ms, float(r['close'])))
    return sorted(out)

def simulate(row, giveback):
    """Return held-exit pnl for one fire, trail-preserving."""
    path = candle_path(row['occ'], row['day'], int(row['exitTsMs']))
    if not path:
        return None  # no trades after exit -> cannot hold, keep system exit
    entry = row['entry_atfire']
    start_mark = entry + row['pnl_atfire'] / 100  # system exit mark = hold start
    peak = max(start_mark, 0.01)
    for _, m in path:
        peak = max(peak, m)
        if m <= peak * (1 - giveback):
            return (m - entry) * 100
    return (path[-1][1] - entry) * 100

# trigger from s2 dataset (aligned_move, er are per-fire, same order as fs rows with coverage)
h = holds  # 537 rows, same fires
trig_mask = (h['aligned_move'] >= 40) & (h['er'] >= 0.40)
fs2 = fs.iloc[h.index].copy() if len(h) != len(fs) else fs.copy()
fs2['trig'] = trig_mask.values
fs2['cap'] = fs2['entry_atfire'] * 100

def run_policy(giveback):
    deltas, used = [], 0
    for _, r in fs2[fs2['trig']].iterrows():
        pnl_hold = simulate(r, giveback)
        if pnl_hold is None:
            deltas.append(0.0)  # no post-exit trades -> system exit stands
        else:
            used += 1
            deltas.append(pnl_hold - r['pnl_atfire'])
    t = fs2[fs2['trig']].copy()
    t['delta'] = deltas
    return t, used

def report(t, used, label, placebo=False):
    cap = t['cap'].sum()
    dl = t['delta'].sum() / cap * 100
    sys_all = fs2['pnl_atfire'].sum(); cap_all = fs2['cap'].sum()
    pol_all = sys_all + t['delta'].sum()
    days = sorted(t['day'].unique()); half = max(1, len(days) // 2)
    cuts = []
    for sel in (days[::2], days[1::2], days[:half], days[half:]):
        s = t[t['day'].isin(sel)]
        cuts.append(s['delta'].sum() / s['cap'].sum() * 100 if len(s) and s['cap'].sum() > 0 else float('nan'))
    line = (f'{label:28} n={len(t)} (held {used}) delta {dl:+6.1f}pp | system '
            f'{sys_all/cap_all*100:+5.1f}% -> {pol_all/cap_all*100:+5.1f}% | '
            f'odd {cuts[0]:+.0f} even {cuts[1]:+.0f} H1 {cuts[2]:+.0f} H2 {cuts[3]:+.0f}')
    if placebo:
        # random same-size fire subsets given the SAME hold simulation applied
        real = dl; k = len(t); worse = 0
        base = fs2.copy()
        for i in range(300):
            idx = rng.choice(len(base), k, replace=False)
            s = base.iloc[idx]
            ds = []
            for _, r in s.iterrows():
                ph = simulate(r, 0.25)
                ds.append(0.0 if ph is None else ph - r['pnl_atfire'])
            if sum(ds) / s['cap'].sum() * 100 >= real:
                worse += 1
        line += f' | placebo-pctl {100 - worse / 3:.0f}'
    print(line)
    # tail metrics
    per = t['delta'] / t['cap']
    print(f'{"":28} median {per.median()*100:+.1f}pp, improved {(t.delta>0).mean()*100:.0f}%, '
          f'give-back>50pp {(per < -0.5).mean()*100:.0f}%, '
          f'delta-without-top3 {(t.delta.sum()-t.delta.nlargest(3).sum())/cap*100:+.1f}pp')

print('=== TRAIL-PRESERVING HOLD on trigger (move>=40 & ER>=0.40) ===')
for gb in (0.15, 0.25, 0.35):
    t, used = run_policy(gb)
    report(t, used, f'giveback {int(gb*100)}%', placebo=(gb == 0.25))
