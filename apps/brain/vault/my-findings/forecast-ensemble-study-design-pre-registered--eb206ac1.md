---
title: Forecast Ensemble — Study Design (pre-registered)
source_url: repo://apps/gex/research/forecast-ensemble/DESIGN.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T19:14:57Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
summary: '**Status:** DESIGN ONLY — no computation run yet. Queued in BACKLOG.md. **Created:** 2026-07-11 **Scope:** research/** only, per charter. No live-code changes; a ship-worthy result ends as a DECISIONS NEEDED'
url_sha1: eb206ac18ae8300c9ac8709216dd828a770e9406
simhash: '9375576845860207270'
status: vault
ingested_by: seed
---

# Forecast Ensemble — Study Design (pre-registered)

**Status:** DESIGN ONLY — no computation run yet. Queued in BACKLOG.md.
**Created:** 2026-07-11
**Scope:** research/** only, per charter. No live-code changes; a ship-worthy
result ends as a DECISIONS NEEDED proposal.

## Motivation

The 77-study structure program found exactly one confirmed entry-side factor
(dn_vex_mass, SPXW-only); every other candidate rule died as a shadow of the
bull tape gate. That is the expected outcome if the residual predictability
is NOT in any single strong filter but in **many individually-worthless weak
signals that are jointly informative** (the Renaissance/Medallion structure:
hundreds of ~50.5% signals + a combiner + high bet frequency).

We already pull 14+ UW data families. None of them individually forecasts
direction (confirmed: raw GEX sign does not — s4/s5 2026-07-09, and "GEX is
a map, not a volatility forecast"). This study tests whether a **regularized
combination** of weak daily features carries a directional prior that the
gate + map does not already capture.

**Positioning:** the ensemble is a *directional prior / sizing layer* on top
of the existing structural edge (map + tape gate + node exits). It is NOT a
standalone strategy — a 52-53% daily edge cannot survive 0DTE spreads alone.

## Thesis (pre-registered)

A cross-source weak-signal ensemble (L2 logistic regression over z-scored
daily features from ≥10 UW data families) predicts next-session open→close
direction on SPY/QQQ/SPX with out-of-sample hit rate ≥ 52.5% and log-loss
better than the base-rate baseline, while **no single feature family alone**
reaches that bar — and conditioning live fires on the ensemble prior adds EV
incrementally on top of bull tape gate + nflags.

## Label

- `y = sign(close − open)` of the **next regular session**, per ticker
  (SPY, QQQ, SPX). Log-return magnitude kept for secondary EV analysis.
- Features are computed strictly from data available at or before today's
  close (as-of discipline; any endpoint whose history is revised or
  timestamped ambiguously gets lagged one extra day or dropped).
- **Effective-n caveat (named up front):** SPY/QQQ/SPX are highly correlated
  — three tickers ≈ one bet per day, not three. Primary evaluation is on
  SPY; SPX/QQQ are stability cuts, not independent samples.

## Amendment A1 (2026-07-11, pre-computation — user request)

Added BEFORE any feature matrix or model was built; primary bar unchanged.

1. **Chop class (secondary target).** User asked to learn up vs down vs
   chop. Label extension: a session is CHOP when |open→close log return|
   is below the trailing-60-session 30th percentile of |open→close|
   (adaptive to vol regime, trailing = no lookahead). Else UP/DOWN by
   sign. Secondary models: (a) multinomial logistic on 3 classes,
   (b) binary chop-vs-trend classifier scored by AUC. Pre-registered
   secondary bars: 3-class macro accuracy > base-rate baseline AND
   chop-AUC ≥ 0.55 OOS with the same placebo protocol. The PRIMARY
   verdict still rides on the binary up/down bars in this design.
2. **Local skylit archive joins as tier-B features** (65 sessions,
   2026-04-13→2026-07-10): per-strike GEX/VEX structure aggregates
   (mass above/below spot, net gamma sign, distance-weighted vanna).
   Tier-B rows are too few for the walk-forward; they are used only for
   a named exploratory cut in the report, never for the verdict.
3. **Interpretability deliverable**: standardized logistic coefficients +
   drop-one family ablations reported as "what moved up/down/chop days";
   correlational language only, no causal claims.

## Phase 0 — history-depth inventory (gate for everything else)

For each candidate endpoint, record: max lookback, granularity, revision
behavior, calls needed for a 250-session backfill. Endpoints that are
snapshot-only (no history) go to a **forward-collection list** (daily cron
capture into research/forecast-ensemble/data/) and are EXCLUDED from the
initial backtest — no look-ahead reconstruction.

Budget per charter: ≥550ms pacing, budget calls before collecting, >30min
collections run detached.

## Feature families (candidate list — final list fixed at end of Phase 0)

Each family contributes 2-6 features, z-scored on a trailing 60-session
window (no full-sample normalization = no leakage). Deliberately include
families with no causal story — statistical persistence is the bar, not
narrative.

1. Market tide — net call/put premium deltas, close vs intraday path
2. Sector ETF tides — breadth of bullish sectors, mega-tech vs small-cap
   divergence (the rotation signal from 2026-07-02)
3. Greek exposure by ticker (daily history) — GEX/VEX level deltas,
   day-over-day migration of mass above/below spot
4. OI changes — net new call vs put OI at index level, concentration
5. Dark pool — volume share, price-relative prints
6. Lit flow — aggressor imbalance
7. Short volume ratio — level + 5-day delta
8. Insider sector flow — aggregate buy/sell tilt (slow; expected weak)
9. Congress trades — net direction (very weak on purpose; a placebo-like
   family that also tests whether regularization correctly shrinks junk)
10. Seasonality — month/day-of-week priors
11. VIX — level, change-from-open, 5-day slope
12. Yield curve — 2s10s level + delta
13. Crypto whale flow — net direction (cross-asset lead-lag test)
14. Candles/momentum — 1/3/5-day return, range compression, gap behavior

## Combiner

- Primary: **L2 logistic regression**. λ chosen once by inner walk-forward
  on the first training window only, then FROZEN (no per-window re-tuning
  = no threshold-tuning violation).
- Robustness check only (not primary): shallow gradient boosting. If GBM
  wildly beats logistic, that is a red flag for overfit, not a result.

## Validation protocol

- **Walk-forward, expanding window**: train on first ≥120 sessions, predict
  next 20, roll forward 20, repeat. No shuffled CV anywhere.
- **Success bar (all required):**
  1. OOS hit rate ≥ 52.5% on SPY AND OOS log-loss < base-rate baseline
  2. Placebo ≥95th percentile vs BOTH label-permutation and date-shuffle
     (80-94th → `research_more`, per charter)
  3. Direction holds on odd/even days and both halves of the OOS period
  4. **No-single-family test**: every single-family model scores < 52.5%
     OOS (if one family alone clears the bar, this is a factor study, not
     an ensemble — re-classify and hand to the structure program)
  5. **Drop-one ablation**: no single family's removal takes the ensemble
     below 51.5% (edge must be distributed, not concentrated)
  6. **Incremental-over-gate (mandatory, study-77 discipline)**: split
     live-fire observations by ensemble prior (aligned vs against); the
     aligned bucket must show higher real-dollar EV *within* gate-passing
     fires. n<30 cells = directional only.
- **Verdict forced**: confirmed / research_more / rejected / not_testable.

## What would kill it (pre-registered failure modes)

- Phase 0 finds <150 sessions of usable multi-family history → `not_testable`
  now; start forward collection and park 60 sessions.
- Ensemble edge exists but is a VIX-regime or trend proxy the gate already
  captures → fails bar 6 → `rejected` as entry-side, note as sizing-only.
- Hit rate 51-52.5%: real but too thin for costs → `research_more`, park
  for more forward data, do NOT tune thresholds to squeak past the bar.

## Deliverables

- `phase0_inventory.md` — endpoint history table + final frozen feature list
- `build_features.py`, `walk_forward.py`, `placebos.py` (mirroring
  gexvex-structure conventions)
- `REPORT.md` with forced verdict
- If confirmed: DECISIONS NEEDED proposal for (a) daily prior computation
  job, (b) sizing-layer integration — proposal only, no code changes.
