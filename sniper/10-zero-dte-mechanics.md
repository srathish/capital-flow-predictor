# 10 — 0DTE Mechanics (Greeks & dealer flows)

You're sniping 0DTE/1DTE SPY and QQQ. The Greeks behave very
differently inside 24 hours of expiry than they do at 30 DTE. This
file is the mental model for why your option premium does what it
does — and when the math is working *for* you vs. *against* you.

## The four Greeks in 0DTE land

| Greek | What it is | 0DTE behavior |
|---|---|---|
| **Delta** | ∂P/∂S — how option price moves per $1 of underlying | At ATM 0DTE: starts ~0.50, swings to 0.0 or 1.0 fast as price moves <0.5%. The "delta bands" are razor-thin. |
| **Gamma** | ∂Δ/∂S — how delta changes per $1 of underlying | **Maximum at ATM, expires at infinity.** Tiny price moves cause enormous P&L moves. This is the entire reason 0DTE pays 100–300% on level-to-level moves. |
| **Theta** | ∂P/∂t — premium decay per unit of time | **Accelerates roughly 2–4× from morning to 1 PM, then 6–10×+ in power hour.** This is why you don't hold past 15:30. |
| **Vega** | ∂P/∂σ — sensitivity to IV | Negligible by mid-day on 0DTE. The premium *is* almost all gamma at that point. |

The 0DTE option's life cycle in one paragraph: at the open, premium
is mostly *time value* — you're paying for ~6.5 hours of possible
movement. By 11:00 you've burned ~25 % of that time value even if
price hasn't moved. By 13:30 you've burned ~60 %. After 15:30 the
remaining ~$0.05–$0.30 is pure intrinsic-or-zero — a binary outcome.
This is why the system forces flat by 15:30.

## The intraday theta clock

Concrete observed rates of theta acceleration on SPY 0DTE ATM:

| Window | Approx. theta vs. morning baseline | What this means |
|---|---|---|
| 09:30 – 11:00 | 1.0× | Normal decay. Holding losers is expensive but survivable. |
| 11:00 – 12:00 | 1.5× | Decay picks up. Trim winners; cut losers fast. |
| 12:00 – 13:00 | 2× | Lunch chop + theta = double leak. Black-out window. |
| 13:00 – 14:30 | 2–4× | Theta scalper's prime; sniper's danger zone unless trending. |
| 14:30 – 15:30 | 4–6× | Premium evaporates between candles. Tight management or out. |
| 15:30 – 16:00 | 6–10×+ | Binary. *Not a trading window for sniper.* |

When the rule in `06-risk-rules.md` says "20-minute time stop in the
morning, 10-minute time stop after 14:00 ET" — this table is why.

## Gamma is your edge, gamma is your risk

Gamma at ATM 0DTE is so high that **a 1-point SPY move can swing a
$1.20 option to $2.50** (entry on a clean rung break) — but the
same gamma takes you from $1.20 to $0.40 on a 1-point adverse move.

**The asymmetry is structural.** Each unit of distance pays you more
or hurts you more than it would on 30-DTE options. So:

- **Right side:** ~+100–250 % gain on a TARGET_1 hit (= 1 rung).
- **Wrong side:** ~−40–60 % on the same distance moved against.

The system's hard −40 % premium stop matches this. Beyond −40 %, you
are typically inside the kind of move that doesn't come back even if
the chart re-aligns.

## Dealer hedging — what your option is *doing* in the market

When you buy a 0DTE SPY call:

1. A market maker sells it to you. They are now **short the call**.
2. To stay delta-neutral, they buy SPY (or futures, or correlated
   ETFs) proportional to the call's delta.
3. If SPY rises and your delta grows from 0.50 → 0.80, the dealer
   buys *more* SPY to maintain neutral. This buying *adds to* the
   price action — they are short gamma.
4. The reverse if SPY falls: they sell SPY into weakness. Pro-cyclical.

In aggregate, when net dealer gamma is negative (the regime sniper
likes), every 1-point SPY move generates *more* dealer buying or
selling in the same direction. This is the "trending regime" tail
wind. Your level breaks have momentum behind them because the dealer
machinery is amplifying.

When dealer gamma is positive (the regime sniper avoids), dealers
hedge *against* price moves — sell rips, buy dips. Levels that
"should" break get absorbed and rejected. You're fighting the entire
options-market plumbing.

This is the foundational reason `03-gex-vex-overlay.md` exists.

## The 0DTE-specific gamma flip caveat

There is **regime ambiguity** that bites people. SPY's all-expiration
GEX can show positive net while *the 0DTE slice alone* is deeply
negative — i.e., the broader chain has the dealers long gamma, but
just-today's contracts have them short gamma.

For an intraday SPY/QQQ sniper, **what matters is the 0DTE-only GEX**
between 12:30 and 15:30 ET. The OpenClaw v11 dashboard in `apps/gex`
should be filterable by expiration. If it isn't, that's a Phase 1
fix on the build list in `07-automation.md`.

## Vega → vanna — why "negative vanna + rising IV" is the call holy grail

You already have the rule from `03-gex-vex-overlay.md`. The math:

- Net dealer vanna negative means dealers are short ∂Δ/∂σ.
- When IV rises (vol expansion), the dealers' short positions become
  more sensitive to direction — their existing delta hedge under-
  hedges. They must buy more deltas.
- For an upside move: they buy more SPY → calls rally faster than
  delta alone would predict.

This is the mechanical bid that makes break-out longs in a negative-
vanna, rising-IV environment so productive. The post-FOMC vanna rally
is the canonical *swing* example (1–3 day bid). Intraday it's the
"rip the open" days you've all seen — VIX up 1–2 points and SPY rips
through every wall.

The mirror on the downside is the **gamma cascade**: negative gamma +
falling spot + rising VIX = dealer selling = SPY waterfall. *That* is
when put snipes pay 300 %.

## Charm exposure (CHEX) — the 1 PM signal

Charm (∂Δ/∂t) is how delta erodes as time passes. For 0DTE this
becomes mechanically dominant in the afternoon.

**The signal:** at ~13:00 ET, check the sign of total dealer charm
exposure:

- **Negative CHEX (dealers short charm)** → as delta of OTM calls
  decays toward zero, dealers unwind hedges by *buying* SPY → upward
  drift into the close. Bullish bias for the afternoon.
- **Positive CHEX** → mirror; bearish drift into the close.

The 1 PM CHEX read should be added as a **size modifier** on
afternoon snipes:

- Snipe in the direction of CHEX drift: full size.
- Snipe against the direction of CHEX drift: half size, exit at TP1.

Plumb this into the GEX dashboard as a separate row. It's a 5-second
check.

## The "four-Greek confluence" A++ setup

The highest-conviction setup, which you might see once every 2–3
weeks:

- **Net GEX** supports direction (negative for longs, positive at
  wall for short rejections)
- **DEX** (delta exposure) centered near current price (high gamma
  punch zone)
- **VEX** with falling IV in your direction (or rising for breakouts)
- **CHEX** afternoon drift matches direction

When all four align, the dealer flow stack is fully behind the move.
This is the only setup where the system permits **2× sizing**.
Override the `05-execution.md` cap. You can't manufacture this read —
it just appears occasionally, usually post-FOMC or after a clean gap
fill.

## Strike-delta cheat sheet (SPY, 0DTE, mid-morning)

The premium math you need on the fly to set TPs:

| Strike vs. spot | Approx. delta | Approx. premium | Expected premium at +1 SPY pt | Expected at −1 |
|---|---|---|---|---|
| ATM (Δ ≈ 0.50) | 0.45 – 0.55 | $1.00 – $1.40 | $1.80 – $2.30 (+80 %) | $0.50 – $0.70 (−45 %) |
| +1 OTM (Δ ≈ 0.35) | 0.30 – 0.40 | $0.60 – $0.85 | $1.30 – $1.70 (+115 %) | $0.25 – $0.40 (−55 %) |
| +2 OTM (Δ ≈ 0.20) | 0.18 – 0.25 | $0.30 – $0.50 | $0.80 – $1.10 (+150 %) | $0.10 – $0.20 (−65 %) |

These numbers shift through the day as theta burns and IV moves —
treat them as orders of magnitude, not quotes. But the **shape** is
permanent: further OTM pays more on the move and hurts more on the
fail. Use this to choose strike per `05-execution.md`.

## When 0DTE is the wrong tool

- If the next rung is > 2 points away on SPY (or > 3 on QQQ) AND
  you're entering after 13:00 ET, **use 1DTE**. Theta is going to
  outrun price.
- If IV is crushing (post-FOMC vol crush, post-earnings index calm),
  switch to 1DTE or even take spot/futures exposure — long vega on a
  0DTE is dead money.
- Around CPI/FOMC/PPI day, 0DTE pricing is so dislocated by event
  premium that a directional bet costs 2–3× normal. 1DTE that
  *includes* the event date is similarly inflated. Use 2DTE that
  starts after the event, or wait until 10:00 ET post-release.

## Summary mental model

> "0DTE is gamma in a bottle. The bottle leaks (theta). You uncork
> only when the wind is at your back (level + EMA + dealer flow).
> You drink fast and recap before 15:30."

Every rule in the sniper folder is a corollary of that sentence.
