"""Merge gen_plays candidates + live prices into final July-10 plays with the
validated rules baked in: intersection-only, +100% take-profit, spread gating
(the backtest's cost lesson — wide spreads eat the edge). Emits plays_jul10.json
for the Atlas UI and prints the trade sheet."""
import json
import os

HERE = os.path.dirname(__file__)
cand = json.load(open(os.path.join(HERE, 'play_candidates.json')))
prices = json.load(open(os.path.join(HERE, 'play_prices.json')))

THEME = {'MU': 'Memory / HBM', 'MRVL': 'AI Silicon', 'AAPL': 'Mega-Cap Tech',
         'META': 'Mega-Cap AI', 'EWY': 'Korea ETF', 'DIA': 'Dow ETF',
         'CRDO': 'AI Connectivity', 'NBIS': 'AI Neocloud'}


def finalize(p):
    pr = prices.get(p['occ'])
    if not pr or pr['bid'] <= 0 or pr['ask'] <= 0:
        return None
    entry = round((pr['bid'] + pr['ask']) / 2, 2)          # realistic mid fill
    spread = round((pr['ask'] - pr['bid']) / entry * 100, 1)
    # data sanity: IV floor (illiquid/stale quotes like DIA IV 12% on a 5% OTM call)
    suspect = pr['iv'] < 0.15 or spread > 30
    return dict(
        ticker=p['ticker'], theme=THEME.get(p['ticker'], ''), score=p.get('score'),
        occ=p['occ'], strike=p['strike'], exp=p['exp'], dte=p['dte'],
        spot=p['spot'], king=p['king'], node_share=p['node_share'], dist=p['dist'],
        node_persist=p.get('node_persist'), node_growth=p.get('node_growth'), node_days=p.get('node_days'),
        sum20=p['sum20'], sum7=p['sum7'], posdays=p['posdays'], askshare=p['askshare'],
        entry=entry, iv=round(pr['iv'] * 100), spread=spread,
        take_profit=round(entry * 2, 2),                    # +100% rule
        tradeable=bool(spread <= 12 and not suspect),
        suspect=suspect)


plays = [f for f in (finalize(p) for p in cand['plays']) if f]
plays.sort(key=lambda x: (x['tradeable'], x['score']), reverse=True)

print("JULY 10 SWING PLAYS — validated intersection rule + +100% take-profit\n")
print(f"{'tkr':5} {'sc':>3} {'contract':22} {'entry':>7} {'spread':>6} {'target(mag)':>12} {'TP+100%':>8}  flow/node")
for p in plays:
    tag = '' if p['tradeable'] else ('  ⚠SUSPECT' if p['suspect'] else '  ⚠WIDE-SPREAD')
    print(f"{p['ticker']:5} {p['score']:>3} {p['ticker']+' $'+str(int(p['strike']))+'C '+p['exp'][5:]:22} "
          f"${p['entry']:>6} {p['spread']:>5}% ${p['king']:.0f}(+{p['dist']}%){'':2} ${p['take_profit']:>6}  "
          f"${p['sum20']}M/{p['posdays']}d · {p['node_share']}%{tag}")

print("\nTRADEABLE (spread ≤12%, clean data):")
for p in [x for x in plays if x['tradeable']]:
    print(f"  • {p['ticker']} ${int(p['strike'])}C {p['exp']} @ ~${p['entry']} → TP ${p['take_profit']} (+100%), "
          f"target ${p['king']:.0f} (+{p['dist']}%), 20d +${p['sum20']}M {p['posdays']}/20d, node {p['node_share']}%")

# watchlist verdict
print("\nWATCHLIST (your picks):")
for t, w in cand['watch'].items():
    if w.get('intersection'):
        print(f"  {t}: PASSES")
    else:
        print(f"  {t}: ❌ SKIP — {'; '.join(w['reasons'])}")

payload = {'asof': cand['asof'], 'regime': cand.get('regime', {}), 'plays': plays, 'watch': cand['watch']}
json.dump(payload, open(os.path.join(HERE, 'ui', 'plays_jul10.json'), 'w'), indent=1)
os.makedirs(os.path.join(HERE, 'server'), exist_ok=True)
json.dump(payload, open(os.path.join(HERE, 'server', 'plays_latest.json'), 'w'), indent=1)
print(f"\nwrote ui/plays_jul10.json + server/plays_latest.json")
