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

## 0. VANNA COMPASS (Clause 8b) — REFUTED on independent replication (15:13)

The vanna-imbalance directional lead — briefly the program's highest-conviction
predictive item — **FAILED hostile replication** (independent UW-daily re-pull,
pre-registered, placebo-controlled). Kill shot: the ±2.5% net-vanna imbalance
sign was POSITIVE on 100% of days (47/47 SPY, 46/46 QQQ), so it NEVER predicted
down — the apparent 56-57% was merely the bull-tape up-day base rate, and a
RANDOM strike split scored identically (0.53-0.56). Test halves SPY 45.8% /
QQQ 52.2%, both below the 54% bar; sign-normalized rescue ~50% OOS (corr≈0).
**Status: vanna-as-direction is SUSPENDED.** The same always-positive degeneracy
likely explains the Skylit-intraday "survivor" too — Vega is re-testing that
sign-normalized. Do not cite vanna imbalance for direction until/unless the
Skylit re-test clears. This is the graduation gate working in reverse: an edge
the mesh believed, killed by a session that had to reproduce it and couldn't.

## 1. GEX does not pick DIRECTION; Skylit King magnet is OPEN (not disproven)

**RETRACTION NOTICE (03:26, Bellwether MSG 6):** the 1-yr walkforward's
"price moves away from the King (42%)" finding used **UW's King**, and UW
computes GEX/VEX with a different dealer model + sign conventions than Skylit.
It is NOT a valid test of the Skylit King our live logic runs on.

**UPDATE (12:26, MSG 13 — magnet reopened WITH signal):** with the corrected
methodology (distance-matched dead-strike control instead of mirror-placebo,
±0.4% ZONE mean-reversion instead of exact-touch), the null reversed in the
operator's exact case: **HIGH-share × PIKA King (n=21): 76% zone-reversion vs
64% at dead strike (+12 pts, 12/21 sessions favor King)**. Weak/barney Kings:
no edge. So the pin is **real-but-CONDITIONAL (dominant pika only) and
ZONE-based (mean-reversion), a LEAN not proof** (n=21, one regime, not yet
significant). Cite as "dominant-pika King = pin zone (leaning real)" — never
as a direction signal, never as proven exact-touch magnet.

**GROUND-TRUTH RECEIPT (12:34, MSG 17 — verified on real price paths, not
aggregates):** SPY 2026-04-29 — King \$710 pika at 41% share; price glued
within 0.15% of the King at essentially every bar, all session (textbook pin).
Contrast SPY 04-24 and 04-13: opened near the King, then TRENDED AWAY.
**Reframe: the King pin is real & strong CONDITIONAL on pika + pin-regime
(chop) days — the WALL; price breaks away on trend days — the ESCALATOR.
Averaging over trend days dilutes the aggregate to a weak lean; the effect is
neither a hallucination nor a direction signal. This is the wall-vs-escalator
hypothesis made concrete.** Pooled evidence: 60 archive pika sessions
(bellwether-archive) + live athena cycles in journal `king_zone_obs`.

**What DOES transfer (validated on Skylit's own data):**
- GEX does NOT predict direction (up/down) — F1/F4 on the 64-day Skylit
  archive; the campaign used Skylit's King and still came out 0.72-correlated
  with SPY beta. **Direction = regime/flow, never node position.**
- Positive total gamma -> lower realized vol / compressed range (holds on BOTH
  Skylit and UW data).

So: "nodes are magnets" remains T1 doctrine for PIN/structure/exit purposes,
pending the Skylit-King re-test; what is corrected is using node location as a
DIRECTION signal. Nothing in the live trading logic changes (operator directive).

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
