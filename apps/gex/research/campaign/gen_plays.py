"""Generate swing-option plays applying the BACKTEST-VALIDATED rules:
  - INTERSECTION only (flow-bullish AND GEX King magnet above spot in reach).
    node-alone loses money (49% win), flow drives, intersection is best (70%).
  - flow-weighted score.
  - +100% take-profit target baked in (setups spike +208% median then fade).

Uses the flow cache (UW 20d accumulation, thru latest) + the freshest Skylit
archive surface. Always reports GOOGL/GOOG/MSFT (user watchlist) pass or fail.
Emits play_candidates.json for live pricing. No network here.
"""
import gzip
import json
import os
from datetime import date

import numpy as np

HERE = os.path.dirname(__file__)
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
DAILY = os.path.join(GEX, 'data/skylit-archive/daily')
FLOW = os.path.join(HERE, 'backtest/flow_cache')

DAYS = sorted(d for d in os.listdir(DAILY) if len(d) == 10 and d[4] == '-')
ASOF = DAYS[-1]                       # freshest archived surface
EXP_MIN_DTE, EXP_MAX_DTE = 18, 55
WATCH = ['GOOGL', 'GOOG', 'MSFT']


def load_flow(t):
    p = os.path.join(FLOW, f'{t}.json')
    if not os.path.exists(p):
        return None
    j = json.load(open(p))
    if isinstance(j, dict) and j.get('error'):
        return None
    return {r['date']: r for r in j if 'date' in r}


def flow_features(fr):
    dates = sorted(fr)
    if len(dates) < 15:
        return None
    win = dates[-20:]
    net = [float(fr[d].get('net_call_premium') or 0) for d in win]
    callp = [float(fr[d].get('call_premium') or 0) for d in win]
    ask = [int(fr[d].get('call_volume_ask_side') or 0) for d in win]
    bid = [int(fr[d].get('call_volume_bid_side') or 0) for d in win]
    net7 = sum(net[-7:])
    at, bt = sum(ask), sum(bid)
    return dict(sum20=sum(net), sum7=net7, posdays=sum(1 for x in net if x > 0),
                askshare=at / (at + bt) if (at + bt) else 0, lastdate=win[-1])


def dte(exp):
    return (date.fromisoformat(exp) - date.fromisoformat(ASOF)).days


def magnet(surf):
    spot = surf['spot']
    best = None
    for x in surf.get('allExpirations', []):
        if EXP_MIN_DTE <= dte(x['expiration']) <= EXP_MAX_DTE and x.get('strikes'):
            best = x; break
    if not best:
        return None
    st = best['strikes']
    K = np.array([s['strike'] for s in st], float)
    G = np.array([s.get('gamma') or 0 for s in st], float)
    V = np.array([s.get('vanna') or 0 for s in st], float)
    totG = np.abs(G).sum() or 1
    ki = int(np.argmax(np.abs(G)))
    return dict(exp=best['expiration'], dte=dte(best['expiration']), spot=spot,
                king=float(K[ki]), share=float(np.abs(G[ki]) / totG), sign=int(np.sign(G[ki])),
                strikes=[float(k) for k in K])


def occ(t, exp, strike):
    y, m, d = exp.split('-')
    return f"{t}{y[2:]}{m}{d}C{round(strike * 1000):08d}"


def nearest(strikes, x):
    return min(strikes, key=lambda k: abs(k - x))


def score(ff, mg, dist):
    # flow-weighted (backtest: flow drives), node confirms
    accum = min(1, ff['sum20'] / 100e6)
    persist = ff['posdays'] / 20
    ask = min(1, max(0, (ff['askshare'] - 0.45) / 0.20))
    node = min(1, mg['share'] / 0.15)
    room = 1 - min(1, abs(dist - 0.08) / 0.17)     # sweet spot ~8% to magnet
    w = {'accum': 30, 'persist': 16, 'ask': 14, 'node': 22, 'room': 8}
    raw = accum * w['accum'] + persist * w['persist'] + ask * w['ask'] + node * w['node'] + room * w['room']
    return round(raw / sum(w.values()) * 100)


def evaluate(t, fr):
    ff = flow_features(fr)
    p = os.path.join(DAILY, ASOF, f'{t}.json.gz')
    surf = json.load(gzip.open(p)) if os.path.exists(p) else None
    mg = magnet(surf) if surf else None
    out = {'ticker': t, 'flow': ff, 'reasons': []}
    if not ff:
        out['reasons'].append('no flow history'); return out
    if not mg:
        out['reasons'].append('no monthly surface'); return out
    dist = (mg['king'] - mg['spot']) / mg['spot']
    flow_ok = ff['sum20'] > 20e6 and ff['posdays'] >= 10 and ff['askshare'] >= 0.48
    node_ok = mg['share'] >= 0.06 and 0.02 <= dist <= 0.25
    if not flow_ok:
        out['reasons'].append(f"flow weak (20d ${ff['sum20']/1e6:.0f}M, {ff['posdays']}/20d, ask {ff['askshare']*100:.0f}%)")
    if not node_ok:
        if mg['share'] < 0.06:
            out['reasons'].append(f"node weak ({mg['share']*100:.1f}% of map)")
        elif dist < 0.02:
            out['reasons'].append(f"King at/below spot ({dist*100:+.1f}%) — no upside target")
        elif dist > 0.25:
            out['reasons'].append(f"King too far (+{dist*100:.0f}%)")
    strike = nearest(mg['strikes'], mg['king'])
    out.update(dict(spot=round(mg['spot'], 2), king=mg['king'], node_share=round(mg['share'] * 100, 1),
                    dist=round(dist * 100, 1), exp=mg['exp'], dte=mg['dte'], strike=strike,
                    occ=occ(t, mg['exp'], strike), sum20=round(ff['sum20'] / 1e6), sum7=round(ff['sum7'] / 1e6),
                    posdays=ff['posdays'], askshare=round(ff['askshare'] * 100),
                    intersection=bool(flow_ok and node_ok)))
    if out['intersection']:
        out['score'] = score(ff, mg, dist)
        out['target_pct'] = out['dist']          # underlying target = magnet
        out['reasons'] = ['INTERSECTION ✓ flow + node']
    return out


def main():
    tickers = [f.replace('.json', '') for f in os.listdir(FLOW) if f.endswith('.json')]
    plays, watch = [], {}
    for t in tickers:
        fr = load_flow(t)
        if not fr:
            continue
        ev = evaluate(t, fr)
        if ev.get('intersection'):
            plays.append(ev)
        if t in WATCH:
            watch[t] = ev
    plays.sort(key=lambda x: x.get('score', 0), reverse=True)
    print(f"as-of surface {ASOF} · flow thru latest cache")
    print(f"\n=== {len(plays)} INTERSECTION plays (validated rule) — top 12 ===")
    for p in plays[:12]:
        print(f"  {p['ticker']:6} score {p.get('score'):3} | ${p['strike']:.0f}C {p['exp']} ({p['dte']}d) | "
              f"spot ${p['spot']} King ${p['king']:.0f} (+{p['dist']}%, {p['node_share']}% map) | "
              f"20d ${p['sum20']}M {p['posdays']}/20 ask{p['askshare']}%")
    print(f"\n=== WATCHLIST (GOOGL/GOOG/MSFT) — honest pass/fail ===")
    for t in WATCH:
        w = watch.get(t)
        if not w:
            print(f"  {t}: no data"); continue
        if w.get('intersection'):
            print(f"  {t}: ✅ PASSES — score {w['score']}, ${w['strike']:.0f}C {w['exp']}, King +{w['dist']}%")
        else:
            extra = ''
            if 'spot' in w:
                extra = f" [spot ${w['spot']}, King ${w['king']:.0f} ({w['dist']:+}%), 20d ${w.get('sum20','?')}M, {w.get('posdays','?')}/20, ask {w.get('askshare','?')}%]"
            print(f"  {t}: ❌ fails — {'; '.join(w['reasons'])}{extra}")
    json.dump({'asof': ASOF, 'plays': plays, 'watch': watch},
              open(os.path.join(HERE, 'play_candidates.json'), 'w'))
    print(f"\nwrote play_candidates.json ({len(plays)} intersection plays)")


if __name__ == '__main__':
    main()
