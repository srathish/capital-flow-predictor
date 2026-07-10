"""Theme-strength detector — 'there's always a bull somewhere.' Instead of
gating the whole system on QQQ (which misses sector rotations — 7/09 QQQ chop
while optical/semis ripped), rank themes by strength and play WITHIN the bull.
A play in a leading theme is worth far more than the same setup in a bleeding
one (7/09: AI Semis +6.8%/100%-up vs Mega Tech -1.5%/17%-up)."""
import gzip
import json
import os

import numpy as np

HERE = os.path.dirname(__file__)
GEX = os.path.abspath(os.path.join(HERE, '..', '..'))
DAILY = os.path.join(GEX, 'data/skylit-archive/daily')
FLOW = os.path.join(HERE, 'backtest/flow_cache')

THEMES = {
    'AI Semis': ['NVDA', 'AMD', 'AVGO', 'MRVL', 'MU', 'ARM', 'TSM', 'SMCI', 'AMAT', 'LRCX',
                 'ASML', 'QCOM', 'ON', 'ALAB', 'CRDO', 'TER', 'AMKR', 'STX', 'SNDK', 'WOLF', 'COHR'],
    'Optical/Networking': ['AAOI', 'GLW', 'ANET', 'CIEN', 'NOK', 'LITE'],
    'Crypto Miners': ['MARA', 'RIOT', 'CLSK', 'CIFR', 'IREN', 'WULF', 'HUT', 'CORZ', 'BMNR', 'BULL'],
    'AI Software': ['PLTR', 'SNOW', 'CRWD', 'DDOG', 'NET', 'MDB', 'PATH', 'AI', 'GTLB', 'CFLT', 'ASAN'],
    'AI Cloud/Infra': ['NBIS', 'CRWV', 'ORCL', 'DELL', 'HPE', 'CEG', 'GEV', 'OKLO', 'NNE', 'APLD'],
    'Mega Tech': ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'NFLX'],
    'Quantum': ['IONQ', 'RGTI', 'QBTS', 'LAES', 'POET'],
    'Nuclear/Power': ['CCJ', 'LEU', 'UEC', 'UUUU', 'NRG', 'CEG', 'OKLO', 'NNE'],
    'Fintech': ['SOFI', 'HOOD', 'AFRM', 'UPST', 'COIN', 'NU', 'XYZ', 'PYPL'],
    'Space': ['ASTS', 'RKLB', 'LUNR', 'ACHR', 'JOBY', 'SPCE'],
}
# ticker -> theme (first match)
TICKER_THEME = {}
for th, ts in THEMES.items():
    for t in ts:
        TICKER_THEME.setdefault(t, th)


def _days():
    return sorted(d for d in os.listdir(DAILY) if len(d) == 10 and d[4] == '-')


def _ret(t, n, spots):
    ds = sorted(spots.get(t, {}))
    if len(ds) < n + 1:
        return None
    return (spots[t][ds[-1]] - spots[t][ds[-1 - n]]) / spots[t][ds[-1 - n]] * 100


def _accum20(t):
    p = os.path.join(FLOW, f'{t}.json')
    if not os.path.exists(p):
        return 0.0
    j = json.load(open(p))
    if isinstance(j, dict):
        return 0.0
    rows = {r['date']: r for r in j if 'date' in r}
    ds = sorted(rows)[-20:]
    return sum(float(rows[d].get('net_call_premium') or 0) for d in ds) / 1e6


def theme_strength():
    """Return {theme: {r1, r5, breadth, accum, bull}} sorted strongest-first,
    plus a set of bull themes. Reads local archive + flow only."""
    days = _days()
    spots = {}
    for day in days:
        d = os.path.join(DAILY, day)
        for f in os.listdir(d):
            if f.endswith('.json.gz'):
                try:
                    spots.setdefault(f[:-8], {})[day] = json.load(gzip.open(os.path.join(d, f)))['spot']
                except Exception:
                    pass
    out = {}
    for th, ts in THEMES.items():
        ts = [t for t in ts if t in spots]
        r1 = [x for t in ts if (x := _ret(t, 1, spots)) is not None]
        r5 = [x for t in ts if (x := _ret(t, 5, spots)) is not None]
        if not r1:
            continue
        breadth = sum(1 for x in r1 if x > 0) / len(r1) * 100
        ac = sum(_accum20(t) for t in ts)
        bull = (np.mean(r1) > 0.5 and breadth >= 55) or (np.mean(r5) > 1 and breadth >= 55)
        out[th] = dict(r1=round(float(np.mean(r1)), 1), r5=round(float(np.mean(r5)), 1),
                       breadth=round(breadth), accum=round(ac), bull=bool(bull))
    ranked = dict(sorted(out.items(), key=lambda kv: kv[1]['r1'], reverse=True))
    bulls = {th for th, v in ranked.items() if v['bull']}
    return ranked, bulls
