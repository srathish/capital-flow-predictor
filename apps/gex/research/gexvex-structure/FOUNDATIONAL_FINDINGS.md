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
