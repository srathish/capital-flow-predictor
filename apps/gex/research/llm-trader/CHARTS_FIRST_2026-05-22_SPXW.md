# Charts-First 0DTE — SPXW 2026-05-22 (blind, paper/RESEARCH)

Session cf0522. Charts-first discretionary method: price action creates the thesis, GEX only confirms.
Underlying opened 7445.72, ran to 7497 in the first 5 min, then spent the entire day range-bound
7463–7505 with a colossal, ever-strengthening 7500 barney (grew from -14M to ~-105M) acting as a
magnet/pin. Nominal regime was "negative gamma" all day, but the tape never trended — it faded every
break in both directions and pinned into the close near 7470–7480.

## Day character (the read that mattered)
- Not a trend day. A pin/chop day masquerading as negative gamma. Every extension mean-reverted.
- The single "event" — a 13:30 break to 7505 above the 7500 barney with a 1-min flip to positive
  gamma — was a **false break** that reversed straight back below 7500. Correctly NOT chased for a long.
- Per method, the right answer on a strong pin is close to 0 trades. I over-traded the short side early
  (3 attempts in the first ~3.5h), then correctly stood flat for the entire midday/afternoon pin (~4h+).

## Trades (all SHORT / long puts; entry & exit = 1-min option close at decision minute, UTC=ET+4)

### T1 — SHORT @ 10:05 ET (7480.07), exit 10:11 ET (7480.77) — PUT SPXW260522P07480000
- Chart thesis: opening rally rejected the 7500 barney; 10:00 candle flushed 7493→7480, price lost
  VWAP-proxy 7488, 5m momentum flipped -0.18%. Coil-at-top resolved down.
- GEX confirm: neg-gamma deepened to -38M; the near 7475 floor dissolved; only structure below was the
  7425 pika (~55 pts air); 7500 barney capped upside.
- What happened: the flush stalled at 7475 and the 7475 pika floor **re-formed and held**; price bounced
  back above entry. Thesis invalidated → exited fast.
- Entry px 18.30 → exit px 17.40. **net -7.73%** (loss). Underlying ticked +0.7 against the put.

### T2 — SHORT @ 10:22 ET (7470.07), exit 10:28 ET (7471.63) — PUT SPXW260522P07470000
- Chart thesis: 15-min coil at 7474 resolved down (10:20 broke to 7470), below consolidation and VWAP,
  5m momentum turning -0.09%.
- GEX confirm: deep neg-gamma -42M; a 7450 barney strengthened to -14M as a downside magnet; floor 7425.
- What happened: broke to 7463.6, then reverted; **no follow-through** (3rd failed down-leg) and the 7475
  pika resistance that capped the bounce dissolved → squeeze back to VWAP. Exited on the scratch.
- Entry px 18.01 → exit px 15.50. **net -16.48%** (loss). Underlying reverted +1.6 against the put.

### T3 — SHORT @ 13:35 ET (7497.01), exit 13:40 ET (7500.00) — PUT SPXW260522P07495000
- Chart thesis: **failed breakout** of 7500 — price poked 7505.2 and rejected to 7497.4 (bearish reversal
  candle / bull trap), stair-stepped down 7505→7497, 5m momentum flipped -0.11%. Best bearish trigger of
  the day and consistent with the day-long fade behavior.
- GEX confirm: the 7500 barney had ballooned to -81M — a colossal overhead wall; targets VWAP 7488 then
  the 7475 floor.
- What happened: the -83M barney **magnet** immediately pulled price back up; it recovered the entire drop
  to 7500.00, pressing up into the barney with positive 5m momentum. Read was wrong (the "failed" break
  didn't stay failed) → cut the losing short near 7500 rather than hold into a violent barney break.
- Entry px 7.00 → exit px 6.10. **net -15.43%** (loss). Underlying moved +3 against the put.
- (Irony/lesson: the genuine fade to 7492/7482 finally came AFTER I exited — but the exit was correct on
  the information available, as price was pressing up into the wall at the exit minute.)

## Stand-downs that were correct (flat is a position)
- 10:29–13:30: repeatedly declined mid-range fades and the slow grind into the 7500 barney (poor R/R
  into strengthening resistance; every push stalled). Avoided many more chop scratches.
- 13:30 false breakout: did NOT chase the long above 7500 — it reversed within 2 minutes.
- Entire afternoon (13:41–15:45): a heavily-defended pin (7500 barney to ~-105M, 7470/7490 floors to
  +60M). Correctly took 0 trades; only actionable idea (a break through the 7470 floor) never triggered
  because the floor grew into a wall.

## Result
| # | Side | Entry ET | Exit ET | Option | Entry | Exit | Net |
|---|------|----------|---------|--------|-------|------|-----|
| 1 | short/put | 10:05 | 10:11 | P7480 | 18.30 | 17.40 | -7.73% |
| 2 | short/put | 10:22 | 10:28 | P7470 | 18.01 | 15.50 | -16.48% |
| 3 | short/put | 13:35 | 13:40 | P7495 | 7.00 | 6.10 | -15.43% |

**Total (unit-weighted sum): -39.64%.** 3 trades, 0 wins, 3 small losses.

## Self-assessment
- **Did charts-first catch the day's move?** There was no trending move to catch — it was a pin/chop day,
  and the method's structural read (huge 7500 barney = pin; false break; fade-everything) was correct.
  The correct expression of "pin day" is near-zero trades; I got the *read* right but the *restraint*
  only half-right.
- **What went wrong:** all three shorts entered on legitimate down-triggers (rejection, coil-break,
  failed-breakout) but the underlying reverted UP within minutes each time — the defining behavior of a
  pinned tape. On this tape, the 7500/7475 levels were magnets that bought every dip; a discretionary
  short needed the underlying to already be *leaving* a level with follow-through, not just triggering at
  it. I was a beat early on T1 and T3 and wrong on the follow-through of all three. Round-trip costs
  (~3%/trade) compounded small adverse underlying ticks into meaningful option losses.
- **What went right:** losses were kept small on the underlying (each exited within ~5 min of the thesis
  breaking); I did not chase the 7500 false breakout; and I stood flat through 4+ hours of untradeable
  pin. The larger error would have been over-trading the pin or chasing the fake breakout — both avoided.
- **The honest lesson:** on a strong-pin day, "0 trades" beats "3 disciplined-but-early shorts." The
  best trade available (a break THROUGH the 7470/7475 floor into air) never set up; absent it, flat was
  the whole edge. Grade: read A-, execution C (should have demanded confirmed follow-through, or simply
  passed, given the pin was diagnosable by ~10:30).
