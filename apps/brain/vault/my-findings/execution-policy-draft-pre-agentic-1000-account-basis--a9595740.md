---
title: Execution Policy — DRAFT (pre-agentic, $1,000 account basis)
source_url: repo://apps/gex/docs/execution-policy-draft.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T16:26:49Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
summary: '**Status: DRAFT. No agentic execution exists yet. This document must be frozen and user-approved BEFORE the first live order. The agent executes this policy verbatim — it has no discretion to exceed it,'
url_sha1: a95957409e3c5119332cb742cd45b77f867a6577
simhash: '14698032093127577078'
status: vault
ingested_by: seed
---

# Execution Policy — DRAFT (pre-agentic, $1,000 account basis)

**Status: DRAFT. No agentic execution exists yet. This document must be
frozen and user-approved BEFORE the first live order. The agent executes
this policy verbatim — it has no discretion to exceed it, ever.**

Scaling note: all dollar figures are percentages of account equity and
scale automatically; $1,000 examples shown.

## 1. Position sizing (per trade)

| Rule | Value | @$1,000 |
|---|---|---|
| Max premium per trade | 10% of equity | $100 |
| Contracts | 1 only — no adding, no averaging | 1 |
| Eligible premium band | $0.50 – $2.00 | matches the validated best-EV band |
| Instruments | SPY / QQQ only (SPXW premium ≥$5 violates the 10% cap at this size) | — |

The $0.50-2.00 band was the highest-EV premium band in the 64-day study
(+6.9%, 59% win) — at $1,000, correct risk sizing and the researched edge
point at the same contracts. That is not a coincidence to waste.

## 2. Daily rules

| Rule | Trigger | Action |
|---|---|---|
| Daily loss stop | −15% of equity ($150) realized on the day | flat, no new entries until next session |
| Consecutive losses | 3 straight losing trades | done for the day regardless of P&L |
| Max concurrent positions | 2 (dedupe already enforces 1 per ticker+direction) | queue/skip further signals |
| Trade count cap | 5 entries/day | prevents churn on whipsaw days |
| Green-day lock (optional) | +25% day ($250) | optional stop; log either way |

## 3. Account drawdown ladder (from high-water mark)

| Drawdown from HWM | Action |
|---|---|
| −10% | warning logged, no change |
| −20% | **size halved** (5% per trade) until equity makes a new 5-day high |
| −30% | **full halt.** No trades. Post-mortem required: re-run the policy simulator including the losing period; system must re-earn `candidate` status before resuming |
| −40% | unreachable by construction (halt at −30%) — if ever touched, the system is retired pending redesign |

Recovery restores size on **equity milestones, not time**: half-size until
a new 5-day equity high, full size only at a new all-time HWM.

## 4. Weekly circuit breaker
−25% in any rolling 5 sessions → flat until the next Monday + written
review of every losing trade against its observation-log features.

## 5. What the agent may NEVER do
- Exceed any cap above, for any reason, including "high conviction"
- Trade a signal that fails the frozen entry policy (validated policy TBD
  from forward data — currently flags_eq_0 is the leading candidate)
- Enter after 15:15 ET, hold 0DTE past 15:55 ET
- Trade during a halt state
- Modify this policy (changes require user approval + a new frozen version)

## 6. Every order carries its evidence
Each execution logs: policy version, signal features (red flags, flow,
GEX state), account state (equity, HWM, drawdown, day P&L, trade count),
and which rule sized it. Same observation-record discipline as the
research pipeline — the live book becomes its own audit trail.

## Worst-case math @ $1,000 (why these numbers)
Max single-day damage: min(5 trades × $100 premium, $150 daily stop) →
**−$150 (−15%)**. Max damage before forced halt: **−$300 (−30%)**, reached
no faster than ~2 bad days with the ladder engaged. The account survives
≥6 worst-case days before retirement review — enough runway for a
41%-win-rate right-tail system to express its edge without ruin risk.
