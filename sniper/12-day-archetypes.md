# 12 — Day Archetypes & Edge Cases

By 10:30 ET — sometimes earlier — you can usually identify which of
seven archetypes today is going to be. The archetype determines:

- Which rungs you should expect to print
- How aggressively to size
- Whether to push for the extension or take TP1 only
- Whether the day is sniper-friendly at all

This is the *meta-filter* that sits above everything else in this
folder. On the wrong archetype, even a perfect signal-stack score
gives you back the win.

## The seven archetypes

| Archetype | Profile shape | Identify by | Sniper posture |
|---|---|---|---|
| **Trend Day** | Vertical, one-sided | Open-drive away from prior close; first IB extends 1.5× IB range in same direction | **Max aggression.** Snipe every aligned rung. Extension targets hit. |
| **Double-Distribution Trend** | Two stacked balances with a thin neck between | First balance for ~60–90 min, then break, then 2nd balance higher/lower | Snipe the break out of balance 1; expect a pause; re-enter on break of balance 2. |
| **Normal Day** | Bell shape with 85 %+ range in IB | IB extends < 0.3× IB range; afternoon chops | Take TP1 only on the early reclaim/failure. Skip everything after 11:30. |
| **Normal Variation** | Bell with one moderate extension | IB extends 0.3–0.8× IB range then balances | TP1 + TP2 on the extension side. No extension target. |
| **Neutral Day** | Range extension both sides | Reclaim *and* failure both confirm, then both fail | **Hostile.** Skip after the second failed rung. |
| **Non-Trend Day** | Very narrow range, flat profile | IB < 0.5× yesterday's IB; coil all day | **Skip the day.** No rungs print cleanly. |
| **P-shape / b-shape** | Long stem then balance | Sharp morning move, then sideways at the new level | TP1 + maybe TP2; trim aggressively. Don't chase extension into balance. |

## Empirical prior — NEG regime morning bias (validated 12 months)

**Before 10:30 ET you already have one signal: the morning GEX regime.** Empirically (see [validation/REPORT.md](validation/REPORT.md)):

| Morning GEX read at 09:25 | SPY trend day rate | QQQ trend day rate |
|---|---|---|
| Positive net GEX | 11.9 % | 5.9 % |
| **Negative net GEX** | **18.2 %** | **26.2 %** |
| Ratio NEG / POS | 1.5 × | **4.4 ×** |

The NEG-regime bump is biggest in QQQ — when QQQ shows negative net GEX at 09:25 ET, the prior probability of a Trend Day is **4.4× higher** than under positive GEX. SPY's effect is real but smaller.

Use this as a *prior* on archetype call, not a determinant. The 10:30 IB extension still decides — but a NEG-regime morning gives you permission to *lean* toward Trend Day expectation an hour earlier, and that translates directly to sizing aggressiveness.

**Practical sizing rule:**
- NEG regime + first 15-min IB extending in one direction → assume Trend Day, size at 1.5× from the first rung.
- POS regime + first 15-min IB tight → assume Normal Day, TP1 only.

## How to identify by 10:30 ET

Check these in sequence at the bottom of the first hour (10:30 ET):

```
1. Where is SPY relative to the prior-day VAH / VAL?
   - Above VAH, holding: bias TREND UP
   - Below VAL, holding: bias TREND DOWN
   - Inside value: bias NORMAL / NEUTRAL

2. Did the open drive away from prior close in one direction with
   minimal pullback?
   - Yes, > 0.3 % move: TREND or DOUBLE-DISTRIBUTION
   - Yes, but pulled back through open: NORMAL or NORMAL VARIATION
   - No, oscillated around open: NEUTRAL or NON-TREND

3. How far has IB extended?
   - > 1.5× IB range one way: TREND DAY confirmed
   - 0.3 – 0.8× IB: NORMAL VARIATION
   - < 0.3×: NORMAL / NON-TREND
   - Extension both sides: NEUTRAL

4. Internals confirmation:
   - ADD strongly trending: supports TREND
   - ADD flat at zero: supports NORMAL / NON-TREND
   - ADD reversing intraday: supports NEUTRAL or DOUBLE-DIST
```

You will rarely be 100 % certain by 10:30. The right move is to
*lean* into the most-likely archetype and adjust as the day
develops. The penalty for getting it wrong is small if you obey the
per-trade rules — but the *upside* of correctly identifying a Trend
Day early is enormous (full size, extension target = 3R+ trade).

## The Trend Day playbook

Sniper's best day. SPY/QQQ have ~50 trend days per year by classical
definitions. They produce the bulk of P&L.

**Signature:**
- Open-drive in one direction within the first 15 min
- 1m 8 EMA never gets crossed (or only briefly)
- 5m 8 EMA holds as support all day for longs (mirror for shorts)
- ADD rising / falling all session

**Action:**
- Take *every* aligned rung snipe.
- Use 1.5× size on score 5/6+.
- Run TP3 to extension on every trade.
- Trail with 1m 8 EMA, don't TP early past TP1.
- Re-enter on every 5m 8 EMA bounce, even outside of a posted rung.

**Internals signature:**
- ADD trending strongly in direction
- TICK series of +800/+1000 prints with few prints opposite
- VOLD confirming with size

## The Double-Distribution Trend playbook

Most common Trend Day variant: open is quiet, then mid-morning breaks
out of the morning balance, builds a second balance higher (or
lower), then trends from there.

**Signature:**
- IB builds for ~60 min as a tight balance
- Around 11:00 ET, breaks out with volume
- Spends 11:30 – 14:00 building a second balance at the new level
- 14:00 – 16:00 trends again

**Action:**
- Snipe the IB break (the rung will usually be IB high/low + 0.20).
- TP1 at first extension; pyramid is OK once.
- Wait for the second balance to build — **do not chase**.
- Snipe the break of the second balance with full size.

This is the day where pyramiding on break-confirm makes the most
money. Look for this shape — it's distinctive once you see it twice.

## The Normal Day playbook

Most days are Normal Days — the move happens in the first hour and
then nothing.

**Signature:**
- IB has the high and low of the day
- Afternoon chops around mid-IB
- ADD flat, internals neutral

**Action:**
- Snipe early. Take whichever rung confirms in the first hour.
- TP1 only. Do not pyramid. Do not run TP2 or TP3.
- After 11:30 ET, **stop trading.** The day is over.

This is the discipline test. New traders try to trade the chop and
give back the morning win. The system explicitly forbids this.

## The Neutral Day — the trap

**Signature:**
- Reclaim above pivot confirms, runs to TP1, then *fails*.
- Failure below pivot confirms, runs to TP1 down, then *fails*.
- Both sides print rejection candles.
- Internals (TICK/ADD/VOLD) oscillate without trend.

**Action:**
- Take the first signal if it scores 4/6 — take TP1, exit fully.
- **Do not take the second signal**, no matter the score. The
  archetype is established as Neutral.
- Walk away by lunch.

Two-sided Neutral Days are the source of most over-trading. The
mental rule is: *if my second snipe today is opposite-direction from
my first snipe today, the day is Neutral, and the second snipe is
the trap.*

## The Non-Trend Day — skip

**Signature:**
- IB is less than half of yesterday's IB range
- Price chops within ±0.15 % of open all morning
- ADD pegged near zero
- 1m 8 EMA crosses 21 EMA repeatedly with no follow-through

**Action:**
- Close the platform by 11:00 ET.
- Don't fabricate trades. The market is telling you "no edge today."

Non-trend days happen often — quad-witch close-out days, week-of-
Christmas, holiday-shortened sessions, summer Fridays. Skipping them
is alpha.

## Calendar overlay — predictable archetype probabilities

| Day / event | Most-likely archetype |
|---|---|
| FOMC release day, morning | NEUTRAL until 14:00; then TREND in second move |
| Day after FOMC | TREND in the FOMC second-move direction |
| CPI / PPI release | TREND from 08:35 ET; sniper opens at 10:00 |
| NFP Friday | TREND or DOUBLE-DIST in opening direction |
| OPEX Friday | NORMAL or NON-TREND (pinning) |
| Quad-witch | NEUTRAL / NON-TREND morning; TREND last 90 min |
| Week before Christmas | NON-TREND |
| Week after Thanksgiving (Mon) | NORMAL VARIATION |
| Earnings-week Mondays | TREND days more common than baseline |
| Mid-week of low-vol regime | NON-TREND / NORMAL bias |

Use these probabilities as **size adjustments only**, not as
direction calls. A FOMC day biased toward NEUTRAL until 14:00 means
you sit on your hands until 14:30, regardless of what the chart shows.

## The "I'm wrong about the archetype" recovery

You called Trend Day at 10:30. By 12:30 it's clearly Neutral. What
do you do?

1. **Close any open Trend-Day-sized positions immediately**, even at
   modest profit.
2. **Reduce all subsequent sizing to 0.5×** for the day.
3. **Skip the second rung** entirely. Don't try to "play the chop."
4. **Walk away by 13:00 ET.**

Bad archetype calls happen ~20 % of the time. Recovering quickly is
worth more than getting the original call right.

## Edge case — overnight gap morning

**Empirically calibrated against 249 SPY/QQQ trading days** (see [validation/REPORT.md](validation/REPORT.md)). The original "80 % gaps fill by noon" rule from third-party research **did not survive validation on this data** — the real picture is asymmetric by direction.

### Same-day fill rate by gap size and direction (May 2025 – May 2026)

| Gap | SPY fill | QQQ fill | Implication |
|---|---|---|---|
| Small gap UP (0.15 – 0.5 %) | **44 %** | **43 %** | Continues > fills. **Don't fade.** |
| Medium gap UP (0.5 – 1.0 %) | 52 % | 51 % | Coin flip. No bias. |
| Big gap UP (> 1.0 %) | 50 % | 59 % | Slight fade bias on QQQ only. |
| Small gap DOWN (-0.5 to -0.15 %) | 57 % | 58 % | Fills more than continues. |
| Big gap DOWN (< -1.0 %) | **67 %** | **67 %** | Reliable bullish reversal. |

**Rules that survive the data:**

- **Small gap up (< 0.5 %)**: bias *with* the gap, not against. Sniper preference: take the bull-side rungs first; the failure trigger has a *worse* base rate than the reclaim.
- **Any gap down**: bias *with* the fill direction (i.e., upward reversal). Bigger gap down = stronger reversal bias.
- **Big gap up (> 1 %)**: treat as Trend Day candidate until proven otherwise — the macro driver doesn't reverse on a whim.
- **Big gap down (> 1 %)**: tradeable bullish reversal — but time the bottom with the EMA stack and confluence, don't buy the first dip.

### What is NOT validated

- Day-of-week gap effects ("Monday gap-down doesn't fade", "Wednesday gap-up extends") come from third-party research and **were not separately confirmed** in this sample. Treat as weak priors until validated independently.
- Intraday gap-fill rate (price tagging prior close briefly intraday but closing elsewhere) is higher than the close-vs-open numbers above. We don't have 1m bars across 12 months to test it cleanly.

Add a "gap" indicator to the `/sniper` morning panel that uses the validated rates:

```
GAP: -1.2 % from y'day close   →  fill bias: STRONG BULLISH REVERSAL
     prior close: 738.65       →  target: 738.65 (close > open)
     empirical fill rate at this size: 67 %  [SPY 12mo]
```

## Edge case — opening-range breakout (ORB) overlay

A separate body of research shows that a clean 0DTE opening-range
breakout with a 60-minute range produces ~89 % win rate using short
credit spreads — but that's a *theta* strategy, not a sniper strategy.

For our directional sniper, ORB is best used as **archetype
confirmation**:

- ORB of the 15-min IB high in the first hour with strong internals
  = TREND DAY confirmed → full aggression.
- ORB that retraces back inside the IB within 30 min = false break,
  archetype is NEUTRAL → step down sizing.

In other words: the 15-min IB high/low is itself a *synthetic rung*
you can trade even when Rapid doesn't post one within 0.1 % of it.
Add IB high/low to the ladder display.

## Summary decision tree

```
By 10:30 ET, ask:
├─ Did open drive away from prior close in one direction?
│  ├─ Yes, with internals confirming → TREND or DOUBLE-DIST
│  │  └─ Snipe all aligned rungs, full extension.
│  └─ Yes, but internals weak → NORMAL VARIATION
│     └─ TP1 + TP2 only; no extension.
├─ Did open oscillate inside prior-day value?
│  ├─ IB extended < 0.3× → NORMAL or NON-TREND
│  │  ├─ Internals trending → NORMAL: TP1 only, then stop.
│  │  └─ Internals flat → NON-TREND: skip the day.
│  └─ IB extended both sides → NEUTRAL
│     └─ First snipe only; walk by lunch.
└─ Gap day with strong gap-fill probability?
   ├─ < 0.5 % gap → bias the fill direction; expect NORMAL
   └─ > 1 % gap → no fade; expect TREND in gap direction
```

This tree should be displayed at the top of the `/sniper` UI from
10:00 ET onward — color-coded by archetype call — so the sizing knob
auto-adjusts.
