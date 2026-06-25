# 02 — The EMA Stack

The level ladder tells you *where* to act. The EMA stack tells you
*whether* to act.

## The three timeframes

| TF | EMA | Role |
|---|---|---|
| **1m** | 8 EMA | Entry trigger. Body close above/below = arm the entry. |
| **1m** | 13 EMA | **Trailing stop** for the runner after TP2. (Practitioner rule from the 8/13/21 EMA literature.) |
| **5m** | 8 & 21 EMA | Direction filter. Stack must agree with the trade. |
| **15m** | 8 & 21 EMA | Macro bias for the day. Determines max position size. |

The reason to add the **1m 13 EMA** as the runner's trail (not the 8):
the 8 EMA gives whipsaw stops on Trend Days where price chops along
it for 4–6 bars before resuming. The 13 EMA sits roughly one ATR
below the 8 on average, which keeps you in the runner through normal
chop. Use the 13 EMA only *after* TP2 — before that, the 8 EMA is
your active stop.

Some traders use 3m + 15m + 1H. The principle is the same — short,
medium, long. The numbers don't matter as much as the *separation* of
timeframes. Each TF should be ~3–5× the next.

## The 8 EMA on 1m — the actual trigger

This is the line you're staring at when price tags a rung.

- For a **long** at a reclaim/break: wait for a 1m candle to **close
  above** the 8 EMA *and* above the rung. Both, in the same candle.
- For a **short** at a failure/rejection: wait for a 1m candle to
  **close below** the 8 EMA *and* below the rung.

If price is *already* well above the 8 EMA when the rung breaks, you
are late. Skip — wait for the next pullback that retests both.

The 8 EMA on 1m moves fast (~8 minutes of memory). That's the point —
it's a momentum gauge, not a trend gauge.

## The 5m stack — direction filter

Five-minute 8 EMA and 21 EMA together tell you whether the broader
session is trending in your direction.

| Stack state | Bias | What you can trade |
|---|---|---|
| 5m 8 > 5m 21, both rising | Bullish | Reclaim longs + break-out longs only |
| 5m 8 < 5m 21, both falling | Bearish | Failure shorts + breakdown shorts only |
| 5m 8 ≈ 5m 21, flat | Chop | Rejection plays at extremes only, smaller size |
| 5m 8 crossing 5m 21 | Inflection | **Wait** for the cross to confirm (one full 5m close) |

**Hard rule:** never take a long when 5m 8 < 5m 21. Never take a short
when 5m 8 > 5m 21. The trigger TF gives false reclaims constantly —
the 5m stack is what keeps you from fading the trend.

## The 15m stack — macro bias / position size

Use the 15m as a *size knob*, not a veto.

- **15m 8 > 15m 21** (uptrend) → longs get full size, shorts get
  half size.
- **15m 8 < 15m 21** (downtrend) → mirror.
- **15m 8 ≈ 15m 21** (range) → all trades at half size.

You can still take counter-15m-bias trades — strong reclaims work in
downtrends, strong failures work in uptrends — but at reduced size.

## The "stack score"

For the signal stack in `04-signal-stack.md`, the EMA component scores
**0 to 2**:

| Condition | Score |
|---|---|
| Trigger candle closes past rung *and* 1m 8 EMA in direction | 1 |
| 5m stack aligned with direction | +1 |
| Bonus (no score, doubles size): 15m aligned too | × 1.0 size |

Cap the EMA contribution at 2 of the 5 total signal points.

## Practical visualisation

On TradingView (or whatever charting layer the `/sniper` tab uses):

- Plot 8 EMA on the 1m chart (orange).
- Overlay 5m 8 EMA (yellow) + 5m 21 EMA (red) on the same 1m chart
  using multi-TF inputs so you see all three on one screen.
- Plot 15m 8/21 as horizontal-ish reference lines.
- Mark all 8 rungs as horizontal price lines (color: bull rungs green,
  bear rungs red, pivot white).

This single screen is the cockpit. You should never need to switch
charts to make a decision.

## Common EMA failures (and the rule that catches each)

| Failure mode | Catch |
|---|---|
| Price wicks above 1m 8 EMA at a rung, then closes back below. | Require body close, not wick. |
| 1m 8 EMA flips green but 5m stack still bearish. | 5m alignment is mandatory, not optional. |
| Price gaps above 8 EMA on a news bar — looks like a clean trigger. | After a news bar, wait one full candle before arming. |
| EMA cross happens *at* the rung — ambiguous. | Wait for one full bar of separation between the EMAs before entering. |
| 8 EMA and rung coincide perfectly (level ≈ EMA price). | Treat as higher-confluence, not lower — but require the retest hold to be 2+ candles. |

## Why 8 EMA specifically

The 8 EMA on a 1-minute chart approximates ~5–8 minutes of weighted
price action. That's roughly the half-life of a 0DTE intraday move —
faster than a 13 or 20, slower than a 5. It's the natural cadence for
sniping level breaks because it filters single-bar noise while still
catching the start of a move.

There's no magic in the number 8 vs. 9. The magic is in pairing it
with the **explicit level** from the ladder. The level provides the
location; the EMA provides the timing.
