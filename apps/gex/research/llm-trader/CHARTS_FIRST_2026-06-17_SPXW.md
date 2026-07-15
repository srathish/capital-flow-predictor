# Charts-First 0DTE — SPXW 2026-06-17 (session cf0617)

Blind out-of-sample. Discretionary, charts-first, GEX-confirm only. Paper (RESEARCH).
Scoring: real ATM option 1-min closes (UW intraday), net = exit·0.985 / (entry·1.015) − 1.
All 5 trades were SHORTS (ATM puts) — charts-first read the tape bearish all day.

## The day in one line
Rangebound-to-violent DOWN day. Morning chopped a 7508–7532 range; a persistent 7505 barney
pinned price through lunch under extreme negative gamma; then a ~106-pt afternoon cascade
(7517 → 7405, −1.4%) in −144M to −213M gamma with no floor. The big vertical bursts were
uncatchable in a 1-min decide-then-reveal harness; the tradeable edge was confluence-rejection
shorts, sandwiched between vicious barney chop.

## Trade log

### T1 — SHORT 10:41 → 10:44 · ATM 7505P · **LOSS −12.35%**
- **Chart thesis:** Failed 7531.9 breakout → 3 lower-low 5-min candles broke the range floor
  (7508) to new lows 7506, below VWAP, 15m −0.31%.
- **GEX confirm:** Regime flipped +7M → −28M deep negative-gamma (fuel); king barney 7505 at spot.
- **Result:** Chased the flush at the day low; the 7506–7508 zone held (as at 10:00) and V-reversed.
  Entry put 21.7 → exit 19.6. Exited on the retest bounce — one candle before the real 19-pt flush.
- **Lesson:** Don't short the low tick of a vertical candle into a nearby floor.

### T2 — SHORT 10:50 → 11:14 · ATM 7505P · **LOSS −15.43%**
- **Chart thesis:** Retest UP into broken 7505 = resistance, downtrend intact, below VWAP.
- **GEX confirm:** −30M negative-gamma, 7505 barney overhead; target 7495 break → 7480.
- **Result:** Better entry type (at-resistance, with-trend), but the 7495 pika floor held 5+ tests
  over ~30 min despite king→7480 and −42M. Underlying flat (7504.32→7504.53) but the long put bled
  ~24 min of theta + friction: 24.9 → 21.7. A "scratch" on the tape = a real −15% on the option.
- **Lesson:** Holding a 0DTE long-put through a directional coil that won't break is theta death.

### T3 — SHORT 12:37 → 13:07 · ATM 7515P · **WIN +14.65%**
- **Chart thesis:** Multi-hour 7515–7520 coil rejected the 7520 barney, broke back below VWAP.
- **GEX confirm:** Gamma exploded to −54M (deepest to that point); 7495 floor eroded to +4.0M
  (half its morning strength = hollow); king barney 7480 below = target.
- **Result:** With-trend, at-VWAP-resistance entry. Rode 7513→7505/barney; **capped +0.10% underlying**
  when the move stalled 3 candles at the 7505 barney king (theta + 0DTE round-trip). Put 22.6 → 26.7.
- **Note:** The bigger flush came later, but only after a fake squeeze to 7517 that would have
  stopped a hold — the cap was correct.

### T4 — SHORT 14:10 → 14:16 · ATM 7480P · **LOSS −26.81%** (worst)
- **Chart thesis:** After the 72-pt crash (7517→7445), dead-cat bounce retraced into the 7480 barney.
- **GEX confirm:** −142M extreme negative-gamma, 7480 barney overhead, floor 7410 weakening.
- **Result:** Shorted the intermediate barney; the bounce was far stronger than thesis and ran
  through 7480 to 7489 (→ later 7505/VWAP). Honored the 7485–7488 invalidation. Put 24.0 → 18.1.
- **Lesson:** In a violent post-crash bounce, short the STRONGEST confluence (VWAP + king barney),
  not the first intermediate node.

### T5 — SHORT 14:44 → 14:54 · ATM 7510P · **WIN +33.81%** (best)
- **Chart thesis:** Deep dead-cat bounce (~86% retrace) grinded into the 7505 barney + VWAP 7508
  confluence = strongest afternoon resistance, within the post-crash downtrend.
- **GEX confirm:** −149M extreme negative-gamma, 7505 barney KING (−29M) + VWAP overhead, NO FLOOR
  below = big downside room.
- **Result:** Planned A+ confluence-rejection entry (applied the T4 lesson). Poke to 7510.4 rejected,
  flushed 7508→7494; **capped +0.18% underlying** into the grind before a snapback. Put 16.1 → 22.2.
  Move continued to 7463 after (left some on the table, but the tape's sudden +20pt bounces justified
  banking the best winner).

## P&L (real ATM option prints, UW intraday)

| # | Dir | In→Out (ET) | ATM put | entry→exit | net |
|---|-----|-------------|---------|-----------|-----|
| T1 | short | 10:41→10:44 | 7505P | 21.7→19.6 | −12.35% |
| T2 | short | 10:50→11:14 | 7505P | 24.9→21.7 | −15.43% |
| T3 | short | 12:37→13:07 | 7515P | 22.6→26.7 | **+14.65%** |
| T4 | short | 14:10→14:16 | 7480P | 24.0→18.1 | −26.81% |
| T5 | short | 14:44→14:54 | 7510P | 16.1→22.2 | **+33.81%** |

**Total (sum): −6.12% · Avg/trade: −1.22% · Record: 2W / 3L**

## Self-assessment

**Direction: right. Execution: net loser.** Every trade was a short, and the day's dominant move
was a −1.4% cascade — charts-first correctly and consistently read the tape bearish. But the day
netted −6.12% on real option prices for three reasons:

1. **The clean edge was small; the chop was expensive.** The two disciplined confluence-rejection
   shorts (T3, T5) both worked (+14.65%, +33.81%) and validated the core method — short the strongest
   resistance, with-trend, on a GEX regime that confirms. But T1 (chasing a flush low) and T4
   (shorting an intermediate barney into a violent bounce) were execution errors that cost −39% combined.

2. **0DTE theta is brutal on flat holds.** T2 was flat on the underlying yet −15.43% on the option —
   24 minutes of theta + bid/ask friction on a long put while a directional coil refused to break.
   The right call there was to cut faster or never hold a non-breaking coil.

3. **The biggest, cleanest moves were structurally uncatchable.** The 14:00 −40pt vertical candle and
   the late 7452→7405 flush happened inside single 1-min candles; a decide-then-reveal harness can't
   enter them safely, and every point of chase risked the violent snapbacks that recurred all day
   (I correctly refused to chase — validated three times — but that also meant sitting out the tape's
   biggest gifts).

**What I'd keep:** the confluence-rejection playbook (T3/T5), capping 0DTE winners at nodes, and the
no-chase discipline. **What I'd fix:** skip intermediate-barney bounce-shorts (wait for VWAP+king
confluence), and never hold a long-0DTE-put through a directional coil that won't break (theta kill).
Net: a hard, whippy negative-gamma day where being right on direction wasn't enough to beat friction
and chop.
