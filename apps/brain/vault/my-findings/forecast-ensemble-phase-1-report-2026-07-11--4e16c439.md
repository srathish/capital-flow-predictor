---
title: Forecast Ensemble — Phase 1 Report (2026-07-11)
source_url: repo://apps/gex/research/forecast-ensemble/REPORT.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:40:39Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
summary: '**The weak-signal ensemble is REJECTED.** 47 features from 10 UW data families, combined with walk-forward L2 logistic regression, predict SPY''s next-session open→close direction at **50.0% out-of-sample** — worse than always-up (56%) and dead-center of both placebo distributions (40th/46th…'
url_sha1: 4e16c43936be4d65c6fe529f7ccf3f0e19a292e9
simhash: '860468345689369202'
status: vault
ingested_by: seed
---

# Forecast Ensemble — Phase 1 Report (2026-07-11)

## TL;DR

**The weak-signal ensemble is REJECTED.** 47 features from 10 UW data
families, combined with walk-forward L2 logistic regression, predict SPY's
next-session open→close direction at **50.0% out-of-sample** — worse than
always-up (56%) and dead-center of both placebo distributions (40th/46th
percentile). The RenTec-style "many weak signals combine into an edge"
thesis does not hold at daily frequency on this data.

**One factor fell out of the wreckage: short volume ratio.** Alone it hits
**58.0% OOS on SPY, replicates at exactly 58.0% on QQQ, and beats both
placebos at the 99.5th percentile.** Rising short-volume ratio (especially
its 5-day delta) → next session down. It fails one stability cut
(even-days = 50%), so per charter it graduates only to **research_more**
with a pre-registered forward test queued — not confirmed, not tradeable yet.

Chop prediction (Amendment A1): **rejected** — OOS AUC 0.537 vs the 0.55 bar.

## Data

- 250 trading sessions backfilled (2025-07-14 → 2026-07-10), 1,361 UW API
  calls total, all paced ≥550ms, zero errors. Raw data under `data/`.
- Families: greeks (SPY/QQQ/SPX aggregate GEX/vanna/charm/delta), market
  tide paths, per-ticker net-premium ticks, short volume ratio, VIX (CBOE
  CSV), dark pool prints, insider sector flow, congress trades, momentum,
  calendar. 47 features, trailing-60 z-scored, no lookahead.
- Labels: next-session open→close on SPY and QQQ (SPX label impossible —
  OHLC endpoint 422s on index tickers; SPX greeks used as features only).
- Final matrix: 220 sessions/ticker after z-burn-in; 100 OOS days on SPY
  (train ≥120, predict 20, roll). **Power caveat: n=100 OOS → ±10pp 95% CI
  on hit rate. Only huge effects were detectable; the placebo percentile
  carries the interpretive weight, not the point estimates.**
- Logged caps: dark pool = last 500 prints/day (SPY only); congress = 40
  pages (4,000 trades); netprem treated as per-minute deltas.

## Pre-registered bars vs results (primary, SPY binary)

| Bar | Required | Got | Pass |
|-----|----------|-----|------|
| OOS hit rate | ≥52.5% | 50.0% | ✗ |
| OOS log-loss < base-rate model | < 0.691 | 0.729 | ✗ |
| Placebo (label permutation) | ≥95th pct | 46th | ✗ |
| Placebo (circular date-shift) | ≥95th pct | 40th | ✗ |
| Odd/even + half stability | hold | odd 56 / even 44 | ✗ |
| No single family ≥52.5% | all < | shortvol 58% | ✗ (factor found) |

Every primary bar failed. **Verdict: rejected.** Re-opening requires NEW
data (forward sessions, or the 4 forward-only families once ≥60 sessions
accrue), not re-slicing.

## Secondary: chop (Amendment A1)

Chop = |next open→close| below trailing-60 30th percentile (29% of days).
OOS AUC 0.537 vs pre-registered 0.55 bar. **Rejected.** The chop-day
coefficients (large dealer net gamma → chop; big dark-pool prints → trend)
point the expected structural direction but did not clear the bar.

## The shortvol factor (one follow-up, per anti-rabbit-hole rule 2)

| Check | Result |
|-------|--------|
| SPY OOS hit (3 features, C=0.01) | 58.0% |
| Label-permutation placebo | 99.5th pct |
| Date-shift placebo | 99.5th pct |
| QQQ replication | 58.0% |
| Halves | H1 54% / H2 62% ✓ |
| Odd/even days | odd 66% / **even 50% ✗** |

Direction: coefficients all negative on P(up) — `shortvol_ratio_5dd`
(5-day delta) strongest. Mechanism candidate: rising short-volume share =
building hedging/positioning pressure that resolves down next session.
Asymmetry: model predicts down only 36% of days; hit 61% on up-predictions,
53% on down-predictions — most of the edge is *staying long when short
volume is falling*, not calling crashes.

**Verdict: research_more.** Found post-hoc via ablation (selection bias
risk is real — 10 families were tried; the best single family's 99.5th
placebo percentile survives a ×10 Bonferroni-style discount, but the
even-day failure plus n=100 means forward validation is mandatory.)
Queued as a pre-registered backlog item; NOT for live use.

## What made days go up, down, or chop (correlational, full-sample)

Up-day tilt: falling short-volume ratio, more intraday tide sign-flips,
positive net call premium, positive dealer charm, big dark-pool prints,
Fridays. Down-day tilt: rising short-volume ratio, congress buy-share and
activity (noise-level, as expected), insider net selling. Chop tilt: high
dealer net gamma / net delta, low VIX, small dark-pool prints — consistent
with the existing map finding that positive gamma pins price.
All coefficients are |β| ≤ 0.11 under C=0.01 — nothing here is strong; the
list is descriptive, not tradeable.

## Consistency with prior findings

This is the program's second convergent negative on daily-frequency
direction forecasting from positioning aggregates (s4/s5: raw GEX sign ≠
forward move; memory: "GEX is a map, not a volatility forecast"). The
ensemble result extends it: even 10 families jointly can't beat always-up
at this horizon/sample. The system's edge remains structural (map + tape
gate + node exits), and the one surviving directional candidate
(short-volume ratio) is a *flow* variable, not a positioning one.

## Deliverables

- `collect_daily.js` (probe/oneshot/perday/slow), `build_features.py`,
  `walk_forward.py`, `outputs/features.csv`, `outputs/walkforward_results.json`
- Forward-capture job for the 4 snapshot-only families: NOT stood up
  (would be a recurring process — needs user sign-off; see DECISIONS NEEDED
  in journal).
