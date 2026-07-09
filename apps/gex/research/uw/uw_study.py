"""
UW research study — two parts:
  A. Re-price the 64-day replay in REAL option dollars (UW 1-min candles):
     validates the 30bps proxy, prices every gate config in dollars, and
     tests the live trail stop out-of-sample.
  B. Flow confirmation: does UW net-premium flow agreeing with the fire
     direction at entry improve real-dollar EV?

Isolated module. Run:
  uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/uw/uw_study.py
"""
import gzip, json, os
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
ET = timezone(timedelta(hours=-4))

# ---------- replay plays ----------
cands = [os.path.join(GEX,'scripts','out',f) for f in os.listdir(os.path.join(GEX,'scripts','out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))
def occ_symbol(t, day, d, K):
    y, m, dd = day.split('-')
    return f"{t}{y[2:]}{m}{dd}{'C' if d>0 else 'P'}{int(round(K*1000)):08d}"

# ---------- candles ----------
CAND = os.path.join(HERE, 'candles')
def load_candles(occ, day):
    p = os.path.join(CAND, f'{occ}_{day}.json')
    if not os.path.exists(p): return None
    rows = json.load(open(p))
    out = []
    for c in rows:
        ts = c.get('start_time') or c.get('tape_time') or c.get('t')
        close = float(c.get('close') or 0)
        if not ts or close <= 0: continue
        out.append((int(datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp()*1000), close))
    return sorted(out)

def mark_at_or_after(cd, ts_ms, tol_ms=4*60_000):
    for t, c in cd:
        if t >= ts_ms:
            return c if t - ts_ms <= tol_ms else None
    return None
def mark_at_or_before(cd, ts_ms, tol_ms=6*60_000):
    best = None
    for t, c in cd:
        if t <= ts_ms: best = (t, c)
        else: break
    if best and ts_ms - best[0] <= tol_ms: return best[1]
    return None

# ---------- price every play ----------
priced = []
missing = 0
for p in plays:
    occ = occ_symbol(p['ticker'], p['day'], p['dir'], p['K'])
    cd = load_candles(occ, p['day'])
    if not cd: missing += 1; continue
    entry = mark_at_or_after(cd, p['fireTsMs'])
    if entry is None or entry <= 0: missing += 1; continue
    exit_struct = mark_at_or_before(cd, p['exitTsMs']) or mark_at_or_after(cd, p['exitTsMs'])
    if exit_struct is None: missing += 1; continue
    # trail on 1-min closes between fire and struct exit (arm +50%, 15% giveback)
    peak = entry; exit_trail = None; trail_ts = None
    for t, c in cd:
        if t <= p['fireTsMs'] or t > p['exitTsMs']: continue
        if c > peak: peak = c
        if (peak - entry) / entry >= 0.50 and c <= peak * 0.85:
            exit_trail, trail_ts = c, t
            break
    final_exit = exit_trail if exit_trail is not None else exit_struct
    priced.append({**p, 'occ': occ, 'entryMark': entry, 'exitStruct': exit_struct,
                   'exitFinal': final_exit, 'usedTrail': exit_trail is not None,
                   'pnlStruct': (exit_struct - entry) * 100, 'pnlFinal': (final_exit - entry) * 100,
                   'retFinal': (final_exit - entry) / entry * 100})
pr = pd.DataFrame(priced)
print(f'priced {len(pr)}/{len(plays)} plays (missing/no-candles: {missing})')

# ---------- gate configs in real dollars ----------
days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
def last_spot(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    return json.loads(gzip.open(p).read().decode().strip().split('\n')[-1])['spot']
prior = {}
for i, day in enumerate(days):
    for t in ['SPY','QQQ','SPXW']:
        if i > 0:
            s = last_spot(days[i-1], t)
            if s: prior[(day, t)] = s
def hour(row):
    tm = datetime.fromtimestamp(row['fireTsMs']/1000, ET); return tm.hour + tm.minute/60
pr['hr'] = pr.apply(hour, axis=1)
pr['g7'] = pr.apply(lambda r: (r['hr'] < 15.25) and (r['dir'] > 0 or (prior.get((r['day'], r['ticker'])) is not None and r['entrySpot'] < prior[(r['day'], r['ticker'])])), axis=1)
# dedupe within g7 subset (chronological, same ticker+dir not concurrently)
pr = pr.sort_values('fireTsMs')
open_until = {}
keep = []
for _, r in pr.iterrows():
    if not r['g7']: keep.append(False); continue
    k = (r['day'], r['ticker'], r['dir'])
    if r['fireTsMs'] < open_until.get(k, 0): keep.append(False); continue
    open_until[k] = r['exitTsMs']; keep.append(True)
pr['final_sys'] = keep

ret = {}
for day in days:
    p0 = os.path.join(ARCHIVE, day, 'SPY.jsonl.gz')
    if os.path.exists(p0):
        v = [json.loads(l)['spot'] for l in gzip.open(p0).read().decode().strip().split('\n')]
        ret[day] = (v[-1]-v[0])/v[0]*100
down = {d for d,r in ret.items() if r <= -0.5}; up = {d for d,r in ret.items() if r >= 0.5}

lines = []
def emit(s): print(s); lines.append(s)
def block(sub, label, col='pnlFinal'):
    n = len(sub)
    if not n: emit(f'{label:46} n=0'); return
    pnl = sub[col].sum(); cap = (sub['entryMark']*100).sum()
    win = (sub[col] > 0).mean()*100
    emit(f'{label:46} n={n:4}  capital=${cap:,.0f}  pnl=${pnl:+,.0f} ({pnl/cap*100:+.1f}%)  win={win:.0f}%')

emit('== REAL-DOLLAR 64-DAY RESULTS (UW 1-min marks, 1 contract/play) ==')
block(pr, 'no gate — struct exits only', 'pnlStruct')
block(pr, 'no gate — struct + trail', 'pnlFinal')
block(pr[pr['g7']], 'G7-PC gate — struct + trail', 'pnlFinal')
block(pr[pr['final_sys']], 'FINAL SYSTEM (G7-PC + dedupe) struct only', 'pnlStruct')
block(pr[pr['final_sys']], 'FINAL SYSTEM (G7-PC + dedupe) struct + trail', 'pnlFinal')
emit('')
fs_ = pr[pr['final_sys']]
emit(f"trail engaged on {fs_['usedTrail'].mean()*100:.0f}% of final-system plays; "
     f"trail Δpnl = ${ (fs_['pnlFinal']-fs_['pnlStruct']).sum():+,.0f}")
emit('')
emit('by day type (final system, struct+trail):')
block(fs_[fs_['day'].isin(down)], '  down days')
block(fs_[fs_['day'].isin(up)], '  up days')
block(fs_[~fs_['day'].isin(down|up)], '  flat days')
emit('')
emit('by month:')
for m in ['2026-04','2026-05','2026-06','2026-07']:
    block(fs_[fs_['day'].str.startswith(m)], f'  {m}')
emit('')
# proxy validation
proxy_ev = fs_['capturedBps'].clip(lower=-30)/30
real_ev = fs_['retFinal']/100
emit(f'proxy vs real EV corr: {np.corrcoef(proxy_ev, real_ev)[0,1]:+.3f}  '
     f'(proxy mean {proxy_ev.mean()*100:+.1f}% vs real {real_ev.mean()*100:+.1f}%)')

# ---------- Part B: flow confirmation ----------
FLOW = os.path.join(HERE, 'flow')
def load_flow(ticker, day):
    p = os.path.join(FLOW, f'{ticker}_{day}.json')
    if not os.path.exists(p): return None
    rows = json.load(open(p))
    out = []
    for r_ in rows:
        ts = r_.get('tape_time') or r_.get('start_time') or r_.get('timestamp') or r_.get('date')
        try: t = int(datetime.fromisoformat(str(ts).replace('Z','+00:00')).timestamp()*1000)
        except Exception: continue
        ncp = float(r_.get('net_call_premium') or 0); npp = float(r_.get('net_put_premium') or 0)
        out.append((t, ncp - npp))
    return sorted(out)

flow_map = {}
for f in os.listdir(FLOW) if os.path.isdir(FLOW) else []:
    tk, day = f.replace('.json','').split('_')
    fl = load_flow(tk, day)
    if fl: flow_map[(tk, day)] = fl

def flow_at(row, window_min=30):
    tk = 'SPX' if row['ticker'] == 'SPXW' else row['ticker']
    fl = flow_map.get((tk, row['day']))
    if not fl: return None
    t0, t1 = row['fireTsMs'] - window_min*60_000, row['fireTsMs']
    vals = [v for t, v in fl if t0 <= t <= t1]
    return sum(vals) if vals else None

if flow_map:
    fs2 = fs_.copy()
    fs2['flow30'] = fs2.apply(flow_at, axis=1)
    fs2 = fs2.dropna(subset=['flow30'])
    fs2['agree'] = np.sign(fs2['flow30']) == np.sign(fs2['dir'])
    emit('')
    emit(f'== FLOW CONFIRMATION (UW net premium, 30m window, n={len(fs2)}) ==')
    block(fs2[fs2['agree']], '  flow AGREES with fire direction')
    block(fs2[~fs2['agree']], '  flow DISAGREES')
    for side, d_ in [('BULL', 1), ('BEAR', -1)]:
        block(fs2[(fs2['dir']==d_) & fs2['agree']], f'  {side} + flow agrees')
        block(fs2[(fs2['dir']==d_) & ~fs2['agree']], f'  {side} + flow disagrees')
    # magnitude terciles among agreeing
    ag = fs2[fs2['agree']].copy()
    if len(ag) > 30:
        ag['mag'] = pd.qcut(ag['flow30'].abs(), 3, labels=['weak','mid','strong'], duplicates='drop')
        for m in ['weak','mid','strong']:
            block(ag[ag['mag']==m], f'  agreeing flow magnitude={m}')
else:
    emit('\n(no flow data collected)')

pr.to_csv(os.path.join(OUT, 'priced_plays.csv'), index=False)
open(os.path.join(OUT, 'UW_STUDY_RAW.md'), 'w').write('\n'.join(lines))
print('\nwritten:', OUT)
