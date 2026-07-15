# Charts-First 0DTE — SPXW 2026-06-11 (blind out-of-sample)

Session `cf0611`. Paper / research only. Charts-first discretionary: price action forms the
thesis, GEX only confirms. P&L scored from real 1-min option prints (ATM strike = entry spot
rounded to 5; OCC intraday close at each decision minute in UTC; net = exit*0.985/(entry*1.015)-1).

## Day shape
Open 7266.99. Morning ran to a 7325 king-pika and rejected → all-day positive/neutral-gamma **box
7275–7325** with VWAP ~7295 as a magnet; the 7275 floor whipsawed repeatedly (bear-traps both ways).
At **13:25 the box broke UP hard** (+37-pt bar), then ripped 7278 → 7394 (**+1.8% on the day**) into a
strong positive-gamma pin at the highs (7335 support, growing to +46M) that held into the close.

## Trades

### T1 — SHORT (7270 put) · entry 11:00 ET @ 30.8 · exit 11:04 ET @ 26.2 · **net −17.45%** (loss)
- **Chart:** box floor 7275 broke — 2 bars below it, new low 7265.3, 10:55 closed on its low, 5-min
  momentum accelerating down. Round-tripped the AM gain.
- **GEX confirm:** net near-spot gamma collapsed +59M→+7M (pin spent); harness stepped floor down to
  7250. Target 7250.
- **What happened:** classic bear-trap. 11:00 bar wicked to 7258.67 then V-reversed to close at its
  high (7273.9), reclaiming 7275. Exited on my pre-set reclaim rule. The 7270 put fell 30.8→26.2.
- **Verdict:** thesis-break exit was correct; the entry fought a "levels-hold" regime — shorting a
  break in positive gamma. Should not have taken it.

### T2 — LONG (7280 call) · entry 11:10 ET @ 26.6 · exit 11:18 ET @ 26.6 · **net −2.96%** (loss, cost drag)
- **Chart:** floor-reclaim bounce — reclaimed 7275, 11:05 closed strong, momentum turning up.
- **GEX confirm:** 7275 pika re-established directly beneath (+8M, tight stop); no wall until king
  7325; positive-gamma regime backs mean-reversion up. Target VWAP 7295.
- **What happened:** underlying did run 7278.65 → 7288.38 and tagged VWAP (7296.2) on the 11:15 high,
  then rejected and closed below VWAP — I banked on my trail rule. But the 7280 call's 1-min close was
  flat 26.6→26.6 (delta gain offset by IV crush on the up-move / stale prints), so after the ~3%
  round-trip cost drag it scored a small loss.
- **Verdict:** best-read trade of the day (right direction, disciplined VWAP cap) yet still a net
  loser after costs — the core lesson of the day.

### T3 — LONG (7280 call) · entry 13:01 ET @ 18.6 · exit 13:05 ET @ 15.9 · **net −17.04%** (loss)
- **Chart:** floor test — price tapped 7275 (strongest floor of the day, +12.3M, growing) and held.
- **GEX confirm:** growing pika floor beneath, no wall to king 7325, positive-gamma levels-hold.
  Target VWAP.
- **What happened:** the strongest floor absorbed anyway — 13:00 bar broke to 7268.8, floor reassigned
  to 7250. Exited on the decisive-break rule (−0.11% underlying). Call 18.6→15.9.
- **Verdict:** entry was slightly early (pre-poke); honoring the stop was correct.

### T4 — LONG (7280 call) · entry 13:08 ET @ 16.7 · exit 13:16 ET @ 15.4 · **net −10.51%** (loss)
- **Chart:** confirmed bear-trap reclaim — 7268.8 poke reversed, 13:05 closed at its high, floor
  re-formed as day's strongest (+13.1M).
- **GEX confirm:** strongest floor of day beneath; same pattern as T2. Target VWAP, stop below 7268.
- **What happened:** ~13:16 the **confirming regime flipped POSITIVE→NEGATIVE gamma** (net −2M) and
  price broke back below 7275 (floor absorbed again). Exited on the regime-flip rule. Call 16.7→15.4.
- **Verdict:** disciplined exit; but this was the 3rd long at the same whipsaw level — I was forcing
  trades in untradeable neutral-gamma chop.

## Total
- Per-trade net: −17.45% · −2.96% · −17.04% · −10.51%
- **Sum (equal size): −47.96%** across 4 round-trips. All four net-negative after costs.

## Self-assessment
- **Did charts-first catch the day's move? NO.** The day's one clean, tradeable move was the **13:25
  box breakout → +1.8% afternoon rally**, and I was flat through all of it. All 4 of my trades were in
  the morning/midday 7275 chop, which bear-trapped in both directions.
- **Critical error:** at 13:27 I fast-forwarded **8 minutes** and skipped the 13:30 breakout bar. The
  13:25 bar had closed at 7278 (the 7309 high was an upper wick, so no breakout was confirmed *then* —
  the read was defensible), but stepping 8 min at a coiled level right under range resistance was too
  coarse. A 2–3 min step catches the 13:30 explosion and turns a missed +1.8% into the trade of the day.
- **Over-trading a whipsaw:** the 7275 level with net gamma flickering around zero (±5M) was a
  meat-grinder. After T1's bear-trap and T3's stop, the 4th attempt (T4) was forcing it. Correct play
  was to mark 7275 "untradeable today" and demand a *decisive* break with room, not fade every touch.
- **What went right:** every exit was rule-based and fast (reclaim / VWAP-cap / decisive-break /
  regime-flip) — no loss was allowed to run; and I correctly refused to *chase* the extended afternoon
  rally into the 7370–7385 pin (a 5th trade there would likely have been another loss).
- **Cost reality:** the ~3% round-trip drag (0.985/1.015) turned even the correctly-directioned,
  well-managed T2 into a net loser. On a chop day, near-zero-edge round-trips are guaranteed bleed —
  selectivity has to be far tighter than "a plausible edge."
- **Grade: poor day.** Right process on exits, wrong process on selection and one fatal fast-forward.
  The disciplined charts-first version of this day is ≤1 trade (the 13:25/13:30 breakout long) and
  otherwise flat — not four fades of a whipsaw floor.
