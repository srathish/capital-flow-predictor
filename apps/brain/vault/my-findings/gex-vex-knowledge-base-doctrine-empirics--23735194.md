---
title: GEX/VEX Knowledge Base — Doctrine ↔ Empirics
source_url: repo://apps/gex/research/gexvex-structure/KNOWLEDGE_BASE.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T19:14:57Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- vex
- structure
- spxw
summary: 'Living synthesis of the Skylit Academy doctrine (docs/skylit-academy.md, 10 chapters) against what this repo has empirically VERIFIED on 64 days of 0DTE SPY/QQQ/SPXW surfaces. Purpose: ground every future GEX/VEX decision in both theory AND evidence, and surface where they agree, conflict, or open…'
url_sha1: 23735194b151c45ae9ca5989000e0fb5aa28ef75
simhash: '6157644035300668011'
status: vault
ingested_by: seed
---

# GEX/VEX Knowledge Base — Doctrine ↔ Empirics

Living synthesis of the Skylit Academy doctrine (docs/skylit-academy.md,
10 chapters) against what this repo has empirically VERIFIED on 64 days of
0DTE SPY/QQQ/SPXW surfaces. Purpose: ground every future GEX/VEX decision
in both theory AND evidence, and surface where they agree, conflict, or
open new questions. Updated as sessions run.

## The core reconciliation

Textbook GEX (and a naive reading of Ch 2/4): *negative gamma → big moves,
positive gamma → pinning.* My s4/s5 tested this scalar sign in isolation
across 29k frames and it FAILED (placebo 0–10th pctl, both horizons, both
the local and total measures, flip-referenced too).

**This is not a contradiction of Skylit doctrine — it confirms it.** The
Academy is emphatic that sign alone is a beginner error:
- Ch 2: *"Assuming Purple Means Bearish"* is Mistake #1; *"Negative gamma
  simply means volatility CAN expand"*; *"prioritize node size over node
  color"*; *"the magnitude of the node determines its influence."*
- Ch 4: *"Regime defines behavior, not direction."* Regime is NEVER used
  alone — always regime **+ structure** (King node, floors/ceilings, air
  pockets) **+ rate of change.**

So the doctrine and the data say the same thing: **the information is in
the MAP (magnitude, topology, growth), not in the scalar sign.** My s6
proved the map half directly — spot trapped between two strong walls moves
measurably less (placebo 100th, all tickers). That IS the Academy's Type-1
range day ("price stays between a floor and ceiling," Ch 4) showing up in
realized-move data.

## Verified findings mapped to doctrine

| Empirical finding | Doctrine anchor | Status |
|---|---|---|
| GEX sign ⊥ forward move (F1, s4/s5) | Ch 2 "size over color"; Ch 4 "regime ≠ direction" | confirmed null, doctrine-consistent |
| Dual-wall trap → less forward move (F3, s6) | Ch 3 floors/ceilings; Ch 4 Type-1 range day | confirmed +, placebo 100th |
| Walls compress vol symmetrically, don't repel directionally (s6) | Ch 3 "nodes are magnets" (pull, not push); Ch 9 "price delivered node-to-node, doesn't teleport" | confirmed |
| Bull tape gate (only shipped rule) | Ch 4 charts-first / prior-close context; Ch 10 Trinity confluence | shipped |
| Structural/pin EXITS beat hold-to-close | Ch 4 Type-1 "play extreme ends only"; Ch 8 "don't fade velocity" | validated |
| Post-hoc protective holds eat premium (s2b, wall-esc v3) | Ch 8 "position BEFORE velocity, amateurs chase late"; Ch 6 execution-is-edge | 3× confirmed |
| Scalar conditioners exhausted (F2) | Ch 2/3 — sign is not the signal, structure is | confirmed |

## Doctrine concepts NOT YET empirically tested (→ new research)

These are genuine, doctrine-grounded hypotheses the repo has never measured.
Each becomes a pre-registered backlog item with the full evidence bar.

1. **Node lifecycle: fresh vs delivered (Ch 9).** *"We target fresh
   positioning, not used levels. Fresh node = highest probability; a
   delivered node (tapped → reacted → left) has reduced influence."*
   TESTABLE: tag each fire's target/anchor node as fresh vs already-tapped
   earlier the same day; compare real-dollar EV. If fresh > delivered, this
   is a NEW entry-quality feature — and unlike the rejected scalar
   conditioners, it is a structural/temporal property, exactly the class
   that survives (s6). **This is the highest-value untested idea in the
   doctrine.**

2. **Growth = intent, decay = protection (Ch 9).** *"Real nodes GROW over
   time; hedge nodes are large-but-decaying protection."* TESTABLE: for
   each fire, is the target node's magnitude RISING over the prior 15–30m?
   Rising-target fires vs falling-target fires, real dollars. (rev_gex_pct
   in the 77-study was frame-to-frame total-|GEX| change — NOT
   target-specific growth; this is different and sharper.)

3. **Rate-of-change as fuel (Ch 8).** *"Air pocket = space, rate of change
   = fuel; space without fuel = drift, space with fuel = acceleration."*
   The barney-fuel EXIT already uses this. UNTESTED on ENTRY: does an
   air-pocket-ahead + rising-node fuel combination at fire time predict a
   cleaner delivery? Must beat gate+nflags incrementally (F2 discipline).

4. **Stairstepping / rolling as trend confirmation (Ch 4, Ch 7, Ch 9).**
   *"Floors rise gradually, ceilings get reclaimed → trend formation."*
   The wall-escalator study rejected PREDICTING rolls; this is the inverse
   — using an ALREADY-OBSERVED roll as regime context for the LIVE trend
   trigger (backlog exit-patience thread). Distinct trigger; the exit
   thread is iceboxed on the 1-contract instrument, but rolling-as-context
   could revive it if partial holds ever exist.

5. **Trinity confluence quality (Ch 10).** Already partly in the bull tape
   gate (all-three-below-prior-close). Ch 10's fuller claim: alignment
   across SPX/SPY/QQQ = high-probability, divergence = low-confidence.
   Cross-ticker agreement at fire was +ve in earlier work; a doctrine-clean
   re-test of alignment-vs-divergence as an entry-quality tier is open.

## Operating principles distilled (for fast reference)

- **Charts first, map confirms** (Ch 1/4). The map is confirmation, not a
  standalone signal generator — mirrors "must beat gate+nflags."
- **Magnitude > color; proximity amplifies** (Ch 2/3). Biggest, closest
  node dominates. Nodes pull like magnets (verified: pull not push).
- **Midpoints are death** (Ch 3). Weakest hedging pressure, ≤1:1 R:R;
  matches s6's mid-tercile moving most (chop). Fade extremes only.
- **Price is delivered node-to-node** (Ch 9). No teleporting to far nodes;
  nearest structure first. Far OTM large nodes are often hedge/decay traps.
- **Position before velocity; never fade it** (Ch 8). The edge is in the
  setup, not the chase — the empirical reason post-hoc holds fail (s2b).
- **Regime = behavior expectation, not direction** (Ch 4). Sets whether to
  expect reactions (range) or continuation (trend); does not call the way.
- **Structure defines direction/range, liquidity defines speed, rate of
  change defines intensity** (Ch 8 final doctrine). Three separate axes —
  the repo has proven the structure axis (s6) and uses the rate-of-change
  axis in exits; the liquidity/air-pocket axis on entry is under-tested.
