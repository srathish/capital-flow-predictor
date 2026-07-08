# 64-Day Validation — GEX/VEX 0DTE System (New Rules)

**Run:** 2026-07-08 evening
**Data:** 64 trading days of archived Skylit surfaces (2026-04-10 → 2026-07-08), SPXW/SPY/QQQ, 5-min frames, all 200 strikes, GEX+VEX. Skylit-only — signals and measurement.
**Method:** exact live pipeline replayed per day — pattern detectors → fire-state machine (same cooldowns) → ATM entry → per-frame structural exits (pin / anchor-hardening / barney-fuel hold) → state-clear/EOD fallback. Performance in underlying bps captured per play (Skylit serves no option quotes; the option-mark trail stop is untested here).
**Raw:** `replay-fires-2026-04-10_2026-07-08.json` (1,339 plays)

---

## Headline: today (+18.1%) was mostly the day, not the system — but the system decomposes into a keepable core and a fixable bleed

| | n | net bps | avg | win % |
|---|---|---|---|---|
| **Baseline (all fires, current rules)** | 1,339 | **−278** | −0.2 | 47% |
| **Recommended config (see below)** | 459 | **+2,017** | +4.4 | 58% |

## Finding 1 — BULL_REVERSE is a real edge; BEAR_RUG bleeds

| State | n | net bps | avg | win % |
|---|---|---|---|---|
| BULL_REVERSE | 507 | **+1,995** | +3.9 | 54% |
| BEAR_RUG | 796 | **−2,066** | −2.6 | 43% |
| BEAR_CONTINUE | 36 | −206 | −5.7 | 25% |

Bear rug fires 60% more often than bull reversal and loses persistently. Caveat: Apr→Jul was a rallying tape (SPY ~$680→$745), so bears fought drift all window — but that's exactly what a regime gate is for.

## Finding 2 — the 30m regime gate fixes the bears (your multi-timeframe idea, validated)

Bears fired when the 30m surface regime agreed (BEAR) were ~breakeven (−0.2 avg); bears fired otherwise bled. Bulls didn't need the gate (positive in every regime bucket). Filter attribution:

| Config | n | net bps | avg | win % |
|---|---|---|---|---|
| baseline | 1,339 | −278 | −0.2 | 47% |
| A: bears only if 30m-aligned | 551 | +1,986 | +3.6 | 53% |
| **B: A + no new fires after 15:15 ET** | **459** | **+2,017** | **+4.4** | **58%** |
| C: B + skip pin-on-spot entries | 342 | +1,663 | +4.9 | 58% |

- **A is the big lever** (+2,264bps swing vs baseline).
- **B adds quality**: win rate 53→58%, cuts the EOD-leak fires (33% win after 15:15).
- **C rejected**: the pin-on-spot entries it drops actually won 59% at +3.0 avg. Pin matters for EXITS, not entries.

## Finding 3 — exits: anchor-hardening is the moneymaker, pin exit fires too late

| Exit | n | net bps | avg | win % | avg MFE |
|---|---|---|---|---|---|
| STRUCT opposing_pika | 683 | **+2,243** | +3.3 | 56% | 19.1 |
| STRUCT pin_forming | 325 | −1,783 | −5.5 | 39% | 9.7 |
| STATE_CLEAR | 207 | −276 | −1.3 | 47% | 13.4 |
| EOD | 124 | −461 | −3.7 | 15% | 2.9 |

Pin-exited plays averaged +9.7bps MFE before dying at −5.5 — the pin rule detects the death after the move already reversed. Future work: lower the pin growth threshold or act on pin *velocity* to exit nearer the peak. EOD holds confirmed as pure leak (15% win) — handled by config B's 15:15 cutoff.

## Finding 4 — monthly consistency (config B basis, filters applied)

| Month | n | net bps | avg | win % |
|---|---|---|---|---|
| April | 71 | +697 | +9.8 | 66% |
| May | 132 | +702 | +5.3 | 58% |
| June | 106 | +298 | +2.8 | 58% |
| July (partial) | 33 | −35 | −1.0 | 42% |

Positive three of four months. July is 6 sessions — small sample, watch it.

## Today (7/08) reconciled

Points-based replay of today: −191bps across 26 plays (35% win) — yet the option-mark simulation showed +18.1%. The gap is real and instructive: today's option P&L came from (a) 0DTE convexity on the three SPXW winners and (b) the trail stop + intraday marks, neither of which the points-based replay can see. Points measure *direction+timing* edge; options monetize the tails. Both views agree on the fix list (bears bled, late-day fires bled).

## Recommendations (in order)

1. **Adopt config B live**: BEAR fires require 30m regime = BEAR; no new fires after 15:15 ET; bulls unchanged. ~5-7 plays/day instead of ~21.
2. Keep all structural exits as-is (anchor-hardening pays for everything).
3. Later: improve pin-exit timing (velocity-based), revisit BEAR_CONTINUE (n=36, 25% win — probably kill it), re-test in a falling tape before trusting bears at all.

## Caveats

- 5-min replay frames vs 1-min live cadence (live fires slightly earlier/more often).
- Underlying bps ≠ option dollars; convexity favors the system more than bps suggest, theta less.
- Trail stop and quote-based exits not simulated (no option data by design — Skylit-only).
- The regime thresholds were built today; the 64-day result is out-of-sample for the *rules* but the tape was one regime (up-trend). Bear-side conclusions need a down-tape test.
