"""
UW deep-study suite part 3 — completes the 15-study program.
  S1/S11  moneyness optimization, overall + per regime (needs variant candles)
  S8x     flow exhaustion conditioned on time-of-day / VIX direction / wall proximity
  S9x     GEX regimes extended: gamma-flip distance, pin proximity, trend/chop day
  S10x    time-of-day: time-to-profit + trail effectiveness per bucket
  S12x    convexity: option % per underlying point, required-vs-realized table
  S13     consolidated regime matrix (L0 vs L3 stack across every regime dim)
  S14     calendar: NFP (computed), OPEX (computed), FOMC (published schedule), big-open days (empirical)
  S15     NO-TRADE score synthesis with odd/even-day holdout

Run: uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/uw/uw_deep3.py
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

# ---------------- shared load (as parts 1-2) ----------------
cands = [os.path.join(GEX,'scripts','out',f) for f in os.listdir(os.path.join(GEX,'scripts','out'))
         if f.startswith('replay-fires-') and f.endswith('.json')]
plays = json.load(open(max(cands, key=os.path.getsize)))
days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
def spots_series(day, t):
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
    if not os.path.exists(p): return None
    return [json.loads(l) for l in gzip.open(p).read().decode().strip().split('\n')]
_sp = {}
def spotmap(day, t):
    if (day,t) in _sp: return _sp[(day,t)]
    s = spots_series(day, t)
    r = None
    if s: r = [(int(datetime.fromisoformat(x['requestedTs'].replace('Z','+00:00')).timestamp()*1000), x['spot'], x.get('strikes')) for x in s]
    _sp[(day,t)] = r
    return r
prior = {}
for i in range(1, len(days)):
    for t in ['SPY','QQQ','SPXW']:
        s = spotmap(days[i-1], t)
        if s: prior[(days[i], t)] = s[-1][1]
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
def struct_mark(cd, ts):
    best = None
    for c in cd:
        if c['t'] <= ts: best = c
        else: break
    return best or at_or_after(cd, ts)

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

vixmap = {}
for day in days:
    s = spotmap(day, 'VIX')
    if s: vixmap[day] = [(t_, sp) for t_, sp, _ in s]
def vix_dir15(day, ts):
    v = vixmap.get(day)
    if not v: return None
    now = None; then = None
    for t_, sp in v:
        if t_ <= ts: now = sp
        if t_ <= ts - 15*60_000: then = sp
    if now is None or then is None: return None
    return now - then

# ---------------- price + feature rows ----------------
def flow_feats(r):
    t = 'SPX' if r['ticker'] == 'SPXW' else r['ticker']
    fl = fmap.get((t, r['day']))
    if not fl: return {}
    def win(lo, hi=0):
        vals = [(c, p_) for tt, c, p_ in fl if r['fireTsMs']-lo*60_000 <= tt <= r['fireTsMs']-hi*60_000]
        if not vals: return None
        return sum(v[0] for v in vals) - sum(v[1] for v in vals), sum(abs(v[0])+abs(v[1]) for v in vals)
    w5 = win(5); w15 = win(15)
    out = {}
    if w5: out['f5'] = w5[0]
    if w15: out['onesided15'] = abs(w15[0])/w15[1] if w15[1] else 0
    return out

def surf_feats(r):
    fr = spotmap(r['day'], r['ticker'])
    if not fr: return {}
    f = None
    for t_, sp, st in fr:
        if t_ <= r['fireTsMs']: f = (t_, sp, st)
        else: break
    if not f or not f[2]: return {}
    _, spot, strikes = f
    tot = sum(s['gamma'] for s in strikes); tota = sum(abs(s['gamma']) for s in strikes) or 1
    pikas_up = [s for s in strikes if s['gamma'] > 0 and s['strike'] > spot]
    pikas_dn = [s for s in strikes if s['gamma'] > 0 and s['strike'] < spot]
    cw = max(pikas_up, key=lambda s: s['gamma'])['strike'] if pikas_up else None
    pw = max(pikas_dn, key=lambda s: s['gamma'])['strike'] if pikas_dn else None
    # gamma flip: strike where cumulative signed gamma crosses 0 (approx: signed-total sign vs spot side)
    ss = sorted(strikes, key=lambda s: s['strike'])
    cum = 0; flip = None
    for s in ss:
        prev = cum; cum += s['gamma']
        if prev < 0 <= cum or prev > 0 >= cum: flip = s['strike']
    # pin: dominant pika within 0.5% of spot
    pin = any(s['gamma'] > 0 and abs(s['strike']-spot)/spot <= 0.005 and abs(s['gamma'])/tota >= 0.18 for s in strikes)
    return {'regime': tot/tota,
            'd_wall': ((cw-spot) if r['dir'] > 0 else (spot-pw))/spot*1e4 if (cw if r['dir']>0 else pw) else None,
            'd_flip': abs(spot-flip)/spot*1e4 if flip else None, 'pin': pin}

rows = []
for p in final:
    occ = occ_symbol(p['ticker'], p['day'], p['dir'], p['K'])
    cd = candles(occ, p['day'])
    if not cd: continue
    e = at_or_after(cd, p['fireTsMs'])
    xs = struct_mark(cd, p['exitTsMs'])
    if not e or not xs: continue
    r = {**p, 'occ': occ, 'cd': cd, 'entry': e['close'], 'entryT': e['t'], 'exitS': xs['close']}
    r.update(flow_feats(p)); r.update(surf_feats(p))
    r['vixd15'] = vix_dir15(p['day'], p['fireTsMs'])
    rows.append(r)
emit(f'rows: {len(rows)}')

def sim_live(r, entry=None, entryT=None):
    e = entry if entry is not None else r['entry']; eT = entryT if entryT is not None else r['entryT']
    peak = e
    for c in r['cd']:
        if c['t'] <= eT or c['t'] > r['exitTsMs'] + 60_000: continue
        m = c['close']
        if m > peak: peak = m
        if (peak-e)/e >= .50 and m <= peak*.85: return m
    return r['exitS']
for r in rows:
    r['pnl'] = (sim_live(r) - r['entry'])*100; r['cap'] = r['entry']*100
def confirm(r):
    c1 = at_or_after(r['cd'], r['fireTsMs'] + 60_000)
    return c1 if (c1 and c1['close'] > r['entry']) else None
os_th = np.quantile([r['onesided15'] for r in rows if 'onesided15' in r], 2/3)
def in_stack(r):
    if 'f5' not in r or np.sign(r['f5']) != np.sign(r['dir']): return False
    if r.get('onesided15', 0) >= os_th: return False
    return confirm(r) is not None
for r in rows:
    r['stack'] = in_stack(r)
    if r['stack']:
        c1 = confirm(r)
        r['pnlStack'] = (sim_live(r, c1['close'], c1['t']) - c1['close'])*100
        r['capStack'] = c1['close']*100

def block(rs, label, pk='pnl', ck='cap'):
    n = len(rs)
    if not n: emit(f'{label:56} n=0'); return
    pnl = sum(r[pk] for r in rs); cap = sum(r[ck] for r in rs)
    emit(f'{label:56} n={n:4}  pnl=${pnl:+,.0f} ({pnl/cap*100:+.1f}%)  win={100*sum(1 for r in rs if r[pk]>0)/n:.0f}%')

# ================= S1/S11 MONEYNESS × REGIME =================
emit('\n== S1/S11 MONEYNESS (full variants) ==')
def nb_day(dayStr):
    d = datetime.fromisoformat(dayStr) + timedelta(days=1)
    while d.weekday() >= 5: d += timedelta(days=1)
    return d.strftime('%Y-%m-%d')
VAR = [('ATM', lambda r: (r['K'], r['day'])),
       ('1 ITM', lambda r: (r['K'] - r['dir']*(5 if r['ticker']=='SPXW' else 1), r['day'])),
       ('2 ITM', lambda r: (r['K'] - r['dir']*2*(5 if r['ticker']=='SPXW' else 1), r['day'])),
       ('1 OTM', lambda r: (r['K'] + r['dir']*(5 if r['ticker']=='SPXW' else 1), r['day'])),
       ('2 OTM', lambda r: (r['K'] + r['dir']*2*(5 if r['ticker']=='SPXW' else 1), r['day'])),
       ('nextexp ATM', lambda r: (r['K'], nb_day(r['day'])))]
def var_pnl(r, fn):
    K2, expd = fn(r)
    cd = candles(occ_symbol(r['ticker'], expd, r['dir'], K2), r['day'])
    if not cd: return None
    e = at_or_after(cd, r['fireTsMs']); xs = struct_mark(cd, r['exitTsMs'])
    if not e or not xs: return None
    rr = dict(r); rr['cd'] = cd; rr['exitS'] = xs['close']
    return {'pnl': (sim_live(rr, e['close'], e['t']) - e['close'])*100, 'cap': e['close']*100}
def regime_tag(r):
    tags = []
    tags.append('GEX+' if (r.get('regime') or 0) > 0.15 else 'GEX-' if (r.get('regime') or 0) < -0.15 else 'GEX0')
    v = r.get('vixd15')
    tags.append('VIXup' if (v or 0) > 0.05 else 'VIXdn' if (v or 0) < -0.05 else 'VIXflat')
    return tags
emit(f"{'contract':14} {'ALL':>18} {'GEX+':>18} {'GEX-/0':>18} {'VIXdn':>18} {'VIXup':>18}")
for name, fn in VAR:
    cells = {}
    universe = [(r, var_pnl(r, fn)) for r in rows]
    universe = [(r, v) for r, v in universe if v]
    def cell(sel):
        if not sel: return 'n=0'
        pnl = sum(v['pnl'] for _, v in sel); cap = sum(v['cap'] for _, v in sel)
        return f"n={len(sel)} {pnl/cap*100:+.1f}%"
    allc = cell(universe)
    gp = cell([(r,v) for r,v in universe if 'GEX+' in regime_tag(r)])
    gn = cell([(r,v) for r,v in universe if 'GEX+' not in regime_tag(r)])
    vd = cell([(r,v) for r,v in universe if 'VIXdn' in regime_tag(r)])
    vu = cell([(r,v) for r,v in universe if 'VIXup' in regime_tag(r)])
    emit(f'{name:14} {allc:>18} {gp:>18} {gn:>18} {vd:>18} {vu:>18}')

# ================= S8x FLOW EXHAUSTION CONDITIONED =================
emit('\n== S8x EXTREME FLOW → SPY fwd 30m, conditioned ==')
frows = []
for day in days:
    fl = fmap.get(('SPY', day)); sp = spotmap(day, 'SPY')
    if not fl or not sp: continue
    for i in range(3, len(sp)-6):
        t0 = sp[i][0]
        vals = [(c, p_) for tt, c, p_ in fl if t0-15*60_000 <= tt <= t0]
        if not vals: continue
        net = sum(v[0] for v in vals) - sum(v[1] for v in vals)
        frows.append({'day': day, 't': t0, 'net': net, 'fwd30': (sp[i+6][1]-sp[i][1])/sp[i][1]*1e4,
                      'hr': hour(t0), 'vixd': vix_dir15(day, t0)})
fdf = pd.DataFrame(frows)
hi = fdf['net'].quantile(.95); lo = fdf['net'].quantile(.05)
ext_b = fdf[fdf['net'] >= hi]; ext_s = fdf[fdf['net'] <= lo]
for lab, e_ in [('extreme BULL flow (top5%)', ext_b), ('extreme BEAR flow (bot5%)', ext_s)]:
    emit(f'{lab}: n={len(e_)} fwd30={e_["fwd30"].mean():+.1f}bps up%={ (e_["fwd30"]>0).mean()*100:.0f}')
    am = e_[e_['hr'] < 12]; pm = e_[e_['hr'] >= 12]
    emit(f'   morning: {am["fwd30"].mean():+.1f}bps (n={len(am)}) · afternoon: {pm["fwd30"].mean():+.1f}bps (n={len(pm)})')
    agree = e_[np.sign(e_['vixd'].fillna(0)) != np.sign(e_['net'])]  # VIX confirming flow dir (VIX down on bull flow)
    emit(f'   when VIX moves WITH the flow: {agree["fwd30"].mean():+.1f}bps (n={len(agree)})')

# ================= S9x GEX EXTENDED =================
emit('\n== S9x GEX EXTENDED (final system, real $) ==')
sub = [r for r in rows if r.get('d_flip') is not None]
for lab, sel in [('gamma flip <30bps away', [r for r in sub if r['d_flip'] < 30]),
                 ('gamma flip 30-100bps', [r for r in sub if 30 <= r['d_flip'] < 100]),
                 ('gamma flip >100bps', [r for r in sub if r['d_flip'] >= 100])]:
    block(sel, f'  {lab}')
block([r for r in rows if r.get('pin')], '  pin on spot at fire')
block([r for r in rows if not r.get('pin')], '  no pin at fire')
ret_day = {d: (spotmap(d,'SPY')[-1][1]-spotmap(d,'SPY')[0][1])/spotmap(d,'SPY')[0][1]*100 for d in days if spotmap(d,'SPY')}
rng_day = {}
for d in days:
    s = spotmap(d, 'SPY')
    if s:
        v = [x[1] for x in s]
        rng_day[d] = (max(v)-min(v))/v[0]*100
trend = {d for d in days if abs(ret_day.get(d,0)) >= 0.6*rng_day.get(d,1e9) and abs(ret_day.get(d,0)) >= 0.4}
block([r for r in rows if r['day'] in trend], '  TREND days (range mostly directional)')
block([r for r in rows if r['day'] not in trend], '  CHOP days')

# ================= S10x TIME OF DAY EXTENDED =================
emit('\n== S10x TIME OF DAY: time-to-peak + trail effectiveness ==')
for lo, hi_, lab in [(9.5,10,'9:30-10'),(10,11,'10-11'),(11,12,'11-12'),(12,13.5,'lunch'),(13.5,15,'13:30-15'),(15,15.25,'15-15:15')]:
    sel = [r for r in rows if lo <= hour(r['fireTsMs']) < hi_]
    if not sel: continue
    tpk = []
    trail_used = 0
    for r in sel:
        e = r['entry']; peak = e; pt = 0
        for c in r['cd']:
            if c['t'] <= r['entryT'] or c['t'] > r['exitTsMs']: continue
            if c['close'] > peak: peak, pt = c['close'], (c['t']-r['entryT'])/60000
        tpk.append(pt)
        if sim_live(r) != r['exitS']: trail_used += 1
    pnl = sum(r['pnl'] for r in sel); cap = sum(r['cap'] for r in sel)
    emit(f"  {lab:10} n={len(sel):4} ret={pnl/cap*100:+6.1f}%  med_t_peak={np.median(tpk):3.0f}min  trail_fired={trail_used/len(sel)*100:.0f}%")

# ================= S12x CONVEXITY EXTENDED =================
emit('\n== S12x CONVEXITY: option % per 10bps of favorable underlying move ==')
for t in ['SPXW','SPY','QQQ']:
    sel = [r for r in rows if r['ticker'] == t]
    conv = []
    for r in sel:
        s = spotmap(r['day'], r['ticker'])
        mv = r['dir']*(s[-1][1]-r['entrySpot'])/r['entrySpot']*1e4
        if mv > 5: conv.append((r['pnl']/r['cap']*100) / (mv/10))
    emit(f"  {t:5} option-%-per-10bps-favorable: median {np.median(conv):+.1f}% (n={len(conv)})")

# ================= S13 CONSOLIDATED REGIME MATRIX =================
emit('\n== S13 REGIME MATRIX: base system vs stack (real $ ret) ==')
def dims(r):
    d = {}
    d['GEX'] = 'GEX+' if (r.get('regime') or 0) > 0.15 else 'GEX-' if (r.get('regime') or 0) < -0.15 else 'GEX0'
    v = r.get('vixd15')
    d['VIX15'] = 'up' if (v or 0) > 0.05 else 'dn' if (v or 0) < -0.05 else 'flat'
    d['daytype'] = 'down' if ret_day.get(r['day'],0) <= -0.5 else 'up' if ret_day.get(r['day'],0) >= 0.5 else 'flat'
    d['friday'] = 'Fri' if datetime.fromisoformat(r['day']).weekday() == 4 else 'Mon-Thu'
    d['trend'] = 'trend' if r['day'] in trend else 'chop'
    return d
mat = []
for dim in ['GEX','VIX15','daytype','friday','trend']:
    vals = sorted(set(dims(r)[dim] for r in rows))
    for v in vals:
        sel = [r for r in rows if dims(r)[dim] == v]
        st = [r for r in sel if r['stack']]
        base_ret = sum(r['pnl'] for r in sel)/sum(r['cap'] for r in sel)*100 if sel else np.nan
        stk_ret = sum(r['pnlStack'] for r in st)/sum(r['capStack'] for r in st)*100 if st else np.nan
        mat.append({'dim': dim, 'value': v, 'n_base': len(sel), 'base_ret%': round(base_ret,1),
                    'n_stack': len(st), 'stack_ret%': round(stk_ret,1) if st else None})
emit(pd.DataFrame(mat).to_markdown(index=False))

# ================= S14 CALENDAR =================
emit('\n== S14 CALENDAR / EVENT DAYS ==')
def first_friday(y, m):
    d = datetime(y, m, 1)
    while d.weekday() != 4: d += timedelta(days=1)
    return d.strftime('%Y-%m-%d')
nfp = {first_friday(2026, m) for m in [4,5,6,7]}
fomc = {'2026-04-28','2026-04-29','2026-06-16','2026-06-17'}  # published Fed schedule (verify)
rng_sorted = sorted(rng_day.values())
big_open = set()
for d in days:
    s = spotmap(d, 'SPY')
    if not s: continue
    v30 = [x[1] for x in s if hour(x[0]) < 10]
    if len(v30) > 2 and (max(v30)-min(v30))/v30[0]*100 >= np.quantile([ (max([x[1] for x in spotmap(dd,'SPY') if hour(x[0])<10] or [1])-min([x[1] for x in spotmap(dd,'SPY') if hour(x[0])<10] or [1]))/spotmap(dd,'SPY')[0][1]*100 for dd in days if spotmap(dd,'SPY')], .9):
        big_open.add(d)
for lab, dset in [('NFP days', nfp & set(days)), ('FOMC days (published sched)', fomc & set(days)), ('big-open days (top decile 9:30-10 range)', big_open)]:
    block([r for r in rows if r['day'] in dset], f'  {lab}')
    block([r for r in rows if r['day'] in dset and r['stack']], f'    (stack subset)', 'pnlStack', 'capStack')

# ================= S15 NO-TRADE SCORE + HOLDOUT =================
emit('\n== S15 NO-TRADE ZONE (score = count of red flags) ==')
def flags(r):
    fl = []
    if 13.5 <= hour(r['fireTsMs']) < 15: fl.append('afternoon_bleed')
    if (r.get('regime') or 0) > 0.15 and (r.get('d_wall') or 99) < 20: fl.append('posGEX_no_room')
    if r.get('onesided15', 0) >= os_th: fl.append('flow_exhausted')
    if 'f5' in r and np.sign(r['f5']) != np.sign(r['dir']): fl.append('flow_against')
    if r.get('pin'): fl.append('pin_on_spot')
    be = r['entry']/r['entrySpot']*1e4
    if be > 30: fl.append('breakeven_too_far')
    return fl
for r in rows: r['nflags'] = len(flags(r))
for k in range(0, 5):
    block([r for r in rows if r['nflags'] == k], f'  {k} red flags')
emit('\n  holdout check (rule: trade only if ≤1 flag; split by odd/even calendar day):')
odd = [r for r in rows if int(r['day'][-2:]) % 2 == 1]; even = [r for r in rows if int(r['day'][-2:]) % 2 == 0]
for lab, half in [('odd days', odd), ('even days', even)]:
    block([r for r in half if r['nflags'] <= 1], f'  {lab}: ≤1 flag')
    block([r for r in half if r['nflags'] >= 2], f'  {lab}: ≥2 flags')

open(os.path.join(OUT, 'UW_DEEP3_RAW.md'), 'w').write('\n'.join(lines))
print('\nwritten:', os.path.join(OUT, 'UW_DEEP3_RAW.md'))
