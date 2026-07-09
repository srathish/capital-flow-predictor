"""
UW deep-study suite — the 7-study program (real 1-min option marks).
 1. contract selection (ATM/ITM/OTM/next-expiry, SPXW-vs-SPY)
 2. entry timing / slippage
 3. exit-rule grid with cross-regime survival test
 4. MFE/MAE in option dollars
 5. was the option too expensive at entry?
 6. liquidity proxies
 7. flow_confirmation_score tiers

Sample: FINAL-SYSTEM plays (G7-PC + dedupe). Bar for any rule: must be
top-quartile across months AND day-types, not just best in aggregate.

Run: uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/uw/uw_deep.py
"""
import gzip, json, os
from datetime import datetime, timezone, timedelta
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
CAND = os.path.join(HERE, 'candles')
FLOW = os.path.join(HERE, 'flow')
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
ET = timezone(timedelta(hours=-4))
HOLIDAYS = {'2026-06-19'}

lines = []
def emit(s=''):
    print(s); lines.append(str(s))

# ---------- plays: final system ----------
cands = [os.path.join(GEX,'scripts','out',f) for f in os.listdir(os.path.join(GEX,'scripts','out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))
days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
def spots_series(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    return [json.loads(l)['spot'] for l in gzip.open(p).read().decode().strip().split('\n')]
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
emit(f'final-system plays: {len(final)}')

# ---------- candles ----------
def occ_symbol(t, day, d, K):
    y, m, dd = day.split('-')
    return f"{t}{y[2:]}{m}{dd}{'C' if d>0 else 'P'}{int(round(K*1000)):08d}"
_cc = {}
def candles(occ, day):
    key = f'{occ}_{day}'
    if key in _cc: return _cc[key]
    p = os.path.join(CAND, key + '.json')
    r = None
    if os.path.exists(p):
        rows = json.load(open(p)); out = []
        for c in rows:
            ts = c.get('start_time')
            close = float(c.get('close') or 0)
            if not ts or close <= 0: continue
            out.append({'t': int(datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp()*1000),
                        'close': close, 'high': float(c.get('high') or close), 'low': float(c.get('low') or close),
                        'vol': (c.get('volume_ask_side') or 0) + (c.get('volume_bid_side') or 0),
                        'iv': float(c.get('iv_high') or 0)})
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
    return best if best and ts - best['t'] <= tol else None

# base rows: entry at fire, marks path, struct exit
rows = []
for p in final:
    occ = occ_symbol(p['ticker'], p['day'], p['dir'], p['K'])
    cd = candles(occ, p['day'])
    if not cd: continue
    e = at_or_after(cd, p['fireTsMs'])
    xs = at_or_before(cd, p['exitTsMs']) or at_or_after(cd, p['exitTsMs'])
    if not e or not xs: continue
    path = [c for c in cd if p['fireTsMs'] <= c['t'] <= p['exitTsMs'] + 60_000]
    rows.append({**p, 'occ': occ, 'cd': cd, 'entry': e['close'], 'entryT': e['t'],
                 'entryVol': e['vol'], 'entryIV': e['iv'], 'exitStruct': xs['close'], 'path': path})
emit(f'priced (base ATM): {len(rows)}')
month = lambda r: r['day'][:7]
ret_day = {}
for d in days:
    s = spots_series(d, 'SPY')
    if s: ret_day[d] = (s[-1]-s[0])/s[0]*100
def daytype(r):
    x = ret_day.get(r['day'], 0)
    return 'down' if x <= -0.5 else 'up' if x >= 0.5 else 'flat'

def summarize(rs, pnl_key):
    n = len(rs)
    if not n: return dict(n=0)
    pnl = sum(r[pnl_key] for r in rs); cap = sum(r['entry']*100 for r in rs)
    return dict(n=n, pnl=round(pnl), ret=round(pnl/cap*100, 1),
                win=round(100*sum(1 for r in rs if r[pnl_key] > 0)/n))

# ============ S3: EXIT GRID (do first — defines pnl for other studies) ============
def sim_exit(r, pt=None, sl=None, trail_arm=None, trail_give=None, max_min=None):
    e = r['entry']; peak = e
    for c in r['path']:
        if c['t'] <= r['entryT']: continue
        m = c['close']
        if m > peak: peak = m
        g = (m - e)/e
        if pt is not None and g >= pt: return e*(1+pt)
        if sl is not None and g <= -sl: return e*(1-sl)
        if trail_arm is not None and (peak-e)/e >= trail_arm and m <= peak*(1-trail_give): return m
        if max_min is not None and (c['t']-r['entryT']) >= max_min*60_000: return m
    return r['exitStruct']
exit_rules = {
    'struct only': dict(),
    'struct + trail50/15 (live)': dict(trail_arm=.50, trail_give=.15),
    'PT+20%': dict(pt=.20), 'PT+30%': dict(pt=.30), 'PT+50%': dict(pt=.50),
    'SL-20%': dict(sl=.20), 'SL-30%': dict(sl=.30),
    'PT+30/SL-20': dict(pt=.30, sl=.20), 'PT+50/SL-25': dict(pt=.50, sl=.25),
    'PT+50/SL-25 + trail': dict(pt=.50, sl=.25, trail_arm=.50, trail_give=.15),
    'trail15/10 (tight)': dict(trail_arm=.15, trail_give=.10),
    'time 60min': dict(max_min=60), 'time 90min': dict(max_min=90),
}
emit('\n== S3 EXIT GRID (real marks; entry at fire) ==')
grid = []
for name, kw in exit_rules.items():
    for r in rows: r['_p'] = (sim_exit(r, **kw) - r['entry']) * 100
    tot = summarize(rows, '_p')
    # cross-regime survival: rank within each month + daytype
    cell = {}
    for key, fn in [('m', month), ('d', daytype)]:
        for g in sorted(set(fn(r) for r in rows)):
            sub = [r for r in rows if fn(r) == g]
            cell[f'{key}:{g}'] = summarize(sub, '_p')['ret']
    grid.append({'rule': name, **tot, 'cells': cell})
gdf = pd.DataFrame(grid)
cells = pd.DataFrame([g['cells'] for g in grid], index=gdf['rule'])
ranks = cells.rank(ascending=False)
gdf['worst_rank'] = ranks.max(axis=1).values
gdf['avg_rank'] = ranks.mean(axis=1).round(1).values
emit(gdf.drop(columns='cells').sort_values('avg_rank').to_markdown(index=False))
emit('\nper-regime returns (%):')
emit(cells.round(1).to_markdown())
best_rule = gdf.sort_values('avg_rank').iloc[0]['rule']
for r in rows: r['pnlBest'] = (sim_exit(r, **exit_rules[best_rule]) - r['entry']) * 100
for r in rows: r['pnlLive'] = (sim_exit(r, **exit_rules['struct + trail50/15 (live)']) - r['entry']) * 100

# ============ S2: ENTRY TIMING ============
emit('\n== S2 ENTRY TIMING (exit = live rule) ==')
res = []
for delay, lab in [(0,'at fire'), (1,'+1 min'), (3,'+3 min'), (5,'+5 min')]:
    tmp = []
    slip = []
    for r in rows:
        e2c = at_or_after(r['cd'], r['fireTsMs'] + delay*60_000)
        if not e2c: continue
        e2 = e2c['close']
        slip.append((e2 - r['entry'])/r['entry']*100)
        rr = {**r, 'entry': e2, 'entryT': e2c['t']}
        tmp.append({'_p': (sim_exit(rr, trail_arm=.50, trail_give=.15) - e2) * 100, 'entry': e2})
    s = summarize(tmp, '_p')
    res.append({'entry': lab, **s, 'avg_reprice_%': round(np.mean(slip), 1) if slip else None})
# confirmation entry: only if next candle closes in trade direction (option up)
tmp = []
for r in rows:
    c1 = at_or_after(r['cd'], r['fireTsMs'] + 60_000)
    if not c1 or c1['close'] <= r['entry']: continue
    rr = {**r, 'entry': c1['close'], 'entryT': c1['t']}
    tmp.append({'_p': (sim_exit(rr, trail_arm=.50, trail_give=.15) - c1['close'])*100, 'entry': c1['close']})
res.append({'entry': 'confirm (opt up after 1m)', **summarize(tmp, '_p'), 'avg_reprice_%': None})
emit(pd.DataFrame(res).to_markdown(index=False))

# ============ S4: MFE/MAE ============
emit('\n== S4 MFE/MAE (real option %, from entry to struct exit) ==')
for r in rows:
    e = r['entry']; mfe = 0; mae = 0; tp_ = 0; tt_ = 0
    for c in r['path']:
        g = (c['close']-e)/e*100
        dt = (c['t']-r['entryT'])/60_000
        if g > mfe: mfe, tp_ = g, dt
        if g < mae: mae, tt_ = g, dt
    r['mfe'], r['mae'], r['t_peak'], r['t_trough'] = mfe, mae, tp_, tt_
    r['profit_first'] = tp_ < tt_ if (mfe > 5 and mae < -5) else (mfe > 5)
m = pd.DataFrame([{k: r[k] for k in ['mfe','mae','t_peak','t_trough','profit_first','pnlLive']} for r in rows])
emit(f"median MFE {m['mfe'].median():+.0f}% @ {m['t_peak'].median():.0f}min · median MAE {m['mae'].median():+.0f}% @ {m['t_trough'].median():.0f}min")
emit(f"profit-before-pain: {m['profit_first'].mean()*100:.0f}% of plays")
losers = m[m['pnlLive'] <= 0]
emit(f"losers: {len(losers)} · of which MFE ≥ +25% (signal worked, exit failed): {(losers['mfe']>=25).mean()*100:.0f}%")
emit(f"losers with MFE < +10% (signal never worked): {(losers['mfe']<10).mean()*100:.0f}%")

# ============ S5: WAS THE OPTION TOO EXPENSIVE? ============
emit('\n== S5 PREMIUM vs REALIZED ==')
for r in rows:
    r['prem_pct'] = r['entry'] / r['entrySpot'] * 100
    s = spots_series(r['day'], r['ticker'])
    r['real_eod_pct'] = abs(s[-1] - r['entrySpot']) / r['entrySpot'] * 100 if s else np.nan
    r['move_vs_prem'] = r['real_eod_pct'] / r['prem_pct'] if r['prem_pct'] else np.nan
s5 = pd.DataFrame([{k: r[k] for k in ['prem_pct','move_vs_prem','pnlLive','entry','mfe','dir']} for r in rows]).dropna()
s5['bucket'] = pd.qcut(s5['move_vs_prem'], 3, labels=['move<prem (overpriced)','fair','move>prem (cheap)'], duplicates='drop')
tab = s5.groupby('bucket', observed=True).apply(lambda g: pd.Series({
    'n': len(g), 'ret_%': g['pnlLive'].sum()/ (g['entry']*100).sum()*100, 'win_%': (g['pnlLive']>0).mean()*100}), include_groups=False).round(1)
emit(tab.to_markdown())
lz = s5[s5['pnlLive'] <= 0]
emit(f"loss decomposition: {(lz['move_vs_prem']<1).mean()*100:.0f}% of losers had realized-move < premium (overpriced/no-move); "
     f"{(lz['move_vs_prem']>=1).mean()*100:.0f}% moved enough but in wrong direction/timing")

# ============ S6: LIQUIDITY PROXIES ============
emit('\n== S6 LIQUIDITY PROXIES ==')
s6 = pd.DataFrame([{k: r[k] for k in ['entryVol','entry','pnlLive']} for r in rows])
s6['volT'] = pd.qcut(s6['entryVol'].clip(lower=0), 3, labels=['thin','mid','thick'], duplicates='drop')
emit(s6.groupby('volT', observed=True).apply(lambda g: pd.Series({
    'n': len(g), 'ret_%': g['pnlLive'].sum()/(g['entry']*100).sum()*100, 'win_%': (g['pnlLive']>0).mean()*100}), include_groups=False).round(1).to_markdown())
s6['premB'] = pd.cut(s6['entry'], [0, .5, 2, 10, 1e9], labels=['<$0.50','$0.5-2','$2-10','>$10'])
emit(s6.groupby('premB', observed=True).apply(lambda g: pd.Series({
    'n': len(g), 'ret_%': (g['pnlLive'].sum()/(g['entry']*100).sum()*100) if len(g) else np.nan, 'win_%': (g['pnlLive']>0).mean()*100}), include_groups=False).round(1).to_markdown())

# ============ S7: FLOW TIERS ============
emit('\n== S7 FLOW CONFIRMATION TIERS ==')
def load_flow(t, day):
    p = os.path.join(FLOW, f'{t}_{day}.json')
    if not os.path.exists(p): return None
    out = []
    for x in json.load(open(p)):
        ts = x.get('tape_time') or x.get('start_time') or x.get('timestamp') or x.get('date')
        try: tt = int(datetime.fromisoformat(str(ts).replace('Z','+00:00')).timestamp()*1000)
        except Exception: continue
        ncp = float(x.get('net_call_premium') or 0); npp = float(x.get('net_put_premium') or 0)
        out.append((tt, ncp, npp))
    return sorted(out)
fmap = {}
if os.path.isdir(FLOW):
    for f in os.listdir(FLOW):
        t, day = f.replace('.json','').split('_')
        fl = load_flow(t, day)
        if fl: fmap[(t, day)] = fl
def flow_feats(r):
    t = 'SPX' if r['ticker'] == 'SPXW' else r['ticker']
    fl = fmap.get((t, r['day']))
    if not fl: return None
    def win(lo, hi):
        vals = [(c, p_) for tt, c, p_ in fl if r['fireTsMs']-lo*60_000 <= tt <= r['fireTsMs']-hi*60_000]
        if not vals: return None
        c = sum(v[0] for v in vals); p_ = sum(v[1] for v in vals)
        return c - p_, abs(c) + abs(p_)
    w5 = win(5, 0); w15 = win(15, 0); w1 = win(1, 0); w15_5 = win(15, 5)
    if not w15: return None
    return {'f1': w1[0] if w1 else 0, 'f5': w5[0] if w5 else 0, 'f15': w15[0],
            'accel': (w5[0] if w5 else 0) - (w15_5[0]/2 if w15_5 else 0),
            'onesided': abs(w15[0]) / w15[1] if w15[1] else 0}
s7rows = []
for r in rows:
    ff = flow_feats(r)
    if not ff: continue
    s7rows.append({**{k: r[k] for k in ['dir','pnlLive','entry']}, **ff})
s7 = pd.DataFrame(s7rows)
if len(s7):
    for w in ['f1','f5','f15']:
        s7[f'agree_{w}'] = np.sign(s7[w]) == np.sign(s7['dir'])
        g = s7.groupby(f'agree_{w}').apply(lambda x: pd.Series({
            'n': len(x), 'ret_%': x['pnlLive'].sum()/(x['entry']*100).sum()*100, 'win_%': (x['pnlLive']>0).mean()*100}), include_groups=False).round(1)
        emit(f'window {w}:'); emit(g.to_markdown())
    s7['accel_agree'] = np.sign(s7['accel']) == np.sign(s7['dir'])
    emit('flow ACCELERATING in fire direction:')
    emit(s7.groupby('accel_agree').apply(lambda x: pd.Series({
        'n': len(x), 'ret_%': x['pnlLive'].sum()/(x['entry']*100).sum()*100, 'win_%': (x['pnlLive']>0).mean()*100}), include_groups=False).round(1).to_markdown())
    s7['os_t'] = pd.qcut(s7['onesided'].rank(method='first'), 3, labels=['mixed','lean','one-sided'])
    agree15 = s7[s7['agree_f15']]
    emit('among 15m-agreeing fires, by one-sidedness:')
    emit(agree15.groupby('os_t', observed=True).apply(lambda x: pd.Series({
        'n': len(x), 'ret_%': x['pnlLive'].sum()/(x['entry']*100).sum()*100, 'win_%': (x['pnlLive']>0).mean()*100}), include_groups=False).round(1).to_markdown())
else:
    emit('(no flow rows)')

# ============ S1: CONTRACT SELECTION ============
emit('\n== S1 CONTRACT SELECTION (same fires, different contracts; exit = live rule at same timestamps) ==')
def nb_day(dayStr):
    d = datetime.fromisoformat(dayStr) + timedelta(days=1)
    while d.weekday() >= 5: d += timedelta(days=1)
    return d.strftime('%Y-%m-%d')
variants = [('ATM (base)', lambda r: (r['K'], r['day'])),
            ('1 ITM', lambda r: (r['K'] - r['dir']*(5 if r['ticker']=='SPXW' else 1), r['day'])),
            ('2 ITM', lambda r: (r['K'] - r['dir']*2*(5 if r['ticker']=='SPXW' else 1), r['day'])),
            ('1 OTM', lambda r: (r['K'] + r['dir']*(5 if r['ticker']=='SPXW' else 1), r['day'])),
            ('2 OTM', lambda r: (r['K'] + r['dir']*2*(5 if r['ticker']=='SPXW' else 1), r['day'])),
            ('next-expiry ATM', lambda r: (r['K'], nb_day(r['day'])))]
vt = []
for name, fn in variants:
    tmp = []
    for r in rows:
        K2, expday = fn(r)
        o = occ_symbol(r['ticker'], expday, r['dir'], K2)
        cd = candles(o, r['day'])
        if not cd: continue
        e = at_or_after(cd, r['fireTsMs'])
        xs = at_or_before(cd, r['exitTsMs']) or at_or_after(cd, r['exitTsMs'])
        if not e or not xs: continue
        rr = {'entry': e['close'], 'entryT': e['t'], 'exitStruct': xs['close'],
              'path': [c for c in cd if r['fireTsMs'] <= c['t'] <= r['exitTsMs'] + 60_000]}
        tmp.append({'_p': (sim_exit(rr, trail_arm=.50, trail_give=.15) - e['close'])*100, 'entry': e['close']})
    s = summarize(tmp, '_p')
    vt.append({'contract': name, **s, 'avg_entry_$': round(np.mean([x['entry'] for x in tmp]), 2) if tmp else None})
emit(pd.DataFrame(vt).to_markdown(index=False))
emit('\nby ticker (ATM base, live rule):')
for t in ['SPXW','SPY','QQQ']:
    sub = [r for r in rows if r['ticker'] == t]
    s = summarize(sub, 'pnlLive')
    emit(f"  {t:5} n={s.get('n',0):4} pnl=${s.get('pnl',0):+,} ({s.get('ret',0):+.1f}%) win={s.get('win',0)}%")

open(os.path.join(OUT, 'UW_DEEP_RAW.md'), 'w').write('\n'.join(lines))
print('\nwritten:', os.path.join(OUT, 'UW_DEEP_RAW.md'))
