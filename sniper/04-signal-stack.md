# 04 — The Signal Stack

Six independent checks. Five contribute to score, one is veto-only.
Each is a clean yes/no.

## The 5 scoring inputs

| # | Input | Source | Max points |
|---|---|---|---|
| 1 | Rung confirmed (body close + retest hold) | Chart | 1 |
| 2 | EMA stack agrees (1m 8 in direction, 5m 8/21 aligned) | Chart | 2 |
| 3 | GEX regime agrees with direction | `apps/gex` | 1 |
| 4 | Wall target exists at or just past next rung | `apps/gex` | 1 |

Total max score: **5**.

Negative scoring (one situation only): trade direction is *opposite*
to GEX regime *and* no clear wall path → **−1**. This makes the
practical floor 0 and can drop an otherwise mid-grade setup below
the action threshold.

## The veto input

**Time-of-day veto.** No setup, no matter how clean, gets traded in:

- 09:30 – 09:35 ET (open vol → false signals)
- 11:45 – 13:00 ET (lunch chop → false signals + low gamma)
- 15:50 – 16:00 ET (closing auction skew)

Outside those windows, the score decides.

## Score thresholds

| Score | Action |
|---|---|
| 5 / 5 | A+ snipe. Full size. Pyramid on confirmation. 0DTE OK. |
| 4 / 5 | A snipe. Full size, no pyramid. 0DTE OK. |
| 3 / 5 | B snipe. **Half size only.** 1DTE or 2DTE — *no 0DTE*. |
| ≤ 2 / 5 | No trade. |

The asymmetry — 0DTE only at 4+ — exists because 0DTE punishes
indecision. If you don't have full conviction, the longer dated
option pays you back for being right slower.

## The 60-second decision

When price tags a rung:

```
1. Did the candle BODY close past the rung?              [Y/N]
2. Did the retest hold?                                  [Y/N]
3. Is 1m 8 EMA in direction (price closed past it too)?  [Y/N]
4. Is the 5m stack aligned (8 vs 21 in direction)?       [Y/N]
5. Is GEX regime supportive?                             [Y/N]
6. Is there a wall as a TP target?                       [Y/N]
7. Time-of-day OK?                                       [Y/N]
```

(1) + (2) = score 1
(3) = score 1
(4) = score 1
(5) = score 1
(6) = score 1
(7) = veto / no trade

If you can't answer all seven in under a minute, the setup is unclear
and you skip by default.

## Worked scoring — bull case from the SPY example

Setup: SPY at 738.40 after testing 737.9 pivot. 1m candle closes at
739.05. Retest at 738.92 holds. 1m 8 EMA at 738.60 — price above. 5m
8 EMA above 21 EMA, both rising. Net GEX -1.8B, regime TRENDING. Call
wall at 741.5. Time: 10:12 ET.

- Rung confirmed (close above 738.9 + retest hold): ✅ (+1)
- EMA stack (1m above 8 EMA, 5m 8>21): ✅ ✅ (+2)
- GEX regime supportive (TRENDING + long): ✅ (+1)
- Wall at 741.5 just past 740.8 break confirm rung: ✅ (+1)
- Time OK (10:12 ET): ✅ veto clear

**Score: 5/5. A+ snipe.** Buy 0DTE or 1DTE calls near ATM; first
target 740 (mechanical 50% off); trail rest with 1m 8 EMA toward
741.5 wall.

## Worked scoring — bear case rejected

Setup: SPY at 736.95 after pivot loss. Wick to 736.70 but candle
closes at 737.05. 1m 8 EMA at 737.15 — price below. 5m 8 < 5m 21.
Net GEX +0.4B, mild positive. Put wall at 734.5. Time: 10:18 ET.

- Rung confirmed (need body close below 736.83 — only got 737.05): ❌
  (0)
- EMA stack (1m below 8 EMA: ✅; 5m 8<21: ✅): (+2)
- GEX regime (pinning is mildly *against* shorts; debatable): 0
- Wall at 734.5 well past 735.9 break confirm rung: ✅ (+1)
- Time OK: ✅

**Score: 3/5.** But (1) failed — there was no actual close below the
rung, just a wick. **No trade.** Wait for an actual body close below
736.83 before re-scoring.

## What "agree" / "aligned" means precisely

- **EMA stack aligned (long):** 1m 8 EMA tilted up *and* price above
  it; 5m 8 EMA above 5m 21 EMA *and* gap widening (or stable, not
  contracting).
- **EMA stack aligned (short):** mirror.
- **GEX regime supportive:**
  - Long: net GEX negative OR spot below flip OR spot >0.3% from a
    bigger call wall on the way up.
  - Short: net GEX positive at a call wall (pinning reject) OR spot
    above flip with a clean put wall as target.
- **Wall target:** a wall whose strike sits within ±1 SPY point of
  the next rung *and* whose size is at least 2× the average wall in
  the visible chain.

## Why six checks and not more

Adding more checks looks rigorous but causes paralysis. The system
above covers:

- *Location* (level ladder, check 1)
- *Timing* (EMAs, checks 2–3)
- *Regime* (GEX, check 4)
- *Target* (wall, check 5)
- *Time-of-day* (veto)

That's the full taxonomy of what makes a 0DTE move pay. Adding RSI,
VWAP, MACD, etc. would either be redundant (most other indicators are
derivatives of price + volume already encoded in the EMAs) or
introduce noise (RSI divergence is famously unreliable on 1m).

If you find yourself wanting another input, write down what it would
have *changed* about the last 20 trades. If the answer isn't "would
have kept me out of a clear loser" or "would have sized up a clear
winner," skip it.
