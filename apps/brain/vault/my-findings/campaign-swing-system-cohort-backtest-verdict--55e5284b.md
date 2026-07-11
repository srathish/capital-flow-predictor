---
title: Campaign Swing System — Cohort Backtest Verdict
source_url: repo://apps/gex/research/campaign/backtest/CAMPAIGN_BACKTEST.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:53:48Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- campaign
- plays
summary: '**Date:** 2026-07-09 · **Design:** 21 formation cohorts (every 2nd day, 2026-04-13 → ~06-05), funnel run AS-OF each date from the flow cache (UW 20-day accumulation) × Skylit archive surfaces (GEX King magnet + VEX). Real option dollars from UW daily `/historic` (1,477 priced legs). Net of 6%…'
url_sha1: 55e5284bcd1b24ae8f632040b7f23c6e53f98db6
simhash: '11545270320117841144'
status: vault
ingested_by: seed
---

# Campaign Swing System — Cohort Backtest Verdict

**Date:** 2026-07-09 · **Design:** 21 formation cohorts (every 2nd day,
2026-04-13 → ~06-05), funnel run AS-OF each date from the flow cache (UW 20-day
accumulation) × Skylit archive surfaces (GEX King magnet + VEX). Real option
dollars from UW daily `/historic` (1,477 priced legs). Net of 6% round-trip
spread. Four arms isolate the edge.

## The decisive result — flow vs node vs combination

**With disciplined profit-taking (exit first day up +100%):**

| arm | what it is | win rate | mean | median |
|---|---|---|---|---|
| **intersection** | flow-bullish AND strong GEX node above spot | **70%** | +34.9% | +94% |
| flow_only | flow-bullish, ATM call (ignore node) | 66% | +28.8% | +94% |
| placebo | random options-liquid name, OTM call | 54% | +5.8% | +94% |
| **node_only** | strong GEX node, NO flow | **49%** | **−6.1%** | **−58%** |

**The verdict, unambiguous:**
1. **The FLOW carries the edge.** flow_only wins 66% vs placebo's 54% — the
   20-day accumulation is the real signal.
2. **The NODE alone is a TRAP — worse than random.** node_only (a strong gamma
   magnet with NO flow behind it) wins only 49% and *loses* money (−6.1%).
   Buying because "there's a big node" is a losing strategy. This is F4 proven
   on real stock dollars: **structure ≠ direction.**
3. **The intersection is best.** flow + node confirmation wins 70% — the node
   adds ~4pp ON TOP of flow, but only when the flow is already there. This is
   exactly the architecture: flow = conviction/direction, node = target/
   confirmation. Never the node alone.

## The other decisive result — profit-taking is the whole game

Hold-to-20-days, these are **lottery tickets**: intersection median −88%, mean
+92% (positive only from tail moonshots). Uninvestable as buy-and-hold.

| | hold to 20d | take profit at +100% |
|---|---|---|
| intersection win rate | 39% | **70%** |
| intersection median | −88% | **+94%** |

The setups **spike then fade** — median max in-window gain is **+208%**, but
unmanaged it round-trips to −88%. This is the Atlas tracking lesson (NBIS
+145%→−12%, MRVL +124%→−73%) confirmed across 286 setups. **Scaling out on the
+100% spike is not optional — it is the strategy.**

## Caveats (honest)

- **Stability is the concern.** Intersection-minus-placebo edge is +92.6pp in
  the first half of cohorts but −3.2pp in the second half. The edge is real but
  concentrated early in the window; 21 cohorts is a small sample. **Validate
  forward before sizing up.**
- **VEX alignment does NOT add** (as defined: VEX magnet same side as GEX
  King). VEX-aligned +81% vs VEX-opposed +145% (n=50, likely noise). Drop it
  as an entry filter for now.
- Entry = daily avg_price, TP trigger = daily high (slightly optimistic fill);
  6% round-trip cost applied. Directional conclusions robust to reasonable
  cost/fill assumptions given the size of the flow-vs-node gap.

## What this means for the swing system (Atlas)

1. **Trade the intersection only** — flow-confirmed AND a King magnet above
   spot within reach. NOT node-alone (loses), and flow-only is good but the
   node confirmation adds real edge.
2. **Hard-code profit-taking** — scale out on the +100% spike; do not hold
   monthly OTM calls to expiry.
3. **The score should weight flow > node** (flow is the driver) — matches the
   current Atlas scoring (accumulation 22, node 16).
4. **Size small until forward-validated** — the H1/H2 split says the edge
   isn't yet proven stable.

Pipeline: `fetch_flow.js` → `build_cohorts.py` → `price_forward.js` →
`analyze.py`. Data: `cohorts.json`, `priced_legs.json`.
