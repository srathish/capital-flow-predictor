"""
UW deep-study suite part 2 — studies 8-15 + THE STACK TEST.

The stack test is the payoff: combine the discriminators part 1 found
(1-min confirmation entry, 5-min flow agreement, non-one-sided flow,
ticker routing, robust exits) and measure whether the intersection is a
REAL positive system in option dollars — reported per-month and per-day-
type so a single regime can't carry it.

Run: uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/uw/uw_deep2.py
"""
import gzip, json, os
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
CAND = os.path.join(HERE, 'candles'); FLOW = os.path.join(HERE, 'flow')
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
ET = timezone(timedelta(hours=-4)); HOLIDAYS = {'2026-06-19'}
lines = []
def emit(s=''):
    print(s); lines.append(str(s))

# ---------- shared loading (same as part 1) ----------
cands = [os.path.join(GEX,'scripts','out',f) for f in os.listdir(os.path.join(GEX,'scripts','out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))
days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
def spots_series(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    return [json.loads(l)['spot'] for l in gzip.open(p).read().decode().strip().split('\n')]
_frames = {}
def frames_full(day, t):
    key = (day, t)
    if key in _frames: return _frames[key]
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    r = None
    if os.path.exists(p):
        r = []
        for l in gzip.open(p).read().decode().strip().split('\n'):
            s = json.loads(l)
            r.append({'t': int(datetime.fromisoformat(s['requestedTs'].replace('Z','+00:00')).timestamp()*1000),
                      'spot': s['spot'], 'strikes': s['strikes']})
    _frames[key] = r
    return r
prior = {}
for i in range(1, len(days)):
    for t in ['SPY','QQQ','SPXW']:
        s = spots_series(days[i-1], t)
        if s: prior[(days[i], t)] = s[-1]
def hour(ts):
    tm = datetime.fromtimestamp(ts/1000, ET); return tm.hour + tm.minute/60
plays = sorted([p for p in plays if p['day'] not in HOLIDAYS], key=lambda p: p['fireTsMs'])
open_until, final = {}, []
for p in plays:
    if hour(p['fireTsMs']) >= 15.25: continue
    if p['dir'] < 0:
        pc = prior.get((p['day'], p['ticker']))
        if pc is None or p['entrySpot'] >= pc: continue
    k = (p['day'], p['ticker'], p['dir'])
    if p['fireTsMs'] < open_until.get(k, 0): continue
    open_until[k] = p['exitTsMs']; final.append(p)

def occ_symbol(t, day, d, K):
    y, m, dd = day.split('-')
    return f"{t}{y[2:]}{m}{dd}{'C' if d>0 else 'P'}{int(round(K*1000)):08d}"
_cc = {}
def candles(occ, day):
    key = f'{occ}_{day}'
    if key in _cc: return _cc[key]
    p = os.path.join(CAND, key + '.json'); r = None
    if os.path.exists(p):
        out = []
        for c in json.load(open(p)):
            ts = c.get('start_time'); close = float(c.get('close') or 0)
            if not ts or close <= 0: continue
            out.append({'t': int(datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp()*1000), 'close': close})
        r = sorted(out, key=lambda x: x['t'])
    _cc[key] = r
    return r
def at_or_after(cd, ts, tol=4*60_000):
    for c in cd:
        if c['t'] >= ts: return c if c['t'] - ts <= tol else None
    return None
def at_or_before(cd, ts, tol=6*60_000):
    best = None
    for c in cd:
        if c['t'] <= ts: best = c
        else: break
    return best if best and ts - best[0 if isinstance(best, tuple) else 't'] <= tol else None

def load_flow(t, day):
    p = os.path.join(FLOW, f'{t}_{day}.json')
    if not os.path.exists(p): return None
    out = []
    for x in json.load(open(p)):
        ts = x.get('tape_time') or x.get('start_time') or x.get('timestamp') or x.get('date')
        try: tt = int(datetime.fromisoformat(str(ts).replace('Z','+00:00')).timestamp()*1000)
        except Exception: continue
        out.append((tt, float(x.get('net_call_premium') or 0), float(x.get('net_put_premium') or 0)))
    return sorted(out)
fmap = {}
for f in os.listdir(FLOW):
    t, day = f.replace('.json','').split('_')
    fl = load_flow(t, day)
    if fl: fmap[(t, day)] = fl
def flow_feats(r):
    t = 'SPX' if r['ticker'] == 'SPXW' else r['ticker']
    fl = fmap.get((t, r['day']))
    if not fl: return None
    def win(lo, hi=0):
        vals = [(c, p_) for tt, c, p_ in fl if r['fireTsMs']-lo*60_000 <= tt <= r['fireTsMs']-hi*60_000]
        if not vals: return None
        return sum(v[0] for v in vals) - sum(v[1] for v in vals), sum(abs(v[0])+abs(v[1]) for v in vals)
    w5 = win(5); w15 = win(15)
    if not w5 or not w15: return None
    return {'f5': w5[0], 'onesided15': abs(w15[0])/w15[1] if w15[1] else 0}

# price base rows
rows = []
for p in final:
    occ = occ_symbol(p['ticker'], p['day'], p['dir'], p['K'])
    cd = candles(occ, p['day'])
    if not cd: continue
    e = at_or_after(cd, p['fireTsMs'])
    if not e: continue
    xs = None
    for c in reversed(cd):
        if c['t'] <= p['exitTsMs']: xs = c; break
    if xs is None: xs = at_or_after(cd, p['exitTsMs'])
    if not xs: continue
    ff = flow_feats(p) or {}
    rows.append({**p, 'occ': occ, 'cd': cd, 'entry': e['close'], 'entryT': e['t'],
                 'exitStructMark': xs['close'], **ff})
emit(f'priced rows: {len(rows)}')

def sim_exit(r, entry, entryT, sl=None, trail_arm=.50, trail_give=.15):
    peak = entry
    for c in r['cd']:
        if c['t'] <= entryT or c['t'] > r['exitTsMs'] + 60_000: continue
        m = c['close']
        if m > peak: peak = m
        g = (m-entry)/entry
        if sl is not None and g <= -sl: return entry*(1-sl)
        if trail_arm is not None and (peak-entry)/entry >= trail_arm and m <= peak*(1-trail_give): return m
    return r['exitStructMark']

def confirm_entry(r):
    c1 = at_or_after(r['cd'], r['fireTsMs'] + 60_000)
    if not c1 or c1['close'] <= r['entry']: return None
    return c1

def block(rs, label, key='pnl'):
    n = len(rs)
    if not n: emit(f'{label:52} n=0'); return
    pnl = sum(r[key] for r in rs); cap = sum(r['cap'] for r in rs)
    win = 100*sum(1 for r in rs if r[key] > 0)/n
    emit(f'{label:52} n={n:4}  pnl=${pnl:+,.0f} ({pnl/cap*100:+.1f}%)  win={win:.0f}%')

# ================= THE STACK TEST =================
emit('\n== STACK TEST: layering tonight-discovered filters (real $) ==')
configs = [
    ('L0: final system, at-fire, live exit', dict()),
    ('L1: + 1-min confirmation entry', dict(confirm=True)),
    ('L2: + flow f5 agrees', dict(confirm=True, flow=True)),
    ('L3: + not one-sided (top-tercile excluded)', dict(confirm=True, flow=True, notonesided=True)),
    ('L4: + SL-25% hard stop', dict(confirm=True, flow=True, notonesided=True, sl=.25)),
    ('L2b: flow-agree only (no confirm)', dict(flow=True)),
    ('L4-SPXW-excl: L4 minus SPXW', dict(confirm=True, flow=True, notonesided=True, sl=.25, nospxw=True)),
]
os_thresh = np.quantile([r['onesided15'] for r in rows if 'onesided15' in r], 2/3)
results = {}
for name, cfg in configs:
    sel = []
    for r in rows:
        if cfg.get('nospxw') and r['ticker'] == 'SPXW': continue
        if cfg.get('flow') and ('f5' not in r or np.sign(r['f5']) != np.sign(r['dir'])): continue
        if cfg.get('notonesided') and r.get('onesided15', 0) >= os_thresh: continue
        e, eT = r['entry'], r['entryT']
        if cfg.get('confirm'):
            c1 = confirm_entry(r)
            if not c1: continue
            e, eT = c1['close'], c1['t']
        x = sim_exit(r, e, eT, sl=cfg.get('sl'))
        sel.append({**r, 'pnl': (x-e)*100, 'cap': e*100})
    results[name] = sel
    block(sel, name)
emit('\nconsistency of the full stack (L4) by month / day-type:')
ret_day = {d: (spots_series(d,'SPY')[-1]-spots_series(d,'SPY')[0])/spots_series(d,'SPY')[0]*100 for d in days if spots_series(d,'SPY')}
def daytype(r):
    x = ret_day.get(r['day'], 0)
    return 'down' if x <= -0.5 else 'up' if x >= 0.5 else 'flat'
L4 = results['L4: + SL-25% hard stop']
for m in ['2026-04','2026-05','2026-06','2026-07']:
    block([r for r in L4 if r['day'].startswith(m)], f'  {m}')
for dt in ['down','flat','up']:
    block([r for r in L4 if daytype(r) == dt], f'  {dt} days')

# ================= S10: TIME OF DAY =================
emit('\n== S10 TIME OF DAY (final system, at-fire entry, live exit) ==')
for r in rows:
    r['pnl'] = (sim_exit(r, r['entry'], r['entryT']) - r['entry'])*100
    r['cap'] = r['entry']*100
buckets = [(9.5,10,'9:30-10:00'),(10,11,'10:00-11:00'),(11,12,'11:00-12:00'),
           (12,13.5,'lunch 12:00-13:30'),(13.5,15,'13:30-15:00'),(15,15.25,'15:00-15:15')]
for lo, hi, lab in buckets:
    block([r for r in rows if lo <= hour(r['fireTsMs']) < hi], f'  {lab}')

# ================= S8: FLOW EXHAUSTION (index forward returns) =================
emit('\n== S8 FLOW EXHAUSTION — extreme 15m flow vs SPY forward returns ==')
frows = []
for day in days:
    fl = fmap.get(('SPY', day)); sp = frames_full(day, 'SPY')
    if not fl or not sp: continue
    sarr = [(f['t'], f['spot']) for f in sp]
    for i in range(3, len(sarr)-6):
        t0 = sarr[i][0]
        vals = [(c, p_) for tt, c, p_ in fl if t0-15*60_000 <= tt <= t0]
        if not vals: continue
        net = sum(v[0] for v in vals) - sum(v[1] for v in vals)
        fwd30 = (sarr[i+6][1]-sarr[i][1])/sarr[i][1]*1e4
        frows.append({'day': day, 'net': net, 'fwd30': fwd30, 'hr': hour(t0)})
fdf = pd.DataFrame(frows)
fdf['bucket'] = pd.qcut(fdf['net'], 10, labels=False, duplicates='drop')
tab = fdf.groupby('bucket').agg(n=('fwd30','size'), net_flow_M=('net', lambda s: s.mean()/1e6),
                                fwd30_bps=('fwd30','mean'), up_pct=('fwd30', lambda s: (s>0).mean()*100)).round(2)
emit('SPY 30m forward return by 15m net-flow decile (0=most bearish flow, 9=most bullish):')
emit(tab.to_markdown())
x = fdf[fdf['bucket']==9]; y = fdf[fdf['bucket']==0]
emit(f'extreme bullish flow decile → fwd30 {x["fwd30_bps"].mean() if "fwd30_bps" in x else x["fwd30"].mean():+.1f}bps · '
     f'extreme bearish decile → {y["fwd30"].mean():+.1f}bps')

# ================= S9: GEX REGIME × REAL $ =================
emit('\n== S9 GEX/VEX REGIME × REAL OPTION $ (final system, live exit) ==')
def surf_feats(r):
    fr = frames_full(r['day'], r['ticker'])
    if not fr: return None
    f = None
    for x in fr:
        if x['t'] <= r['fireTsMs']: f = x
        else: break
    if not f: return None
    tot = sum(s['gamma'] for s in f['strikes']); tota = sum(abs(s['gamma']) for s in f['strikes']) or 1
    spot = f['spot']
    pikas_up = [s for s in f['strikes'] if s['gamma'] > 0 and s['strike'] > spot]
    pikas_dn = [s for s in f['strikes'] if s['gamma'] > 0 and s['strike'] < spot]
    cw = max(pikas_up, key=lambda s: s['gamma'])['strike'] if pikas_up else None
    pw = max(pikas_dn, key=lambda s: s['gamma'])['strike'] if pikas_dn else None
    return {'regime': tot/tota,
            'd_callwall': (cw-spot)/spot*1e4 if cw else None,
            'd_putwall': (spot-pw)/spot*1e4 if pw else None}
for r in rows:
    sf = surf_feats(r) or {}
    r.update(sf)
g9 = pd.DataFrame([{k: r.get(k) for k in ['regime','d_callwall','d_putwall','pnl','cap','dir']} for r in rows]).dropna(subset=['regime'])
g9['gex'] = np.where(g9['regime'] > 0.15, 'positive', np.where(g9['regime'] < -0.15, 'negative', 'neutral'))
for g in ['positive','neutral','negative']:
    sub = g9[g9['gex']==g]
    if len(sub): emit(f"  GEX {g:9} n={len(sub):4}  ret={sub['pnl'].sum()/sub['cap'].sum()*100:+.1f}%  win={(sub['pnl']>0).mean()*100:.0f}%")
g9v = g9.dropna(subset=['d_callwall'])
g9v['wall'] = pd.cut(np.where(g9v['dir']>0, g9v['d_callwall'], g9v['d_putwall']), [0,20,50,100,1e9], labels=['<20bps to wall','20-50','50-100','>100'])
emit('  distance to TARGET-side wall (call wall for bulls / put wall for bears):')
for w in g9v['wall'].cat.categories:
    sub = g9v[g9v['wall']==w]
    if len(sub): emit(f"    {w:16} n={len(sub):4}  ret={sub['pnl'].sum()/sub['cap'].sum()*100:+.1f}%  win={(sub['pnl']>0).mean()*100:.0f}%")

# ================= S12: CONVEXITY / BREAKEVEN =================
emit('\n== S12 SIGNAL vs OPTION CONVEXITY ==')
for r in rows:
    s = spots_series(r['day'], r['ticker'])
    r['und_move_bps'] = r['dir']*(s[-1]-r['entrySpot'])/r['entrySpot']*1e4 if s else np.nan
    r['breakeven_bps'] = r['entry']/r['entrySpot']*1e4
c12 = pd.DataFrame([{k: r.get(k) for k in ['und_move_bps','breakeven_bps','pnl','cap','ticker']} for r in rows]).dropna()
c12['cleared_be'] = c12['und_move_bps'] >= c12['breakeven_bps']
emit(f"avg breakeven: {c12['breakeven_bps'].mean():.0f}bps of underlying · plays clearing breakeven by EOD: {c12['cleared_be'].mean()*100:.0f}%")
for t in ['SPXW','SPY','QQQ']:
    sub = c12[c12['ticker']==t]
    emit(f"  {t:5} breakeven={sub['breakeven_bps'].mean():.0f}bps  cleared={sub['cleared_be'].mean()*100:.0f}%  ret={sub['pnl'].sum()/sub['cap'].sum()*100:+.1f}%")

# ================= S13/S14: REGIME + EVENT DAYS =================
emit('\n== S13/S14 EVENT & CALENDAR DAYS (final system) ==')
def third_friday(y, m):
    d = datetime(y, m, 15)
    while d.weekday() != 4: d += timedelta(days=1)
    return d.strftime('%Y-%m-%d')
opex = {third_friday(2026, m) for m in [4,5,6,7]}
fridays = {d for d in days if datetime.fromisoformat(d).weekday() == 4}
for lab, dset in [('OPEX days', opex), ('Fridays', fridays), ('non-Fridays', set(days)-fridays)]:
    block([r for r in rows if r['day'] in dset], f'  {lab}')

open(os.path.join(OUT, 'UW_DEEP2_RAW.md'), 'w').write('\n'.join(lines))
print('\nwritten:', os.path.join(OUT, 'UW_DEEP2_RAW.md'))
