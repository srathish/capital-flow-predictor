---
title: DOCTRINE CORRECTIONS 2026-07-11 — King=vol not direction; campaign=beta; realized not peak
source_url: athena://doctrine-corrections/2026-07-11
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:23:45Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- doctrine-correction
- king-node
- gex
- 0dte
- beta
- realized-pnl
summary: 'Source: `apps/gex/research/exit-study/OVERNIGHT_STUDY.md` + 1-year UW GEX/VEX walkforward (SPY+QQQ, 247 days, multi-regime) by the Bellwether session. These corrections SUPERSEDE the cited lines below wherever they'
url_sha1: 29dae03a46e15a1ab171d6b0ee9de59f77594ced
simhash: '10205895078844300395'
status: vault
ingested_by: ingest
---

# Doctrine Corrections — 2026-07-11 overnight robustness pass

Source: `apps/gex/research/exit-study/OVERNIGHT_STUDY.md` + 1-year UW GEX/VEX
walkforward (SPY+QQQ, 247 days, multi-regime) by the Bellwether session.
These corrections SUPERSEDE the cited lines below wherever they conflict.

## 1. King/GEX nodes are NOT directional magnets

**Superseded claims:**
- Skylit Academy ("Nodes act like magnets. The bigger they are, the stronger the
  pull."; "Price moves where positioning builds.")
- GEX/VEX Knowledge Base ("Nodes pull like magnets (verified: pull not push)").

**Corrected doctrine:** GEX-King and VEX-King DIRECTION accuracy is 45-49% —
below the ~55% always-up baseline, in every quarter tested; price moved toward
the King only ~42% of the time. Independent of Skylit (UW computes GEX
differently). What SURVIVES: positive total gamma -> compressed next-day range
(0.7% vs 1.1%), all year. GEX is a volatility/pin map, not a direction signal.
Cite "King -> pin/vol"; direction comes from regime/tape, never node location.

## 2. Campaign swing "+70% intersection" is mostly beta

~52% of it is SPY beta (corr 0.72 with forward-20d SPY return, R² ~0.52).
Bull-forward cohorts: 81% win / +57%. CHOP-forward cohorts: 51% win / ~0%.
NOT regime-independent alpha — always cite with the regime caveat.

## 3. No 0DTE exit/entry/instrument edge survived costs + robustness

Both the 0DTE fire system and the campaign system are long-call BETA plays:
they print in bull tape and die in chop. The lever is the MACRO REGIME GATE,
not structure-picks-direction.

## 4. Grading rule: realized, never peak

The plays-tracker EOD summary reports PEAK (best_pct_gain), overstating
realized by ~45 points. Live-fire ground truth (159 fires, 07-08..07-10):
avg REALIZED -21.6% vs avg PEAK +45.3%. Grade every thesis and fire against
tracked_plays.close_mark (realized_ret), never best_mark.

**Fairness decomposition (grade by direction x tape, not blended):** the -21.6%
blend is dominated by 07-08 (89 bear puts, -25%). Per day: 07-08 -25%; 07-09
+34% (5/5 calls); 07-10 -9% blended but the 9 CALLS averaged ~+6% realized
(6-of-11 green, peaks to +108%) — the only real losers were 2 counter-trend BEAR
puts on a bull day (-72%/-81%). The leak is (a) counter-trend bear fires (the
bull-tape-gate case) and (b) the mechanical structure-exit giving back peak.
Bull fires in bull tape performed: entries catch moves. Do not score the
operator's discretionary exits as the system's close_mark.
