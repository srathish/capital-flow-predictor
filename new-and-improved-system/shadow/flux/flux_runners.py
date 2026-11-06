#!/usr/bin/env python3
"""DESIGN_flux_runners.md — Flux trend entries (E3 cross, E4 pullback) with original / trailing / trailing+time-stop exits,
split by prior-day local gamma balance (low third = big-range days). Coin-direction control. python3 flux_runners.py [--holdout]"""
import json, os, sys, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(HERE, '..', '..', '.cache')
src = open(os.path.join(HERE, 'flux_test.py')).read(); exec(src[:src.index("def band(")])  # sessions(), et()
HOLD = '--holdout' in sys.argv

def balance(T):
    B = {}
    for l in open(os.path.join(HERE, '..', '..', '.cache', 'uwgreeks', f'{T}.jsonl')):
        if not l.strip(): continue
        j = json.loads(l); B[j['d']] = j['s']
    return B

def local_B(s, S0):
    A = N = 0.0
    for r in s:
        if abs(r[0] / S0 - 1) <= 0.02: g = r[1] + r[2]; A += abs(g); N += g
    return N / A if A > 0 else None

def exit_path(P, ms, i0, side, entry, stop0, mode, target=None):
    R = abs(entry - stop0)
    if R <= 0: return None
    best = entry; stop = stop0
    for k in range(i0, len(ms)):
        m = ms[k]; c = P[m]['price']
        if m >= 955: return side * (c - entry) / R
        if (c <= stop) if side > 0 else (c >= stop): return side * (c - entry) / R
        if mode == 'X0' and target is not None and ((c >= target) if side > 0 else (c <= target)): return side * (c - entry) / R
        if mode in ('X1', 'X2'):
            best = max(best, c) if side > 0 else min(best, c)
            trail = best - side * R
            stop = max(stop, trail) if side > 0 else min(stop, trail)
            if mode == 'X2' and m - ms[i0] >= 30 and side * (best - entry) / R < 0.5: return side * (c - entry) / R
    return side * (P[ms[-1]]['price'] - entry) / R

def entries(P, ms):
    """first E3 and first E4 signal: (type, index of signal, trend side)"""
    out = {}
    for i in range(16, len(ms) - 1):
        m = ms[i]; p = P[m]
        if p['inner']['upper'] == p['inner']['lower'] or m > 900: continue
        c, L = p['price'], p['level']
        if 'E3' not in out and m >= 630:
            prior = [P[ms[j]]['price'] - P[ms[j]]['level'] for j in range(i - 15, i)]
            if c > L and all(x < 0 for x in prior): out['E3'] = (i, 1)
            elif c < L and all(x > 0 for x in prior): out['E3'] = (i, -1)
        if 'E4' not in out and m >= 615 and i >= 30:
            prior = [P[ms[j]]['price'] - P[ms[j]]['level'] for j in range(i - 30, i)]
            sd = 1 if all(x > 0 for x in prior) else -1 if all(x < 0 for x in prior) else 0
            if sd and abs(c / L - 1) <= 0.0003: out['E4'] = (i, sd)
    return out

rows = []; rnd = random.Random(20261105)
for T in ('SPY', 'QQQ'):
    S = sessions(T); Bk = balance(T); days = sorted(S)
    for n, d in enumerate(days):
        P = S[d]
        if len(P) < 300 or n == 0: continue
        prevd = days[n - 1]; prevP = S[prevd]; S0 = prevP[max(prevP)]['price']
        b = local_B(Bk[prevd], S0) if prevd in Bk else None
        ms = sorted(P)
        for typ, (i, side) in entries(P, ms).items():
            p = P[ms[i]]; e = P[ms[i + 1]]['price']; L = p['level']; hi = p['inner']['upper'] - L; ho = p['outer']['upper'] - L
            stop0 = L - side * hi; tgt = L + side * ho
            for mode in ('X0', 'X1', 'X2'):
                r = exit_path(P, ms, i + 1, side, e, stop0, mode, tgt)
                coin = []
                for _ in range(20):
                    s2 = rnd.choice((1, -1)); st2 = e - s2 * abs(e - stop0)
                    rc = exit_path(P, ms, i + 1, s2, e, st2, mode, e + s2 * abs(tgt - e))
                    if rc is not None: coin.append(rc)
                if r is not None: rows.append({'T': T, 'd': d, 'typ': typ, 'mode': mode, 'B': b, 'r': r, 'coin': sum(coin) / len(coin) if coin else None})
build = [x for x in rows if x['d'] < '2026-07-01']
th = {}
for T in ('SPY', 'QQQ'):
    bs = sorted(set((x['d'], x['B']) for x in build if x['T'] == T and x['B'] is not None), key=lambda z: z[1])
    th[T] = (bs[len(bs) // 3][1], bs[2 * len(bs) // 3][1])
sel = [x for x in rows if (x['d'] >= '2026-07-01') == HOLD]
def stats(v):
    if not v: return 'n 0'
    by = {}
    for x in v: by.setdefault(x['d'], []).append(x['r'])
    dm = [sum(a) / len(a) for a in by.values()]; k = len(dm); mu = sum(dm) / k
    sd = math.sqrt(sum((y - mu) ** 2 for y in dm) / (k - 1)) if k > 1 else 0; t = mu / sd * math.sqrt(k) if sd else float('nan')
    W = [x['r'] for x in v if x['r'] > 0]; Lo = [-x['r'] for x in v if x['r'] <= 0]
    aw = sum(W) / len(W) if W else 0; al = sum(Lo) / len(Lo) if Lo else 0; pf = sum(W) / sum(Lo) if Lo and sum(Lo) else float('inf')
    cn = [x['coin'] for x in v if x['coin'] is not None]
    return f"n {len(v):3d} | mean {mu:+.3f}R t {t:5.2f} | win {len(W) / len(v) * 100:3.0f}% | avg win {aw:.2f}R / avg loss {al:.2f}R | PF {pf:.2f} | coin-direction mean {sum(cn) / len(cn) if cn else float('nan'):+.3f}R"
print(f"{'HOLDOUT Jul 1 – Nov 5 2026' if HOLD else 'BUILD Nov 7 2025 – Jun 30 2026'} | low-B threshold SPY {th['SPY'][0]:.3f} QQQ {th['QQQ'][0]:.3f}")
for typ in ('E3', 'E4'):
    for mode in ('X0', 'X1', 'X2'):
        for lab, f in (('all days', lambda x: True), ('LOW-B (big range)', lambda x: x['B'] is not None and x['B'] < th[x['T']][0]), ('high-B', lambda x: x['B'] is not None and x['B'] >= th[x['T']][1])):
            v = [x for x in sel if x['typ'] == typ and x['mode'] == mode and f(x)]
            star = '  <== primary' if mode == 'X1' and lab.startswith('LOW') else ''
            print(f"  {typ} {mode} {lab:18s} {stats(v)}{star}")
json.dump(rows, open(os.path.join(HERE, 'runners_rows.json'), 'w'))
