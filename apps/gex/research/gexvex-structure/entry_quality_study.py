"""ENTRY QUALITY study (RESEARCH ONLY — Clause 0, no live-code changes).

Question: are any FIRE entries non-golden (systematically low MFE) and worth
filtering, beyond what the validated tape gate already blocks? Or are entries
uniformly high-MFE and the leak is purely the exit?

Data:
  - research/exit-study/fires_index.json  : 1355 fires (replay Apr10-Jul08 + live Jul09-10)
  - research/exit-study/cache/{sym}_{day}.json : UW option-contract 1m marks (real P&L path)
  - data/skylit-archive/intraday/{day}/{SPY,QQQ,SPXW}.jsonl.gz : spot for tape gate
  - data/gexester.db tracked_plays.supporting_state : patternDetection confidence/score (live only)

For each fire: MFE (peak %gain), MAE (worst %dd) on the real option path, entered
at first bar >= fireTsMs+60s (matches entry_segmentation convention).
Breakdowns: STATE, tape-gate status, time-of-day, confidence. Walk-forward by day.
"""
import gzip, json, os, bisect
from datetime import datetime, timezone
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
EXIT = os.path.join(GEX, 'research', 'exit-study')
CACHE = os.path.join(EXIT, 'cache')
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
TAPE_TICKERS = ['SPY', 'QQQ', 'SPXW']

def to_ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

# ---------- tape archive (mirrors live bull-tape-gate.js reconstruction) ----------
ARCH_DAYS = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
_spot = {}
def spot_series(day, t):
    k = (day, t)
    if k in _spot: return _spot[k]
    p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz'); ts, sp = [], []
    if os.path.exists(p):
        for line in gzip.open(p).read().decode().strip().split('\n'):
            if not line: continue
            r = json.loads(line)
            if r.get('spot') is None: continue
            ts.append(to_ms(r['requestedTs'])); sp.append(float(r['spot']))
        o = np.argsort(ts); ts = [ts[i] for i in o]; sp = [sp[i] for i in o]
    _spot[k] = (ts, sp); return ts, sp
def spot_at(day, t, tsms):
    ts, sp = spot_series(day, t)
    if not ts: return None
    i = bisect.bisect_right(ts, tsms) - 1
    return sp[i] if i >= 0 else None
def prior_close(day, t):
    if day not in ARCH_DAYS: return None
    di = ARCH_DAYS.index(day)
    if di == 0: return None
    ts, sp = spot_series(ARCH_DAYS[di - 1], t)
    return sp[-1] if sp else None

# ---------- option path -> MFE / MAE ----------
def opt_path(sym, day, fire_ms):
    p = os.path.join(CACHE, f'{sym}_{day}.json')
    if not os.path.exists(p): return None
    rows = json.load(open(p))
    if not isinstance(rows, list): return None
    path = sorted(((to_ms(r['start_time']), float(r['close'])) for r in rows
                   if isinstance(r, dict) and r.get('start_time') and float(r.get('close') or 0) > 0),
                  key=lambda x: x[0])
    if len(path) < 4: return None
    ei = next((i for i, (t, _) in enumerate(path) if t >= fire_ms + 60000), None)
    if ei is None or ei >= len(path) - 2: return None
    entry = path[ei][1]
    if entry <= 0: return None
    steps = path[ei:]; t0 = steps[0][0]
    mfe, mae, mfe_t, mae_t = -1.0, 1.0, t0, t0
    d5 = d15 = d30 = None
    for t, c in steps:
        g = (c - entry) / entry
        if g > mfe: mfe, mfe_t = g, t
        if g < mae: mae, mae_t = g, t
        dt = t - t0
        if d5 is None and dt >= 5 * 60000: d5 = g
        if d15 is None and dt >= 15 * 60000: d15 = g
        if d30 is None and dt >= 30 * 60000: d30 = g
    last = (steps[-1][1] - entry) / entry
    return dict(entry=entry, mfe=mfe, mae=mae,
                d5=d5 if d5 is not None else last,
                d15=d15 if d15 is not None else last,
                d30=d30 if d30 is not None else last,
                ttPeak=round((mfe_t - t0) / 60000),
                againstFirst=(mae_t < mfe_t and mae < -0.05))

# ---------- confidence from live DB ----------
import sqlite3
conf_by_key = {}
try:
    con = sqlite3.connect(os.path.join(GEX, 'data', 'gexester.db'))
    for row in con.execute("SELECT trading_day, ticker, fire_ts_ms, supporting_state FROM tracked_plays WHERE supporting_state IS NOT NULL"):
        day, tk, fts, ss = row
        try:
            pd_ = json.loads(ss).get('patternDetection') or {}
            conf_by_key[(day, tk, int(fts))] = (pd_.get('confidence'), pd_.get('score'))
        except Exception:
            pass
    con.close()
except Exception as e:
    print('conf load failed', e)

# ---------- build records ----------
fires = json.load(open(os.path.join(EXIT, 'fires_index.json')))
def tod_bucket(fire_ms):
    dt = datetime.fromtimestamp(fire_ms / 1000, tz=timezone.utc)
    m = dt.hour * 60 + dt.minute  # UTC; EDT open=13:30 UTC
    if m < 13 * 60 + 30: return '0_pre'
    if m < 14 * 60: return '1_open(9:30-10:00)'
    if m < 19 * 60: return '2_midday(10:00-15:00)'
    if m < 20 * 60: return '3_lasthr(15:00-16:00)'
    return '4_post'

recs = []
for f in fires:
    o = opt_path(f['sym'], f['day'], f['fireTsMs'])
    if o is None: continue
    # tape reconstruction
    day, tsms, tk, d = f['day'], f['fireTsMs'], f['ticker'], f['dir']
    above = {}
    miss = False
    for t in TAPE_TICKERS:
        s, pc = spot_at(day, t, tsms), prior_close(day, t)
        if s is None or pc is None: miss = True; above[t] = None
        else: above[t] = 1 if s > pc else 0
    n_above = None if miss else sum(above.values())
    # gate decision (mirrors live): bulls blocked if all 3 below; bears (G7-PC) blocked if fired ticker >= prior close
    gate = 'unknown'
    if not miss:
        if d > 0:
            gate = 'BLOCK' if n_above == 0 else 'ALLOW'
        else:
            fired = above.get('SPXW' if tk == 'SPXW' else tk)
            gate = 'BLOCK' if fired == 1 else 'ALLOW'  # bear needs fired < prior close
    conf, score = conf_by_key.get((day, tk, int(tsms)), (None, None))
    recs.append(dict(day=day, ticker=tk, state=f['state'], dir=d,
                     mfe=o['mfe'], mae=o['mae'], d5=o['d5'], d15=o['d15'], d30=o['d30'],
                     ttPeak=o['ttPeak'], againstFirst=o['againstFirst'],
                     n_above=n_above, gate=gate, tod=tod_bucket(tsms),
                     conf=conf, score=score))

days = sorted({r['day'] for r in recs})
split = days[len(days) // 2]
for r in recs: r['isTest'] = r['day'] >= split
print(f"records with option path: {len(recs)} / {len(fires)} fires")
print(f"walk-forward split day = {split}  (train {sum(1 for r in recs if not r['isTest'])} / test {sum(1 for r in recs if r['isTest'])})")

# ---------- reporting ----------
def med(a):
    a = sorted(a); return a[len(a)//2] if a else float('nan')
def mean(a): return sum(a)/len(a) if a else float('nan')
def pct(x): return f"{x*100:+.0f}%" if x == x else '  -'
def fr(R, f): return 100*sum(1 for r in R if f(r))/len(R) if R else 0

OUT = []
def P(s=''): print(s); OUT.append(s)

def block(label, R):
    if not R: return
    mfe = [r['mfe'] for r in R]; mae = [r['mae'] for r in R]
    P(f"\n{label}  (n={len(R)})")
    P(f"  MFE peak:  median {pct(med(mfe))}  mean {pct(mean(mfe))}  | reach +25%: {fr(R,lambda r:r['mfe']>=.25):.0f}%  +50%: {fr(R,lambda r:r['mfe']>=.5):.0f}%  +100%: {fr(R,lambda r:r['mfe']>=1):.0f}%")
    P(f"  MAE dd:    median {pct(med(mae))}  mean {pct(mean(mae))}  | never < -15%: {fr(R,lambda r:r['mae']>=-.15):.0f}%  never < -30%: {fr(R,lambda r:r['mae']>=-.30):.0f}%")
    P(f"  drift:     +5m {pct(mean([r['d5'] for r in R]))}  +15m {pct(mean([r['d15'] for r in R]))}  +30m {pct(mean([r['d30'] for r in R]))}")
    P(f"  quality:   worked-before-hurt (MFE>|MAE|): {fr(R,lambda r:r['mfe']>abs(r['mae'])):.0f}%  | against-first: {fr(R,lambda r:r['againstFirst']):.0f}%  | med mins-to-peak {med([r['ttPeak'] for r in R]):.0f}")

P("="*70); P("OVERALL"); P("="*70)
block("ALL FIRES", recs)

P("\n" + "="*70); P("BY STATE"); P("="*70)
for st in ['BEAR_RUG','BEAR_CONTINUE','BEAR_TRAPDOOR','BULL_REVERSE']:
    block(st, [r for r in recs if r['state']==st])

P("\n" + "="*70); P("BY TAPE-GATE STATUS (live gate decision)"); P("="*70)
for g in ['ALLOW','BLOCK','unknown']:
    block(f"gate={g}", [r for r in recs if r['gate']==g])
P("\n-- gate x direction --")
for d,dn in [(1,'BULL'),(-1,'BEAR')]:
    for g in ['ALLOW','BLOCK']:
        R=[r for r in recs if r['dir']==d and r['gate']==g]
        if R: P(f"  {dn} {g}: n={len(R):4}  MFE med {pct(med([r['mfe'] for r in R]))}  reach+50% {fr(R,lambda r:r['mfe']>=.5):.0f}%  +30m drift {pct(mean([r['d30'] for r in R]))}")

P("\n" + "="*70); P("BY TIME-OF-DAY"); P("="*70)
for tb in sorted({r['tod'] for r in recs}):
    block(tb, [r for r in recs if r['tod']==tb])

P("\n" + "="*70); P("BY CONFIDENCE (live subset only — replay fires have no supporting_state)"); P("="*70)
conf_recs = [r for r in recs if r['conf'] is not None]
P(f"fires with confidence: {len(conf_recs)}")
if conf_recs:
    cs = sorted(r['conf'] for r in conf_recs)
    lo, hi = cs[len(cs)//3], cs[2*len(cs)//3]
    P(f"confidence terciles: low<{lo:.2f}  mid  high>{hi:.2f}")
    for lab, f in [('low conf', lambda r:r['conf']<lo), ('mid conf', lambda r:lo<=r['conf']<=hi), ('high conf', lambda r:r['conf']>hi)]:
        block(lab, [r for r in conf_recs if f(r)])

P("\n" + "="*70); P("WALK-FORWARD: MFE reach+50% by STATE, train vs test"); P("="*70)
P(f"{'state':<16}{'n':>6}{'train +50%':>12}{'test +50%':>12}{'train MFEmed':>14}{'test MFEmed':>13}")
for st in ['BEAR_RUG','BEAR_CONTINUE','BULL_REVERSE']:
    tr=[r for r in recs if r['state']==st and not r['isTest']]; te=[r for r in recs if r['state']==st and r['isTest']]
    if tr or te:
        P(f"{st:<16}{len(tr)+len(te):>6}{fr(tr,lambda r:r['mfe']>=.5):>11.0f}%{fr(te,lambda r:r['mfe']>=.5):>11.0f}%{pct(med([r['mfe'] for r in tr])):>14}{pct(med([r['mfe'] for r in te])):>13}")

P("\n" + "="*70); P("WALK-FORWARD: STATE x TOD reach+50% (train/test, n>=20)"); P("="*70)
for st in ['BEAR_RUG','BULL_REVERSE']:
    for tb in sorted({r['tod'] for r in recs}):
        R=[r for r in recs if r['state']==st and r['tod']==tb]
        if len(R)<20: continue
        tr=[r for r in R if not r['isTest']]; te=[r for r in R if r['isTest']]
        P(f"  {st:<13}{tb:<22} n={len(R):4}  train+50% {fr(tr,lambda r:r['mfe']>=.5):>3.0f}%  test+50% {fr(te,lambda r:r['mfe']>=.5):>3.0f}%")

P("\n" + "="*70); P("INCREMENTAL CHECK: within gate=ALLOW, any low-MFE state/TOD cut?"); P("="*70)
allow = [r for r in recs if r['gate']=='ALLOW']
P(f"gate=ALLOW baseline: n={len(allow)}  reach+50% {fr(allow,lambda r:r['mfe']>=.5):.0f}%  MFEmed {pct(med([r['mfe'] for r in allow]))}  +30m drift {pct(mean([r['d30'] for r in allow]))}")
P("  -- by state (within ALLOW), walk-forward --")
for st in ['BEAR_RUG','BULL_REVERSE','BEAR_CONTINUE']:
    R=[r for r in allow if r['state']==st]
    if len(R)<15: continue
    tr=[r for r in R if not r['isTest']]; te=[r for r in R if r['isTest']]
    P(f"    {st:<14} n={len(R):4}  reach+50% {fr(R,lambda r:r['mfe']>=.5):>3.0f}%  train {fr(tr,lambda r:r['mfe']>=.5):>3.0f}% / test {fr(te,lambda r:r['mfe']>=.5):>3.0f}%  +30m {pct(mean([r['d30'] for r in R]))}")
P("  -- by TOD (within ALLOW), walk-forward --")
for tb in sorted({r['tod'] for r in allow}):
    R=[r for r in allow if r['tod']==tb]
    if len(R)<15: continue
    tr=[r for r in R if not r['isTest']]; te=[r for r in R if r['isTest']]
    P(f"    {tb:<22} n={len(R):4}  reach+50% {fr(R,lambda r:r['mfe']>=.5):>3.0f}%  train {fr(tr,lambda r:r['mfe']>=.5):>3.0f}% / test {fr(te,lambda r:r['mfe']>=.5):>3.0f}%  +30m {pct(mean([r['d30'] for r in R]))}")
P("  -- worst 3-index tape cells within ALLOW (n_above), for bulls & bears --")
for d,dn in [(1,'BULL'),(-1,'BEAR')]:
    for k in [0,1,2,3]:
        R=[r for r in allow if r['dir']==d and r['n_above']==k]
        if len(R)<15: continue
        P(f"    {dn} n_above={k} n={len(R):4}  reach+50% {fr(R,lambda r:r['mfe']>=.5):>3.0f}%  +30m {pct(mean([r['d30'] for r in R]))}")

# save digest recs for reference
json.dump([{k:r[k] for k in ('day','ticker','state','dir','mfe','mae','d30','gate','tod','conf','score')} for r in recs],
          open(os.path.join(HERE, 'entry_quality_recs.json'), 'w'))
print("\nwrote entry_quality_recs.json")
