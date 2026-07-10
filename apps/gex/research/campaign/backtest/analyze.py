"""Cohort-backtest step 4: real option-dollar outcomes per arm + verdict.

For each leg: entry at the cohort date, forward +10d/+20d, and the in-window
MAX (spike) from the contract's real daily price series. Compares the four
arms (intersection / flow_only / node_only / placebo), applies a spread-cost
haircut, checks stability, and states whether the INTERSECTION beats the
ablations and the placebo — i.e. whether flow x GEX/VEX carries the edge.
"""
import json
import os
import statistics as st

HERE = os.path.dirname(__file__)
PRICE = os.path.join(HERE, 'price_cache')
COST = 0.06   # round-trip option spread haircut (stocks; ~3% each way)
TP = 1.00     # take-profit policy: exit first day up >= +100%

cohorts = json.load(open(os.path.join(HERE, 'cohorts.json')))
series_cache = {}


def series(occ):
    if occ not in series_cache:
        p = os.path.join(PRICE, f'{occ}.json')
        s = None
        if os.path.exists(p):
            j = json.load(open(p))
            if isinstance(j, list) and j:
                s = sorted(j, key=lambda r: r['date'])
        series_cache[occ] = s
    return series_cache[occ]


def outcome(leg):
    s = series(leg['occ'])
    if not s:
        return None
    # entry = first row on/after the cohort date
    ei = next((i for i, r in enumerate(s) if r['date'] >= leg['cohort']), None)
    if ei is None or s[ei]['px'] <= 0:
        return None
    entry = s[ei]['px']
    win = s[ei:ei + 21]
    if len(win) < 6:
        return None
    def ret(px):
        return (px - entry) / entry
    fwd10 = ret(win[min(10, len(win) - 1)]['px'])
    fwd20 = ret(win[-1]['px'])
    mx = max(ret(r['hi']) for r in win)
    # take-profit policy: first day the HIGH crosses +TP, else hold to end
    tp = None
    for r in win[1:]:
        if ret(r['hi']) >= TP:
            tp = TP; break
    if tp is None:
        tp = fwd20
    return dict(entry=entry, fwd10=fwd10, fwd20=fwd20, mx=mx, tp=tp)


rows = []
for leg in cohorts:
    o = outcome(leg)
    if o:
        rows.append({**leg, **o})

print(f"priced legs: {len(rows)} / {len(cohorts)}")


def agg(arm, key='fwd20', net=True):
    xs = [r[key] - (COST if net else 0) for r in rows if r['arm'] == arm]
    if not xs:
        return None
    return dict(n=len(xs), mean=st.mean(xs), median=st.median(xs),
                win=sum(1 for x in xs if x > 0) / len(xs))


ARMS = ['intersection', 'flow_only', 'node_only', 'placebo']
print("\n=== forward-20d option return by arm (net of 6% round-trip spread) ===")
print(f"  {'arm':13} {'n':>4} {'mean':>8} {'median':>8} {'win':>6}")
res = {}
for a in ARMS:
    g = agg(a, 'fwd20')
    res[a] = g
    if g:
        print(f"  {a:13} {g['n']:>4} {g['mean']*100:>+7.1f}% {g['median']*100:>+7.1f}% {g['win']*100:>5.0f}%")

print("\n=== if you take profit at +100% (spike-capture policy; the Atlas lesson) ===")
for a in ARMS:
    g = agg(a, 'tp')
    if g:
        print(f"  {a:13} {g['n']:>4} mean {g['mean']*100:>+7.1f}%  median {g['median']*100:>+7.1f}%  win {g['win']*100:>3.0f}%")

print("\n=== max in-window gain (the spike that fades if unmanaged) ===")
for a in ARMS:
    xs = [r['mx'] for r in rows if r['arm'] == a]
    if xs:
        print(f"  {a:13} median max +{st.median(xs)*100:.0f}%  mean max +{st.mean(xs)*100:.0f}%")

# stability of the intersection edge over placebo
inter = [r for r in rows if r['arm'] == 'intersection']
plac = [r for r in rows if r['arm'] == 'placebo']
if inter and plac:
    cds = sorted({r['cohort'] for r in inter})
    half = len(cds) // 2
    def ev(sub, key='fwd20'):
        xs = [r[key] - COST for r in sub]
        return st.mean(xs) if xs else float('nan')
    print("\n=== stability: intersection minus placebo (net fwd20) ===")
    for lbl, sel in [('odd', cds[::2]), ('even', cds[1::2]), ('H1', cds[:half]), ('H2', cds[half:])]:
        i = [r for r in inter if r['cohort'] in sel]; p = [r for r in plac if r['cohort'] in sel]
        print(f"  {lbl:4} intersection {ev(i)*100:+6.1f}%  placebo {ev(p)*100:+6.1f}%  edge {(ev(i)-ev(p))*100:+.1f}pp")

# VEX-alignment split within intersection
va = [r for r in inter if r.get('vex_aligned') == 1]
vn = [r for r in inter if r.get('vex_aligned') == 0]
if va and vn:
    print(f"\n=== does VEX alignment add? intersection fwd20 net ===")
    print(f"  VEX-aligned (n={len(va)}): {st.mean([r['fwd20']-COST for r in va])*100:+.1f}%")
    print(f"  VEX-opposed (n={len(vn)}): {st.mean([r['fwd20']-COST for r in vn])*100:+.1f}%")

json.dump(rows, open(os.path.join(HERE, 'priced_legs.json'), 'w'))
print(f"\nwrote priced_legs.json ({len(rows)} legs)")
