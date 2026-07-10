"""Cohort-backtest step 2: run the funnel AS-OF each past formation date using
the flow cache (Stage 1) + the Skylit archive surfaces (Stage 2, GEX + VEX).

Emits one target option contract per (cohort, ticker, arm) so step 3 can price
the real forward outcome. Four arms isolate the edge:
  intersection : flow-bullish AND strong GEX King magnet above spot  -> magnet call
  flow_only    : flow-bullish, ignore the map                        -> ATM call
  node_only    : strong GEX King magnet above spot, ignore flow      -> magnet call
  placebo      : random options-liquid ticker, not flow-selected     -> ~OTM call

GEX (gamma) picks the target magnet; VEX (vanna) alignment is recorded for
analysis. No network here — reads cache + archive only.
"""
import gzip
import json
import os
import random

import numpy as np

HERE = os.path.dirname(__file__)
GEX = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DAILY = os.path.join(GEX, 'data/skylit-archive/daily')
FLOW = os.path.join(HERE, 'flow_cache')

rng = random.Random(42)

DAYS = sorted(d for d in os.listdir(DAILY) if len(d) == 10 and d[4] == '-')
FWD = 20                      # need 20 trading days forward
FORM_DATES = DAYS[:len(DAYS) - FWD - 1][::2]   # every 2nd day, leaving forward room
SHORTLIST = 40               # top-N by flow per cohort
EXP_MIN_DTE, EXP_MAX_DTE = 18, 55   # monthly-ish target expiry


def load_flow(t):
    p = os.path.join(FLOW, f'{t}.json')
    if not os.path.exists(p):
        return None
    j = json.load(open(p))
    if isinstance(j, dict) and j.get('error'):
        return None
    # rows have date + net_call_premium etc.; index by date
    return {r['date']: r for r in j if 'date' in r}


def flow_features(flowrows, asof):
    """20-day accumulation ending at `asof` (inclusive)."""
    dates = sorted(d for d in flowrows if d <= asof)
    if len(dates) < 15:
        return None
    win = dates[-20:]
    net = [float(flowrows[d].get('net_call_premium') or 0) for d in win]
    callp = [float(flowrows[d].get('call_premium') or 0) for d in win]
    ask = [int(flowrows[d].get('call_volume_ask_side') or 0) for d in win]
    bid = [int(flowrows[d].get('call_volume_bid_side') or 0) for d in win]
    sum20 = sum(net)
    posdays = sum(1 for x in net if x > 0)
    asktot, bidtot = sum(ask), sum(bid)
    askshare = asktot / (asktot + bidtot) if (asktot + bidtot) else 0
    return dict(sum20=sum20, posdays=posdays, askshare=askshare, callprem=sum(callp))


def surface(day, t):
    p = os.path.join(DAILY, day, f'{t}.json.gz')
    if not os.path.exists(p):
        return None
    try:
        return json.load(gzip.open(p))
    except Exception:
        return None


def dte(exp, asof):
    from datetime import date
    a = date.fromisoformat(asof); e = date.fromisoformat(exp)
    return (e - a).days


def magnets(surf, asof):
    """Pick a monthly-ish expiry; return GEX King + VEX magnet on it."""
    spot = surf['spot']
    best = None
    for x in surf.get('allExpirations', []):
        d = dte(x['expiration'], asof)
        if EXP_MIN_DTE <= d <= EXP_MAX_DTE and x.get('strikes'):
            best = x; break
    if not best:
        return None
    st = best['strikes']
    K = np.array([s['strike'] for s in st], float)
    G = np.array([s.get('gamma') or 0 for s in st], float)
    V = np.array([s.get('vanna') or 0 for s in st], float)
    totG = np.abs(G).sum() or 1
    ki = int(np.argmax(np.abs(G)))       # GEX King
    vi = int(np.argmax(np.abs(V)))       # VEX magnet
    return dict(exp=best['expiration'], dte=dte(best['expiration'], asof), spot=spot,
                gex_king=float(K[ki]), gex_share=float(np.abs(G[ki]) / totG), gex_sign=int(np.sign(G[ki])),
                vex_strike=float(K[vi]), vex_sign=int(np.sign(V[vi])), strikes=[float(k) for k in K])


def occ(t, exp, strike):
    y, m, d = exp.split('-')
    return f"{t}{y[2:]}{m}{d}C{round(strike * 1000):08d}"


def nearest_strike(strikes, target):
    return min(strikes, key=lambda k: abs(k - target))


def main():
    tickers = [f.replace('.json', '') for f in os.listdir(FLOW) if f.endswith('.json')]
    flows = {t: load_flow(t) for t in tickers}
    flows = {t: f for t, f in flows.items() if f}
    print(f'{len(flows)} tickers with flow cache; {len(FORM_DATES)} cohorts')

    cohorts = []
    for D in FORM_DATES:
        # Stage 1: flow features as-of D, rank by 20d net call premium
        scored = []
        for t, fr in flows.items():
            ff = flow_features(fr, D)
            if ff and ff['sum20'] > 0:
                scored.append((t, ff))
        scored.sort(key=lambda x: x[1]['sum20'], reverse=True)
        shortlist = scored[:SHORTLIST]
        shortlist_set = {t for t, _ in shortlist}

        # Stage 2 on the shortlist: GEX King magnet above spot within reach
        surfaced = []
        for t, ff in shortlist:
            surf = surface(D, t)
            if not surf:
                continue
            mg = magnets(surf, D)
            if not mg:
                continue
            dist = (mg['gex_king'] - mg['spot']) / mg['spot']
            strong = mg['gex_share'] >= 0.06
            above = 0.02 <= dist <= 0.25          # King above spot, room to run
            entry_strike = nearest_strike(mg['strikes'], mg['gex_king'])
            atm_strike = nearest_strike(mg['strikes'], mg['spot'] * 1.02)
            rec = dict(cohort=D, ticker=t, exp=mg['exp'], dte=mg['dte'], spot=mg['spot'],
                       gex_king=mg['gex_king'], gex_share=round(mg['gex_share'], 3),
                       vex_strike=mg['vex_strike'], vex_aligned=int((mg['vex_strike'] - mg['spot']) * (mg['gex_king'] - mg['spot']) > 0),
                       dist=round(dist, 3), sum20=round(ff['sum20']), posdays=ff['posdays'],
                       askshare=round(ff['askshare'], 3))
            if strong and above:
                cohorts.append({**rec, 'arm': 'intersection', 'occ': occ(t, mg['exp'], entry_strike), 'strike': entry_strike})
            # flow_only: every shortlisted name, ATM call (ignore whether map is strong)
            cohorts.append({**rec, 'arm': 'flow_only', 'occ': occ(t, mg['exp'], atm_strike), 'strike': atm_strike})
            surfaced.append(t)

        # node_only (TRUE ablation): strong GEX King magnet among names NOT in
        # the flow shortlist -> magnet call. Isolates the node WITHOUT flow.
        nonflow = [t for t in flows if t not in shortlist_set]
        rng.shuffle(nonflow)
        picked_node = 0
        for t in nonflow:
            if picked_node >= 14:
                break
            surf = surface(D, t)
            if not surf:
                continue
            mg = magnets(surf, D)
            if not mg:
                continue
            dist = (mg['gex_king'] - mg['spot']) / mg['spot']
            if mg['gex_share'] >= 0.06 and 0.02 <= dist <= 0.25:
                es = nearest_strike(mg['strikes'], mg['gex_king'])
                cohorts.append(dict(cohort=D, ticker=t, arm='node_only', exp=mg['exp'], dte=mg['dte'],
                                    spot=mg['spot'], strike=es, occ=occ(t, mg['exp'], es),
                                    gex_king=mg['gex_king'], gex_share=round(mg['gex_share'], 3),
                                    dist=round(dist, 3)))
                picked_node += 1

        # Placebo: random options-liquid tickers NOT flow-shortlisted, ~OTM call
        pool = [t for t in flows if t not in shortlist_set]
        rng.shuffle(pool)
        picked = 0
        for t in pool:
            if picked >= 8:
                break
            surf = surface(D, t)
            if not surf:
                continue
            mg = magnets(surf, D)
            if not mg:
                continue
            otm = nearest_strike(mg['strikes'], mg['spot'] * 1.06)
            cohorts.append(dict(cohort=D, ticker=t, arm='placebo', exp=mg['exp'], dte=mg['dte'],
                                spot=mg['spot'], strike=otm, occ=occ(t, mg['exp'], otm),
                                gex_share=round(mg['gex_share'], 3), dist=round((otm - mg['spot']) / mg['spot'], 3)))
            picked += 1

    by_arm = {}
    for c in cohorts:
        by_arm[c['arm']] = by_arm.get(c['arm'], 0) + 1
    print('legs by arm:', by_arm)
    json.dump(cohorts, open(os.path.join(HERE, 'cohorts.json'), 'w'))
    print(f'wrote cohorts.json: {len(cohorts)} legs, {len(set(c["occ"] for c in cohorts))} unique contracts')


if __name__ == '__main__':
    main()
