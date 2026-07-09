"""Study harness — the evidence bar, encoded once and reused by every study.

Implements the charter's discipline mechanically:
  - real option dollars (pnl_atfire on final-system fires)
  - stability: direction must hold on odd/even days AND both halves
  - placebo: permutation percentile (pooled) + split-half guard against
    multiple-comparison luck for auto-generated hypotheses
  - incremental over gate+nflags: signal must survive inside nflags==0
  - sample floor n>=30 to graduate past forward_watchlist
  - forced verdict: every study returns one of the fixed statuses

Nothing here writes, imports live code, or has side effects.
"""
import os
import numpy as np
import pandas as pd

from safety import RESEARCH_ROOT

FIRES_PARQUET = os.path.join(
    RESEARCH_ROOT, 'gexvex-structure/outputs/fires_structure.parquet')

# Verdict vocabulary (fixed).
REJECTED = 'rejected'
FORWARD_WATCHLIST = 'forward_watchlist'
PROMISING = 'promising'
NOT_TESTABLE = 'not_testable'

# Bars.
MIN_N = 30
GAP_BAR = 10.0            # pp, |hi - lo| tercile EV gap
PLACEBO_BAR = 95.0        # pooled percentile
SPLIT_HALF_BAR = 80.0     # min of odd/even placebo (multiple-testing guard)
PLACEBO_FLOOR = 80.0      # below this = noise = rejected


def load_fires():
    """Read-only load of the final-system fire set with structure features."""
    df = pd.read_parquet(FIRES_PARQUET)
    fs = df[df['final_sys']].copy()
    fs['cap'] = fs['entry_atfire'] * 100
    return fs


def ev(sub):
    cap = sub['cap'].sum()
    return sub['pnl_atfire'].sum() / cap * 100 if len(sub) and cap > 0 else float('nan')


def _terciles(fs, feature):
    v = fs.dropna(subset=[feature])
    if len(v) < 3 * MIN_N or v[feature].nunique() < 3:
        return None
    try:
        q = pd.qcut(v[feature], 3, labels=[0, 1, 2], duplicates='drop')
    except ValueError:
        return None
    if pd.Series(q).nunique() < 3:
        return None
    return v, q


def stability_cuts(fs, mask_series):
    """EV of the masked subset on odd days, even days, first half, second half."""
    days = sorted(fs['day'].unique())
    half = len(days) // 2
    sub = fs[mask_series]
    out = []
    for sel in (days[::2], days[1::2], days[:half], days[half:]):
        s = sub[sub['day'].isin(sel)]
        out.append(ev(s))
    return out


def placebo_pctl(fs, feature, real_gap, rng, n=500, day_subset=None):
    """Percentile of |real_gap| against permuted-feature tercile gaps."""
    base = fs if day_subset is None else fs[fs['day'].isin(day_subset)]
    v = base.dropna(subset=[feature])
    if len(v) < 3 * MIN_N:
        return float('nan')
    pnl = v['pnl_atfire'].values
    cap = v['cap'].values
    vals = v[feature].values
    worse = 0
    for _ in range(n):
        sh = rng.permutation(vals)
        lo_t, hi_t = np.quantile(sh, 1/3), np.quantile(sh, 2/3)
        lo = sh <= lo_t
        hi = sh >= hi_t
        g = (pnl[hi].sum() / cap[hi].sum() * 100 if cap[hi].sum() > 0 else 0) - \
            (pnl[lo].sum() / cap[lo].sum() * 100 if cap[lo].sum() > 0 else 0)
        if abs(g) >= abs(real_gap):
            worse += 1
    return 100 - worse / n * 100


def evaluate_feature(fs, feature, rng, family='unspecified'):
    """Full evidence-bar evaluation of one conditioning feature. Returns dict."""
    t = _terciles(fs, feature)
    if t is None:
        return dict(feature=feature, family=family, verdict=NOT_TESTABLE,
                    reason='insufficient coverage / <3 distinct terciles')
    v, q = t
    ev_lo, ev_mid, ev_hi = ev(v[q == 0]), ev(v[q == 1]), ev(v[q == 2])
    gap = ev_hi - ev_lo
    best_hi = gap >= 0
    # stability: does the better tercile beat the worse on all four cuts?
    better = 2 if best_hi else 0
    worse_t = 0 if best_hi else 2
    days = sorted(v['day'].unique())
    half = len(days) // 2
    cuts_ok = 0
    cut_detail = []
    for sel in (days[::2], days[1::2], days[:half], days[half:]):
        s = v[v['day'].isin(sel)]
        eb, ew = ev(s[q[s.index] == better]), ev(s[q[s.index] == worse_t])
        ok = (eb == eb and ew == ew and eb > ew)
        cuts_ok += ok
        cut_detail.append(round(eb - ew, 1) if (eb == eb and ew == ew) else None)
    pooled = placebo_pctl(v, feature, gap, rng)
    odd_p = placebo_pctl(v, feature, gap, rng, day_subset=days[::2])
    even_p = placebo_pctl(v, feature, gap, rng, day_subset=days[1::2])
    # ticker-neutrality (the check that caught dn_vex_mass SPXW-concentration
    # in the 77-study): count tickers where the hi-lo gap keeps the pooled sign
    tickers_consistent = 0
    ticker_gaps = {}
    for tk in ('SPY', 'QQQ', 'SPXW'):
        s = v[v['ticker'] == tk]
        if len(s) < MIN_N:
            continue
        try:
            sq = pd.qcut(s[feature], 3, labels=[0, 1, 2], duplicates='drop')
        except ValueError:
            continue
        if pd.Series(sq).nunique() < 3:
            continue
        g = ev(s[sq == 2]) - ev(s[sq == 0])
        ticker_gaps[tk] = round(g, 1)
        if g == g and np.sign(g) == np.sign(gap):
            tickers_consistent += 1
    # incremental over gate+nflags: gap inside nflags==0 same sign?
    z = v[v['nflags'] == 0]
    incr = float('nan')
    if len(z) >= 2 * MIN_N:
        zq = pd.qcut(z[feature], 2, labels=[0, 1], duplicates='drop')
        if pd.Series(zq).nunique() == 2:
            hi_ev, lo_ev = ev(z[zq == 1]), ev(z[zq == 0])
            incr = (hi_ev - lo_ev) if best_hi else (lo_ev - hi_ev)
    n_key = int(min((q == better).sum(), (q == worse_t).sum()))
    res = dict(
        feature=feature, family=family, n=len(v), n_key=n_key,
        ev_lo=round(ev_lo, 1), ev_mid=round(ev_mid, 1), ev_hi=round(ev_hi, 1),
        gap=round(gap, 1), cuts_ok=cuts_ok, cut_detail=cut_detail,
        placebo_pooled=round(pooled, 0), placebo_odd=round(odd_p, 0),
        placebo_even=round(even_p, 0), incremental=round(incr, 1) if incr == incr else None,
        tickers_consistent=tickers_consistent, ticker_gaps=ticker_gaps)
    res['verdict'] = classify(res)
    return res


def classify(r):
    """Forced verdict from the metrics. Conservative by construction."""
    if r.get('placebo_pooled') != r.get('placebo_pooled'):
        return NOT_TESTABLE
    # noise
    if r['placebo_pooled'] < PLACEBO_FLOOR:
        return REJECTED
    strong_placebo = (r['placebo_pooled'] >= PLACEBO_BAR and
                      min(r['placebo_odd'], r['placebo_even']) >= SPLIT_HALF_BAR)
    incr_ok = (r['incremental'] is not None and
               np.sign(r['incremental']) == np.sign(r['gap']) and r['incremental'] != 0)
    # ticker-neutrality: the signal must hold on >=2 of 3 tickers, else it is
    # concentrated (e.g. dn_vex_mass is SPXW-only) -> forward_watchlist, not promising
    ticker_ok = r.get('tickers_consistent', 0) >= 2
    full_bar = (abs(r['gap']) >= GAP_BAR and r['cuts_ok'] == 4 and
                strong_placebo and incr_ok and r['n_key'] >= MIN_N and ticker_ok)
    if full_bar:
        return PROMISING
    # directional + some evidence but not the full bar
    if r['placebo_pooled'] >= PLACEBO_FLOOR and (r['cuts_ok'] >= 3 or incr_ok):
        return FORWARD_WATCHLIST
    return REJECTED
