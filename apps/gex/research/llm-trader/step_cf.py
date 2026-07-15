#!/usr/bin/env python3
"""
CHARTS-FIRST causal harness (RESEARCH ONLY, Clause 0). The "Glitch model":
price action creates the thesis; GEX only confirms. Decide-then-reveal, 1-min,
isolated by SESSION env. Same firewall as step_iso.py (no lookahead).

  SESSION=cf python3 step_cf.py init 2026-07-14 SPXW
  SESSION=cf python3 step_cf.py act '{"action":"hold","mins":N}'
  SESSION=cf python3 step_cf.py act '{"action":"enter_long","why":"..."}'   # ATM call
  SESSION=cf python3 step_cf.py act '{"action":"enter_short","why":"..."}'  # ATM put
  SESSION=cf python3 step_cf.py act '{"action":"exit","why":"..."}'

Each step prints, in order: (1) PRICE ACTION — day frame, VWAP-proxy, position
in range, last 5-min candles (O/H/L/C derived from 1-min spots), swing structure
(pivots labelled HH/HL/LH/LL + trend), momentum. (2) GEX CONFIRM — regime, king,
nearest floor/ceiling, and whether structure supports each direction. Auto-flat 15:45.
"""
import gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BF = os.path.join(HERE, '..', 'velocity-capture', 'backfill')
SESSION = os.environ.get('SESSION', 'cf')
STATE = os.path.join(HERE, f'state_{SESSION}.json')
START, END = 30, 375

def load(day, tk):
    rows = []
    with gzip.open(os.path.join(BF, day, f'{tk}.jsonl.gz'), 'rt') as f:
        for l in f:
            r = json.loads(l)
            m = (int(r['requestedTs'][11:13]) * 60 + int(r['requestedTs'][14:16])) - 810
            if 0 <= m <= 390:
                rows.append({'m': m, 'spot': r['spot'],
                             'st': {x['strike']: (x.get('gamma') or 0, x.get('vanna') or 0)
                                    for x in r.get('strikes', [])}})
    return sorted(rows, key=lambda r: r['m'])

def et(m): return f"{(m + 570) // 60:02d}:{(m + 570) % 60:02d}"

def bars5(closes, base_m):
    """Derive 5-min O/H/L/C candles from the 1-min close series."""
    out = []
    for i in range(0, len(closes), 5):
        seg = closes[i:i + 5]
        if not seg: continue
        out.append((base_m + i, seg[0], max(seg), min(seg), seg[-1]))
    return out

def pivots(closes, thr):
    """ZigZag pivots on closes; returns labelled swing sequence + trend."""
    if len(closes) < 3: return [], 'forming'
    piv = []; dir = 0; rh = rl = closes[0]
    for c in closes:
        if dir >= 0:
            if c > rh: rh = c
            if (rh - c) / rh >= thr: piv.append(('H', rh)); dir = -1; rl = c
        if dir <= 0:
            if c < rl: rl = c
            if (c - rl) / rl >= thr: piv.append(('L', rl)); dir = 1; rh = c
    # label HH/HL/LH/LL
    labs = []
    for i, (k, v) in enumerate(piv):
        prev = [p for p in piv[:i] if p[0] == k]
        if not prev: labs.append(k + '?')
        else: labs.append(('H' if k == 'H' else 'L') + ('H' if v > prev[-1][1] else 'L'))
    hi = [v for k, v in piv if k == 'H']; lo = [v for k, v in piv if k == 'L']
    trend = 'range'
    if len(hi) >= 2 and len(lo) >= 2:
        if hi[-1] > hi[-2] and lo[-1] > lo[-2]: trend = 'UPTREND (HH+HL)'
        elif hi[-1] < hi[-2] and lo[-1] < lo[-2]: trend = 'DOWNTREND (LH+LL)'
    return labs[-6:], trend

def gex_confirm(rows, i):
    cur = rows[i]; spot = cur['spot']; st = cur['st']
    tot = sum(abs(g) for g, _ in st.values()) or 1
    near = {k: g for k, (g, v) in st.items() if abs(k - spot) / spot <= 0.01 and abs(g) >= tot * 0.02}
    king = max(st, key=lambda k: abs(st[k][0]))
    net = sum(g for k, (g, v) in st.items() if abs(k - spot) / spot <= 0.005)
    floors = sorted([k for k, g in near.items() if g > 0 and k < spot], key=lambda k: -near[k])
    ceils = sorted([k for k, g in near.items() if k > spot], key=lambda k: -abs(near[k]))
    p1 = rows[i - 1]['st'] if i >= 1 else {}
    def d1(k): return (st[k][0] - p1.get(k, (0, 0))[0]) / 1e6 if p1 else 0
    lines = [f"  regime: {'POSITIVE-gamma (pins/chop, levels hold)' if net>0 else 'NEGATIVE-gamma (trending/violent, levels break)'}  (net near-spot {net/1e6:+.0f}M)",
             f"  king: {king} ({'pika' if st[king][0]>0 else 'barney'}) {st[king][0]/1e6:+.0f}M",
             f"  nearest pika FLOOR below: {floors[0] if floors else 'NONE'}" + (f" ({near[floors[0]]/1e6:+.1f}M, 1mΔ{d1(floors[0]):+.1f})" if floors else ' — no support under price'),
             f"  nearest node ABOVE (resistance): {ceils[0] if ceils else 'NONE'}" + (f" ({near[ceils[0]]/1e6:+.1f}M {'pika' if near[ceils[0]]>0 else 'barney'})" if ceils else '')]
    return "\n".join(lines)

def view(rows, upto):
    idx = max(i for i, r in enumerate(rows) if r['m'] <= upto)
    past = rows[:idx + 1]; closes = [r['spot'] for r in past]; cur = rows[idx]
    vwap = sum(closes) / len(closes)
    lo, hi = min(closes), max(closes)
    posr = (cur['spot'] - lo) / (hi - lo) * 100 if hi > lo else 50
    bars = bars5(closes, past[0]['m'])[-8:]
    labs, trend = pivots(closes, 0.0020)
    mom5 = (closes[-1] / closes[-6] - 1) * 100 if len(closes) > 6 else 0
    mom15 = (closes[-1] / closes[-16] - 1) * 100 if len(closes) > 16 else 0
    out = [f"== {et(cur['m'])} ET =========================================",
           "PRICE ACTION (your thesis comes from HERE):",
           f"  spot {cur['spot']:.2f} · open {closes[0]:.2f} ({(cur['spot']/closes[0]-1)*100:+.2f}%) · day range {lo:.2f}-{hi:.2f} · pos {posr:.0f}% of range",
           f"  VWAP-proxy {vwap:.2f} → price is {'ABOVE (bullish bias)' if cur['spot']>vwap else 'BELOW (bearish bias)'}",
           f"  trend: {trend} · recent swings: {' '.join(labs) if labs else 'none yet'}",
           f"  momentum: 5-min {mom5:+.2f}% · 15-min {mom15:+.2f}%",
           "  last 5-min candles  O / H / L / C:"]
    for bm, o, h, l, c in bars:
        arrow = '▲' if c >= o else '▼'
        out.append(f"    {et(bm)} {arrow} {o:.1f} / {h:.1f} / {l:.1f} / {c:.1f}")
    out.append("GEX CONFIRM (does structure back your price thesis? do NOT trade on this alone):")
    out.append(gex_confirm(rows, idx))
    return "\n".join(out), cur

def main():
    cmd = sys.argv[1]
    if cmd == 'init':
        day, tk = sys.argv[2], sys.argv[3]
        st = {'day': day, 'tk': tk, 'cursor': START, 'pos': None,
              'log': os.path.join(HERE, f'decisions_{SESSION}_{day}_{tk}.jsonl')}
        open(st['log'], 'w').close(); json.dump(st, open(STATE, 'w'))
        rows = load(day, tk); v, _ = view(rows, START)
        print(f"=== CHARTS-FIRST TRADER · {tk} {day} ===\n{v}\nPOSITION: flat")
        return
    st = json.load(open(STATE)); rows = load(st['day'], st['tk'])
    if cmd == 'act':
        d = json.loads(sys.argv[2]); _, cur = view(rows, st['cursor'])
        rec = {'m': st['cursor'], 'et': et(st['cursor']), 'spot': cur['spot'],
               'action': d.get('action'), 'why': d.get('why', '')}
        a = d.get('action')
        if a in ('enter_long', 'enter_short'):
            if st['pos']: rec['note'] = 'REJECTED: already in position'
            else: st['pos'] = {'side': 'long' if a == 'enter_long' else 'short', 'm': st['cursor'], 'spot': cur['spot']}
        elif a == 'exit':
            if st['pos']: rec['closed'] = st['pos']; st['pos'] = None
            else: rec['note'] = 'REJECTED: flat'
        with open(st['log'], 'a') as f: f.write(json.dumps(rec) + '\n')
        st['cursor'] = min(st['cursor'] + max(1, int(d.get('mins', 1))), END)
        json.dump(st, open(STATE, 'w'))
        if st['cursor'] >= END:
            if st['pos']:
                with open(st['log'], 'a') as f:
                    f.write(json.dumps({'m': END, 'et': et(END), 'action': 'exit', 'why': 'auto-flat 15:45',
                                        'spot': rows[-1]['spot'], 'closed': st['pos']}) + '\n')
            print("DONE — auto-flat 15:45. Log:", st['log']); return
        v, now = view(rows, st['cursor']); pos = st['pos']
        pl = (f"POSITION: {pos['side'].upper()} since {et(pos['m'])} @ {pos['spot']:.2f} "
              f"(underlying {(now['spot']/pos['spot']-1)*100*(1 if pos['side']=='long' else -1):+.2f}%)" if pos else "POSITION: flat")
        print(v + "\n" + pl)

if __name__ == '__main__':
    main()
