# Charts-First Discretionary 0DTE — SPXW 2026-06-10 (paper, RESEARCH / Clause 0)

Method: price action builds the thesis; GEX only confirms. Ruthless selectivity.
Session `cf0610`, 10:00–15:45 ET, one position at a time, auto-flat 15:45.

## Day character
An **extreme positive-gamma pin/chop day**. Near-spot gamma sat positive the entire
session and peaked at **+191M** in the early afternoon. The two range extremes held
essentially every test:
- **Ceiling ~7395–7400 / king node** rejected the one real breakout attempt (10:25).
- **Floor 7295–7300** held ~9 times; every probe below snapped back (bear traps).

The only sustained directional move was the **morning slide 7395 → 7291 (10:25–11:15)**,
which resolved *inside* my first fast-forward window, and a slow afternoon bleed to
**7268** that never accelerated (gamma stayed positive, no negative-gamma flip). Close ~7287,
day -1.3%.

Per the mandate ("the strong positive-gamma pin is untradeable; trade 0–1 times in
rangebound chop"), the correct trade count was **0–1**. I took 3 — all at the extremes,
all cut small on the underlying, but all losers on 0DTE option premium.

## Trades (real ATM prints, net = exit*0.985 / (entry*1.015) − 1)

| # | Side | Entry ET | Exit ET | Entry spot | Exit spot | Underlying | ATM contract | Prem in→out | **Net** |
|---|------|----------|---------|-----------|-----------|-----------|--------------|-------------|--------|
| 1 | LONG | 11:25 | 11:34 | 7330.74 | 7319.78 | −0.15% | 7330C `SPXW260610C07330000` | 29.30 → 21.70 | **−28.1%** |
| 2 | SHORT| 13:39 | 13:48 | 7294.65 | 7309.95 | −0.21%* | 7295P `SPXW260610P07295000` | 16.90 → 8.50 | **−51.2%** |
| 3 | LONG | 14:07 | 14:14 | 7324.95 | 7318.03 | −0.09% | 7325C `SPXW260610C07325000` | 11.60 → 11.40 | **−4.6%** |

\*T2 short = long the put; market rallied against it, so a −0.21% underlying move against
the position = −51% on the put premium (delta + theta + spread).

**Total: −83.9% summed (−28.0% avg per trade). 0 wins / 3 losses.**

### T1 — mean-reversion long into 7345 king (LOSS −28.1%)
Chart: oversold −0.97% into the 7309 low, 11:20 engulfing reversal 7314.9→7331.7, momentum
flipped up. GEX: gamma reasserted 61M→121M, 7345 king magnet 56M just overhead, floor held.
Thesis = pop to the 7345 magnet. It stalled at 7336 (the day's recurring cap), printed a
lower high, rolled back to the 7320 stop in 9 min. **Cut fast** at −0.15% underlying. Right
discipline, wrong regime read — 7345 was never reachable all day.

### T2 — air-pocket short on 7295 breakdown (LOSS −51.2%)
Chart: descending triangle at the floor, 13:35 broke 7300.5→7294.6 to a new low. GEX: the
7295 floor node vanished from the map (next support 7225 = 70pts of air), gamma collapsed to
+19M. Looked like the transition-out-of-pin. **It was a bear trap** — 13:45 spiked to a
marginal new low then reversed hard to 7311, gamma snapped 16M→86M and the 7295 node
reappeared. Stopped on the reclaim. This was the single worst read: I shorted the exact
floor that had held all day, in a still-positive-gamma regime.

### T3 — pin-to-king long on gamma surge (LOSS −4.6%)
Chart: grind up off the trap lows, entry on a small pullback near support (not chasing). GEX
(best confluence of the day): gamma surged to +191M, king ballooned to +88M (biggest node
all day), floor migrated up 7295→7320. Thesis = pinned drift up to 7345. Price never
migrated — it pinned *in place* at 7318 for 9 min while gamma faded 191M→115M and the 7320
floor node vanished. **Cut at −0.09%**, the smallest loss of the three.

## What went right
- **No blow-ups.** Every stop was tiny on the underlying (−0.15% / −0.21% / −0.09%).
- **Avoided the worst whipsaw** — stood down on the 10:25 breakout that rejected at 7400.
- Correctly stood down for the entire back third (14:35→close), refusing to chase the slow
  bleed to 7268, which promptly snapped back to 7287 at 15:40.

## What went wrong (the real lesson)
- **Traded an untradeable pin 3×.** The regime label said "POSITIVE-gamma (levels hold)" every
  single read; the mandate says that pin is untradeable. I engaged at the extremes anyway.
- **0DTE premium punishes even 6–15pt adverse moves.** "Small" underlying losses became −28%,
  −51%, −4.6% on ATM premium via delta + theta + the entry/exit spread haircut. On a pin day,
  the round-trip spread alone is a headwind that only a real trend overcomes.
- **The floor-break short (T2) was the cardinal error** — fading/breaking a level that had
  held 9× in a positive-gamma regime, on gamma that never flipped negative.

## Did it catch the move?
**No.** The day's only clean directional leg (7395→7291) happened inside a fast-forward
window before I engaged, and the afternoon never produced the negative-gamma break I set as
my bar. The honest right answer for this tape was **flat / 0–1 trades**; my selectivity
filtered 41 decision points down to 3, but the 3 I took were the wrong side of a pin that
reverted everything.
