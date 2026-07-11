---
title: Foundational GEX/VEX Findings (0DTE SPY/QQQ/SPXW)
source_url: repo://apps/gex/research/gexvex-structure/FOUNDATIONAL_FINDINGS.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:16:47Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- vex
- structure
- spxw
summary: Durable, system-level truths from the raw 64-day Skylit surface archive. These are physics/structure facts (no option P&L, no fire set), so they constrain how ALL downstream GEX/VEX work should be
url_sha1: 490878b44c6b3eea9ebebc3042a85d6e254a6ee5
simhash: '3107636104437453173'
status: vault
ingested_by: seed
---

# Foundational GEX/VEX Findings (0DTE SPY/QQQ/SPXW)

Durable, system-level truths from the raw 64-day Skylit surface archive.
These are physics/structure facts (no option P&L, no fire set), so they
constrain how ALL downstream GEX/VEX work should be framed.

## F1 — Raw GEX sign does NOT forecast forward index behavior (2026-07-09, s4/s5)

Tested on 14,400–29,376 surface frames (64 days × SPY/QQQ/SPXW), forward
horizons 15 and 30 min:

- **Volatility (pin/trend hypothesis):** net-GEX tercile vs forward
  |realized move| is NOT monotone. The MIDDLE tercile moves most; the
  neg-minus-pos gap is −0.6 to −1.5 bps at placebo percentiles 0–10 (i.e.
  the real "effect" is smaller than almost all random shuffles). Holds for
  local ±1% GEX, total signed GEX, and both horizons.
- **Mean-reversion hypothesis:** P(forward move toward dominant node) =
  48.4% posGEX / 44.6% negGEX / 47.5% baseline — a coin flip.
- **Flip-referenced:** spot below the zero-gamma flip vs above → forward
  |move| 9.1 vs 9.2 bps. No negative-gamma volatility premium.

**Implication (load-bearing):** the system's edge is NOT "GEX predicts the
tape" as a scalar volatility-regime forecast. The edge is GEX/VEX as a
**MAP** — where dealer hedging concentrates — exploited by (a) pattern
detectors that locate structural inflection nodes, (b) the tape gate
(prior-close directional context), and (c) node-structure EXITS. This is
why every scalar-GEX conditioner tested has rejected (see F2).

## F4 — GEX/VEX structure predicts VOLATILITY, not DIRECTION (2026-07-09, synthesis s4/s5/s6/s10 + H2)

Every foundational test of whether GEX/VEX structure forecasts the *direction*
of the next index move has come back null; the one robust forecast is of
*volatility* (pin vs release):

| test | predicts direction? | predicts volatility? |
|---|---|---|
| GEX sign (s4/s5) | no (placebo 0–10th) | no |
| mean-reversion to wall (s4 H2) | no (48% ≈ coin flip) | — |
| dual-wall trap topology (s6) | — | **YES: trap → less move, placebo 100th** |
| Trinity structural alignment (s10) | no (53/51% up, unstable) | no (ER not monotone, placebo 91st, flips odd/even) |

**Principle:** the dealer-gamma map tells you HOW MUCH price will move (dense
bracketing topology compresses realized vol → pinning; sparse/air-pocket
topology permits expansion), but NOT WHICH WAY. Direction must come from the
tape/chart (exactly the Academy's "Charts First" doctrine — Heatseeker
confirms, it does not generate direction). This is why: (a) the bull tape
gate — a TAPE/direction rule — is the only shipped entry edge; (b) structural
EXITS (pin detection = volatility compression) work; (c) every structural
DIRECTION conditioner has rejected. Operationalization caveat: s10 used
gamma center-of-mass bias in ±1.5%; a richer floor/ceiling/King alignment
could differ, but the scalar-clean version is null.

## F3 — Map TOPOLOGY predicts pinning where the scalar failed (2026-07-09, s6)

The same 14,400 frames where GEX *sign* had no forecasting power: when spot
is TRAPPED between two strong opposing walls (min of the nearest above/below
wall shares, top tercile), forward 30-min |move| is **7.9 bps vs 9.9 bps**
in the low-trap tercile — placebo **100th pctl**, and it holds on every
ticker (SPY 8.0→6.8, QQQ 13.6→10.4, SPXW 9.1→6.9). **Pinning is real, but
it is a SHAPE property (dual-wall trap), not a SIGN property.** This is the
positive counterpart to F1 and the empirical basis for the node-structure
exits: the map compresses realized move when its topology brackets spot.

Directional repulsion (spot drifts away from the stronger wall) was NULL
(+0.3 / +1.4 bps) — walls compress volatility symmetrically; they do not
push price away. So the tradeable topology signal is VOLATILITY (pin vs
release), consistent with why pin-exit logic works and directional
wall-migration prediction (77-study) did not.

## F2 — Scalar GEX/VEX conditioners on the fire set are exhausted (2026-07-09)

Seven+ secondary conditioners now reject or are non-incremental over
(bull tape gate + nflags + net_gex_local level): VIX×GEX, GEX
sign-persistence, and the 77-study families (concentration/shape, gradient/
cliff, dealer-acceleration, curvature, migration prediction, compression→
expansion, structure-reset, confluence scores). The ONE survivor
(mass-below-spot / dn_vex_mass) is SPXW-concentrated and on the forward
watchlist, not shipped.

**Rule going forward:** new GEX/VEX ideas that are scalar re-slices of the
existing 537-fire set start from a strong prior of REJECTION. Higher-value
directions: (a) fire-GENERATION quality (are the detectors finding the
right nodes?), (b) the campaign/stock system (different universe), (c)
genuinely new structure that the map encodes but we haven't measured
(e.g. multi-node topology, VEX-driven repricing), each with the full
evidence bar.

## What still ships from GEX/VEX work

Only the **bull tape gate** (shipped 2026-07-09) has cleared the bar for
live entry logic. Structural exits remain the best validated instrument.
Everything else is map-as-context, verified per the charter before any
live change.
