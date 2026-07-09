"""
VIX intraday research study — isolated module, see README.md.

Reads: data/skylit-archive/intraday/<day>/{VIX,SPY,QQQ,SPXW}.jsonl.gz
       scripts/out/replay-fires-*.json  (fires with outcomes)
       data/gexester.db                 (2026-07-08 real option marks, read-only)
Writes: research/vix/out/VIX_RESEARCH_REPORT.md + charts.

Run:  uv run --with numpy,pandas,matplotlib,scipy python research/vix/vix_study.py
"""
import gzip, json, os, sqlite3, sys
from datetime import datetime, timezone, timedelta
import numpy as np
import pandas as pd
from scipy import stats as sps
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
ET = timezone(timedelta(hours=-4))
TICKERS = ['SPY', 'QQQ', 'SPXW']
PREM_BPS = 30.0  # crude 0DTE ATM premium ≈ 30bps of spot (option-EV proxy)

# ---------------- load panel ----------------
def load_spots(day, ticker):
    p = os.path.join(ARCHIVE, day, f'{ticker}.jsonl.gz')
    if not os.path.exists(p): return None
    rows = []
    for line in gzip.open(p).read().decode().strip().split('\n'):
        s = json.loads(line)
        rows.append((s['requestedTs'], s['spot']))
    return rows

days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))
panel = {}
for day in days:
    vix = load_spots(day, 'VIX')
    if not vix: continue
    row = {'VIX': dict(vix)}
    ok = True
    for t in TICKERS:
        sp = load_spots(day, t)
        if not sp: ok = False; break
        row[t] = dict(sp)
    if ok: panel[day] = row
print(f'days with full VIX+index data: {len(panel)}')

# aligned dataframe: one row per (day, grid ts)
recs = []
for day, row in panel.items():
    tss = sorted(set(row['VIX']) & set(row['SPY']) & set(row['QQQ']) & set(row['SPXW']))
    for ts in tss:
        recs.append({'day': day, 'ts': ts,
                     'min_et': (lambda h, m: h*60+m)(*map(int, ts[11:16].split(':'))) - 4*60,
                     'VIX': row['VIX'][ts], 'SPY': row['SPY'][ts],
                     'QQQ': row['QQQ'][ts], 'SPXW': row['SPXW'][ts]})
df = pd.DataFrame(recs).sort_values(['day', 'ts']).reset_index(drop=True)

# ---------------- features + forward returns ----------------
def per_day(g):
    g = g.sort_values('ts').reset_index(drop=True)
    g['vix_open'] = g['VIX'].iloc[0]
    g['vix_chg_open'] = g['VIX'] - g['vix_open']
    for w, lbl in [(1, '5m'), (3, '15m'), (6, '30m'), (12, '1h')]:
        g[f'vix_roc_{lbl}'] = g['VIX'].diff(w)
        for t in TICKERS:
            g[f'{t}_fwd_{lbl}'] = (g[t].shift(-w) / g[t] - 1) * 1e4  # bps
    for t in TICKERS:
        g[f'{t}_fwd_eod'] = (g[t].iloc[-1] / g[t] - 1) * 1e4
        g[f'{t}_ret_5m'] = (g[t] / g[t].shift(1) - 1) * 1e4
    # realized vol rest-of-day (annualized %, from 5-min rets)
    r = (np.log(g['SPXW']).diff())
    rv = []
    for i in range(len(g)):
        tail = r.iloc[i+1:]
        rv.append(np.sqrt((tail**2).sum() / max(len(tail),1) * 78 * 252) * 100 if len(tail) >= 6 else np.nan)
    g['rv_rest'] = rv
    return g
df = df.groupby('day', group_keys=False).apply(per_day)
df['vix_z'] = (df['VIX'] - df['VIX'].mean()) / df['VIX'].std()
df['vix_trend_15m'] = np.sign(df['vix_roc_15m']).fillna(0)

# ---------------- Q1: correlations ----------------
horizons = ['5m', '15m', '30m', '1h', 'eod']
feats = ['VIX', 'vix_chg_open', 'vix_roc_5m', 'vix_roc_15m', 'vix_roc_1h', 'vix_z']
corr_rows = []
for f in feats:
    for t in TICKERS:
        for h in horizons:
            col = f'{t}_fwd_{h}'
            sub = df[[f, col]].dropna()
            if len(sub) < 50: continue
            pr = sub[f].corr(sub[col])
            sr = sps.spearmanr(sub[f], sub[col]).statistic
            corr_rows.append({'feature': f, 'ticker': t, 'horizon': h, 'pearson': pr, 'spearman': sr, 'n': len(sub)})
corr = pd.DataFrame(corr_rows if corr_rows else [{'feature':'n/a','ticker':'n/a','horizon':'n/a','pearson':0,'spearman':0,'n':0}])

# chart: heatmap of spearman corr (feature x ticker-horizon)
piv = corr.pivot_table(index='feature', columns=['ticker', 'horizon'], values='spearman')
piv = piv.reindex(columns=pd.MultiIndex.from_product([TICKERS, horizons]))
fig, ax = plt.subplots(figsize=(13, 4.2))
im = ax.imshow(piv.values, cmap='RdBu_r', vmin=-0.25, vmax=0.25, aspect='auto')
ax.set_xticks(range(piv.shape[1])); ax.set_xticklabels([f'{t}\n{h}' for t, h in piv.columns], fontsize=7)
ax.set_yticks(range(piv.shape[0])); ax.set_yticklabels(piv.index, fontsize=8)
for i in range(piv.shape[0]):
    for j in range(piv.shape[1]):
        v = piv.values[i, j]
        if not np.isnan(v): ax.text(j, i, f'{v:+.2f}', ha='center', va='center', fontsize=6.5)
ax.set_title('Spearman corr: VIX features vs forward index returns (bps)')
fig.colorbar(im, shrink=0.8); fig.tight_layout()
fig.savefig(os.path.join(OUT, 'corr_heatmap.png'), dpi=150); plt.close(fig)

# ---------------- Q2/Q3: rising vs falling VIX → continuation ----------------
def bucket_stats(mask, col):
    s = df.loc[mask, col].dropna()
    return len(s), s.mean(), (s > 0).mean() * 100

updown_rows = []
for t in TICKERS:
    for h in ['15m', '30m', '1h']:
        col = f'{t}_fwd_{h}'
        for lbl, m in [('VIX rising (roc15>+0.05)', df['vix_roc_15m'] > 0.05),
                       ('VIX falling (roc15<-0.05)', df['vix_roc_15m'] < -0.05),
                       ('VIX flat', df['vix_roc_15m'].abs() <= 0.05)]:
            n, mu, pos = bucket_stats(m, col)
            updown_rows.append({'ticker': t, 'horizon': h, 'bucket': lbl, 'n': n, 'mean_fwd_bps': mu, 'pct_up': pos})
updown = pd.DataFrame(updown_rows)

# ---------------- Q4/Q5: VIX level vs subsequent realized vol (VRP) ----------------
df['vix_q'] = pd.qcut(df['VIX'], 5, labels=['Q1 low', 'Q2', 'Q3', 'Q4', 'Q5 high'], duplicates='drop')
vrp = df.dropna(subset=['rv_rest']).groupby('vix_q', observed=True).agg(
    n=('rv_rest', 'size'), vix_mean=('VIX', 'mean'), rv_rest_mean=('rv_rest', 'mean'),
    abs_fwd1h_spy=('SPY_fwd_1h', lambda s: s.abs().mean())).reset_index()
vrp['vrp'] = vrp['vix_mean'] - vrp['rv_rest_mean']

fig, ax = plt.subplots(figsize=(8, 4))
x = np.arange(len(vrp))
ax.bar(x - 0.2, vrp['vix_mean'], 0.4, label='VIX (implied)')
ax.bar(x + 0.2, vrp['rv_rest_mean'], 0.4, label='Realized vol rest-of-day (SPX)')
ax.set_xticks(x); ax.set_xticklabels(vrp['vix_q'].astype(str))
ax.set_ylabel('vol (annualized %)'); ax.legend(); ax.set_title('Implied (VIX) vs subsequent realized — the premium you pay')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'vrp_by_vix_quintile.png'), dpi=150); plt.close(fig)

# ---------------- Q6/Q7: trade-quality joins ----------------
rep_path = None
for f in sorted(os.listdir(os.path.join(GEX, 'scripts', 'out'))):
    if f.startswith('replay-fires-') and f.endswith('.json'): rep_path = os.path.join(GEX, 'scripts', 'out', f)
plays = json.load(open(rep_path))
vix_lookup = {(day, ts): v for day, row in panel.items() for ts, v in row['VIX'].items()}
def vix_at(day, ts_ms, offset_min=0):
    tm = datetime.fromtimestamp(ts_ms / 1000, timezone.utc) + timedelta(minutes=offset_min)
    tm = tm.replace(minute=tm.minute - tm.minute % 5, second=0, microsecond=0)
    return vix_lookup.get((day, tm.strftime('%Y-%m-%dT%H:%M:00Z')))

prows = []
for p in plays:
    v0 = vix_at(p['day'], p['fireTsMs'])
    v15 = vix_at(p['day'], p['fireTsMs'], -15)
    vx = vix_at(p['day'], p['exitTsMs'])
    if v0 is None: continue
    prows.append({'day': p['day'], 'dir': p['dir'], 'ticker': p['ticker'],
                  'bps': p['capturedBps'], 'opt': max(-1.0, p['capturedBps'] / PREM_BPS),
                  'vix': v0, 'vix_roc15': (v0 - v15) if v15 is not None else np.nan,
                  'vix_hold_chg': (vx - v0) if vx is not None else np.nan})
tp = pd.DataFrame(prows)
tp['side'] = np.where(tp['dir'] > 0, 'BULL', 'BEAR')
tp['vix_lvl'] = pd.qcut(tp['vix'], 3, labels=['low', 'mid', 'high'], duplicates='drop')
tp['vix_dir'] = np.select([tp['vix_roc15'] > 0.05, tp['vix_roc15'] < -0.05], ['rising', 'falling'], 'flat')

tq_level = tp.groupby(['side', 'vix_lvl'], observed=True).agg(n=('opt', 'size'), optEV=('opt', 'mean'), win=('bps', lambda s: (s > 0).mean() * 100)).reset_index()
tq_dir = tp.groupby(['side', 'vix_dir'], observed=True).agg(n=('opt', 'size'), optEV=('opt', 'mean'), win=('bps', lambda s: (s > 0).mean() * 100)).reset_index()
hold = tp.dropna(subset=['vix_hold_chg'])
hold_corr = {s: hold.loc[hold['side'] == s, ['vix_hold_chg', 'opt']].corr().iloc[0, 1] for s in ['BULL', 'BEAR']}

fig, axes = plt.subplots(1, 2, figsize=(11, 4))
for ax, (frame, key, title) in zip(axes, [(tq_dir, 'vix_dir', 'by VIX 15m direction at fire'), (tq_level, 'vix_lvl', 'by VIX level tercile at fire')]):
    for i, side in enumerate(['BULL', 'BEAR']):
        sub = frame[frame['side'] == side]
        ax.bar(np.arange(len(sub)) + (i - 0.5) * 0.35, sub['optEV'] * 100, 0.35, label=side)
        ax.set_xticks(range(len(sub))); ax.set_xticklabels(sub[key].astype(str))
    ax.axhline(0, color='k', lw=0.5); ax.set_ylabel('option EV proxy (%/play)'); ax.set_title(title); ax.legend()
fig.suptitle('Fire quality vs VIX conditions (1,339 replayed plays)')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'trade_quality_vix.png'), dpi=150); plt.close(fig)

# real option marks 7/08: hold-period VIX change vs P&L%
con = sqlite3.connect(os.path.join(GEX, 'data', 'gexester.db'))
real = pd.read_sql_query("""
  SELECT ticker, option_type, strike, fire_ts_ms, close_ts_ms, entry_mark, close_mark
  FROM tracked_plays WHERE trading_day='2026-07-08' AND entry_mark>0 AND close_mark IS NOT NULL
   AND ((ticker='SPXW' AND ABS(strike-ROUND(spot_at_fire/5)*5)<2.5)
     OR (ticker IN ('SPY','QQQ') AND ABS(strike-ROUND(spot_at_fire))<0.5))""", con)
con.close()
real['pnl_pct'] = (real['close_mark'] / real['entry_mark'] - 1) * 100
real['vix_chg'] = [ (vix_at('2026-07-08', c) or np.nan) - (vix_at('2026-07-08', f) or np.nan)
                    for f, c in zip(real['fire_ts_ms'], real['close_ts_ms']) ]
real = real.dropna(subset=['vix_chg'])
real_corr = {ot: real.loc[real['option_type'] == ot, ['vix_chg', 'pnl_pct']].corr().iloc[0, 1]
             for ot in ['call', 'put'] if (real['option_type'] == ot).sum() >= 5}

# ---------------- report ----------------
def md_table(frame, floats=3):
    return frame.to_markdown(index=False, floatfmt=f'.{floats}f')

top_corr = corr.reindex(corr['spearman'].abs().sort_values(ascending=False).index).head(12)
rep = f"""# VIX Intraday Research Report
**Isolated research module — no trading-logic changes. See README for reversal.**

Data: {len(panel)} trading days ({days[0]} → {days[-1]}), 5-min Skylit frames (VIX native symbol), {len(df):,} aligned observations, {len(tp):,} replayed fires joined, {len(real)} real option plays (7/08).

## Q1 — VIX changes vs forward index returns
Strongest 12 of {len(corr)} feature×ticker×horizon correlations (Spearman):

{md_table(top_corr[['feature','ticker','horizon','spearman','pearson','n']])}

![corr](corr_heatmap.png)

## Q2/Q3 — rising vs falling VIX: continuation and follow-through
Forward returns conditioned on 15m VIX direction:

{md_table(updown[updown['horizon']=='30m'], 2)}

## Q4/Q5 — is premium rich when VIX is high? (implied vs realized)
{md_table(vrp, 2)}

![vrp](vrp_by_vix_quintile.png)

## Q6 — VIX move during the hold vs option P&L
- Replayed fires (option-EV proxy): corr(VIX change during hold, EV) — BULL {hold_corr.get('BULL', float('nan')):+.3f}, BEAR {hold_corr.get('BEAR', float('nan')):+.3f}
- Real 7/08 option marks: corr(VIX change during hold, P&L%) — {', '.join(f'{k.upper()} {v:+.3f}' for k, v in real_corr.items())}

## Q7 — fire quality by VIX regime
By VIX 15m direction at fire:
{md_table(tq_dir, 2)}

By VIX level tercile at fire:
{md_table(tq_level, 2)}

![tq](trade_quality_vix.png)
"""
open(os.path.join(OUT, 'VIX_RESEARCH_REPORT.md'), 'w').write(rep)
print('report written:', os.path.join(OUT, 'VIX_RESEARCH_REPORT.md'))
# machine-readable summary for the synthesis pass
corr.to_csv(os.path.join(OUT, 'correlations.csv'), index=False)
updown.to_csv(os.path.join(OUT, 'vix_direction_continuation.csv'), index=False)
vrp.to_csv(os.path.join(OUT, 'vrp.csv'), index=False)
tq_dir.to_csv(os.path.join(OUT, 'trade_quality_by_vix_dir.csv'), index=False)
tq_level.to_csv(os.path.join(OUT, 'trade_quality_by_vix_level.csv'), index=False)
