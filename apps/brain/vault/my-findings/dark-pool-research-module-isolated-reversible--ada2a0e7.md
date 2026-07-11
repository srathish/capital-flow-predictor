---
title: Dark Pool Research Module — ISOLATED, REVERSIBLE
source_url: repo://apps/gex/research/darkpool/README.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T16:26:49Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- dark-pool
- flow
summary: '**Status: research only. Nothing under `apps/gex/src/` imports this'
url_sha1: ada2a0e7b5b6500ef32bcf392882031219785446
simhash: '2969253751847974149'
status: vault
ingested_by: seed
---

# Dark Pool Research Module — ISOLATED, REVERSIBLE

**Status: research only. Nothing under `apps/gex/src/` imports this directory.**

Same isolation contract as `research/vix/`: reads existing artifacts + its own
collected data; writes only inside this directory; **revert = `rm -rf apps/gex/research/darkpool`**.

## Data source — Skylit-native

Flowseeker service (Skylit's dark pool product, reverse-engineered from the
app bundle): `https://fs-ws.skylit.ai/api/dark-pool/top-prints` with
`ticker`, `top_n`, `lookback_days`, `as_of_date` (historical works across the
full archive window). Auth = same Clerk bearer token as Heatseeker.

## Objective

Skylit Academy Section 1 treats dark pool prints as institutional footprints.
Study question: **do large dark-pool print levels act as intraday
support/resistance — i.e., do approaches to those price levels get REJECTED
(deflection) or BOUGHT UP / SOLD THROUGH (absorption)?** And does that improve
our fires?

## Method (no lookahead)

- Levels for session D = top prints as of D−1 (known before the open).
- Walk the 5-min index archive; detect touches of each level (±0.05%);
  classify outcome over the next 30m: deflect vs break-and-hold, split by
  approach direction (from above = support test / from below = resistance).
- **Placebo control:** identical touch logic on offset pseudo-levels
  (level ± random 0.3-0.7%) — a level only "works" if it beats its own placebo.
- Weight by print notional and recency; join with the 1,339 replayed fires
  (fires launched near a DP level vs not).

## Run

```bash
cd apps/gex
node research/darkpool/collect.js          # ~130 paced calls, once
uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/darkpool/dp_study.py
```
