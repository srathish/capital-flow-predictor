# 11 — Internals & VWAP Overlay

Up to this point the sniper stack has been: ladder + EMA + GEX/VEX.
This file adds two further confluence inputs that practitioner day-
traders use to filter false breakouts on index ETFs:

1. **Market internals** — NYSE TICK, ADD, VOLD.
2. **VWAP** — daily, anchored, and bands.

These are *confluence layers*, not entry triggers. They go in the
signal stack as **score modifiers**, not as new mandatory checks.

## Why internals matter for SPY / QQQ specifically

SPY and QQQ are *indices*. A 1m candle on SPY is the volume-weighted
behavior of 500 names. A 1m candle can look bullish (close above 1m
8 EMA) while *only 80 of 500 names are participating*. That's a
narrow-breadth rally — which historically *fades* during the
afternoon.

Internals tell you whether the rally / sell-off you're sniping has
the rest of the market behind it.

## The three internals you need

### NYSE TICK ($TICK)

Count of NYSE stocks ticking up *now* minus those ticking down. Range
oscillates roughly −1000 to +1000.

**Reading:**

| Print | Meaning |
|---|---|
| > +800 | Strong institutional buying (program trades active) |
| +600 to +800 | Moderate buying |
| ±400 | Neutral chop |
| −600 to −800 | Moderate selling |
| < −800 | Strong institutional selling |

**Patterns:**

- **Series of +800 prints with few prints below −300** = sustained
  buying flow. Bullish.
- **Each successive high in price = lower TICK print** (e.g., +900,
  then +700, then +500) = *fading TICK* — momentum dying. Bearish
  divergence.
- **Selloff lows getting less negative** (e.g., −900 → −500) =
  rising TICK floor. Reversal forming.
- **First TICK above +1000 after a long downmove** = often the
  initial-spike before a reversal. Treat as exhaustion, not entry.

### ADD (NYSE Advance-Decline, $ADD)

Cumulative count of advancing stocks minus declining stocks. Builds
through the session. Trend is more important than the absolute level.

**Reading:**

- **ADD rising from open with shallow dips** = broad participation.
- **ADD falling steadily** = broad selling.
- **ADD flat near zero** = chop / day-type Neutral or Non-Trend.

**Divergence — the highest-value signal:**

| Setup | Action |
|---|---|
| SPY new high but ADD already peaked and declining | **Exit longs**; bearish divergence. Skip new long snipes. |
| SPY new low but ADD already bottomed and recovering | **Exit shorts**; bullish divergence. Skip new short snipes. |

### VOLD (Volume Advance-Decline, $VOLD)

Net volume on advancing stocks vs. declining stocks. Acts as the
**tiebreaker** when ADD and TICK disagree — it weights the breadth
read by actual dollars behind each side.

**Reading:**

- **VOLD confirms ADD** → high-conviction trade.
- **VOLD contradicts ADD** (e.g., ADD positive but VOLD negative) →
  the advancers are small-caps with no real money; the decliners are
  mega-caps with real money. Reduce size or skip.

## The internals 3-pillar rule

Before entering a snipe, check:

1. ADD trend supports direction.
2. TICK pattern supports direction (no fading, no climax-flip).
3. VOLD confirms ADD.

**If 3 of 3 align → +1 stack point (bonus).**
**If 2 of 3 align → 0 (neutral).**
**If 1 of 3 aligns → −1 stack point (warning, but not veto).**
**If 0 of 3 align → veto.** Don't trade against the entire market.

This becomes a 6th input on the signal stack:

| # | Input | Source | Range |
|---|---|---|---|
| 6 | Internals 3-pillar | TICK/ADD/VOLD | −1 to +1 |

So max signal score becomes **6**. Re-baseline thresholds:

| Score (out of 6) | Action |
|---|---|
| 6 / 6 | A++ — 1.5× to 2× sizing, pyramid OK |
| 5 / 6 | A+ — full size |
| 4 / 6 | A — full size, no pyramid |
| 3 / 6 | B — half size, 1–2DTE only |
| ≤ 2 / 6 | No trade |

## VWAP overlay

VWAP is the **volume-weighted intraday mean**. It is heavily used as
a benchmark by institutional algos — which means it tends to act as a
self-fulfilling pivot.

### Three VWAPs to plot

1. **Session VWAP** (resets at 09:30 ET each day) — the standard.
2. **Anchored VWAP from yesterday's close** — gives you a "true"
   reference that includes the overnight gap.
3. **Anchored VWAP from major intraday inflection** (e.g., FOMC
   release time, or the day's pivot rejection) — adapts to news.

### VWAP bands (1 standard deviation)

Plot +1 σ and −1 σ bands. They give you a mean-reversion target on
non-trending days, and a "rejection zone" on trending days.

### How VWAP integrates with the ladder

The sniper edge case where VWAP matters most:

- **VWAP coincides with a rung** (within 0.20 SPY pts) → that rung's
  confluence score gets a **+0.5 boost** (round up to +1 if it
  pushes score across a threshold).
- **VWAP is on the *wrong* side of your trade** (e.g., long below
  VWAP) → reduce DTE by one. Take 1DTE instead of 0DTE, or 2DTE
  instead of 1DTE. The institutional flow is leaning against you.
- **Price oscillates around VWAP without expansion** (within ±0.3 σ
  for 30+ min) → day-type is Neutral / Non-Trend. Reduce size 50 %
  on any snipe; skip extension targets.

### VWAP bounces as the +1 internals tilt

Specific high-edge sub-setup: SPY pulls back to VWAP from above,
TICK drops to −600 then *starts recovering*. This is a known
mean-reversion long with strong empirical support. If a *Rapid rung*
sits within 0.2 SPY pts of VWAP at that moment, you have:

- Rung confirmation pending
- TICK floor rising (bullish internals)
- VWAP defended (institutional bid)

That's the kind of confluence the system was built for.

## Internals on FOMC / event days

**Override rule:**

- Before 14:00 ET on FOMC day: **ignore internals**. They will
  whipsaw on rumor / hedging flows.
- After the 14:00 release: take the first stable 15-min read. If
  ADD reverses direction post-release, *expect* a multi-hour move in
  that direction (the standard "second move" after FOMC).

Internals on FOMC day are higher-information *after* the release than
before. Plan to evaluate at 14:30 ET, not before.

## Where to source the data

| Feed | Cost | Pros | Cons |
|---|---|---|---|
| ThinkOrSwim ($TICK, $ADD, $VOLD symbols) | Free with TDA acct | Easy, real-time | Polling-only, no API |
| Polygon.io | Paid tier | API + WS | Internals are derived; check coverage |
| TradingView | Paid tier | All three native | No API access to feeds |
| IBKR | Free with acct | Real-time | Limited polling, derived feeds |

For automation in `apps/web /sniper`, the cleanest path is:

- Subscribe to a TICK/ADD/VOLD feed via Polygon or Tradier
- Push 1-minute snapshots through your existing `apps/uw_socket`
- Render as small histograms in the stack panel:

```
TICK   ▌▌▌█▌  +720  [BULLISH]
ADD    ▌█▌█▌▌  +1450 rising  [BULLISH]
VOLD   ▌▌█▌▌  +0.92B  [BULLISH]
3-pillar: ✅✅✅  (+1)
```

That 3-line block is the entire internals contribution to the
decision. The user shouldn't have to look at a separate platform.

## What internals *don't* tell you

- They don't tell you *where* to act — the ladder does.
- They don't tell you direction at the moment — the EMA stack does.
- They don't tell you regime — GEX does.
- They tell you whether the move you're about to snipe is **real or
  artificial** — that's their entire job.

A clean ladder break against weak internals is the most common false-
breakout pattern on SPY. Adding this 6th input is the single biggest
improvement you can make to hit rate.
