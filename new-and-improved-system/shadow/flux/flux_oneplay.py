#!/usr/bin/env python3
"""DESIGN_flux.md amendment 2: one-play-a-day selections of the F4 pullback rule."""
import os, sys, math
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flux_test.py')).read()
exec(src[:src.index("def pullback(")])   # sessions(), walk(), clustered() etc.

def pullback_first(P, ms, mode, streak):
    cum = 0.0; lvl = {}
    for i, m in enumerate(ms):
        cum += P[m]['price']; lvl[m] = cum / (i + 1) if mode == 'plain' else P[m]['level']
    for i in range(streak, len(ms) - 1):
        m = ms[i]
        if m < 615 or m > 900: continue
        p = P[m]
        if p['inner']['upper'] == p['inner']['lower']: continue
        c, L = p['price'], lvl[m]
        prior = [P[ms[j]]['price'] - lvl[ms[j]] for j in range(i - streak, i)]
        side = 1 if all(x > 0 for x in prior) else -1 if all(x < 0 for x in prior) else 0
        if side and abs(c / L - 1) <= 0.0003:
            e = P[ms[i + 1]]['price']; hi = p['inner']['upper'] - p['level']; ho = p['outer']['upper'] - p['level']
            r = walk(P, ms, i + 1, side, e, L - side * hi, L + side * ho)
            if r is not None: return m, r
    return None

for HOLD in (False, True):
    S = {T: sessions(T) for T in ('SPY', 'QQQ')}
    res = {k: [] for k in ('S1', 'S1_plain', 'S2', 'S2_plain', 'S3')}
    days = sorted(set(d for T in S for d in S[T] if (d >= '2026-07-01') == HOLD))
    for d in days:
        first = {}; first_p = {}
        for T in ('SPY', 'QQQ'):
            P = S[T].get(d)
            if not P or len(P) < 300: continue
            ms = sorted(P)
            a = pullback_first(P, ms, 'flux', 30); b = pullback_first(P, ms, 'plain', 30); c = pullback_first(P, ms, 'flux', 90)
            if a: res['S1'].append((d, a[1])); first[T] = a
            if b: res['S1_plain'].append((d, b[1])); first_p[T] = b
            if c: res['S3'].append((d, c[1]))
        for src_, key in ((first, 'S2'), (first_p, 'S2_plain')):
            if src_:
                T = min(src_, key=lambda t: (src_[t][0], t != 'SPY')); res[key].append((d, src_[T][1]))
    print(f"\n{'HOLDOUT Jul–Nov 2026' if HOLD else 'BUILD Nov 2025 – Jun 2026'}")
    for k, v in res.items():
        n, mu, t = clustered(v); med = sorted(x[1] for x in v)[len(v) // 2] if v else float('nan')
        print(f"  {k:9s} trades {len(v):4d} | mean {mu:+.3f}R | t {t:5.2f} | median {med:+.2f}R | win {sum(1 for _, r in v if r > 0) / max(1, len(v)) * 100:4.1f}%")
