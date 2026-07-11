---
title: Dark Pool Print Research Report
source_url: repo://apps/gex/research/darkpool/out/DP_RESEARCH_REPORT.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:53:48Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- dark-pool
- flow
summary: '**Isolated research module — no trading-logic changes. Revert: `rm -rf'
url_sha1: a3b44860c75056bd872976228ca140814bd1e2b1
simhash: '7457133238018157898'
status: vault
ingested_by: seed
---

# Dark Pool Print Research Report
**Isolated research module — no trading-logic changes. Revert: `rm -rf apps/gex/research/darkpool`.**

Data: Skylit Flowseeker (`fs-ws.skylit.ai/api/dark-pool/top-prints`, reverse-engineered from the app bundle — Skylit-native, same Clerk auth). 64 sessions × SPY+QQQ, top-20 prints at 1-day and 5-day lookbacks, levels always taken **as of the prior day** (no lookahead). 4,990 level touches classified against the 5-min index archive, each real level controlled by 3 offset placebo levels under identical logic.

## Q1 — do DP print levels deflect price? **Not better than chance.**

| | touches | deflection rate |
|---|---|---|
| Real DP levels | 1,069 | 58.7% |
| Placebo levels | 2,739 | 56.4% |

Mann-Whitney p = 0.18 — not significant. Everything deflects >50% at this resolution because 5-min index price action mean-reverts at the 10bps scale; DP levels don't deflect *more than random nearby prices*.

Sub-slices with a real hint (above own placebo):
- **Resistance tests** (approach from below): real 57.6% vs placebo 50.6% (+7.0pp) — sellers do seem to sit at big-print levels overhead
- **QQQ**: real 57.6% vs placebo 53.0% (+4.6pp); SPY shows zero edge
- **Print size does NOT matter**: small/mid/large notional terciles = 58.7/60.5/57.0% — a $0.7B print deflects no better than a $0.15B one

## Q2 — are fires better near DP levels? **Apparent yes, actually no.**

Raw sample (all 847 SPY/QQQ fires): near-DP (≤10bps) +21.0% EV vs +5.6% away — looks like a big feature. But:
- **Under the final system (G7-PC + dedupe) it vanishes**: ≤10bps +27.6% vs >30bps +28.6%. The live gates already remove exactly the fires DP-proximity was flagging.
- **The distance gradient is non-monotonic** (+28.5 / +4.6 / −16.4 / +12.7 / +9.8% across 5 buckets) — noise-shaped, not a dose-response.
- Bull/bear splits point in opposite directions on small n.

## Verdict: EXCLUDE (with one thread worth pulling later)

Dark pool print levels, as served by Flowseeker top-prints, do not earn a place in the system — not as deflection zones (fails placebo control) and not as a fire-quality feature (edge is absorbed by existing gates). This mirrors Skylit Academy's own framing: dark pool data is Section 1 *context*, not a trigger.

**Caveats / future work:** (a) 5-min frames are coarse for touch microstructure — the resistance-side +7pp hint deserves a 1-min retest when live data accumulates; (b) server caps at top-20 prints; deeper books untested; (c) equities only (SPY/QQQ) — SPX prints don't exist as such.

## Reproducibility
`node research/darkpool/collect.js && uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/darkpool/dp_study.py`
Raw touch data: out/touches.csv · chart: out/dp_deflection.png
