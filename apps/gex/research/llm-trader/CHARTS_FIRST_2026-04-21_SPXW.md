# Charts-First 0DTE — SPXW 2026-04-21 (blind out-of-sample, SESSION cf0421)

Paper only (RESEARCH). Price action forms the thesis; GEX only confirms. Scored on real 1-min
option prints (SPXW 260421), net = exit*0.985 / (entry*1.015) - 1.

## Day shape (as read live, no lookahead)
Open 7109, a fast opening rally to 7135.9 by ~09:50 that stalled at the highs in a positive-gamma
pin. Around 10:20-11:05 the pin broke and price flushed 7135 -> 7086.7 (a ~49pt down move), then
snapped back with an exhaustion-V to ~7104. From ~11:15 onward the tape locked into an unusually
deep, ever-strengthening positive-gamma pin (net near-spot climbed +60M -> +100M -> +240M -> +535M),
grinding slowly lower to a 7063.8 low around 13:20, reclaiming, and drifting back to ~7100 into the
close. Net: a slow grind-down day (close ~7095) whose only tradeable energy was the midday
flush + V-bounce; the rest was untradeable pin.

## Trades (3)

### Trade 1 — SHORT (PUT 7125) · 10:25 -> 10:30 ET · LOSS -9.67%
- CHART: Rollover from HOD 7135.9 — lower closes 10:10 7134.3 > 10:15 7133.8 > 10:20 7126.4, price
  broke below VWAP-proxy 7126.9 with 15-min momentum accelerating down (-0.12%).
- GEX CONFIRM: positive-gamma pin had just COLLAPSED, regime flipped to NEGATIVE gamma -17M (fuel);
  near 7100 floor dissolved (to 7070), ~57pts of air below; king pika 7165 far overhead.
- OUTCOME: The VWAP-loss flush did NOT follow through — VWAP 7127 held, price chopped back up, and
  the regime flipped RIGHT BACK to positive gamma (+9M). Cut at ~breakeven-underlying per the manage
  rule (exit when the confirming regime flips). Option: 10.70 -> 9.96 = **-9.67%** (small adverse
  move + round-trip cost drag). Correct discipline; the setup was a false trigger in a flip-flopping
  regime.

### Trade 2 — LONG (CALL 7115) · 10:54 -> 10:58 ET · LOSS -31.05%
- CHART: Exhaustion flush bottomed at 7112.4, held the 7109 open/day-low, 10:50 candle turned green
  (C7115.4), 5-min momentum bottomed. Bounce underway.
- GEX CONFIRM: extreme positive gamma building (+10M -> +37M, "levels hold"), strong 7070 pika KING
  floor below. Capped-scalp long targeting the 7125 barney; stop below the 7109 open.
- OUTCOME: WRONG. 7109 broke; price sliced to a new low 7107 and kept flushing toward the 7070 king.
  Stopped out at plan. Option: 11.40 -> 8.10 = **-31.05%**. The "support" I bought was a price level,
  not a GEX node — and in a levels-hold regime a *non-node* level still gave way. The single worst
  read of the day, but the stop was honored (the call expired 0.03).

### Trade 3 — LONG (CALL 7095) · 11:08 -> 11:14 ET · WIN +4.71%
- CHART: Exhaustion-V off day-low 7086.7 after a 49pt flush — 11:05 candle strong green C7098.2
  (+10.6), 5-min momentum flipped positive. This is the method's favored "transition out of the pin".
- GEX CONFIRM: bounced in extreme positive gamma (+69M, levels hold -> 7086 low holds); the overhead
  7100 pika DISSOLVED leaving clean air toward VWAP 7121 / 7125 barney.
- OUTCOME: Worked +17pts of underlying (7086.7 -> 7104), but STALLED at 7102 well short of the 7120
  target with momentum dying. Banked the winner per "cap 0DTE winners, they round-trip" rather than
  let it fade. Option: 15.70 -> 16.94 = **+4.71%**.

## Total
- Sum of trade returns: **-36.01%** · Avg per trade: **-12.00%** (2 losses, 1 win).
- Real underlying path validated every exit: Trade 1 flush never came (regime flipped back);
  Trade 2 stop was right (price flushed 44 more points to 7063.8); Trade 3 stall was real (re-pinned).

## Self-assessment — did charts-first catch the day's move?
Partially, and the discipline mattered more than the entries.

What charts-first got RIGHT:
- Stood down through the 7130-7135 opening stall (0 trades in the chop-at-highs).
- Did NOT chase a short into the 49pt flush once it was clearly heading into the 7070 pika KING in
  extreme positive gamma (recognized "floor building, not giving way" = no short) — this avoided the
  day's biggest trap.
- Caught the exhaustion-V bounce for the one green trade.
- Correctly diagnosed the afternoon as an extraordinary positive-gamma pin (+240M to +535M) and
  stood FLAT for ~4.5 hours (11:15 -> close), avoiding certain theta-bleed from overtrading the pin.

What it got WRONG (the -36%):
- Both losses came in the same 30-minute volatile transition zone (10:25-10:58) where the near-spot
  regime whipsawed negative<->positive every 1-2 minutes. Charts-first fired a directional trigger
  each way (short the VWAP break, long the support hold) and got chopped by the regime flip-flop.
- Lesson for this tape type: when net-gamma is oscillating sign every couple of minutes around a
  tight VWAP, "flat is a position" — the regime confirm is unstable, so a chart trigger there is a
  coin-flip. The clean money (Trade 3) came only once the move had ENERGY (a 49pt flush + V), not in
  the low-energy chop that preceded it. Two of three trades should not have been taken.

Net: charts-first + GEX-confirm caught the flavor and the safe stance (flat through the pin, one
disciplined V-bounce win, no blow-up), but overtraded the noisy transition and finished red. The
losses were controlled (fast cuts, honored stop); the process failure was selectivity, not risk.
