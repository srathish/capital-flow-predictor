# Charts-First 0DTE — SPXW 2026-06-12 (blind out-of-sample)

Session `cf0612`. Paper/research only. Method: read the chart first, use GEX only to confirm,
be selective, manage tight. 4 trades taken (top of the "1–4 is a good day" range).
P&L scored from real 1-min option prints (SPXW 260612 contracts, entry/exit = 1-min close at
decision minute, ET+4=UTC), net = exit*0.985 / (entry*1.015) − 1.

## Day shape
Gap-and-reversal open (7394 → 7407 spike → flush to 7365 low), then a clean momentum breakout
that melted up all morning to a 7455.8 high just before noon. From ~12:00 to the close the tape
pinned in a tight 7400–7455 box around a 7425 barney — extreme negative-gamma readings (net
near-spot -50M to -78M) but the actual behavior was violent V-reversals at VWAP, not cascades.
Two clean directional moves (the morning breakout up, the midday reversal flush down); the rest
was untradeable chop.

## Trade log

### T1 — LONG (breakout) · WIN +25.45%
- Entry 10:02 ET @ spot 7395.19 · Exit 10:08 ET @ 7414.08 · ATM 7395 Call (SPXW260612C07395000)
- Entry $28.70 → Exit $37.10 (1-min closes, 14:02 / 14:08 UTC)
- CHART: bounce off the 7365 low turned into a momentum breakout — 10:00 candle 7379→7395 closed
  on its high, reclaimed VWAP (7384), 15-min momentum +0.33% accelerating.
- GEX CONFIRM: broke through the 7385 pika which flipped to a FLOOR ~10pts below entry; clean air
  overhead to the next node 7460; negative-gamma regime = breakout extends, not pins.
- MANAGE: banked the vertical +15pt impulse into new day highs (7414, extended +27 over VWAP) as
  net near-spot gamma decayed -26M→-9M (trending fuel dying). Textbook "cap the 0DTE winner."

### T2 — SHORT (failed-breakdown / bull-trap) · LOSS -33.67%
- Entry 10:45 ET @ 7391.91 · Exit 10:53 ET @ 7409.26 · ATM 7390 Put (SPXW260612P07390000)
- Entry $23.70 → Exit $16.20 (14:45 / 14:53 UTC)
- CHART: 30-min coil under 7421 failed to break up and flushed -23pts in one bar (7416→7393),
  lost VWAP; 5-min momentum -0.33%. GEX: -38M, 7395 barney overhead, only a thin 7385 pika below.
- WHY IT FAILED: the 7385 pika did NOT give way — it reformed and held, then price V-reversed and
  blew back through VWAP+7395 to 7409 (bear trap). Cut at my stated invalidation (reclaim of
  7395/VWAP). Lesson: shorting a mid-range flush into a live pika floor = low-quality; the floor held.

### T3 — SHORT (double-top reversal flush) · WIN +35.46%
- Entry 11:34 ET @ 7443.15 · Exit 11:43 ET @ 7424.68 · ATM 7445 Put (SPXW260612P07445000)
- Entry $24.30 → Exit $33.92 (15:34 / 15:43 UTC)
- CHART: double-top rejection at 7451/7455.8 after the extended melt-up; price rolled over and
  broke the 11:20–30 consolidation, momentum negative on both timeframes.
- GEX CONFIRM: net gamma -50M (strong negative) AND nearest floor below = NONE (clean air pocket).
  Cleaner than T2 — this time there was genuinely no floor under price. Fading the exhaustion of
  the highs, not chasing a mid-range break.
- MANAGE: rode the ~18pt flush and banked the big gain into the rising VWAP (7413) — the day's
  magnet / first real support and prime bounce zone. Redeemed the T2 whipsaw.

### T4 — SHORT (VWAP-break continuation) · LOSS -25.86%
- Entry 11:50 ET @ 7407.83 · Exit 11:53 ET @ 7421.96 · ATM 7410 Put (SPXW260612P07410000)
- Entry $25.00 → Exit $19.10 (15:50 / 15:53 UTC)
- CHART: continuation short on a decisive VWAP break, price below VWAP, momentum accelerating.
  GEX: -54M, no floor, ~38pts air to the 7370 king.
- WHY IT FAILED: same trap as T2 — price V-reversed 7407→7422 in one bar, reclaiming VWAP+7420.
  Cut at my stated stop. Second failed breakdown-short: on this tape the no-floor flushes keep
  V-reverting at VWAP instead of cascading. That was the day's key lesson, learned twice.

## Result
| # | Dir | Entry→Exit (ET) | Option | Net |
|---|-----|-----------------|--------|-----|
| T1 | Long  | 10:02→10:08 | 7395C | +25.45% |
| T2 | Short | 10:45→10:53 | 7390P | -33.67% |
| T3 | Short | 11:34→11:43 | 7445P | +35.46% |
| T4 | Short | 11:50→11:53 | 7410P | -25.86% |

**Total (sum of equal-weight net): +1.39% · avg +0.35%/trade · 2W / 2L.**

## Self-assessment
- Charts-first DID catch the day's two real moves: the morning breakout long (T1) and the midday
  double-top reversal flush (T3) — the only two clean directional legs. Both used a real chart
  thesis first with GEX confirming (floor+air for the long; no-floor+strong-negative-gamma for the
  short), and both were exited by the "cap the 0DTE winner / bank into the next node/VWAP" rule.
- The two losses (T2, T4) were the same mistake twice: shorting a *breakdown/flush* rather than a
  *rejection at an extreme*. This tape's negative-gamma "no floor" reads produced violent
  V-reversals at VWAP, not cascades — so breakdown-continuation shorts got trapped, while fading
  the exhaustion extremes (T3) worked. I cut both losers immediately at their pre-stated
  invalidation, which kept them from compounding; net the day still finished green (+1.39%).
- Discipline held where it mattered: after learning the V-reversal pattern (by 11:53) I stood down
  for the entire ~4-hour afternoon pin (7400–7455 box, 7425 barney up to -39M) rather than churn a
  mid-range chop into theta and costs — flat was the correct position for 200+ minutes.
- Improvement: I should have recognized after T2 that a "flush with no floor" on this tape was not
  a short trigger but a *long-the-bounce* setup at VWAP; taking T4 was avoidable and cost -25.86%.
  Fade the extremes, don't chase the breaks — the single transferable read from this day.
