"""
Policy simulator — combines the 15-study findings into configurable
trade-quality policies over the repriced fire set, and compares each
against the all-fires baseline in REAL option dollars.

RESEARCH ONLY (research/uw isolation contract). Nothing in the live path
imports this. Revert = rm -rf research/uw.

Usage:
  uv run --with numpy,pandas,pyarrow,tabulate python research/uw/studies/policy_simulator.py
  ... --rebuild        # force dataset rebuild from candles/flow/archive

Pipeline:
  1. build (or load cached) canonical dataset  outputs/repriced_fires.parquet
  2. schema-validate
  3. run policy suite (policy_config.POLICIES + FULL_POLICY)
  4. run ablation suite (policy_ablation)
  5. write CSV/Parquet + markdown report
"""
import gzip, json, os, sys
from datetime import datetime, timezone, timedelta
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
UW = os.path.dirname(HERE)
GEX = os.path.abspath(os.path.join(UW, '..', '..'))
ARCHIVE = os.path.join(GEX, 'data', 'skylit-archive', 'intraday')
CAND = os.path.join(UW, 'candles')
FLOW = os.path.join(UW, 'flow')
OUTDIR = os.path.join(UW, 'studies', 'outputs')
os.makedirs(OUTDIR, exist_ok=True)
DATASET = os.path.join(OUTDIR, 'repriced_fires.parquet')
ET = timezone(timedelta(hours=-4))
HOLIDAYS = {'2026-06-19'}

sys.path.insert(0, HERE)
from policy_config import THRESHOLDS as T, POLICIES, FULL_POLICY, ABLATION_COMPONENTS  # noqa: E402
from policy_metrics import compute_policy_metrics, holdout_metrics, breakdown, stability_assessment  # noqa: E402

REQUIRED_COLUMNS = [
    'day', 'ticker', 'dir', 'K', 'fireTsMs', 'exitTsMs', 'entrySpot', 'hr',
    'entry_atfire', 'pnl_atfire', 'confirmed', 'pnl_confirm',
    'mfe_pct', 'mae_pct', 't_peak_min',
    'prem_pct', 'breakeven_bps', 'premium_band',
    'f5', 'onesided15', 'flow_agree5', 'flow_extreme',
    'gex_regime', 'gex_state', 'd_wall_bps', 'pin',
    'daytype', 'trend_day', 'nfp', 'fomc', 'nflags',
]


def validate_schema(df: pd.DataFrame, required=REQUIRED_COLUMNS) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise SystemExit(
            f"SCHEMA ERROR — dataset at {DATASET} is missing columns: {missing}\n"
            f"Re-run with --rebuild (and check collectors under research/uw/) to regenerate."
        )


# ====================================================================
# Dataset builder
# ====================================================================
def _hour(ts):
    tm = datetime.fromtimestamp(ts / 1000, ET)
    return tm.hour + tm.minute / 60


def build_dataset() -> pd.DataFrame:
    print('building canonical repriced-fires dataset...')
    cands = [os.path.join(GEX, 'scripts', 'out', f) for f in os.listdir(os.path.join(GEX, 'scripts', 'out'))
             if f.startswith('replay-fires-') and f.endswith('.json')]
    plays = json.load(open(max(cands, key=os.path.getsize)))
    plays = [p for p in plays if p['day'] not in HOLIDAYS]
    days = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))

    _sp = {}
    def spotmap(day, t):
        if (day, t) in _sp: return _sp[(day, t)]
        p = os.path.join(ARCHIVE, day, f'{t}.jsonl.gz')
        r = None
        if os.path.exists(p):
            r = []
            for l in gzip.open(p).read().decode().strip().split('\n'):
                s = json.loads(l)
                r.append((int(datetime.fromisoformat(s['requestedTs'].replace('Z', '+00:00')).timestamp() * 1000),
                          s['spot'], s.get('strikes')))
        _sp[(day, t)] = r
        return r

    prior = {}
    for i in range(1, len(days)):
        for t in ['SPY', 'QQQ', 'SPXW']:
            s = spotmap(days[i - 1], t)
            if s: prior[(days[i], t)] = s[-1][1]

    def occ_symbol(t, day, d, K):
        y, m, dd = day.split('-')
        return f"{t}{y[2:]}{m}{dd}{'C' if d > 0 else 'P'}{int(round(K * 1000)):08d}"

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
                out.append({'t': int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000),
                            'close': close,
                            'vol': (c.get('volume_ask_side') or 0) + (c.get('volume_bid_side') or 0),
                            'iv': float(c.get('iv_high') or 0)})
            r = sorted(out, key=lambda x: x['t'])
        _cc[key] = r
        return r

    def at_or_after(cd, ts, tol=4 * 60_000):
        for c in cd:
            if c['t'] >= ts: return c if c['t'] - ts <= tol else None
        return None

    def struct_mark(cd, ts):
        best = None
        for c in cd:
            if c['t'] <= ts: best = c
            else: break
        return best or at_or_after(cd, ts)

    def sim_live(cd, entry, entryT, exitTs, exitMark):
        peak = entry
        for c in cd:
            if c['t'] <= entryT or c['t'] > exitTs + 60_000: continue
            m = c['close']
            if m > peak: peak = m
            if (peak - entry) / entry >= T['trail_arm'] and m <= peak * (1 - T['trail_giveback']):
                return m
        return exitMark

    def load_flow(t, day):
        p = os.path.join(FLOW, f'{t}_{day}.json')
        if not os.path.exists(p): return None
        out = []
        for x in json.load(open(p)):
            ts = x.get('tape_time') or x.get('start_time') or x.get('timestamp') or x.get('date')
            try: tt = int(datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp() * 1000)
            except Exception: continue
            out.append((tt, float(x.get('net_call_premium') or 0), float(x.get('net_put_premium') or 0)))
        return sorted(out)
    fmap = {}
    for f in os.listdir(FLOW):
        t, day = f.replace('.json', '').split('_')
        fl = load_flow(t, day)
        if fl: fmap[(t, day)] = fl

    vix = {}
    for day in days:
        s = spotmap(day, 'VIX')
        if s: vix[day] = [(t_, sp) for t_, sp, _ in s]

    ret_day, rng_day, open_rng = {}, {}, {}
    for d in days:
        s = spotmap(d, 'SPY')
        if not s: continue
        v = [x[1] for x in s]
        ret_day[d] = (v[-1] - v[0]) / v[0] * 100
        rng_day[d] = (max(v) - min(v)) / v[0] * 100
        v30 = [x[1] for x in s if _hour(x[0]) < 10]
        open_rng[d] = (max(v30) - min(v30)) / v30[0] * 100 if len(v30) > 2 else 0
    trend = {d for d in days if abs(ret_day.get(d, 0)) >= 0.6 * rng_day.get(d, 1e9) and abs(ret_day.get(d, 0)) >= 0.4}
    big_open_thr = np.quantile(list(open_rng.values()), 0.9)

    def first_friday(y, m):
        d = datetime(y, m, 1)
        while d.weekday() != 4: d += timedelta(days=1)
        return d.strftime('%Y-%m-%d')
    def third_friday(y, m):
        d = datetime(y, m, 15)
        while d.weekday() != 4: d += timedelta(days=1)
        return d.strftime('%Y-%m-%d')
    NFP = {first_friday(2026, m) for m in [4, 5, 6, 7]}
    OPEX = {third_friday(2026, m) for m in [4, 5, 6, 7]}
    FOMC = {'2026-04-28', '2026-04-29', '2026-06-16', '2026-06-17'}  # published Fed schedule

    def nb_day(dayStr):
        d = datetime.fromisoformat(dayStr) + timedelta(days=1)
        while d.weekday() >= 5: d += timedelta(days=1)
        return d.strftime('%Y-%m-%d')

    # g7 + dedupe flags (as columns, not universe restriction)
    plays = sorted(plays, key=lambda p: p['fireTsMs'])
    open_until = {}
    for p in plays:
        p['hr'] = _hour(p['fireTsMs'])
        g7 = p['hr'] < 15.25 and (p['dir'] > 0 or
             (prior.get((p['day'], p['ticker'])) is not None and p['entrySpot'] < prior[(p['day'], p['ticker'])]))
        p['g7_gate'] = g7
        k = (p['day'], p['ticker'], p['dir'])
        if g7 and p['fireTsMs'] >= open_until.get(k, 0):
            p['final_sys'] = True
            open_until[k] = p['exitTsMs']
        else:
            p['final_sys'] = False

    rows = []
    for p in plays:
        occ = occ_symbol(p['ticker'], p['day'], p['dir'], p['K'])
        cd = candles(occ, p['day'])
        if not cd: continue
        e = at_or_after(cd, p['fireTsMs'])
        xs = struct_mark(cd, p['exitTsMs'])
        if not e or not xs: continue
        pnl_atf = (sim_live(cd, e['close'], e['t'], p['exitTsMs'], xs['close']) - e['close']) * 100
        c1 = at_or_after(cd, p['fireTsMs'] + T['confirm_wait_min'] * 60_000)
        confirmed = bool(c1 and c1['close'] > e['close'])
        pnl_cf = (sim_live(cd, c1['close'], c1['t'], p['exitTsMs'], xs['close']) - c1['close']) * 100 if confirmed else np.nan
        entry_cf = c1['close'] if confirmed else np.nan
        # next-expiry variant (present only where variant candles were collected)
        cdn = candles(occ_symbol(p['ticker'], nb_day(p['day']), p['dir'], p['K']), p['day'])
        pnl_nx = np.nan
        if cdn:
            en = at_or_after(cdn, p['fireTsMs']); xn = struct_mark(cdn, p['exitTsMs'])
            if en and xn:
                pnl_nx = (sim_live(cdn, en['close'], en['t'], p['exitTsMs'], xn['close']) - en['close']) * 100
        # path stats (at-fire basis, to struct exit)
        mfe = mae = 0.0; tpk = 0.0
        for c in cd:
            if c['t'] <= e['t'] or c['t'] > p['exitTsMs']: continue
            g = (c['close'] - e['close']) / e['close'] * 100
            if g > mfe: mfe, tpk = g, (c['t'] - e['t']) / 60_000
            if g < mae: mae = g
        # flow features
        ft = 'SPX' if p['ticker'] == 'SPXW' else p['ticker']
        fl = fmap.get((ft, p['day']))
        f1 = f5 = f15 = np.nan; onesided = np.nan; accel = np.nan
        if fl:
            def win(lo, hi=0):
                vals = [(c_, q) for tt, c_, q in fl if p['fireTsMs'] - lo * 60_000 <= tt <= p['fireTsMs'] - hi * 60_000]
                if not vals: return None
                return sum(v[0] for v in vals) - sum(v[1] for v in vals), sum(abs(v[0]) + abs(v[1]) for v in vals)
            w1, w5, w15, w15_5 = win(1), win(5), win(15), win(15, 5)
            if w1: f1 = w1[0]
            if w5: f5 = w5[0]
            if w15:
                f15 = w15[0]; onesided = abs(w15[0]) / w15[1] if w15[1] else 0
            if w5 and w15_5: accel = w5[0] - w15_5[0] / 2
        # surface features
        fr = spotmap(p['day'], p['ticker'])
        gexr = np.nan; d_wall = np.nan; d_flip = np.nan; pin = False
        if fr:
            f_ = None
            for t_, sp, st in fr:
                if t_ <= p['fireTsMs']: f_ = (t_, sp, st)
                else: break
            if f_ and f_[2]:
                _, spot, strikes = f_
                tot = sum(s['gamma'] for s in strikes); tota = sum(abs(s['gamma']) for s in strikes) or 1
                gexr = tot / tota
                ups = [s for s in strikes if s['gamma'] > 0 and s['strike'] > spot]
                dns = [s for s in strikes if s['gamma'] > 0 and s['strike'] < spot]
                w_ = max(ups, key=lambda s: s['gamma'])['strike'] if (p['dir'] > 0 and ups) else \
                     (max(dns, key=lambda s: s['gamma'])['strike'] if (p['dir'] < 0 and dns) else None)
                if w_: d_wall = abs(w_ - spot) / spot * 1e4
                cum = 0; flip = None
                for s in sorted(strikes, key=lambda x: x['strike']):
                    prev = cum; cum += s['gamma']
                    if prev < 0 <= cum or prev > 0 >= cum: flip = s['strike']
                if flip: d_flip = abs(spot - flip) / spot * 1e4
                pin = any(s['gamma'] > 0 and abs(s['strike'] - spot) / spot <= 0.005 and abs(s['gamma']) / tota >= 0.18
                          for s in strikes)
        vd = np.nan
        vv = vix.get(p['day'])
        if vv:
            now = then = None
            for t_, sp in vv:
                if t_ <= p['fireTsMs']: now = sp
                if t_ <= p['fireTsMs'] - 15 * 60_000: then = sp
            if now is not None and then is not None: vd = now - then

        rows.append({
            'day': p['day'], 'ticker': p['ticker'], 'state': p['state'], 'dir': p['dir'], 'K': p['K'],
            'fireTsMs': p['fireTsMs'], 'exitTsMs': p['exitTsMs'], 'entrySpot': p['entrySpot'],
            'hr': p['hr'], 'g7_gate': p['g7_gate'], 'final_sys': p['final_sys'], 'occ': occ,
            'entry_atfire': e['close'], 'pnl_atfire': pnl_atf,
            'confirmed': confirmed, 'entry_confirm': entry_cf, 'pnl_confirm': pnl_cf,
            'pnl_nextexp': pnl_nx,
            'mfe_pct': mfe, 'mae_pct': mae, 't_peak_min': tpk,
            'entry_vol': e['vol'], 'entry_iv': e['iv'],
            'prem_pct': e['close'] / p['entrySpot'] * 100,
            'breakeven_bps': e['close'] / p['entrySpot'] * 1e4,
            'f1': f1, 'f5': f5, 'f15': f15, 'onesided15': onesided, 'accel': accel,
            'gex_regime': gexr, 'd_wall_bps': d_wall, 'd_flip_bps': d_flip, 'pin': pin,
            'vixd15': vd,
            'daytype': 'down' if ret_day.get(p['day'], 0) <= -0.5 else 'up' if ret_day.get(p['day'], 0) >= 0.5 else 'flat',
            'trend_day': p['day'] in trend,
            'nfp': p['day'] in NFP, 'fomc': p['day'] in FOMC, 'opex': p['day'] in OPEX,
            'big_open': open_rng.get(p['day'], 0) >= big_open_thr,
        })
    df = pd.DataFrame(rows)

    # derived, threshold-dependent columns
    df['gex_state'] = np.select([df['gex_regime'] > T['gex_positive_min'], df['gex_regime'] < T['gex_negative_max']],
                                ['positive', 'negative'], 'neutral')
    df['flow_agree5'] = np.sign(df['f5']) == np.sign(df['dir'])
    os_thr = df['onesided15'].quantile(T['flow_onesided_quantile'])
    ext_thr = df['f15'].abs().quantile(T['flow_extreme_quantile'])
    df['flow_onesided'] = df['onesided15'] >= os_thr
    df['flow_extreme'] = df['f15'].abs() >= ext_thr
    lo, hi = T['premium_band_good']
    blo, bhi = T['premium_band_bad']
    df['premium_band'] = np.select(
        [df['entry_atfire'].between(lo, hi), df['entry_atfire'].between(blo, bhi)],
        ['good_0.5-2', 'bad_2-10'], 'other')
    # no-trade red flags (S15)
    df['flag_afternoon'] = (df['hr'] >= T['bad_window_start_hr']) & (df['hr'] < T['bad_window_end_hr'])
    df['flag_posgex_noroom'] = (df['gex_state'] == 'positive') & (df['d_wall_bps'].fillna(99) < T['wall_skip_below_bps'])
    df['flag_flow_exhausted'] = df['flow_onesided'].fillna(False)
    df['flag_flow_against'] = df['f5'].notna() & ~df['flow_agree5']
    df['flag_pin'] = df['pin']
    df['flag_breakeven'] = df['breakeven_bps'] > T['breakeven_max_bps']
    flagcols = [c for c in df.columns if c.startswith('flag_')]
    df['nflags'] = df[flagcols].sum(axis=1)
    df.to_parquet(DATASET, index=False)
    df.to_csv(DATASET.replace('.parquet', '.csv'), index=False)
    print(f'dataset: {len(df)} rows → {DATASET}')
    return df


def load_repriced_fires(rebuild=False) -> pd.DataFrame:
    if rebuild or not os.path.exists(DATASET):
        return build_dataset()
    return pd.read_parquet(DATASET)


# ====================================================================
# Filters (pure, composable) — names referenced from policy_config
# ====================================================================
FILTERS = {
    'not_gex_positive': lambda df: df['gex_state'] != 'positive',
    'not_bad_window': lambda df: ~((df['hr'] >= T['bad_window_start_hr']) & (df['hr'] < T['bad_window_end_hr'])),
    'premium_ok': lambda df: (df['premium_band'] == 'good_0.5-2') |
                             ((df['premium_band'] != 'bad_2-10')) |
                             ((df['premium_band'] == 'bad_2-10') & (df['nflags'] == 0)),
    'spxw_ok': lambda df: (df['ticker'] != 'SPXW') | (df['nflags'] == 0),
    'flow_agree': lambda df: df['flow_agree5'].fillna(False),
    'flow_not_onesided': lambda df: ~df['flow_onesided'].fillna(False),
    'flow_exhaustion_ok': lambda df: ~(df['flow_extreme'].fillna(False) & (df['hr'] < T['morning_end_hr'])) &
                                     (~df['flow_extreme'].fillna(False) |
                                      (df['hr'] >= T['morning_end_hr']) & (np.sign(df['accel']).eq(np.sign(df['dir'])))),
    'wall_ok': lambda df: df['d_wall_bps'].fillna(60) >= T['wall_skip_below_bps'],
    'breakeven_ok': lambda df: df['breakeven_bps'] <= T['breakeven_max_bps'],
    'flags_relaxed': lambda df: df['nflags'] <= T['flags_max_relaxed'],
    'flags_strict': lambda df: df['nflags'] <= T['flags_max_strict'],
}


def compute_positive_stack_score(df: pd.DataFrame) -> pd.Series:
    """Count of independently-validated positive conditions (sizing input)."""
    conds = [
        df['flow_agree5'].fillna(False) & ~df['flow_onesided'].fillna(False),
        df['gex_state'] != 'positive',
        df['d_wall_bps'].between(T['wall_sweet_lo_bps'], T['wall_sweet_hi_bps']),
        df['nflags'] == 0,
        df['trend_day'],
        df['premium_band'] == 'good_0.5-2',
    ]
    return sum(c.astype(int) for c in conds)


def compute_position_size(df: pd.DataFrame, mode: str) -> pd.Series:
    if mode == 'flat':
        return pd.Series(T['size_base'], index=df.index)
    score = compute_positive_stack_score(df)
    size = T['size_floor'] + T['size_step'] * score
    return size.clip(T['size_floor'], T['size_cap'])


def apply_policy(df: pd.DataFrame, policy: dict) -> pd.DataFrame:
    sel = df.copy()
    entry = policy.get('entry', 'atfire')
    if entry == 'confirm':
        sel = sel[sel['confirmed']]
        sel = sel.assign(pnl_raw=sel['pnl_confirm'], entry_used=sel['entry_confirm'], entry_type='confirm')
    else:
        sel = sel.assign(pnl_raw=sel['pnl_atfire'], entry_used=sel['entry_atfire'], entry_type='atfire')
    for fname in policy.get('filters', []):
        sel = sel[FILTERS[fname](sel)]
    size = compute_position_size(sel, policy.get('sizing', 'flat'))
    sel = sel.assign(size=size,
                     pnl=sel['pnl_raw'] * size,
                     cap=sel['entry_used'] * 100 * size,
                     ret_pct=sel['pnl_raw'] / (sel['entry_used'] * 100) * 100)
    return sel.dropna(subset=['pnl'])


def run_policy_suite(df: pd.DataFrame, policies) -> tuple:
    rows, kept = [], {}
    for pol in policies:
        tr = apply_policy(df, pol)
        m = compute_policy_metrics(tr, len(df))
        m.update(holdout_metrics(tr, df))
        m.update(stability_assessment(tr, df, m, T))
        rows.append({'policy': pol['name'], **m})
        kept[pol['name']] = tr
    return pd.DataFrame(rows), kept


def generate_markdown_report(results, ablation, full_trades, baseline_trades, df, path):
    L = []
    L.append('# Policy Simulation Report — ranked by OUT-OF-SAMPLE SURVIVAL, not return\n')
    L.append(f'Universe: {len(df)} repriced fires ({df["day"].min()} → {df["day"].max()}). '
             'Real option marks; live exit rule (structural + trail). Research only.\n')
    L.append('A policy earns its rank by a 9-check stability score (positive mean AND median, '
             'PF>1, bounded drawdown, positive odd AND even days, positive both halves, '
             'neutral-or-better across tickers and time buckets, no outlier/tail dependency) — '
             'NOT by total P&L. A high-return policy that fails holdouts is a curve-fit.\n')
    ranked = results.sort_values(['stability_score', 'ret_on_cap_pct'], ascending=False)
    L.append('## Stability ranking\n')
    L.append(ranked[['policy', 'recommended_status', 'stability_score', 'holdout_pass_count',
                     'regime_pass_count', 'outlier_dependency_score', 'tail_dependency_percent',
                     'n', 'kept_pct', 'ret_on_cap_pct', 'profit_factor', 'win_rate',
                     'ret_odd', 'ret_even', 'ret_H1', 'ret_H2']].to_markdown(index=False))
    L.append('\n### Reading guide\n')
    top = ranked.iloc[0]
    L.append(f"- Most survivable policy: **{top['policy']}** "
             f"(status={top['recommended_status']}, stability {top['stability_score']}/9, "
             f"holdouts {top['holdout_pass_count']}/4, ret {top['ret_on_cap_pct']:+.1f}%).")
    hot = results.sort_values('ret_on_cap_pct', ascending=False).iloc[0]
    if hot['policy'] != top['policy']:
        L.append(f"- Highest RETURN policy is **{hot['policy']}** ({hot['ret_on_cap_pct']:+.1f}%) — "
                 f"stability {hot['stability_score']}/9, status={hot['recommended_status']}: "
                 'return without survival evidence.')
    L.append('\n## Full metric table\n')
    L.append(results.to_markdown(index=False))
    L.append('\n## Ablation (FULL_COMBINED minus one component)\n')
    L.append(ablation.to_markdown(index=False))
    L.append('\n## FULL_COMBINED breakdowns\n')
    for col, title in [('ticker', 'ticker'), ('gex_state', 'GEX state'), ('daytype', 'day type'),
                       ('premium_band', 'premium band'), ('nflags', 'no-trade flags'),
                       ('entry_type', 'entry type')]:
        b = breakdown(full_trades, col)
        if len(b):
            L.append(f'### by {title}\n')
            L.append(b.to_markdown(index=False))
            L.append('')
    tb = full_trades.assign(bucket=pd.cut(full_trades['hr'], [9.5, 10, 11, 12, 13.5, 15, 15.5],
                                          labels=['9:30-10', '10-11', '11-12', 'lunch', '13:30-15', '15+']))
    L.append('### by time bucket\n')
    L.append(breakdown(tb, 'bucket').to_markdown(index=False))
    for ev in ['nfp', 'fomc', 'big_open']:
        b = breakdown(full_trades, ev)
        if len(b):
            L.append(f'\n### by {ev}\n')
            L.append(b.to_markdown(index=False))
    open(path, 'w').write('\n'.join(L))
    print('report →', path)


def main():
    rebuild = '--rebuild' in sys.argv
    df = load_repriced_fires(rebuild)
    validate_schema(df)
    print(f'universe: {len(df)} repriced fires')

    from policy_ablation import run_ablation_suite
    results, kept = run_policy_suite(df, POLICIES + [FULL_POLICY])
    ablation = run_ablation_suite(df, FULL_POLICY, apply_policy, compute_policy_metrics, holdout_metrics)

    results.to_csv(os.path.join(OUTDIR, 'policy_simulation_results.csv'), index=False)
    results.to_parquet(os.path.join(OUTDIR, 'policy_simulation_results.parquet'), index=False)
    ablation.to_csv(os.path.join(OUTDIR, 'policy_ablation_results.csv'), index=False)
    generate_markdown_report(results, ablation, kept['FULL_COMBINED'], kept['baseline_all_fires'],
                             df, os.path.join(OUTDIR, 'policy_summary_report.md'))
    print(results[['policy', 'n', 'kept_pct', 'total_pnl', 'ret_on_cap_pct', 'win_rate',
                   'profit_factor', 'ret_odd', 'ret_even', 'ret_H1', 'ret_H2']].to_string(index=False))


if __name__ == '__main__':
    main()
