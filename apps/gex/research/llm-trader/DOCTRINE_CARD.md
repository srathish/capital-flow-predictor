# Skylit Doctrine Card (LLM Trader)

Faithful compression of `apps/gex/docs/skylit-academy.md` (1764 lines). Loses no operative rule.
Scope: 0DTE index structure, SPXW / SPY / QQQ. Feed = **Skylit** surface JSON (per-strike gamma + vanna), NOT UW.
**Prime directive: Charts First → Heatseeker confirms.** Structure creates the thesis; the map confirms or denies it; never the reverse. Heatseeker is a confirmation tool, not a signal generator.

## 1. CORE VOCAB → FEED MAPPING
- **pika** = strike with `gamma > 0` (yellow). Dealers **long gamma** → buy dips / sell rips → **volatility-DAMPENING**.
  - Behaves as: gravity-well pins, chop, friction, mean-reversion, "pinned" tape.
- **barney** = strike with `gamma < 0` (purple). Dealers **short gamma** → hedge WITH the move (buy rips / sell dips) → **volatility-AMPLIFYING**.
  - Behaves as: acceleration, node overshoots, wicks, air-pocket fills. `sign = g>0?pika : g<0?barney : zero`.
- **king node** = strike with **max |gamma|** (either sign). Center of structural gravity; the strike MMs are most likely to **pin price into the NYSE close**.
  - Identify it FIRST. It never guarantees a stop — just the single most influential node.
- **relativeSignificance** = normalized |gamma| magnitude (0–100 scale). Drives floor/ceiling/gatekeeper selection. Magnitude, not sign, sets pull.
- **floor** = pika strike **below spot** with the largest relativeSignificance → support. Gives way if tested repeatedly.
- **ceiling** = pika strike **above spot** with the largest relativeSignificance → resistance.
- **gatekeeper** = smaller node **between two larger structural nodes**; a checkpoint. Clear it → advance to next zone; fail it → fall back to prior region.
- **air pocket** = contiguous low-significance strikes (weak GEX). A **pathway, not a target** — price travels fast through it.
- **liquidity vacuum** = extended air pocket (span ≥ ~3% of spot). Freeway vs a hallway; extended directional travel, minimal interruption.
- **pika cloud** = dense cluster of multiple pika nodes → gravity well; price sticks / rotates / struggles. Neutral — magnitude decides strength.
- **vanna** = separate per-strike VannaValues; **VEX king = max |vanna|**. Read for directional/rotational pressure and **persistence**.
  - Confirms or overrides the gamma read (e.g. vanna-persistent bear survives even after a gamma pin flips). Not a standalone entry.
- **gamma deltas (rate-of-change / Velocity Mode)** = Δ relativeSignificance across windows 30s / 1m / 5m / 15m / 30m / session, in percentage-points; classified growing / stable / decaying by pp-per-minute thresholds. This is **dealer urgency = fuel**.
  - **Real node** = growing on **5m AND 15m**. **Hedge node** = stable/decaying on 5m+15m, untested, and >3% from spot.
- **Dark-pool prints are directionless** (carry no side). Notional = conviction scale; price = a level that mattered.
  - Only interesting as **soft S/R when they line up with a dealer node** — that alignment is confluence.

## 2. THE REGIME READ (how price moves, never where)
- Regime tells you **HOW price travels between levels**, not direction. Purple ≠ bearish. Same map, different behavior by regime.
- **Positive gamma (pika-dominant):** slower, tighter rotations, levels hold, chop / ranges, mean-reverting, feels "pinned."
  - Trade style: fade extremes, quick in/out, precision, take profit fast (theta + chop). Don't force breakouts.
- **Negative gamma (barney-dominant):** fast, node overshoots, sharp bounces/rejections, air pockets fill aggressively, "wicky."
  - Trade style: assume overshoot FIRST, don't fade blindly, enter at the extreme as the overshoot stalls.
- Ask at the open: **"What market regime can we expect today?"** — that answer changes everything.
- **Types of day** (regime + structure):
  - **Range/Choppy** (usually +gamma): price between floor & ceiling, no trinity confluence, often sitting on a key level awaiting news → play **extreme ends of ranges ONLY**; don't chase reversals; sell premium only if experienced.
  - **Trend** (usually −gamma): nodes far from spot with rapid accumulation, king grows fast, floors/ceilings roll → don't fade strength; if you miss entry, **sit out until a clear pivot** (e.g. a king-node price target is hit); trade structure in the direction of the move.
  - **Whipsaw** (−gamma + air pockets): chaotic map, no confluence, violent reversals off extremes → fade extreme ends, wait for clarity. **When in doubt, sit out.**

## 3. STRUCTURE
- **Chart-level S/R (drawn before the map):** mark obvious swing highs/lows only (best levels spotted in <5s). Fresh (untapped) > tested; each tap degrades a level. Exceptions where a re-test is playable: **double bottom/top** and **S/R flip** (old resistance → support becomes "fresh" in its new role). Higher timeframes first (daily/weekly = highways); recent levels > old. **Trade extremes, avoid midpoints.**
- Read order: locate spot → king → largest node below (floor) → largest node above (ceiling) → air pockets → gatekeepers.
- **Node MAGNITUDE (not sign) sets pull strength.** Nodes are magnets: bigger = stronger pull, closer = stronger pull. Size over color, always.
- Approaching a **strong node:** price sticks, rotates, struggles (grinds through a crowd).
- Approaching an **air pocket:** fast, clean travel (runs through a hallway). Negative-gamma pocket → violent/sharp; positive-gamma pocket → mild/slow.
- **Midpoints** (halfway between major nodes): weakest hedging pressure, choppy, R:R at best 1:1 → **no edge, no trade.** We fade extremes, not midpoints.
- **Node lifecycle:** Fresh (untested, full strength — do business here) → Tested → Delivered (did its job, weaker pull) → Decaying.
  - **Target fresh positioning, not used levels.** Once liquidity is used, the level weakens.
- **Real vs hedge nodes:** Growth = intent (real target); decay = protection (hedge — often far OTM, large, fades over time, ignore).
  - Price does NOT teleport to a big far node. Only **growing nodes with a structural pathway** are valid targets.
- **Price is delivered node → node** through structure (launch point → highway → next node), never randomly.

## 4. THE PATTERNS (one tell each — patterns are NOT signals)
- **Rug (bearish):** pika above, barney directly below it, spot below the pika → rejection **WITH acceleration lower.** A ceiling that shoves price down once rejected.
- **Inverse / Reverse Rug (bullish):** barney on top, pika below, spot above the pika → **hold + bounce with momentum.**
- **Beach Ball / Overshoot:** price punches past a node then reacts → **overshoot → reaction → reversion. NOT a breakout** (we do NOT trade breakouts). More common in negative gamma.
- **Pika Clouds:** dense pika cluster → friction / gravity well; price slows, pins, rotates. Neutral by default — magnitude decides.
- **Whipsaw:** defined ranges but **no trinity confluence** (e.g. SPX bull / QQQ bear / SPY pinned) → fakeouts, both sides trapped → **fade extreme ends ONLY.**
- **Rainbow Road:** no dominant nodes, no defined floor/ceiling, no bias → **NO-TRADE.** (Whipsaw keeps ranges; Rainbow Road has none.)
- **Hierarchy of influence when patterns collide:** 1) node magnitude → 2) gamma regime → 3) pattern structure → 4) cross-index alignment. **Magnitude overrides everything.**

## 5. THE ENTRY LAW
- **Patterns highlight potential → confirmation comes from CONFLUENCE → ENTRY comes from DEFLECTION.** Never trade a pattern in isolation.
- **Deflection entry (concrete):** pre-identify the setup on the map → wait for price to arrive → enter **at the direct tap of the major node**, before the deflection plays out.
  - The pattern is the prediction; the tap is the trigger. Not before (early), not after (chasing). No node reached = **no trade.**
- **Deflection zones:** ±$0.50 on QQQ & SPY, ±$5 on SPX. (QQQ king 590 → 589.50–590.50; SPX king 6900 → 6895–6905.)
- **Why it works:** at extremes retail is liquidated / panicking, dealers rebalance, and you absorb forced liquidity → **cheap fill, near-zero drawdown.**
  - Buy puts into a rug ceiling from call-chasers; buy calls into a reverse-rug floor from fear-sellers. You get filled on their emotion.
- **Stop = one node beyond invalidation** — break AND hold 1 node past the node you're playing (puts off 660 gatekeeper → stop on break+hold above 661; node 603 → stop above 604).
- **R:R: 3:1 minimum (aim higher). 2:1 acceptable-not-ideal. Below 2:1 → avoid.** A+ setup = chart structure + Heatseeker confluence + asymmetric R:R.
- **Node-tap probability** — SPEC: 1st ~80% / 2nd ~66% / 3rd ~33%.
  - **EMPIRICAL (OpenClaw v11 60-day replay — USE THESE):** 1st **56.6%** / 2nd 49.6% / 3rd 45.3% / 4+ 44.3%. First-tap edge is real (~6.6pp) but far smaller than spec.
  - First tap = best fade; 2nd = still tradable; 3rd+ = weakening level, avoid aggressive fades.
- **Targets = structure, node-to-node** (floor → ceiling, key level → key level). We fade extremes; we do NOT chase moves.

## 6. THE 9-STEP SYNTHESIS (real-time, in order)
1. **Start with price** — trending or ranging? If price makes no sense, stop here.
2. **Anchor to structure** — near support / resistance / range extreme, or a dead midpoint? (Is this a location worth attention?)
3. **Check the map** — closest meaningful node, its strength, the space around it. Does the map back the chart?
4. **Evaluate the node** — strong? fresh or already delivered? likely to react? (Most traders rush here — don't.)
5. **Expect the reaction type** — direct tap (most interactions) vs overshoot (negative-gamma nodes). Prepare > predict.
6. **Check the regime** — positive-gamma pocket → clean reactions, take profit fast; negative-gamma → expect overshoot / violent swings.
7. **Check the path** — air pockets (fast) vs gatekeepers / pika clouds (friction) beyond the node.
8. **Confirm across indices** — SPX / SPY / QQQ doing the same thing, or is one off?
9. **Decide** — all aligns (structure + valid node + clear reaction + indices agree) → **take it.** Anything off (weak node, conflict, mess) → **wait or pass.** Skip steps = lose the edge.

## 7. DYNAMIC TELLS (structure is living — what each precedes)
- **Rolling floor UP** = downside nodes fade, floor jumps to a higher strike → downside shrinking → **bullish structure** (stop leaning bearish while downside is taken away).
- **Rolling ceiling DOWN** = upside caps sooner, ceiling drops to a lower strike → **bearish structure** (stop leaning bullish while upside targets shrink).
  - Rolling is a **positioning shift — NOT a breakout, NOT a gamma flip, NOT a continuation trigger.** The trade is still a deflection reversal at the edge. Tightening range alone is not a trade — no reaction, no trade.
- **Node handoff** = one node draining (decaying) while a rival builds (growing 5m+15m) → gravity migrating; precursor to price re-anchoring on the building node.
- **King flip** = king changes character (barney-ceiling → pika-floor, i.e. price breaks & holds above a key node so it becomes support) → regime/bias flip. Distinct from rolling; vanna persistence can keep a bias alive through a gamma pin flip (e.g. BEAR_CONTINUE).
- **Velocity divergence** = rate-of-change shows one-directional, rapid accumulation ahead of / away from spot → precedes fast delivery / trend day.
  - **Do NOT fade velocity** (stepping in front of dealer flow). Position BEFORE it, off weakening structure / rolling.
- **Stairstepping** (floors rising session/session, ceilings reclaimed) = trend formation = positioning evolution.
- **Space + fuel:** air pocket = space; rate-of-change = fuel. Space w/o fuel = drift; space + fuel = acceleration. Velocity Mode is most dangerous in **negative gamma.**

## 8. TRINITY / CONFLUENCE (SPX · SPY · QQQ)
- You trade the **system**, not one chart. SPX = institutional hedging, SPY = liquidity + flow, QQQ = tech weighting — three expressions of one exposure engine.
- Connected springs: SPX won't run if SPY and/or QQQ disagree. A move on one chart is a signal; a move across all three is **confirmation.**
- **Alignment** (nodes line up, bias consistent, floors/ceilings agree) → cleaner delivery, higher-probability reactions, asymmetric R:R.
- **Divergence** (one holds while another breaks, nodes conflict) → chop / fakeouts / whipsaw. **Divergence is a warning, not an opportunity.**
- Classify: **A) Full alignment** (all 3 agree) = high-probability. **B) Partial** (2/3 agree) = reduced confidence but playable — **2/3 is the bare minimum.** **C) Divergence** = no trade or reduced size.
- A target is valid only if the whole system supports delivery. A lead index can't drag the others alone (SPX must break+hold below its king before SPY/QQQ flush to theirs).

---
## QUICK DECISION CHECKLIST (run each minute)
1. Charts first — at an extreme (support/resistance/range edge) or a dead midpoint? Midpoint → NO TRADE.
2. Regime — pika-dominant (chop / fade cleanly) or barney-dominant (assume overshoot first)?
3. King located; nearest floor & ceiling marked; magnitude noted (size > color).
4. Nearest node — fresh (trade) or delivered/decayed (skip)? Real (growing 5m+15m) or hedge (skip)?
5. Pattern present — rug / rev-rug / beach-ball / pika-cloud / whipsaw / rainbow? Rainbow → stand down.
6. Tap count on this node — 1st (best) / 2nd (ok) / 3rd+ (weak, avoid).
7. Path beyond the node — air pocket (fast target) vs gatekeeper / pika-cloud (friction)?
8. Dynamic tell active — rolling / handoff / king-flip / velocity? Is the map still paying me this direction?
9. Trinity — ≥ 2/3 of SPX·SPY·QQQ aligned? If not → wait or pass.
10. Entry ONLY at the direct tap (±$0.50 QQQ/SPY, ±$5 SPX); stop = 1 node beyond (break+hold); R:R ≥ 3:1. Else no trade.
