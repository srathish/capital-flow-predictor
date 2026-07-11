---
title: Campaign System — Skylit Universe × UW 20-Day Accumulation (PLAN)
source_url: repo://apps/gex/research/campaign/PLAN.md
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
summary: '**Status: PLANNING. Nothing built, nothing live. Separate system from the 0DTE index tracker — different timeframe, different holds, different'
url_sha1: 6215f314318d504c2fc2a68a6ccadd2bae69c3e6
simhash: '16125561643113628962'
status: vault
ingested_by: seed
---

# Campaign System — Skylit Universe × UW 20-Day Accumulation (PLAN)

**Status: PLANNING. Nothing built, nothing live. Separate system from the
0DTE index tracker — different timeframe, different holds, different rules.**

## Thesis

The 0DTE system trades dealer mechanics intraday. This system hunts
**multi-week campaigns on individual stocks**: institutional positioning
that shows up simultaneously as (a) a structural magnet on the Skylit map
at a monthly/2-month expiry, and (b) persistent 20-day accumulation in the
options at/near that strike on UW. Map says WHERE, flow says WHO'S ALREADY
BUYING. This systematizes the existing manual playbook (6-criteria bull
filter, 3-month Kings workup, MSFT $400C-style trades).

## The funnel (efficiency-first, full 378-ticker Skylit universe)

**Stage 1 — Flow screen (378 UW calls, ~4 min).**
`GET /api/stock/{t}/options-volume?limit=20` → 20 daily rows per ticker in
ONE call: net call/put premium, ask/bid-side volume, 30d averages.
Compute per ticker: 20d cumulative net premium, 7d, trend/persistence
(count of positive days), acceleration. Keep names passing the 6-criteria
skeleton (20d net > threshold, 7d > 0, persistent) → **shortlist ~40-60**.

**Stage 2 — Map structure (shortlist × 1 Skylit call each).**
Full multi-expiry surface (client already returns 10 expirations incl.
monthlies). Find King/magnet per monthly expiry out to ~2 months, grade
structure with the existing OpenClaw/grader modules: magnet strength,
air pockets, room to target, untouched target → **candidates ~15-25**.

**Stage 3 — Strike-level confirmation (candidates × 2 UW calls each).**
`flow-per-strike?date=` + `oi-change?date=` over the last 20 days AT the
magnet strikes: ask-side dominance + OI GROWING = opening accumulation
(the "verify whale flow" rule). Reject if flow is at other strikes than
the map magnet, or OI flat/shrinking (closing/rolling).

**Stage 4 — Trade-quality gate (per survivor).**
Live quote: spread% (stocks: hard filter, e.g. ≤8% of mid), premium band,
breakeven vs expected move, IV percentile (<70 per doctrine), earnings
date inside hold window (UW earnings calendar) → position plan: contract
= the accumulated strike/expiry (or one strike nearer), entry trigger =
structural level, target = magnet, invalidation = map-based.

**Output: morning Campaign Report (~9:50 ET)** — ranked candidates with
the full evidence chain per name (flow stats, map card, strike
confirmation, quality gate) + explicit rejects with reasons.

## Validation BEFORE anything is acted on (non-negotiable, per 7/08 lessons)

1. **Cohort backtest**: for each of the last ~40 business days as a
   "formation date": run Stages 1-3 exactly as of that date (UW endpoints
   are historical; Skylit surfaces from the archive + retention window)
   → candidates per cohort → measure forward 10/20-day outcomes.
2. **Real option dollars**: price each candidate's actual contract with
   UW daily contract history (`/option-contract/{occ}/historic`) — entry
   at next-day open mark, exits at target/invalidation/time. NO bps proxy.
3. **Stability-first ranking**: run results through the policy simulator's
   9-check framework (odd/even cohorts, first/second half, sector splits,
   flow-strength terciles). Nothing graduates past `research_more` without
   passing holdouts.
4. **Controls**: (a) placebo cohort — random tickers with similar liquidity,
   (b) flow-only (no map) and map-only (no flow) ablations to prove the
   INTERSECTION carries the edge, not either leg alone.

## What is explicitly out of scope for v1
- Auto-trading, live sizing (report + observation only)
- Bearish campaigns (put accumulation) — v2 after bull path validates
- Intraday management (this system's cadence is daily; the 0DTE system
  stays untouched and separate)

## Costs
- Stage 1 daily: 378 UW calls. Backtest: ~40 cohorts × (378 + shortlist
  drills) — run over 2-3 nights with pacing, or sample cohorts (every 2nd
  day = 20 cohorts) to halve it.
- Skylit: shortlist-sized pulls only (~60/day live; archive covers backtest).

## Open decisions
1. Stage-1 thresholds: start at doctrine values (20d net > $50M scaled by
   market cap? or absolute) — calibrate on cohort 1 without peeking forward.
2. Hold horizon: 10 vs 20 trading days (validate both).
3. Cohort sampling: all 40 vs every-other (cost/latency trade-off).
