# DOCTRINE — the Skylit rulebook, distilled and encodable

Source of truth: Skylit Academy (12 chapters, `apps/gex/docs/skylit-academy.md`) + Skylit Heatseeker field guide / Patternpedia. Nothing in this file comes from our own prior studies. Every rule below is written so an agent can check it.

---

## 0. The three sentences that govern everything
1. **Charts first. Heatseeker confirms.** The chart creates the thesis; the map says whether dealer positioning supports it. Map without chart = noise.
2. **The edge is execution at the deflection.** We enter at the direct tap of a major node, with a tight stop and a generous target. We do not chase, we do not anticipate, we do not trade midpoints.
3. **The system must align.** SPX, SPY, QQQ are one exposure engine. No confluence → no trade.

---

## 1. The map: what a node is
- A **node** = concentrated dealer exposure at a strike. Read **magnitude first, sign second.**
- **Sign = behavior, not direction.**
  - **Pika (positive gamma, yellow):** dealers buy dips / sell rips → dampens, pins, chops. Clean deflections, slow travel.
  - **Barney (negative gamma, purple):** dealers hedge *with* the move → amplifies, overshoots, wicky, fast travel. **Purple does NOT mean bearish.**
- **Absolute Value Rule:** the biggest |exposure| node wins regardless of color. Bigger and closer = stronger pull.

## 2. Node hierarchy (identify in this order, every time)
1. **Spot** — where is price.
2. **King** — largest |exposure| on the board. Structural center of gravity; where MMs most want to pin into the close. Can be pika or barney.
3. **Floor** — largest node *below* spot (support). **Ceiling** — largest node *above* spot (resistance).
4. **Gatekeepers** — intermediate nodes between major nodes; checkpoints that decide whether price can transit to the next zone.
5. **Air pockets** — zones of thin/absent exposure. Pathways, **not targets.** Negative-gamma air pocket = violent travel; positive-gamma air pocket = slow drift.
6. **Midpoint** — halfway between two major nodes. **Never trade it.** R:R there is ≤1:1 and doctrine requires 3:1.

## 3. Regime (tells you HOW price moves, never WHICH WAY)
- `regime = Σ(signed exposure near spot) / Σ|exposure|`; label positive / negative / mixed.
- **Positive gamma:** slower, pinned, levels hold, failed breakouts, mean reversion. → **Fade extremes. Quick in/out. Theta burns here.**
- **Negative gamma:** fast, overshoots, levels knife through, air pockets fill aggressively. → **Assume overshoot first. Never fade velocity. Follow continuation; don't fade blindly.**
- **Regime is NOT a direction gate.** Direction comes from chart structure + node accumulation + reshuffles.

## 4. Day types (classify before 9:45, re-classify on reshuffle)
| Day | Signature | How to trade |
|---|---|---|
| **Range / Chop** (usually +gamma) | price between a floor and ceiling; Trinity not aligned (1 up / 1 down / 1 pinned) | fade the **extreme ends only**; respect both sides; no chasing |
| **Trend** (usually −gamma) | nodes far from spot with rapid accumulation; Velocity one-directional; air pockets; king growing fast; **floors rolling up / ceilings rolling down** | don't fade strength; if entry missed, wait for a clear pivot (e.g. king target hit); structure in direction of move |
| **Whipsaw** (−gamma + air pockets + index divergence) | fast moves through barney nodes, chaos, no Trinity confluence, violent reversals at range ends | play extreme ends only; **when in doubt, sit out** |
| **Rainbow Road** | no dominant nodes, no floor/ceiling, no bias | **NO TRADE** |

## 5. Patterns (behavior, never signals; always read with magnitude + regime + Trinity)
| Pattern | Structure (relative to spot) | Behavior | Bias |
|---|---|---|---|
| **Rug** | pika ABOVE, barney directly below it, spot below the pika | rejection at the pika + acceleration down through the barney | bearish — buy puts **at the tap of the pika ceiling** |
| **Reverse Rug** | barney ABOVE, pika BELOW, spot above the pika | pika deflects up, barney amplifies the bounce | bullish — buy calls **at the tap of the pika floor**. **Never fade a reverse rug.** |
| **Pika Cloud** | ≥3 adjacent pika nodes | gravity well: price sticks, rotates, inefficient | neutral; friction; don't trade *through* it; fade its edges |
| **Beach Ball** | price overshoots a big node then stalls | overshoot → reaction → reversion | **not a breakout.** Trade the snap-back after the stall, never the push-through |
| **Whipsaw** | conflicting Trinity, convoluted map, ranges still exist | fake moves, both sides trapped | fade extremes only |
| **Rainbow Road** | no structure at all | random | no trade |

**Pattern interaction:** magnitude overrides pattern; a Rug on QQQ with a Pika Cloud below on SPY = slow/partial move, not a clean dump. Hierarchy of influence: **1 magnitude → 2 regime → 3 pattern → 4 cross-index.**

## 6. The map is alive (read the reshuffle, not the snapshot)
- **Rolling floor up** = downside being removed → bullish evidence. **Rolling ceiling down** = upside being capped → bearish evidence. *"If upside targets are shrinking, why am I still bullish?"*
- Rolling is a **positioning event**, not a breakout and not a continuation trigger. The trade is still the reversal at the edge.
- **Rate of change = fuel.** Air pocket + stable positioning = drift. Air pocket + rapid accumulation (Velocity) = acceleration. **Position before velocity; never fade inside it.**
- **Growth = intent; decay = protection.** Far-OTM big nodes that don't grow are hedge nodes (traps), not targets. Only *growing* nodes with a structural pathway are targets.
- **Node lifecycle:** Fresh (full strength) → Tested → Delivered (did its job, weaker) → Decaying. **We do business at fresh nodes. We do not target used levels.** Exceptions: double bottoms, S/R flips.
- **Tap decay:** 1st tap strongest, 2nd still tradable, 3rd weak. Each tap consumes liquidity.
- **Delivery:** price is delivered node → node through structure. Near nodes = pathway; far nodes = possibility. Price does not teleport.
- **Stairstepping:** floors rising / ceilings reclaimed week over week = trend being built by positioning.

## 7. Trinity (SPX / SPY / QQQ)
- SPX = institutional hedging, SPY = liquidity/flow, QQQ = tech. Three expressions of one engine; the springs are connected.
- **Full alignment** (3/3) = high probability. **Partial** (2/3, the bare minimum) = playable, reduced size. **Divergence** = warning, not opportunity → reduce or pass.
- A target is valid only if the *system* supports delivery to it.

## 8. Execution (the only thing that produces P&L)
- **Entry = direct tap of a major node** that is part of a recognized setup, in the direction of the chart thesis, with Trinity alignment. *"The pattern is the prediction; the tap is the trigger."*
- **Deflection zone:** ±$0.50 on SPY/QQQ, ±$5 on SPX.
- **Negative-gamma node:** expect overshoot first; enter as the overshoot **stalls**, not at the first touch. Overshoot does not invalidate the thesis — it strengthens it.
- **Stop:** break **and hold** one node beyond the played node (e.g. puts off 660 → stop above 661 on hold).
- **Target:** node-to-node — floor→ceiling, key level→key level. Structure, not a number.
- **R:R:** 3:1 standard (aim higher); 2:1 acceptable; below → no trade.
- **Non-negotiables:** no midpoints · assume overshoot in −gamma · no chasing · no aggressive 3rd taps · **no setup, no entry — let the map bring price to you.**
- **Positive-gamma pocket:** take profits fast (chop + theta). **Negative-gamma zone:** prepare for violent swings; size accordingly.

## 9. The real-time 9-step loop (Chapter 11 — the agent's main loop)
1. **Price** — trending or ranging? If price doesn't make sense, stop.
2. **Structure** — near support/resistance/range edge, or in the middle? *Is there a location worth attention?*
3. **Map** — nearest meaningful node, its strength, space around it. Does the map support the chart?
4. **Node quality** — strong? fresh or used? likely to react? (slow down here)
5. **Reaction type** — direct tap vs overshoot (barney → overshoot likelier). Prepare, don't predict.
6. **Regime** — clean or messy reactions? take profits fast or brace for swings?
7. **Path** — air pockets vs gatekeepers/pika clouds between here and the target.
8. **Trinity** — do SPX/SPY/QQQ agree?
9. **Decide** — everything lines up → trade. Anything off → wait or pass. **Skipping a step removes the edge.**

## 10. The A+ standard (what gets a trade)
1. Chart structure supports the thesis (charts first).
2. Heatseeker confluence: a recognized setup at a strong, fresh node.
3. Asymmetric R:R ≥ 3:1 with a one-node-beyond stop.
4. Entry is a **reaction** (deflection at the tap), never anticipation.
5. Trinity aligned (≥2/3).
6. Not a Rainbow Road / Whipsaw-midrange environment.
