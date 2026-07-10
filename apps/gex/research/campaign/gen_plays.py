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


def _exp_block(surf, exp):
    for x in surf.get('allExpirations', []):
        if x['expiration'] == exp and x.get('strikes'):
            return x
    return None


def _king(block):
    """King magnet on an expiry block: strike, |gamma| share of that expiry, raw |gamma|."""
    st = block['strikes']
    K = np.array([s['strike'] for s in st], float)
    G = np.array([s.get('gamma') or 0 for s in st], float)
    tot = np.abs(G).sum() or 1
    ki = int(np.argmax(np.abs(G)))
    return float(K[ki]), float(np.abs(G[ki]) / tot), float(abs(G[ki])), [float(k) for k in K]


def load_surface(day, t):
    p = os.path.join(DAILY, day, f'{t}.json.gz')
    return json.load(gzip.open(p)) if os.path.exists(p) else None


def magnet(t):
    """20-DAY GEX/VEX picture (not a single snapshot). Pick the monthly target
    expiry as-of the latest day, then track that expiry's King magnet across the
    last ~20 archive days: robust strike (mode), persistence, and GROWTH — the
    doctrine's test for a real node vs a one-day hedge fluke."""
    latest = load_surface(ASOF, t)
    if not latest:
        return None
    tgt = None
    for x in latest.get('allExpirations', []):
        if EXP_MIN_DTE <= dte(x['expiration']) <= EXP_MAX_DTE and x.get('strikes'):
            tgt = x['expiration']; break
    if not tgt:
        return None
    window = DAYS[-20:]
    kings, shares, gammas, above = [], [], [], 0
    n = 0
    for d in window:
        surf = load_surface(d, t)
        blk = _exp_block(surf, tgt) if surf else None
        if not blk:
            continue
        ks, sh, gm, strikes = _king(blk)
        sp = surf['spot']
        kings.append(ks); shares.append(sh); gammas.append(gm)
        n += 1
        # bullish structure = a strong King sitting above spot within reach that day
        if sh >= 0.06 and 0.01 <= (ks - sp) / sp <= 0.30:
            above += 1
    if n < 8:
        return None
    spot = latest['spot']
    king_now = kings[-1]                              # current pull (may roll)
    persist = above / n
    share_avg = float(np.mean(shares))
    h = len(gammas) // 2
    old = np.mean(gammas[:h]) or 1
    growth = (np.mean(gammas[h:]) - old) / abs(old)
    # ---- VEX (vanna) direction + pin detection on the CURRENT target surface ----
    blk = _exp_block(latest, tgt)
    K = np.array([q['strike'] for q in blk['strikes']], float)
    G = np.array([q.get('gamma') or 0 for q in blk['strikes']], float)
    V = np.array([q.get('vanna') or 0 for q in blk['strikes']], float)
    vi = int(np.argmax(np.abs(V)))
    vex_strike = float(K[vi]); vex_dist = (vex_strike - spot) / spot
    up_v = V[K > spot].sum(); dn_v = V[K < spot].sum()
    # bullish vanna = the VEX magnet pulls UP (above spot) AND net vanna leans up
    vex_bullish = vex_dist > 0.01 and up_v >= abs(dn_v) * 0.7
    # pin: dominant gamma King sits AT spot (pinned, not trending) -> bad for a call
    ki = int(np.argmax(np.abs(G)))
    pinned = abs(K[ki] - spot) / spot < 0.02 and abs(G[ki]) / (np.abs(G).sum() or 1) >= 0.18
    king_sign = 'pika' if G[ki] >= 0 else 'barney'
    return dict(exp=tgt, dte=dte(tgt), spot=spot, king=king_now, share=share_avg,
                share_now=shares[-1], persist=round(persist, 2), growth=round(float(growth), 2),
                days=n, strikes=strikes, vex_strike=vex_strike, vex_dist=round(vex_dist * 100, 1),
                vex_bullish=bool(vex_bullish), pinned=bool(pinned), king_sign=king_sign)


def occ(t, exp, strike):
    y, m, d = exp.split('-')
    return f"{t}{y[2:]}{m}{d}C{round(strike * 1000):08d}"


def nearest(strikes, x):
    return min(strikes, key=lambda k: abs(k - x))


def recent_pop(t):
    """Anti-chase: fractional move over the last ~3 archive days. The prediction
    backtest showed already-popped names FADE — don't chase them."""
    px = [s['spot'] for d in DAYS[-4:] if (s := load_surface(d, t))]
    return (px[-1] - px[0]) / px[0] if len(px) >= 2 else 0.0


def market_regime():
    """'There's always a bull somewhere.' Don't gate on QQQ (it misses sector
    rotations — 7/09 QQQ +1.7% while optical/semis ripped; a 5-day gate wrongly
    read chop). Report the actual last-session QQQ move + rank THEMES; the gate
    is per-theme, so we trade the leaders even when the index is mixed."""
    from themes import theme_strength
    q = [s['spot'] for d in DAYS[-3:] if (s := load_surface(d, 'QQQ'))]
    q1 = round((q[-1] - q[-2]) / q[-2] * 100, 1) if len(q) >= 2 else None   # yesterday's real QQQ move
    ranked, bulls = theme_strength()
    leaders = [(th, v['r1'], v['breadth']) for th, v in list(ranked.items())[:4]]
    return dict(qqq_1d=q1, bull_themes=sorted(bulls), leaders=leaders,
                note=(f"Bull themes: {', '.join(sorted(bulls)[:4])} — trade the leaders"
                      if bulls else "no clear bull theme — stand down"))


def score(ff, mg, dist):
    # flow-weighted (backtest: flow drives), 20-day node persistence/growth confirms
    accum = min(1, ff['sum20'] / 100e6)
    fpersist = ff['posdays'] / 20
    ask = min(1, max(0, (ff['askshare'] - 0.45) / 0.20))
    node = min(1, mg['share'] / 0.15)
    npersist = mg['persist']                        # King held its strike over 20d
    ngrowth = min(1, max(0, mg['growth']))          # node magnitude rising (intent)
    room = 1 - min(1, abs(dist - 0.08) / 0.17)      # sweet spot ~8% to magnet
    w = {'accum': 28, 'fpersist': 12, 'ask': 12, 'node': 16, 'npersist': 14, 'ngrowth': 10, 'room': 8}
    raw = (accum * w['accum'] + fpersist * w['fpersist'] + ask * w['ask'] + node * w['node'] +
           npersist * w['npersist'] + ngrowth * w['ngrowth'] + room * w['room'])
    return round(raw / sum(w.values()) * 100)


def evaluate(t, fr):
    ff = flow_features(fr)
    out = {'ticker': t, 'flow': ff, 'reasons': []}
    if not ff:
        out['reasons'].append('no flow history'); return out
    mg = magnet(t)                                  # 20-day GEX/VEX picture
    if not mg:
        out['reasons'].append('no persistent monthly surface'); return out
    dist = (mg['king'] - mg['spot']) / mg['spot']
    pop3 = recent_pop(t)
    # ask-side >=50% qualifies; >=52% is the A+ tier (backtest: PF 2.2 -> 2.8)
    flow_ok = ff['sum20'] > 20e6 and ff['posdays'] >= 10 and ff['askshare'] >= 0.50
    aplus = ff['askshare'] >= 0.52 and mg['share'] >= 0.15
    node_ok = mg['share'] >= 0.06 and mg['persist'] >= 0.5 and 0.02 <= dist <= 0.25
    chase_ok = pop3 <= 0.08                                # anti-chase: not already popped >8% in 3d
    vex_ok = mg['vex_bullish'] and not mg['pinned']       # VEX magnet pulls UP + not pinned at spot
    if not flow_ok:
        out['reasons'].append(f"flow weak (20d ${ff['sum20']/1e6:.0f}M, {ff['posdays']}/20d, ask {ff['askshare']*100:.0f}% <52)")
    if not chase_ok:
        out['reasons'].append(f"already popped +{pop3*100:.0f}% in 3d — chasing fades")
    if not vex_ok:
        if mg['pinned']:
            out['reasons'].append(f"PINNED — GEX King at spot (pika wall), price stuck not trending")
        else:
            out['reasons'].append(f"VEX bearish — vanna magnet at ${mg['vex_strike']:.0f} ({mg['vex_dist']:+}%) pulls DOWN")
    if not node_ok:
        if mg['share'] < 0.06:
            out['reasons'].append(f"node weak ({mg['share']*100:.1f}% of map avg over 20d)")
        elif mg['persist'] < 0.5:
            out['reasons'].append(f"node not persistent (King held its strike only {mg['persist']*100:.0f}% of 20d)")
        elif dist < 0.02:
            out['reasons'].append(f"King at/below spot ({dist*100:+.1f}%) — no upside target")
        elif dist > 0.25:
            out['reasons'].append(f"King too far (+{dist*100:.0f}%)")
    strike = nearest(mg['strikes'], mg['king'])
    out.update(dict(spot=round(mg['spot'], 2), king=mg['king'], node_share=round(mg['share'] * 100, 1),
                    node_persist=round(mg['persist'] * 100), node_growth=round(mg['growth'] * 100),
                    node_days=mg['days'], dist=round(dist * 100, 1), exp=mg['exp'], dte=mg['dte'], strike=strike,
                    occ=occ(t, mg['exp'], strike), sum20=round(ff['sum20'] / 1e6), sum7=round(ff['sum7'] / 1e6),
                    posdays=ff['posdays'], askshare=round(ff['askshare'] * 100),
                    pop3=round(pop3 * 100, 1), vex_strike=mg['vex_strike'], vex_dist=mg['vex_dist'],
                    vex_bullish=mg['vex_bullish'], pinned=mg['pinned'], king_sign=mg['king_sign'],
                    intersection=bool(flow_ok and node_ok and chase_ok and vex_ok)))
    if out['intersection']:
        out['score'] = score(ff, mg, dist)
        out['target_pct'] = out['dist']
        out['take_profit_pct'] = 100            # validated: limit-sell at +100% (70% win, PF 2.2)
        out['max_hold_days'] = 20               # hard time-stop
        out['aplus'] = bool(aplus)              # A+ = ask>=52% + strong node (backtest PF 2.8)
        out['reasons'] = [f"{'A+ ' if aplus else ''}INTERSECTION ✓ flow + GEX node ({out['node_persist']}% persist, {mg['king_sign']}) + VEX bullish (${mg['vex_strike']:.0f} +{mg['vex_dist']}%) + not chasing"]
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
    from themes import TICKER_THEME, theme_strength
    _, bulls = theme_strength()
    for p in plays:                              # tag theme + is-it-in-a-bull-theme
        p['theme'] = TICKER_THEME.get(p['ticker'], 'other')
        p['theme_bull'] = p['theme'] in bulls
    plays.sort(key=lambda x: (x.get('theme_bull', False), x.get('score', 0)), reverse=True)
    regime = market_regime()
    print(f"as-of surface {ASOF} (=yesterday) · flow thru latest cache")
    print(f"QQQ last session {regime.get('qqq_1d')}% · {regime['note']}")
    print("LEADERS: " + " | ".join(f"{th} {r1:+.1f}% ({br:.0f}%up)" for th, r1, br in regime['leaders']))
    print(f"\n=== {len(plays)} INTERSECTION plays (validated rule) — top 12 ===")
    for p in plays[:12]:
        bull = '🐂' if p.get('theme_bull') else '  '
        print(f"  {bull} {p['ticker']:5} [{p.get('theme','?')[:14]:14}] score {p.get('score'):3} | ${p['strike']:.0f}C ({p['dte']}d) | "
              f"King ${p['king']:.0f} +{p['dist']}% ({p['node_share']}%) | 20d ${p['sum20']}M ask{p['askshare']}%")
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
    json.dump({'asof': ASOF, 'regime': market_regime(), 'plays': plays, 'watch': watch},
              open(os.path.join(HERE, 'play_candidates.json'), 'w'))
    print(f"\nwrote play_candidates.json ({len(plays)} intersection plays)")


if __name__ == '__main__':
    main()
