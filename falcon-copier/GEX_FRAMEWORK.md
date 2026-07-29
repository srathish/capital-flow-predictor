# GEX/VEX framework — why our reversal system failed, and the redesign (research-grounded)

Sources: SpotGamma (gex playbook, put/call wall mechanics), MenthorQ (dealer hedging,
2nd-order greeks), zerogex/vcalgo (vanna/charm), InsiderFinance/Cboe. 2026-07-29.

## The one variable we were missing: the GAMMA FLIP / regime
Reversal-vs-breakout is **not** a property of the node — it's set by the **gamma regime**:
- **Positive gamma (spot ABOVE the flip):** dealers sell rallies / buy dips → vol compresses →
  **MEAN-REVERSION. Nodes HOLD. Reversals work. Price pins to the largest-gamma strike (the king).**
- **Negative gamma (spot BELOW the flip):** dealers buy rallies / sell dips → vol expands →
  **MOMENTUM. Nodes BREAK. Trends run for hours. Reversals FAIL.**
- The **flip level** (net gamma crosses zero) is the switch. Crossing it changes the whole tape:
  +→− = mean-reverting turns trending; −→+ = trending turns to a grind/pin.

**Our error:** we took reversals in ALL regimes and at ANY pika. In negative-gamma zones the walls
broke through us — that's the −$5,566 (07-10) and −$4,408 (07-16) days.

## The reversal-vs-breakout rules (SpotGamma playbook)
- **Reversal valid when:** price approaches a wall UNDER MATCHING REGIME (call wall + positive gamma =
  short the rally, tight stop above; put wall = long the dip toward the king) AND momentum
  **decelerates** at the level AND it **holds on the test**. Target = back toward the king/pin.
- **Breakout valid when:** price crosses the **flip level on VOLUME and holds 5 minutes past it**;
  momentum accelerates through the wall; in negative gamma, breakdowns trend for hours.
- **INVALIDATION (skip/exit):**
  - a wall **tested repeatedly without rejection** → "customer-held, not dealer-hedged" → it will BREAK.
    (This is EXACTLY our 07-10 2nd-tap of 7555 and 07-16 3rd-tap of 7540 — the losers.)
  - **VIX moves >10% intraday** (headline shock / vol-regime shift).
  - **false flip** that reverses within 10 min **without volume**.

## Vanna / charm (the leading, non-lagging layer)
- **Charm** (delta decay w/ time) → a **scheduled EOD drift**: into the close, deltas slide to 0/1 and
  dealers rebalance, accelerating the morning→afternoon move toward the pin (positive gamma) or the
  trend (negative gamma). Time-based ⇒ genuinely leading. Strongest into OPEX/close.
- **Vanna** (delta sens. to IV) → dealer flow when IV moves; dominates on headline-light days.
- Matches our own only-survivor finding: **vanna-velocity** (OOS AUC 0.658).

## Why "GEX-mechanical" backtests keep dying here (the honest meta-lesson)
Research consensus: GEX is a **probabilistic framework/filter, not a "price must go here" signal.**
"Most powerful when it ALIGNS with traditional technical levels." Which expirations you include
changes results materially. ⇒ a naive mechanical fader (what we built) has no edge; the edge is
regime + wall + confirmation (volume) + technical alignment.

## THE REDESIGN (keyed on the flip regime)
1. **Compute the flip level** (cumulative net g0 crosses zero) and which side spot is on. [have the data]
2. **Positive gamma (above flip):** fade the **actual walls** (largest pika above = call wall / below =
   put wall — NOT lesser nodes) toward the king, only when momentum decelerates at the wall.
3. **Negative gamma (below flip):** follow the trend / trade the flip-cross breakout **on volume**; don't fade.
4. **Gates:** skip a wall tested ≥2× without rejection (customer-held); skip if VIX >10% intraday;
   require **volume** to confirm a break.
5. **Charm tilt:** into the afternoon, lean with the charm drift (toward pin in +gamma / with trend in −gamma).

## Data we still need to build it right
- **Underlying 1-min VOLUME** (UW /stock/SPXW(SPY)/ohlc/1m has volume) — to confirm break-vs-fakeout.
- **VIX 1-min** — the >10% invalidation.
- (have: per-strike 0DTE g0 → flip level, walls, king; per-strike v0 → vanna.)

## Status
This is a *framework*, not yet a validated edge. But unlike the blind fader, it's grounded in dealer
mechanics and it EXPLAINS every failure we saw. Next: rebuild the sim keyed on the flip regime + pull
volume/VIX, then re-test on the 9 days. Clause 0: research only.
