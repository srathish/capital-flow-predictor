# 09 — Rapid-Trading-Style Methodology (decoded)

The level posts you're reading aren't proprietary in concept — they're
a distilled blend of two well-known frameworks: **Market Profile** day-
type analysis and **liquidity sweep + reclaim** entry mechanics. This
file connects the vocabulary so you can extend the system beyond what
any single morning post tells you.

## Vocabulary translation table

| Rapid post phrase | Underlying concept | Where it comes from |
|---|---|---|
| "can hold" pivot | Value-area mid / point of control / prior-day VWAP close | Market Profile |
| "reclaim" | Failed breakout that's swept liquidity below, then closes back above | ICT / sweep-reclaim engines |
| "break" | Initial-balance breakout above first 30–60 min range | Market Profile |
| "watch for" target | Next acceptance node — usually prior-day high, VWAP band, or value-area edge | Composite profile |
| "room to" extension | Gap-fill zone or measured-move (ABCD-style) target | Auction theory |
| "gap to fill" | Prior-day close vs. today's open imbalance | Standard gap-trading lit. |
| "above that" / "below that" | Trend continuation past the break-confirm rung | Auction acceptance |

So when Rapid posts:

> "$SPY 737.9 can hold watch for a push to 738.9 that reclaims …"

… they are saying: *"the pivot at 737.9 is the prior-day point of
control / VWAP close; if price stays above it, watch for a sweep of
738.9 that closes back above as the long trigger; the prior-day high
sits at 740 as the first acceptance test; gap fill above is 741.88 –
742.9."*

Knowing that, you can **build your own ladder on days the post
doesn't arrive** (see end of file).

## Why the rung shape is what it is

Every Rapid ladder has the same shape because every auction day has
the same anatomy:

1. **Overnight imbalance** — globex auction sets a high/low.
2. **Open** — RTH session opens inside or outside that imbalance.
3. **Initial balance (first 60 min)** — defines the day's first
   structure. The pivot ≈ midpoint of yesterday's value area or
   today's IB.
4. **Acceptance test** — first push toward yesterday's high or low.
   This is your `RECLAIM_TRIGGER` / `FAILURE_TRIGGER`.
5. **Acceptance or rejection** — body close past = acceptance, wick
   = rejection. This is your *confirmation*.
6. **Extension** — once accepted, price seeks the next reference
   (prior-day high/low, gap fill, measured move). This is your
   `TARGET_1` and `EXTENSION_ZONE`.

Each rung in the published ladder maps to a step in this anatomy.
That's why the structure is repeatable.

## The 8 market-profile day types — and which rungs print on each

Market Profile literature names eight day types. They're worth knowing
because they tell you, by 10:30 ET, *which rungs are likely to print
the rest of the day* and therefore which trades to look for.

| Day type | Profile shape | What it looks like | Which rungs print |
|---|---|---|---|
| **Trend Day** | Tall, vertical, one-sided | Open and never look back; 85 %+ of range in one direction | Reclaim → all targets up to extension (or mirror down) |
| **Double-Distribution Trend** | Two stacked balances with a thin neck | Quiet open, then break, then second balance higher (or lower) | Reclaim, target_1, then a *pause*, then break-confirm to extension |
| **Normal Day** | Bell-shaped; 85 %+ of range in IB | First hour does most of the work; chop after | Only the close-by rungs print (pivot + reclaim or pivot + failure) |
| **Normal Variation** | Bell with one moderate extension | IB plus a measured push one way | Reclaim or failure + target_1; rarely break-confirm |
| **Neutral Day** | Range extension both sides, returns to middle | Tests upside then downside; closes mid-range | Sniper-hostile — both reclaim and failure triggers print, then fail |
| **Non-Trend Day** | Very small range; flat profile | Coil all day, no breakouts | Pivot tested repeatedly; *no rung confirms*. Skip the day. |
| **P-shape** | Tall stem at the bottom, fat top | Strong rally then balance higher | Reclaim → target_1, then sideways. Trim at target_1, don't chase. |
| **b-shape** | Fat bottom, tall stem up top | Sell-off then balance lower | Failure → target_1_down, then sideways. Mirror of P. |

**Practical implication for the sniper:**
- On Trend / Double-Distribution days, ladder *all* rungs and run
  TP3 to the extension. These are the days the system pays you 3R+.
- On Normal / P / b days, take TP1 and TP2 only. Skip extension.
- On Neutral / Non-Trend days, **don't trade** after the first
  failed rung. Sit out.

The day type is usually identifiable by **11:00 ET** from how
aggressively the first IB break extends. The signal-stack score will
naturally bias you toward the right action — Trend Days produce
high-confidence stack reads at multiple rungs, Neutral Days don't —
but knowing the day type explicitly helps you size and exit.

## When the post doesn't arrive — synthesizing a ladder

If Rapid doesn't post on a given day (illness, traveling, etc.), do
not invent levels in your head. Construct a ladder *mechanically*
from the references that the post itself derives from:

```
PIVOT             = midpoint(prior_day_VAH, prior_day_VAL)
                    OR prior-day VWAP close
                    OR prior-day point of control (POC)

RECLAIM_TRIGGER   = max(pivot + 0.10% SPY, IB_high)
TARGET_1          = prior_day_high
BREAK_CONFIRM     = prior_day_high + 0.10% SPY
EXTENSION         = first untested gap above (yesterday's open vs.
                    today's open) OR measured move (TARGET_1 + IB_range)

FAILURE_TRIGGER   = min(pivot - 0.10% SPY, IB_low)
TARGET_1_DOWN     = prior_day_low
EXTENSION_DOWN    = first untested gap below
                    OR (TARGET_1_DOWN - IB_range)
```

For QQQ, scale the 0.10% buffer to ~0.12% (slightly wider point
range). The mechanical ladder will not match Rapid's perfectly, but
it gives you a *defensible* set of rungs to trade. Track these
synthetic ladders separately in the journal — backtest performance
should be measured separately so you don't conflate them.

## Why the sweep-reclaim pattern is so reliable

A reclaim entry has built-in edge because the price action *itself*
discloses where the stops were. When 737.9 breaks (sweep), every
stop-loss order resting just below 737.9 is triggered → real selling
hits the tape → price overshoots to 736.50 → no follow-through → the
shorts that just triggered are now offside → buybacks → price closes
back above 737.9 (reclaim) → trapped shorts cover → momentum.

The "reclaim" candle is therefore *information* about who's trapped:

- Body close 30 %+ inside the prior bar = strong reclaim (trapped
  shorts, long entry).
- Wick reclaim only = no trapped flow, lower probability.

This is why **body close ≠ wick** is rule one in `01-level-ladder.md`.
You're not just being technical — you're requiring evidence that
real flow flipped.

## The "narrative" check

Before every entry, you should be able to say in one sentence *what
just happened*:

- "Price swept 737.9 lows, closed back above, shorts trapped."
- "Price broke 740 on a strong 1m bar after consolidating 10 min."
- "Price tagged the call wall, rejected on a doji, 5m stack just
  rolled."

If you can't say what just happened in one sentence, the chart is
ambiguous and the trade is not ready.

This single check filters more impulse trades than any of the
quantitative inputs.

## When Rapid's call disagrees with your stack

Sometimes the post calls for a long, but by the time the rung
confirms the stack has shifted bearish. **The stack wins.** The post
is yesterday-evening / this-morning analysis. The stack is *now*.

The post's job is to give you the **levels** — the locations to act.
It is not to give you direction. Direction always comes from the
stack at the moment of confirmation.

This is the single biggest mental adjustment for following posted-
level trading. You're not subscribing to a *call*. You're using a
*map*. The compass is yours.
