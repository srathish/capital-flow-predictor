# 03 — GEX / VEX Overlay (OpenClaw v11)

The level ladder and EMA stack will give you valid technical entries
all day. The GEX/VEX overlay tells you *which of those entries will
actually pay*. This is the highest-leverage filter in the system.

You already have OpenClaw v11 running in `apps/gex`. Use it.

## The 4 GEX inputs you need each morning

Pull these once at 09:25 ET from `apps/gex`:

1. **Net GEX sign + magnitude** (SPY and QQQ separately).
2. **Gamma flip price** — the strike where net GEX crosses zero.
3. **Largest call wall** within ±2 % of spot — strike and size.
4. **Largest put wall** within ±2 % of spot — strike and size.

Plus one VEX input:

5. **Vanna regime** — positive vanna (IV drop = dealer buying =
   support) vs. negative vanna (IV rise = dealer selling = cascade
   risk).

You should know all five numbers before the bell rings.

## The two regimes that matter

### Regime A — Trending / Volatile
- Net GEX **negative**, OR
- Spot trading **below** the gamma flip

Dealers are short gamma. They hedge *with* the move (buy on the way
up, sell on the way down). Breakouts go further than they "should."
**This is the sniper's home regime.** Every rung break has tail wind.

### Regime B — Pinning / Suppressed
- Net GEX **positive** AND
- Spot trading **above** the gamma flip AND
- Spot within 0.3% of a large call wall

Dealers are long gamma. They hedge *against* the move (sell rips, buy
dips). Rungs get tagged and rejected. Breakouts fade.
**Avoid initiating breakout longs here.** Take rejection plays
instead — short the test of the call wall, target the next put wall.

## The wall confluence rule

Walls are not just numbers — they are *magnets and barriers*.

For each rung in the ladder, ask:

| Question | Implication |
|---|---|
| Is there a call wall between spot and the next bull rung? | Headwind for longs. Either skip, or take a smaller long with the wall as the target. |
| Is there a put wall between spot and the next bear rung? | Headwind for shorts. Same logic, mirrored. |
| Does a wall sit *at* the next rung (within 0.2 SPY pts / 0.4 QQQ pts)? | Highest probability target. Half of the position takes profit there mechanically. |
| Does a wall sit *beyond* the next rung but before the extension zone? | Best-case scenario. The rung is your entry confirmation, the wall is your max target. |

Concretely, for the SPY 737.9 ladder:

- If the **largest call wall is at 742** → bull case completes at the
  extension zone with mechanical TP at 741.88.
- If the **largest call wall is at 740** → the 740 break will likely
  *fail*. Trade the 738.9 reclaim only to 740 (no breakout add).
- If the **largest put wall is at 735** → bear case stops at 735.
  Mechanical TP at 735.0, don't chase to 732.8.

## Vanna — the IV gate

The VEX overlay tells you whether IV is going to *help* or *hurt* your
option leg, independent of price.

| Vanna regime | What it means for sniping |
|---|---|
| Positive vanna, IV expected to fall | Calls cheaper as price rises (vega drag), but premium decay accelerates. Snipe with shorter dated (0DTE), exit faster. |
| Negative vanna, IV expected to rise | Calls expand on a rally (vega tail wind). 0DTE pays asymmetric. Best regime for calls. |
| Negative vanna, IV falling | Worst regime for calls — both vega and theta against you. Use puts on rejections instead. |
| Positive vanna, IV rising | Mixed. Reduce size, take profits early. |

## The single GEX/VEX score (0 to 2 points)

For the signal stack:

| Condition | Score |
|---|---|
| Trade direction aligns with regime (long in Regime A, short in Regime B at a call wall, etc.) | 1 |
| There is a wall *at* or *just past* the target rung (mechanical TP target exists) | +1 |

If the trade is **opposite** to the regime (e.g., longs in heavy
positive-GEX pinning regime with no clear path to extension):
**score -1**. This is one of the few negative-scoring inputs in the
stack — bad GEX confluence is enough to veto an otherwise valid
technical setup.

## Failure modes the overlay catches

| Without GEX | With GEX |
|---|---|
| You buy the 740 break, but 740 *is* the call wall. You hold to 740.8 expecting follow-through. You give back the trade. | You don't take the 740 break at all. You took the 738.9 reclaim long and exited at 740 mechanically. |
| You short the failure at 736.83 even though SPY closed yesterday at 737 and the put wall is at 737 — you're shorting *into* support. | You skip the short. Wait for body close below 735.9 (past the wall) with retest hold. |
| You buy 0DTE calls in a positive-vanna, falling-IV regime. Underlying moves your way but premium doesn't expand. | You either use 1DTE or take spot exposure instead. |

## What to read off the GEX dashboard in 60 seconds

The `/sniper` tab (see `07-automation.md`) should display, at the top,
this six-line summary that you can scan without thinking:

```
SPY  spot 738.42  flip 737.10  net GEX  -2.4B   regime: TRENDING
     calls: 740 (3.1B) | 745 (1.2B)
     puts:  735 (2.8B) | 730 (0.9B)
     vanna: NEG, IV climbing → calls expand

QQQ  spot 528.20  flip 530.10  net GEX  +1.1B   regime: PINNING
     calls: 530 (2.4B) | 532 (0.8B)
     puts:  525 (1.6B) | 522 (0.4B)
     vanna: POS, IV stable → reduce size
```

If you can read those six lines and know what kind of day to expect,
the overlay is doing its job.

## Update cadence

- **Once at 09:25 ET** for the morning setup.
- **Once at 12:00 ET** to refresh — afternoon walls can shift as
  0DTE flows materialize.
- **Once at 13:00 ET** specifically for CHEX (see below).
- **Once at 14:30 ET** before power hour.

Don't refresh more often than that. GEX is a regime variable, not a
tick-by-tick trigger.

## The 1 PM CHEX read — the afternoon drift signal

Charm exposure (CHEX) is the dealer-aggregate ∂Δ/∂t — how dealer
deltas decay through the rest of the session. On 0DTE this becomes
mechanically dominant after lunch.

At **13:00 ET sharp**, read the sign of total dealer charm exposure:

- **Negative CHEX** (dealers short charm) → dealers must *buy* SPY
  into the close as OTM call deltas decay → **bullish drift bias**
  through 16:00.
- **Positive CHEX** → mirror → **bearish drift bias**.

Apply as a size modifier on afternoon snipes:

- Snipe **with** the CHEX drift: **full size** per `05-execution.md`.
- Snipe **against** the CHEX drift: **half size, exit at TP1 only**.

CHEX has no read before 13:00 — it's overwhelmed by intraday flow.
Make this a single 5-second check at 1 PM and have the `/sniper` tab
display the sign clearly above the ladder for the rest of the session.

## The "four-Greek confluence" A++ setup

The highest-conviction read, seen ~once every 2–3 weeks. **All four**
dealer-aggregate Greeks align:

- **GEX**: trending regime supports direction (neg for longs, or pos
  + at-a-wall for short rejection)
- **DEX**: dealer delta centered near current price (max gamma
  punch zone — small moves create biggest dealer hedge demand)
- **VEX**: vanna direction agrees with IV trajectory (neg VEX +
  rising IV for longs; pos VEX + falling IV for short rejections)
- **CHEX**: afternoon drift matches direction

When the read appears, the dealer-flow stack is fully behind the
move. This is the **only** setup where the system permits **2×
sizing** — override the standard cap. Track explicitly in the journal
as "4G" trades; review these separately to confirm they really are
the best edge.
