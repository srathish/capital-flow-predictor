# Falcon-replica — state of the reverse-engineering + how we validate

## What we know (verified, not asserted)
1. **The setup switch is the node sign in the trade's path.** Pika (g0>0) = deflection (fade toward/off
   it; walls hold). Barney (g0<0) = trapdoor (ride through; accelerant). The whole-surface net gamma is
   +gamma on every 2026 low-VIX day, so it does NOT discriminate — the LOCAL node does. (`node_sign.mjs`)
   - JUL 20: 7490 pika tapped 9×, rejected 9/9, king 64% of the day = dealer-held deflection zone.
   - JUL 28: 7450 pika ceiling (grew 18→43M) sitting on a 7440 barney floor (grew −19→−30M); Falcon
     shorted the rejection into the barney. Deflection + trapdoor are the same trade at the extreme.
2. **The 0-100 score ranks.** With the discipline gate (tape-agree + one-thesis/day + top-2 by score →
   ~1.5 trades/day, Falcon-like), scalp-reachability rises with the score: 0% → 50% → 70%. (`score.mjs`)
3. **There is NO clean directional edge in the index.** At the top score band, avg favorable excursion
   (~6 pts) ≈ avg adverse excursion (~6 pts). SPX itself is ~symmetric.
4. **The edge is option convexity + management, confirmed on REAL UW data:**
   - 07-24 7410P ranged $0.10→$23.25 (close $0.55); 07-23 7380P $0.02→$18.40 (close **$0.03**);
     07-28 7430P $0.10→$49.00 (close $1.70).
   - Falcon's claimed peaks all fit inside the real ranges. His realized gains (+94%, +52%) came from
     MANAGING the pop — holding to expiry would have lost on 2 of 3.
   - So: cheap convex 0DTE entry + a real structural move + disciplined exit before theta. Not an index
     edge.

## The honest data limit
UW's `option-contract/{occ}/intraday` keeps the **current day only**; historical intraday option marks
are unavailable, and modeling 0DTE realized P/L (IV swings 0.2→8.8 intraday near expiry) is unreliable.
`get_historic_chains` gives real DAILY OHLC/IV/greeks — good for reachability + verifying claims, but not
entry-timed. **Realized capture can only be validated FORWARD, on real marks.**

## The validation (Glitch's method)
Run after each close to accumulate a real sample. ~2 weeks → n≈20-30 → a real expectancy number.
```
ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env \
  DATABASE_URL= bash research/doctrine/run_forward.sh <YYYY-MM-DD>
```
It pulls the day's surface+aux, scores the disciplined signals, prices them on the day's REAL 0DTE marks
with a fixed manage rule (+30% / −40% / EOD), and appends to `forward_log.txt`. Once n≈20-30:
- if realized expectancy is positive AND the score still ranks → the system is real; then (and only then)
  propose wiring into the live tracker (Clause 0: no live-code change without approval).
- if not → the honest conclusion is that structure + discipline reproduce Falcon's *reachability* but not
  his *capture*, and the missing piece is execution/management skill, not another GEX rule.

## Open discrepancy to watch
The discipline selector skews LATE-day (many 13:00-15:00 entries) and on 07-28 it picked LONG while Falcon
was SHORT. The one-thesis/tape gate may be too crude. Re-check direction logic before trusting live.
