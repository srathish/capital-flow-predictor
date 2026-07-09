"""Build swing-agent card data from the campaign scan JSON.

Turns the raw campaign candidates into presentation-ready cards: a normalized
0-100 conviction score (composite of the doctrine components), an underlying
R:R, signal tags, and a plain-language thesis. Research/presentation only —
reads the scan output, writes a UI JSON. No live code, no orders.
"""
import json
import os
import glob

HERE = os.path.dirname(__file__)

# Light theme map for known tickers (Midas-style category chip). Omitted if absent.
THEME = {
    'NBIS': 'AI Neocloud', 'MRVL': 'AI Silicon', 'DELL': 'AI Infrastructure',
    'DIA': 'Dow Index', 'V': 'Payments', 'ETHA': 'ETH Spot ETF', 'GEV': 'Grid / Power',
    'TSM': 'Foundry Leader', 'JPM': 'Money-Center Bank', 'BX': 'Alt Assets',
    'HIMS': 'Telehealth', 'SMH': 'Semis ETF', 'XLF': 'Financials ETF',
    'DASH': 'Delivery', 'AAPL': 'Mega-Cap Tech',
}


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def score_components(c):
    """Each 0-1; weights chosen so a fully-confirmed A-setup lands high-80s."""
    accumulation = clamp((c.get('sum20') or 0) / 150e6)        # net 20d call premium
    persistence = clamp((c.get('posDays') or 0) / 20)           # positive days /20
    node = clamp((c.get('magnetRelSig') or 0) / 0.20)          # node share of surface
    king = 1.0 if c.get('kingIsMagnet') else 0.0
    oi = c.get('oiGrowthPct')
    oi_open = clamp((oi or 0) / 40) if oi is not None else 0.5  # neutral if unknown
    ask = c.get('askShare')
    ask_side = clamp(((ask or 0.4) - 0.40) / 0.25) if ask is not None else 0.5
    spread = c.get('spreadPct')
    tradeable = clamp(1 - (spread or 12) / 15) if spread is not None else 0.4
    confirmed = 1.0 if c.get('confirmed') else 0.0
    parts = {
        'accumulation': (accumulation, 22),
        'node_strength': (node, 16),
        'king': (king, 8),
        'persistence': (persistence, 14),
        'oi_opening': (oi_open, 12),
        'ask_side': (ask_side, 12),
        'tradeable': (tradeable, 10),
        'confirmed': (confirmed, 6),
    }
    total_w = sum(w for _, w in parts.values())
    raw = sum(v * w for v, w in parts.values())
    return round(raw / total_w * 100), {k: round(v * 100) for k, (v, _) in parts.items()}


def tags(c):
    t = []
    if c.get('kingIsMagnet'):
        t.append('KING MAGNET')
    else:
        t.append(f"GK{c.get('gatekeepers', 0)} NODE")
    if (c.get('oiGrowthPct') or 0) >= 20:
        t.append('OI OPENING')
    if (c.get('askShare') or 0) >= 0.52:
        t.append('ASK-SIDE')
    if c.get('confirmed'):
        t.append('CONFIRMED')
    return t


def rr(c):
    """Underlying swing R:R. Target = magnet; stop = conservative swing
    invalidation (half the distance-to-target, floored at 5%, capped 8%)."""
    reward = (c.get('distPct') or 0) * 100
    stop = clamp(reward * 0.5, 5, 8)
    return round(reward / stop, 1), round(reward, 1), round(stop, 1)


def status(c):
    if c.get('confirmed'):
        return 'CONFIRMED'
    if c.get('qualityFails'):
        return 'BLOCKED'
    return 'WATCH'


def build(scan_path):
    cands = json.load(open(scan_path))
    cards = []
    for c in cands:
        sc, comps = score_components(c)
        ratio, rew, stp = rr(c)
        cards.append({
            'ticker': c['ticker'], 'theme': THEME.get(c['ticker'], ''),
            'score': sc, 'components': comps, 'dir': 'LONG',
            'status': status(c), 'tags': tags(c),
            'spot': round(c['spot'], 2), 'magnet': c['magnetStrike'],
            'expiry': c['expiry'], 'dte': c['dte'], 'distPct': round((c.get('distPct') or 0) * 100, 1),
            'occ': c.get('occ'), 'entry': round(c.get('mid') or 0, 2),
            'nodeShare': round((c.get('magnetRelSig') or 0) * 100, 1),
            'accum20d': round((c.get('sum20') or 0) / 1e6), 'persist': c.get('posDays'),
            'oiGrow': None if c.get('oiGrowthPct') is None else round(c['oiGrowthPct']),
            'askShare': None if c.get('askShare') is None else round(c['askShare'] * 100),
            'spread': None if c.get('spreadPct') is None else round(c['spreadPct'], 1),
            'earnings': c.get('nextEarnings'), 'earningsInWindow': c.get('earningsInWindow'),
            'rr': ratio, 'reward': rew, 'stop': stp,
        })
    cards.sort(key=lambda x: x['score'], reverse=True)
    return cards


if __name__ == '__main__':
    latest = sorted(glob.glob(os.path.join(HERE, 'out/campaign_report_*.json')))[-1]
    day = latest.split('_')[-1].replace('.json', '')
    cards = build(latest)
    out = {'agent': 'ATLAS', 'tagline': 'multi-week swing agent · Skylit nodes × 20-day accumulation',
           'asof': day, 'cards': cards}
    dest = os.path.join(HERE, 'ui', f'cards_{day}.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    json.dump(out, open(dest, 'w'), indent=1)
    print(f'wrote {dest}: {len(cards)} cards')
    for c in cards[:6]:
        print(f"  {c['ticker']:5} score {c['score']:3}  {c['status']:9} R:R {c['rr']}  {' · '.join(c['tags'])}")
