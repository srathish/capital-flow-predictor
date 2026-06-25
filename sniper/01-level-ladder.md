# 01 — The Level Ladder

How to decode a Rapid-Trading post into a structured ladder of trades.

## The canonical post shape

> "$SPY 737.9 can hold watch for a push to 738.9 that **reclaims** look
> for 740 that **breaks** watch for 740.8. Above that room to
> 741.88–742.9 gap to fill. If 737.9 unable to hold watch for a drop
> to 736.83 that **breaks** look for 735.9. Below that room to 735–734
> and 732.8."

Every Rapid post has the same grammar:

```
<PIVOT> can hold
  → push to <RECLAIM_TRIGGER> that reclaims
  → look for <TARGET_1> that breaks
  → watch for <BREAK_CONFIRM>
  → above that, room to <EXTENSION_ZONE> (gap fill / measured move)

<PIVOT> unable to hold
  → drop to <FAILURE_TRIGGER> that breaks
  → look for <TARGET_1_DOWN>
  → below that, room to <EXTENSION_ZONE_DOWN> (gap fill)
```

That gives you **8 rungs** per ticker per day. Most days you'll touch
two or three of them.

## Rung definitions

| Rung | Role | Action when price touches |
|---|---|---|
| `PIVOT` | Bull/bear axis for the day. | Wait — don't trade the touch. Trade the *resolution* of the touch. |
| `RECLAIM_TRIGGER` | Above pivot — confirms longs. | Body close above + retest hold → snipe CALLS toward `TARGET_1`. |
| `TARGET_1` | Next resistance to break. | Two outcomes: rejection (exit) or break (next rung). |
| `BREAK_CONFIRM` | Above `TARGET_1`. Validates the break. | Body close above → momentum add. |
| `EXTENSION_ZONE` | Measured move / gap fill. | Take profit, don't chase. |
| `FAILURE_TRIGGER` | Below pivot — confirms shorts. | Body close below + retest hold → snipe PUTS toward `TARGET_1_DOWN`. |
| `TARGET_1_DOWN` | Next support. | Reject (exit) or break (next rung). |
| `EXTENSION_ZONE_DOWN` | Gap fill / lower measured move. | Take profit. |

## The single most important rule

**Touch ≠ trade. Confirmation = trade.**

A price tag of a rung is *information*, not an entry. You need
**confirmation** before sniping. Confirmation has two parts:

1. **Body close past the rung** on the trigger timeframe (1m or 2m).
   Wicks don't count. A 1m candle whose body closes above 738.9
   = reclaim confirmed.
2. **Retest hold** — price comes back to the rung and bounces (long)
   or rejects (short) within the next 1–3 candles.

Both required. If you skip (2), you'll get faked out by liquidity
sweeps. If you skip (1), you'll buy the wick top.

## Reclaim vs break (don't confuse them)

- **Reclaim** = price was *below* a rung, comes back *above* it, and
  holds. The rung becomes new support.
- **Break** = price was *below* a higher resistance rung, pushes
  *through* it, and holds. The rung becomes new support.

They look similar but mean different things:

- Reclaiming `RECLAIM_TRIGGER` (738.9) after pivot test = the bull
  scenario is *activating*. Entry candidate.
- Breaking `TARGET_1` (740) = the bull scenario is *playing out*.
  Momentum add only, not initial entry — the move is half done.

## Rejection plays (the inverse trades)

The post tells you bull/bear scenarios from the pivot. But each upside
rung is also a **rejection short** candidate, and each downside rung
is a **rejection long** candidate, *if* the EMA stack and GEX regime
disagree with the breakout.

Example: SPY runs to 740, but:
- 5m 8 EMA still below 21 EMA (no trend)
- Net GEX deeply positive, 740 is the largest call wall
- VIX rising

→ 740 will likely *reject*. That's a put snipe back to 738.9, not a
call snipe to 740.8.

The post gives you levels. The stack tells you direction. **Never
infer direction from the post alone.**

## How to format levels for the engine

To feed the `/sniper` UI (see `07-automation.md`), parse the post
into JSON like this:

```json
{
  "ticker": "SPY",
  "session_date": "2026-06-25",
  "pivot": 737.9,
  "bull": {
    "reclaim_trigger": 738.9,
    "target_1": 740.0,
    "break_confirm": 740.8,
    "extension": [741.88, 742.9],
    "extension_note": "gap fill"
  },
  "bear": {
    "failure_trigger": 736.83,
    "target_1": 735.9,
    "break_confirm": null,
    "extension": [735.0, 734.0, 732.8],
    "extension_note": "gap fill"
  }
}
```

The parser only needs to find numbers in the post and assign them by
keywords (`hold`, `reclaim`, `break`, `room to`, `gap`, `unable to
hold`, `drop to`, `below`). Build the parser in `apps/gex/scripts/`
since it's already Python.

## Multi-ticker

Apply the same ladder shape to QQQ. Some days Rapid posts QQQ levels;
some days only SPY. When only SPY is posted, derive QQQ candidate
levels from:

- Premarket high/low
- Overnight high/low
- Yesterday's close + 0.5 ATR rungs
- Largest GEX walls within ±1.5% of QQQ spot

Until you have data showing derived QQQ ladders work, **only trade
QQQ when Rapid explicitly posts QQQ levels**.

## Edge cases

- **No clear pivot** — the post says "above 740 we run, below 738 we
  bleed" with a 2-point dead zone. Pivot = midpoint, but require
  *both* boundary breaks before trading. Lower confluence.
- **News-driven gap** — premarket gap of >0.5% on SPY invalidates
  prior-day levels. Wait for the first hour to print new structure
  before applying the ladder.
- **No post on the day** — sit. Don't fabricate levels. This system
  needs an authored ladder.

## Output

By the end of this stage you should have:

- 8 rungs (4 bull, 4 bear) printed.
- An expectation for the day (bullish / bearish / range) based on
  premarket action vs. pivot.
- Awareness of which 2–3 rungs are most likely to print today, given
  premarket positioning.
