# Aggregate the 3x3 grid: eq / MAE / win / expectancy / knife, walk-forward,
# day-block bootstrap, gate tiers, random control. Emits report_data.json + jsonl.
import json, os, random, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(20260715)
scored = json.load(open(os.path.join(HERE, 'scored.json')))
randc  = json.load(open(os.path.join(HERE, 'random.json')))
ENTRIES = ['e1', 'e2', 'e3']; EXITS = ['X1', 'X2', 'X3']

def mean(a): return sum(a)/len(a) if a else float('nan')
def median(a): return st.median(a) if a else float('nan')
def pct(x): return f"{x*100:+.0f}%"

def cell_rows(entry, gate):
    rows = [r for r in scored if r['entry'] == entry]
    if gate == 'le0': rows = [r for r in rows if r['le0']]
    return rows

def summarize(entry, exit_, gate):
    rows = cell_rows(entry, gate)
    pnls = [r['pnl'][exit_]['pnl'] for r in rows]
    eqs  = [r['eq'] for r in rows]
    maes = [r['mae15'] for r in rows]         # early adverse (entry-timing relevant)
    mfes = [r['mfe'] for r in rows]
    knives = [r['knife'] for r in rows]
    wins = [p for p in pnls if p > 0]; losses = [p for p in pnls if p <= 0]
    return {
        'N': len(rows), 'eq': mean(eqs), 'mae_med': median(maes), 'mfe_med': median(mfes),
        'winrate': len(wins)/len(pnls) if pnls else float('nan'),
        'avgwin': mean(wins) if wins else 0.0, 'avgloss': mean(losses) if losses else 0.0,
        'expectancy': mean(pnls), 'total': sum(pnls),
        'knife': mean([1.0 if k else 0.0 for k in knives]),
        'pnls': pnls,
    }

def days_sorted(rows):
    return sorted(set(r['day'] for r in rows))

def walkforward(entry, exit_, gate):
    rows = cell_rows(entry, gate)
    ds = days_sorted(rows); mid = len(ds)//2
    h1d, h2d = set(ds[:mid]), set(ds[mid:])
    p1 = [r['pnl'][exit_]['pnl'] for r in rows if r['day'] in h1d]
    p2 = [r['pnl'][exit_]['pnl'] for r in rows if r['day'] in h2d]
    return (mean(p1), len(p1), mean(p2), len(p2), ds[mid] if mid < len(ds) else None)

def bootstrap_p(entry, exit_, gate, B=3000):
    rows = cell_rows(entry, gate)
    byday = {}
    for r in rows: byday.setdefault(r['day'], []).append(r['pnl'][exit_]['pnl'])
    days = list(byday); npos = 0
    means = []
    for _ in range(B):
        samp = []
        for _ in range(len(days)):
            samp += byday[random.choice(days)]
        mu = mean(samp); means.append(mu)
        if mu > 0: npos += 1
    return npos/B, mean(means)

grid = {}
for g in ['all', 'le0']:
    grid[g] = {}
    for e in ENTRIES:
        for x in EXITS:
            s = summarize(e, x, g)
            wf = walkforward(e, x, g)
            bp, bmu = bootstrap_p(e, x, g)
            s.update({'wf_h1': wf[0], 'wf_h1n': wf[1], 'wf_h2': wf[2], 'wf_h2n': wf[3],
                      'wf_split': wf[4], 'boot_p': bp})
            del s['pnls']
            grid[g][f'{e}_{x}'] = s

# random control expectancy per exit
randstats = {'all': {}, 'le0': {}}
for g in ['all', 'le0']:
    rr = randc if g == 'all' else [r for r in randc if r['le0']]
    for x in EXITS:
        pnls = [r['pnl'][x] for r in rr]
        randstats[g][x] = {'N': len(pnls), 'expectancy': mean(pnls), 'total': sum(pnls),
                           'winrate': len([p for p in pnls if p > 0])/len(pnls) if pnls else float('nan')}

json.dump({'grid': grid, 'random': randstats}, open(os.path.join(HERE, 'report_data.json'), 'w'), indent=2)

# ---- console grid ----
def fmt_row(lbl, s):
    return (f"  {lbl}  N={s['N']:3d}  eq={s['eq']:.2f}  MAEmed={pct(s['mae_med'])}  "
            f"win={s['winrate']*100:4.0f}%  avgW={pct(s['avgwin'])}  avgL={pct(s['avgloss'])}  "
            f"E={pct(s['expectancy'])}  tot={s['total']*100:+5.0f}%  knife={s['knife']*100:3.0f}%  "
            f"WF[{pct(s['wf_h1'])}|{pct(s['wf_h2'])}]  P>0={s['boot_p']:.2f}")

ename = {'e1': 'E1-ANTICIPATE', 'e2': 'E2-FIRSTTICK', 'e3': 'E3-CONFIRM'}
for g in ['all', 'le0']:
    print(f"\n===== GATE {'<=+40M (primary)' if g=='all' else '<=0 (strict)'} =====")
    for x in EXITS:
        print(f"-- EXIT {x} --")
        for e in ENTRIES:
            print(fmt_row(f"{ename[e]:14s}x{x}", grid[g][f'{e}_{x}']))
    print("  RANDOM-timing control:")
    for x in EXITS:
        rs = randstats[g][x]
        print(f"    rand x{x}: N={rs['N']} E={pct(rs['expectancy'])} tot={rs['total']*100:+.0f}% win={rs['winrate']*100:.0f}%")

# ---- pick best cell (max expectancy on gate all, both WF halves positive) ----
best = None
for e in ENTRIES:
    for x in EXITS:
        s = grid['all'][f'{e}_{x}']
        robust = s['wf_h1'] > 0 and s['wf_h2'] > 0
        key = (robust, s['expectancy'])
        if best is None or key > best[0]:
            best = (key, e, x, s)
_, be, bx, bs = best
print(f"\nBEST CELL: {ename[be]} x {bx}  E={pct(bs['expectancy'])} tot={bs['total']*100:+.0f}% "
      f"win={bs['winrate']*100:.0f}% WF[{pct(bs['wf_h1'])}|{pct(bs['wf_h2'])}] P>0={bs['boot_p']:.2f}")

# ---- emit entryfix_events.jsonl for best cell ----
def hhmm(mi): return f"{mi//60:02d}:{mi%60:02d}"
outp = os.path.join(HERE, 'entryfix_events.jsonl')
with open(outp, 'w') as f:
    for r in [x for x in scored if x['entry'] == be]:
        pe = r['pnl'][bx]
        f.write(json.dumps({
            'day': r['day'], 'ticker': 'SPXW', 'minute': hhmm(r['me']),
            'strike': r['strike'], 'spot_at_entry': round(r['S'], 1),
            'kind': 'fix', 'implied': 'up' if r['dir'] > 0 else 'down',
            'exit_minute': hhmm(pe['exit_m']),
            'outcome': 'win' if pe['pnl'] > 0 else 'loss',
            'pnl_pct': round(pe['pnl']*100, 1),
        }) + "\n")
print(f"wrote {outp}")
print(json.dumps({'best_entry': be, 'best_exit': bx}, ))
