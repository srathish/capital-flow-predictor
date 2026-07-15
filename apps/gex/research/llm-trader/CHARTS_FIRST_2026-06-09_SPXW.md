# Charts-First 0DTE — SPXW 2026-06-09 (session cf0609, BLIND out-of-sample)

Paper only (RESEARCH, Clause 0). Charts create the thesis; GEX confirms. 5 trades taken.
Scored with real UW option prints: entry/exit = 1-min close at decision minute (ET+4 = UTC).
`net = exit*0.985/(entry*1.015) - 1` (long option per trade; a "down" bet = long put).

## Tape summary (what actually happened)
Gap-up open (+0.70%) ran to 7481 in 15 min, then rejected. From 10:00 the day was a **persistent,
violent grind DOWN** in negative→positive-gamma stair-steps: 7457 → 7408 → 7375 → 7300 →
**7242.88 low (-2.9% intraday) by 12:41**. Then a sharp **V-recovery** off the strongest floor of the
day (7230→7215 pika, peak net gamma +61M) back through VWAP to ~7382, before pinning 7350–7380
into the close. Dominant read: down-trend with sharp positive-gamma snapback bounces.

## Trades

### T1 — LONG 10:25 @ 7432.80 → exit 10:30 @ 7424.73 — call 7435 — **-38.00%**
- CHART: exhaustion-V off the 7408 negative-gamma flush low; impulsive bounce reclaimed the 7420/7430
  barneys, 5-min momentum turned +. Target VWAP reclaim.
- GEX confirm: growing 7425 pika floor under price, clear air to 7500.
- OUTCOME: floor failed within 5 min — 7425 lost, flipped to resistance; exited fast on invalidation.
  Underlying only -0.11%, but 0DTE ATM call decayed hard ($18.00→$11.50). **Loss.**
- Verdict: counter-trend long in a down day; the "floor" was thin (+7M) and broke. Mistake.

### T2 — LONG 10:48 @ 7375.82 → exit 10:49 @ 7366.54 — call 7375 — **-9.26%**
- CHART: climactic 3-candle flush tagged the 7375 floor exactly = mean-reversion long.
- GEX confirm: 7375 pika +9M, net gamma surged POSITIVE +37M (levels hold).
- OUTCOME: caught the knife one minute early — price sliced through 7375 to 7366; exited immediately.
  Small loss ($23.10→$21.60). **Loss.**
- Verdict: right idea (deep flush into strong gamma), wrong execution — entered on the tag, not the turn.

### T3 — SHORT 11:33 @ 7320.20 → exit 11:36 @ 7328.47 — put 7320 — **-8.26%**
- CHART: collapsing 7375 positive-gamma pin, price coiling AT the 7318 lows without the usual
  V-bounce = continuation short. Target 7280/7230.
- GEX confirm: gamma eroded +48M→+22M (levels no longer holding), GEX king/center collapsed to 7230.
- OUTCOME: the day's snapback fired — king snapped 7230→7360, gamma re-strengthened, price bounced;
  exited on thesis-break before the 7332 stop. Put lost ($23.80→$22.50). **Loss.**
- Verdict: only trend-aligned short of the day; correct concept, whipsawed by a positive-gamma snapback.

### T4 — LONG 12:01 @ 7308.66 → exit 12:09 @ 7292.97 — call 7310 — **-32.39%**
- CHART: confirmed double-bottom 7300–7303 + green reversal candle after -1.3% decline.
- GEX confirm: 7300 pika floor, positive gamma +32M.
- OUTCOME: 7300 broke decisively despite +41M gamma (7292.97), flipped to resistance; exited on
  invalidation. Underlying -0.21%; ATM call decayed hard ($24.40→$17.00). **Loss.**
- Verdict: the +6M floor at 7300 was too weak; strong gamma did NOT hold the level on this down day.
  Fourth counter-trend long — the recurring error.

### T5 — LONG 12:45 @ 7257.95 → exit 13:03 @ 7289.72 — call 7260 — **+57.87%**
- CHART: CONFIRMED bounce off the 7242.88 day-low (deepest oversold, -2.1%) — green reversal candle
  to 7259.2, higher low held above 7250. **Waited for the turn, not the tag.** Capped mean-reversion.
- GEX confirm: 7230 pika king = the **strongest floor of the day (+18M)**, net gamma peaked +61M into
  the low (strongest dealer defense). Clear air to the 7290–7300 opposing node.
- OUTCOME: patience through an 18-min coil paid off; thrust to 7289.7. **Capped the winner into the
  7290–7300 wall** exactly as prescribed. Call $28.80→$46.85. **Win.**
- Verdict: the one A+ setup — strongest floor + peak gamma + deepest oversold + confirmed turn. The
  day's only long that didn't fight the trend from a weak level.

### After 13:03 — stood down
VWAP breakout + retest developed (7310→7380) but under **extreme positive gamma (+64–78M)** it was a
grinding pin, and clean retest/breakout entries either ran away or stalled. Late-day 0DTE theta made
the capped 7350–7380 range unfavorable. Flat into the 15:45 auto-flat. 0 further trades — correct.

## Result
| # | dir | entry(ET) | exit(ET) | contract | entry$ | exit$ | net |
|---|-----|-----------|----------|----------|--------|-------|-----|
| T1 | long | 10:25 | 10:30 | C7435 | 18.00 | 11.50 | **-38.00%** |
| T2 | long | 10:48 | 10:49 | C7375 | 23.10 | 21.60 | **-9.26%** |
| T3 | short| 11:33 | 11:36 | P7320 | 23.80 | 22.50 | **-8.26%** |
| T4 | long | 12:01 | 12:09 | C7310 | 24.40 | 17.00 | **-32.39%** |
| T5 | long | 12:45 | 13:03 | C7260 | 28.80 | 46.85 | **+57.87%** |

**Total (sum of per-trade net): -30.04%  ·  Avg/trade: -6.01%  ·  Record: 1W / 4L**

## Self-assessment
- **Did charts-first catch the day's move? Partially — the recovery, not the decline.** The dominant
  move was a -2.9% grind DOWN; I was long-biased (4 of 5 trades long) and repeatedly *faded* the
  downtrend with mean-reversion longs off weak floors (T1, T4) that 0DTE decay punished hard. My one
  trend-aligned short (T3) was correct in concept but snapback-whipsawed. The single clean win (T5)
  caught the exhaustion reversal off the day's true bottom.
- **The edge that worked:** waiting for a *confirmed turn* (green candle / held higher-low) at the
  **strongest** floor with **peak** gamma at a deep-oversold extreme (T5). The losers (T2, T4) took the
  same idea but entered on the level *tag* at weaker floors, and got knifed.
- **The core mistake:** on a persistent trend-down day, "strong positive gamma = level holds" failed
  repeatedly on the downside (7375, 7350, 7300 all broke despite +30–41M gamma). Mean-reversion longs
  into thin/mid floors were low-edge; I should have stood down on T1/T4 and either shorted the breaks
  or waited only for the deepest, strongest-floor reversal (T5).
- **Discipline that held:** every loss was cut fast on invalidation (all small in underlying terms);
  the winner was capped into the opposing node; and I correctly refused to chase the extreme-gamma
  afternoon pin (~2.5 hrs flat, 0 forced trades). But fast, small stops on 0DTE ATM options still
  bleed 8–38% each via decay + 3.5% round-trip friction, which is why 4 small "underlying" losses
  outweighed one big win. Net: a losing day; the tape was a whipsaw, and I over-traded the long side.
