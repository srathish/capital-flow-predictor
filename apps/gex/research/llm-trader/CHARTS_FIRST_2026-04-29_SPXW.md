# Charts-First 0DTE — SPXW 2026-04-29 (session cf0429, BLIND)

Discretionary charts-first read. Price action forms the thesis; GEX only confirms. Paper/RESEARCH.
Prices are real 1-min option closes (ET+4=UTC) for the ATM contract at each decision minute.
net = exit*0.985 / (entry*1.015) − 1.

## Day character
Open 7138.80. SPX chopped a ~34-pt mean-reverting range (7110.04–7143.90) the entire session.
Every breakout AND breakdown failed and reverted. Labeled NEGATIVE-gamma most of the day (deepened
to −68M near the lows) yet realized vol stayed low — the "negative gamma" never produced a sustained
trend leg; it produced violent-but-short flushes that all snapped back. Regime flipped to POSITIVE-gamma
into the close and pinned at the 7130 barney (which grew to a −50M king). This was a stand-down day:
1 clean directional move worth trading, and a lot of untradeable chop.

## Trades

### 1 — LONG (call 7140) · entry 10:26 / exit 10:31 ET
- CHART: price pressing the day-high 7138.80 for the 3rd time with rising intraday lows
  (7120>7126>7133) and rising minute-closes; above VWAP-proxy; momentum positive → ascending
  compression / up thesis.
- GEX CONFIRM: negative-gamma (breakouts trend), NO wall overhead until the 7200 barney (~62 pts air).
  Caveat noted at entry: no pika floor beneath → manage tight.
- EXIT: breakout tagged 7139.64 then immediately rejected back below the 7138.80 level with momentum
  going flat — failed follow-through, cut over air.
- REAL P&L: entry $12.60 → exit $13.80 → **net +6.3%**. (Exited into a small pop; correct to cut.)

### 2 — LONG (call 7140) · entry 10:35 / exit 10:41 ET
- CHART: the breakout finally showed follow-through — 3 rising candles to a fresh high 7142.46,
  15-min momentum expanding → up-continuation thesis.
- GEX CONFIRM: king flipped UP to the 7200 barney (upside target), negative-gamma fuels trend.
- EXIT: trend stalled at 7143.90, 5-min momentum decelerated then flipped negative on the first red
  candle — pre-stated momentum-roll exit. Never reached 7200.
- REAL P&L: entry $16.30 → exit $14.60 → **net −13.1%**. Worst trade: chased the top of a 3-candle
  run at an inflated premium ($16.30 vs $12.60 earlier); the "confirmed" breakout was still just chop.

### 3 — SHORT (put 7135) · entry 11:04 / exit 11:13 ET  ← the day's edge
- CHART: first decisive break of the day — price cracked BELOW VWAP-proxy 7133.74 on an
  expanding-momentum red candle (11:00: 7137.9>7133.1) and held below for 4 min, after the failed
  7143.9 top → down thesis.
- GEX CONFIRM: net gamma deepened to −32M (downside fuel), barney ceiling 7135 capping just overhead,
  clean air down to the 7085/7060 pika floor. Bounce got rejected right at the 7135 barney (king).
- EXIT: capped the winner into the next opposing node — flush ran ~7 pts straight into the day-low
  support 7120.42 while 5-min momentum decelerated; banked rather than risk the round-trip (correct —
  price bounced off 7125 minutes later).
- REAL P&L: entry $14.20 → exit $18.70 → **net +27.8%**. Clean read + clean management.

### 4 — SHORT (put 7120) · entry 11:55 / exit 12:00 ET
- CHART: day-low break with continuation — broke prior day-low on a −13pt candle and made a new low
  7117.85, strongest momentum of the day → down thesis toward the 7060 pika.
- GEX CONFIRM: deep negative-gamma (−37M), nearest floor the 7060 pika (~58 pts air).
- EXIT: immediate snapback — price reverted 6 pts to 7123.6 with 5-min momentum flipping positive;
  cut small before the 7125 stop. Failed breakdown, consistent with the whole day.
- REAL P&L: entry $13.60 → exit $12.40 → **net −11.5%**. Mistake acknowledged in-flight: chased an
  already-extended move 2 candles into the flush (poor R:R). This exact analog kept failing all day.

## Result
| # | dir | entry ET | exit ET | entry $ | exit $ | net |
|---|-----|----------|---------|---------|--------|-----|
| 1 | LONG  | 10:26 | 10:31 | 12.60 | 13.80 | +6.3% |
| 2 | LONG  | 10:35 | 10:41 | 16.30 | 14.60 | −13.1% |
| 3 | SHORT | 11:04 | 11:13 | 14.20 | 18.70 | **+27.8%** |
| 4 | SHORT | 11:55 | 12:00 | 13.60 | 12.40 | −11.5% |

**Total (sum of nets): +9.5%. Avg/trade: +2.4%. Record 2W/2L, green driven entirely by trade #3.**
Stayed FLAT ~12:00–15:45 (the entire midday/afternoon chop, deep-negative-gamma lows, and the
positive-gamma pinned close) — no forced trades.

## Self-assessment
- **What worked:** The one genuinely tradeable move — the 11:00 VWAP breakdown flush — was read
  correctly (chart broke VWAP with expanding momentum, GEX confirmed with a capping barney and air
  below) and managed correctly (capped into the day-low opposing node before the bounce). That single
  trade carried the day. Discipline in the afternoon was strong: recognized the mean-reverting chop
  early and stood down through hours of it, including resisting the tempting-but-repeatedly-failing
  7110/7130 barney probes and the positive-gamma pinned close.
- **What didn't:** Both losers were CHASES of extended moves — buying the top of a 3-candle breakout
  run at inflated premium (#2), and shorting a day-low break 2 candles into the flush (#4). On a
  mean-reverting day, entering AT the extreme instead of on the reclaim/rejection is the core error;
  both would have been avoided by requiring a pullback entry or waiting for the failed-break confirmation.
- **Process note:** a 10-min fast-forward skipped me past the 14:00 flush trigger; finer sampling near
  loaded pivots (as I later did at the 7110/7130 barneys) is the fix.
- **Did charts-first catch the day's move?** Yes, the *only* clean one (the 11:00 flush, +27.8%), and
  it correctly avoided over-trading a treacherous chop — net green +9.5% despite a 2W/2L record. This
  day had no sustained trend to catch; the win was in selectivity, not in a big directional call.
