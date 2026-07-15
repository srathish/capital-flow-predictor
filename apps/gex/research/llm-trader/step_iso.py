#!/usr/bin/env python3
"""
CAUSAL STEP-HARNESS for the LLM-trader experiment (RESEARCH ONLY, Clause 0).

Decide-then-reveal at 1-MINUTE granularity with the FULL STRIKE SURFACE:
the trader (a Claude agent) commits a decision for minute t before the harness
reveals t+1. Data flows only through this script and decisions are logged
before each reveal — lookahead impossible by construction; the tool-call
transcript is the audit trail.

  python3 step.py init 2026-07-14 SPXW      # reset; shows 10:00 ET full state
  python3 step.py act '{"action":"hold"}'                    # advance 1 min
  python3 step.py act '{"action":"hold","mins":10}'          # fast-forward quiet tape
  python3 step.py act '{"action":"enter_long","why":"..."}'  # ATM call at this minute
  python3 step.py act '{"action":"enter_short","why":"..."}' # ATM put
  python3 step.py act '{"action":"exit","why":"..."}'
Full surface (every strike, gamma+vanna, 1/15-min deltas) prints EVERY step.
Auto-flat 15:45. Decisions -> decisions_<day>_<ticker>.jsonl
"""
import gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BF = os.path.join(HERE, '..', 'velocity-capture', 'backfill')
SESSION = os.environ.get('SESSION','default')
STATE = os.path.join(HERE, f'state_{SESSION}.json')
START, END = 30, 375   # 10:00 ET .. 15:45 ET

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

def surface(rows, i):
    cur = rows[i]; spot = cur['spot']
    p1 = rows[i - 1]['st'] if i >= 1 else {}
    p15 = rows[i - 15]['st'] if i >= 15 else {}
    tot = sum(abs(g) for g, _ in cur['st'].values()) or 1
    lines = []
    for k in sorted(cur['st'], reverse=True):
        if abs(k - spot) / spot > 0.012: continue
        g, v = cur['st'][k]
        if abs(g) < tot * 0.005: continue
        d1 = (g - p1.get(k, (0, 0))[0]) / 1e6 if p1 else 0
        d15 = (g - p15.get(k, (0, 0))[0]) / 1e6 if p15 else 0
        tag = 'PIKA' if g > 0 else 'BARN'
        atspot = ' <<< spot' if abs(k - spot) / spot < 0.0008 else ''
        lines.append(f"  {k:>8} {tag} {g/1e6:>+7.1f}M ({abs(g)/tot:>4.0%})  1m{d1:+5.1f}  15m{d15:+6.1f}  van{v/1e6:+6.1f}M{atspot}")
    return "\n".join(lines)

def view(rows, upto):
    idx = max(i for i, r in enumerate(rows) if r['m'] <= upto)
    cur = rows[idx]; past = rows[:idx + 1]
    spots = [r['spot'] for r in past]
    out = [f"== {et(cur['m'])} ET · spot {cur['spot']:.2f} · open {spots[0]:.2f} ({(cur['spot']/spots[0]-1)*100:+.2f}%) · "
           f"range {min(spots):.2f}-{max(spots):.2f}",
           "last 20 closes: " + " ".join(f"{r['spot']:.1f}" for r in past[-20:]),
           "FULL SURFACE (strike, sign, gamma, share, 1-min Δ, 15-min Δ, vanna):",
           surface(rows, idx)]
    return "\n".join(out), cur

def main():
    cmd = sys.argv[1]
    if cmd == 'init':
        day, tk = sys.argv[2], sys.argv[3]
        st = {'day': day, 'tk': tk, 'cursor': START, 'pos': None,
              'log': os.path.join(HERE, f'decisions_{SESSION}_{day}_{tk}.jsonl')}
        open(st['log'], 'w').close()
        json.dump(st, open(STATE, 'w'))
        rows = load(day, tk)
        v, _ = view(rows, START)
        print(f"=== LLM-TRADER · {tk} {day} · 1-min decide-then-reveal ===\n{v}\nPOSITION: flat")
        return
    st = json.load(open(STATE)); rows = load(st['day'], st['tk'])
    if cmd == 'act':
        d = json.loads(sys.argv[2])
        _, cur = view(rows, st['cursor'])
        rec = {'m': st['cursor'], 'et': et(st['cursor']), 'spot': cur['spot'],
               'action': d.get('action'), 'why': d.get('why', '')}
        a = d.get('action')
        if a in ('enter_long', 'enter_short'):
            if st['pos']: rec['note'] = 'REJECTED: already in position'
            else: st['pos'] = {'side': 'long' if a == 'enter_long' else 'short',
                               'm': st['cursor'], 'spot': cur['spot']}
        elif a == 'exit':
            if st['pos']: rec['closed'] = st['pos']; st['pos'] = None
            else: rec['note'] = 'REJECTED: flat'
        with open(st['log'], 'a') as f: f.write(json.dumps(rec) + '\n')
        st['cursor'] = min(st['cursor'] + max(1, int(d.get('mins', 1))), END)
        json.dump(st, open(STATE, 'w'))
        if st['cursor'] >= END:
            if st['pos']:
                with open(st['log'], 'a') as f:
                    f.write(json.dumps({'m': END, 'et': et(END), 'action': 'exit',
                                        'why': 'auto-flat 15:45', 'spot': rows[-1]['spot'],
                                        'closed': st['pos']}) + '\n')
            print("DONE — auto-flat 15:45. Log:", st['log']); return
        v, now = view(rows, st['cursor'])
        pos = st['pos']
        pl = (f"POSITION: {pos['side'].upper()} since {et(pos['m'])} @ {pos['spot']:.2f} "
              f"(underlying {(now['spot']/pos['spot']-1)*100*(1 if pos['side']=='long' else -1):+.2f}%)"
              if pos else "POSITION: flat")
        print(v + "\n" + pl)
        json.dump(st, open(STATE, 'w'))

if __name__ == '__main__':
    main()
