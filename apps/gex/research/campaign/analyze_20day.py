"""20-day evolution analysis: for each ticker, walk the last 20 days of UW
option flow AND Skylit GEX/VEX surfaces together to tell the story of HOW the
setup formed — when accumulation started, how the King node built and rolled,
whether spot is approaching the magnet. Reads local cache + archive only."""
import gzip
import json
import os
import sys
from datetime import date

import numpy as np

HERE = os.path.dirname(__file__)
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
DAILY = os.path.join(GEX, 'data/skylit-archive/daily')
FLOW = os.path.join(HERE, 'backtest/flow_cache')
DAYS = sorted(d for d in os.listdir(DAILY) if len(d) == 10 and d[4] == '-')[-20:]
ASOF = DAYS[-1]


def flow_rows(t):
    p = os.path.join(FLOW, f'{t}.json')
    if not os.path.exists(p):
        return {}
    j = json.load(open(p))
    if isinstance(j, dict):
        return {}
    return {r['date']: r for r in j if 'date' in r}


def surf(day, t):
    p = os.path.join(DAILY, day, f'{t}.json.gz')
    return json.load(gzip.open(p)) if os.path.exists(p) else None


def target_exp(t):
    s = surf(ASOF, t)
    if not s:
        return None
    for x in s.get('allExpirations', []):
        d = (date.fromisoformat(x['expiration']) - date.fromisoformat(ASOF)).days
        if 18 <= d <= 55 and x.get('strikes'):
            return x['expiration']
    return None


def king_on(day, t, exp):
    s = surf(day, t)
    if not s:
        return None
    for x in s.get('allExpirations', []):
        if x['expiration'] == exp and x.get('strikes'):
            st = x['strikes']
            K = np.array([q['strike'] for q in st], float)
            G = np.array([q.get('gamma') or 0 for q in st], float)
            V = np.array([q.get('vanna') or 0 for q in st], float)
            tot = np.abs(G).sum() or 1
            ki = int(np.argmax(np.abs(G))); vi = int(np.argmax(np.abs(V)))
            return dict(spot=s['spot'], king=float(K[ki]), share=float(np.abs(G[ki]) / tot),
                        gamma=float(abs(G[ki])), vex=float(K[vi]), vex_sign=int(np.sign(V[vi])))
    return None


def analyze(t):
    fr = flow_rows(t)
    exp = target_exp(t)
    print(f"\n{'='*72}\n{t} — 20-day evolution (target expiry {exp})\n{'='*72}")
    if not exp:
        print("  no monthly surface"); return
    fdates = sorted(d for d in fr if d <= ASOF)[-20:]   # full 20-day flow window
    cum = 0
    print(f"  {'date':10} {'spot':>8} {'King':>7} {'node%':>6} | {'netCall$M':>9} {'cum$M':>7} {'ask%':>5}")
    first_share = last_share = None
    spot0 = spotN = None
    king_seq = []
    for d in fdates:                                     # iterate FLOW days (all 20)
        f = fr.get(d)
        net = float(f.get('net_call_premium') or 0) / 1e6
        cum += net
        at = int(f.get('call_volume_ask_side') or 0); bt = int(f.get('call_volume_bid_side') or 0)
        ask = at / (at + bt) * 100 if (at + bt) else float('nan')
        k = king_on(d, t, exp)                           # GEX where a surface exists
        if k:
            if first_share is None:
                first_share = k['share']; spot0 = k['spot']
            last_share = k['share']; spotN = k['spot']; king_seq.append(k['king'])
            gex = f"{k['spot']:>8.2f} {k['king']:>7.0f} {k['share']*100:>5.1f}%"
        else:
            gex = f"{'—':>8} {'—':>7} {'—':>6}"
        print(f"  {d:10} {gex} | {net:>+9.1f} {cum:>+7.0f} {ask:>4.0f}%")
    # narrative synthesis
    print(f"\n  STORY:")
    if spot0 and spotN:
        print(f"   • spot: ${spot0:.2f} → ${spotN:.2f} ({(spotN-spot0)/spot0*100:+.1f}% over 20d)")
    if king_seq:
        rolled = king_seq[-1] - king_seq[0]
        moved = 'rolled UP' if rolled > 0 else 'rolled DOWN' if rolled < 0 else 'held'
        print(f"   • King magnet: ${king_seq[0]:.0f} → ${king_seq[-1]:.0f} ({moved}); "
              f"currently +{(king_seq[-1]-spotN)/spotN*100:.1f}% above spot")
    if first_share and last_share:
        print(f"   • node strength: {first_share*100:.1f}% → {last_share*100:.1f}% of the expiry "
              f"({'BUILDING' if last_share > first_share else 'fading'})")
    tot20 = sum(float(fr[d].get('net_call_premium') or 0) for d in fdates) / 1e6
    pos = sum(1 for d in fdates if float(fr[d].get('net_call_premium') or 0) > 0)
    print(f"   • flow: 20d net call premium {tot20:+.0f}M, {pos}/{len(fdates)} positive days "
          f"→ {'ACCUMULATION' if tot20 > 20 and pos >= 10 else 'NO accumulation'}")


if __name__ == '__main__':
    tickers = sys.argv[1:] or ['MRVL', 'AAPL', 'META', 'MSFT', 'GOOGL']
    for t in tickers:
        analyze(t)
