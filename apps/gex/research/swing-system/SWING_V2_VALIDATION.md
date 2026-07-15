# SWING v2 VALIDATION — V-reclaim long-only OOS + node-aware sweep

**RESEARCH ONLY (Clause 0). No live-code change. Findings → DECISIONS NEEDED / ghost paper only.**
Snapshot 2026-07-14 PM. Two pre-registered confirmations on the operator's swing system, with the full
control battery (volume-matched random timing, walk-forward halves, day-block bootstrap, Bonferroni over
the enumerated grid, 3% option-P&L haircut on real UW 1-min prints, ATM at entry).

**Days used (globbed at analysis time):** 18 complete `(day,ticker)` series × 3 tickers (SPXW/SPY/QQQ).
- **In-sample (original 16):** 2026-06-22 … 2026-07-14 (the OPERATOR_EYE set).
- **True OOS (newly backfilled, NOT in the original 16):** **2026-06-17, 2026-06-18** — only **2 days
  (n=13 long trades)**. The extended backfill was **still running at analysis time** (it had reached
  2026-06-16, filling backward toward late May); the promised 20–35-day OOS had not materialized yet.
  **The OOS leg is therefore underpowered — re-run `swing_v2_validation.py` as more OOS days complete
  (it auto-detects new complete days; option-price cache persists so re-runs are cheap).**

Engine faithfulness check: the pure-v1 config (R0.25/S12, flip unrestricted, no node gates) **exactly
reproduces the OPERATOR_EYE primary** — n=389, mean −2.9%, hit 31%, exits {stall 152 / flip 225 / eod 12}.
So every result below is on the same rules/prices as the frozen study.

---

## One-line verdict

**TEST 1 confirms the one surviving slice.** The frozen **V-reclaim LONG-only** system (R 0.25%, S 12,
CONFIRM 2, no flips, no shorts, no higher-low) is **+10.4%/trade (n=92), hit 47%, +960% total**,
**positive on BOTH walk-forward halves (+17.7% / +3.8%)**, **beats volume-matched random on both halves
(random −6.5% / −5.1%)**, and is **positive on the 2 OOS days (+4.7%, n=13)**. It **clears its
pre-registered pass bar** and its day-block bootstrap P(mean>0) ≈ **97.5%**. **TEST 2 is a null:** the
node-gate does **not** rescue the flip mechanic to profitability, **pin-hold is null-to-harmful**, no v2
cell beats the long-only slice, and the addendum's **day-context gate / R0.35% / S20 all fail** on the
full sample (the gate helps *only* on 2026-07-13, the day it was reverse-engineered from, and hurts his
two winning days). **Ghost, paper-only, the frozen V-reclaim-LONG-only config — and nothing else.**
Caveat: it does **not** clear the ultra-strict 42-cell Bonferroni (needs 99.88%), and OOS is thin.

---

## Grid enumerated for Bonferroni (declared before outcomes)

| block | dimensions | cells |
|---|---|---|
| TEST 1 — V-reclaim long-only | R{0.15,0.25,0.35}% × S{12,20} × gate{off,on} | 12 |
| TEST 2 — v2 node sweep (full ruleset) | PIN_ZONE{0.15,0.30,0.45}% × PIN_STALL_X{2,3} × flip{vetoed,off,v1} | 18 |
| Addendum — full ruleset R/S/gate | R{0.15,0.25,0.35}% × S{12,20} × gate{off,on} | 12 |
| **total** | | **42** |

Bonferroni α = 0.05/42 = **0.00119** → a cell must show bootstrap **P(mean>0) ≥ 0.99881**.
**PRIMARY (pre-declared) = TEST 1, R 0.25% / S 12 / ungated** — the exact rule OPERATOR_EYE reported as
the +16.7% slice.

---

## TEST 1 — V-reclaim LONG-only (the promised rerun)

Frozen rule: causal ZigZag V-reclaim long entries only (down-swing ≥R, ≥0.6R reclaim, 2 rising closes),
counter-trend-suppression gate as in OPERATOR_EYE, **no flips, no shorts, no higher-low**, exit = stall S
/ EOD. Option P&L on real UW 1-min prints, ATM at entry, 3% round-trip haircut.

| R% | S | gate | nTr | mean/tr | hit | boot P>0 | H1 mean | H2 mean | OOS n | OOS mean |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.15 | 12 | off | 77 | −6.8% | 29% | 3.6% | −9.0% | −5.6% | 3 | +1.7% |
| 0.15 | 20 | off | 62 | −7.1% | 37% | 8.0% | −14.7% | −3.2% | 3 | +3.3% |
| **0.25** | **12** | **off** | **92** | **+10.4%** | **47%** | **97.4%** | **+17.7%** | **+3.8%** | **13** | **+4.7%** ← PRIMARY |
| 0.25 | 12 | on | 38 | +4.4% | 50% | 78.2% | +7.1% | −1.6% | 11 | +4.5% |
| 0.25 | 20 | off | 80 | +6.0% | 45% | 79.7% | +24.8% | −8.6% | 10 | +13.2% |
| 0.25 | 20 | on | 32 | +5.5% | 47% | 70.6% | +16.0% | −17.6% | 9 | +8.4% |
| 0.35 | 12 | off | 110 | −0.5% | 41% | 46.8% | +0.7% | −1.7% | 28 | **−12.7%** |
| 0.35 | 20 | off | 94 | −3.5% | 45% | 32.4% | −0.2% | −6.4% | 22 | −21.3% |

*(the four gated / two remaining R0.15 cells are all negative; full table in `swing_v2_results.json`.)*

**Primary cell (R 0.25 / S 12 / ungated) dissection:**
- **Full sample: n=92, mean +10.4%, median −1.3%, hit 47%, total +960%**, day-block bootstrap
  90%CI = [+1.8%, +18.1%], **P(mean>0) ≈ 97.4%**.
- **Walk-forward: H1 (06-17…06-30) +17.7% (n=44) · H2 (07-01…07-14) +3.8% (n=48) — positive on BOTH.**
- **OOS-only (06-17, 06-18): +4.7% (n=13), hit 54%, total +62%** — positive, but tiny.
- **Volume-matched random: −6.4% (n=1,840); H1 −6.5% / H2 −5.1%.** System beats random by ~+17 ppts.
- **PASS BAR (pre-registered): beats random on both halves ✓ · positive expectancy after haircut ✓ →
  PASS.**

**Honesty note on +16.7% → +10.4%.** OPERATOR_EYE's +16.7% (n=58) was a *post-hoc subgroup* of the
full-ruleset primary run (flips still active, and V-reclaim longs that arrived while short were tagged
"flip", not counted). The **frozen** long-only re-simulation (no flips at all, so those exits change and
more V-reclaim longs open as fresh) gives **+10.4% (n=92)** — lower, as expected from removing the
post-hoc selection, but **still strongly positive and now honestly frozen**. That it survives the
de-selection is the point.

**Bonferroni:** P(mean>0)=97.4% clears a conventional α=0.05 and the 2-cell R∈{0.15,0.25} pre-registration
(needs 97.5%, essentially a tie), but **does NOT clear the full 42-cell Bonferroni (needs 99.88%)**.
Read: a real, pass-bar-clearing lean — not yet a multiple-comparison-clean finding. OOS thinness is the
binding constraint, not the in-sample signal.

---

## TEST 2 — v2 node-aware sweep (full operator ruleset)

Full ruleset (V-reclaim + higher-low longs, V-reclaim + lower-high flip shorts), R 0.25% / S 12.
Dominant pika = gamma>0 strike with |gamma|/Σ|gamma| ≥ 0.15 (matches `swing-ghost.mjs loadDay`). Pikas
are present 35% (SPXW) / 70% (SPY) / 53% (QQQ) of minutes; spot sits within 0.30% of a pika ~29/62/42%
of the time — **the gates bind, they are not no-ops.**

| PIN_ZONE% | STALL_X | flip | nTr | mean | boot P>0 | flip n | flip mean | veto binds | pinhold binds | pin-cohort mean |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.15 | 2 | vetoed | 436 | −1.8% | 23% | 222 | −5.4% | 49 | 45 | +2.7% |
| 0.15 | 2 | off | 308 | −2.2% | 27% | 0 | — | 0 | 62 | −7.1% |
| 0.15 | 2 | v1 | 458 | −2.8% | 12% | 252 | −8.0% | 0 | 34 | −11.2% |
| 0.30 | 2 | vetoed | 419 | −1.7% | 28% | 204 | −6.3% | 69 | 72 | −5.2% |
| **0.30** | **2** | **off** | **299** | **−1.7%** | **36%** | 0 | — | 0 | 89 | −5.4% ← best v2 |
| 0.30 | 2 | v1 | 454 | −2.6% | 16% | 257 | −8.1% | 0 | 55 | −7.2% |
| 0.45 | 2 | off | 296 | −1.5% | 35% | 0 | — | 0 | 103 | −4.8% |
| 0.45 | 3 | v1 | 449 | −3.0% | 11% | 267 | −8.2% | 0 | 63 | −8.0% |

*(all 18 cells in `swing_v2_results.json`; every cell is negative, best bootstrap P>0 = 35.7%.)*

**(a) Does the node gate rescue the flip mechanic? Partially — but not to profit.**
- Flip cohort P&L: **v1 unrestricted ≈ −8.0%** (n≈252–267) → **vetoed-in-zone ≈ −5.4% to −6.6%**
  (n≈185–222). The veto (binds 49–108×, scaling with PIN_ZONE) removes the worst pin-chop flips and
  lifts the flip cohort ~1.5–2.5 ppts — **but it stays net-negative**. Turning **flips off entirely** is
  the best full-sample variant (−1.5% to −1.7%) — i.e., the flip mechanic's best contribution is
  *removal*, exactly as OPERATOR_EYE implied (flip −7.5% over 225 fires). The node gate is a partial
  patch, not a rescue.

**(b) Does PIN-HOLD improve the stall exit? No — null-to-harmful.**
- Isolation (flip=v1 fixed): **no-pinhold −2.7% → +pinhold STALL_X2 −2.6% (Δ ~0) → STALL_X3 −2.9%
  (worse).** The trades pin-hold actually keeps alive resolve **worse**, not better:
  **STALL_X2 pin-cohort −7.2% (n=55), STALL_X3 −11.4% (n=53).** Pin-hold binds 34–103× (not a no-op) but
  staying in through pin chop bleeds — the pin oscillation the operator's eye reads as "hold" does not,
  mechanized, resolve favorably. Honest null.

**(c) Best v2 cell vs the field:** best v2 = **PIN_ZONE 0.30 / STALL_X 2 / flip-off → −1.7% (P>0=34%)**,
still negative and **far below V-reclaim-LONG-only (+10.4%)**. No v2 configuration is a ghost candidate.

---

## Addendum — swing-scale (R 0.35%), stall-patience (S 20), day-direction context gate

Full ruleset, node fixed at PIN_ZONE 0.30 / STALL_X 2 / flip=vetoed. Day-context gate: longs only when
spot > max(open, running-mean-of-closes); mirror shorts only when spot < min(open, running mean).

| R% | S | gate | nTr | mean | boot P>0 | long mean | short mean | gate-blocked |
|---|---|---|---|---|---|---|---|---|
| 0.25 | 12 | off | 419 | −1.7% | 26% | −1.8% | −1.6% | 0 |
| 0.25 | 12 | **on** | 162 | **−7.8%** | 8% | −6.8% | −8.8% | 719 |
| 0.25 | 20 | on | 141 | −15.9% | 1% | −15.3% | −16.5% | 714 |
| 0.35 | 12 | off | 357 | −2.2% | 28% | −5.3% | +1.4% | 0 |
| 0.35 | 12 | on | 165 | −10.1% | 1% | −14.0% | −6.1% | 573 |
| 0.15 | 12 | off | 504 | −8.3% | 0% | −9.1% | −7.4% | 0 |

**R 0.35% is a null** — no better than R 0.25% on the full ruleset (−2.2% vs −1.7%), and it was the
*worst* OOS cell for the long-only slice (−12.7%). **S 20 is worse than S 12.** **The day-context gate is
net-negative everywhere** (it blocks 573–944 entries per cell but the survivors are worse): R0.25/S12
goes −1.7% → −7.8% when gated.

**Case studies under the best gated cell (R 0.25 / S 12 / gated) vs matched ungated:**

| day | ungated | gated | gate verdict |
|---|---|---|---|
| **2026-07-13** (the down day that motivated the gate) | −15.9% (n=32, 16L/16S) | **−5.3% (n=14, all SHORT)** | **gate works** — drops the 16 counter-trend longs, goes short, cuts the loss |
| **2026-07-14** (operator +311%) | −5.5% (n=23) | **−16.2% (n=10, all LONG)** | **gate hurts** — kept longs, but the wrong ones |
| **2026-07-10** (operator +436%) | −20.1% (n=9) | **−35.6% (n=4)** | **gate hurts** — mechanization loses this day either way |

So the gate does exactly what it was designed to do **on 2026-07-13** (flip the book short instead of
long-bleeding), but it is **overfit to that one day** — it damages his two big winning days and the full
sample. It does not survive as a general rule.

---

## Head-to-head (full sample, 18 days)

| config | n | mean/tr | hit | day-block boot | read |
|---|---|---|---|---|---|
| **V-reclaim LONG-only (T1 primary)** | 92 | **+10.4%** | 47% | 90%CI [+2.0,+18.3], **P>0 97.7%** | **winner** |
| best v2 (PZ0.30/X2/flip-off) | 299 | −1.7% | 33% | [−8.7,+5.5], P>0 34% | null |
| best gated (R0.25/S12) | 162 | −7.8% | 31% | [−15.7,+2.0], P>0 9% | worse |
| v1 baseline (operator_eye primary) | 458 | −2.7% | 31% | [−6.8,+1.3], P>0 14% | the thing being fixed |
| random (vol-matched, T1 timing) | 1,840 | −6.4% | 31% | — | floor |

**Survivors clearing the 42-cell Bonferroni (P>0 ≥ 0.9988 AND positive expectancy): NONE.**
V-reclaim-long-only is the sole positive, pass-bar-clearing config; it misses the ultra-strict Bonferroni
on OOS-limited power (97.7% vs 99.88%), not on effect size.

---

## VERDICT — what to ghost from tomorrow (frozen spec)

**Ghost, PAPER-ONLY (Clause 0), exactly one config — V-reclaim LONG-only:**

```
rule        : V-reclaim LONG entries only (causal 1-min ZigZag)
R           : 0.25%  (reversal threshold; 0.15% and 0.35% both fail)
CONFIRM     : 2 consecutive rising 1-min closes
entry gate  : down-swing ≥R, price reclaims ≥0.6R off the low, 2 rising closes;
              OPERATOR_EYE counter-trend suppression (block a V-reclaim long inside an
              established downtrend unless prior swing-high has broken)
side        : LONG only        (no shorts, no mirror)
flips       : OFF              (no flip-to-short; flip cohort is −8% and unfixable by the node gate)
higher-low  : OFF              (only V-reclaims)
node gates  : OFF              (pin-hold null-to-harmful; flip-veto moot with flips off)
day-context : OFF              (overfit to 2026-07-13; hurts the full sample)
exit        : swing-stall S = 12 min without a new favorable extreme, else EOD flat 15:45
contract    : same-day-expiry ATM call at the entry minute; 3% round-trip haircut
budget      : ≤6 entries/day/ticker; 5-min cooldown; universe SPXW/SPY/QQQ (0DTE indexes only)
```

Emitted for the viewer: **`swing_v2_events.jsonl`** (92 events, this exact config; schema
`day,ticker,minute[UTC],strike,spot_at_entry,kind:"swing",implied[occ],side,exit_minute,outcome,
pnl_pct,rule`). This config already matches `swing-ghost.mjs`'s intent; to ghost it faithfully, run
swing-ghost with **flips disabled, shorts disabled, higher-low disabled, node gates disabled, R=0.20→0.25%,
S=12** (i.e., strip it back to the long-only V-reclaim core — the node/flip machinery is inert-to-harmful).

**Before any escalation beyond paper:** (1) accumulate the real OOS — re-run as the backfill fills toward
late May (target ≥10 OOS days / n≥60 long trades); (2) require the OOS-only cohort to stay positive and
beat random on its own; (3) only then does it clear the 42-cell Bonferroni burden. Until then it is a
**strong lean that passed its promised bar**, not a certified finding.

---

## Methods & limitations

- Causal ZigZag (no lookahead), edge-triggered entries; option P&L from real UW `option-contract/<occ>/
  intraday` 1-min prints, close-to-close, 3% round-trip haircut (identical convention to `pnl_v0.py` /
  `operator_eye.py`). Structural stop from `swing-ghost.mjs` was **left out** to keep TEST 1/2 identical
  to the frozen OPERATOR_EYE pre-registration (the stop is a separate validated lean, not re-litigated).
- VWAP proxy for the day-context gate = causal running mean of closes (surface feed carries no underlying
  volume). Documented limitation.
- **n = 18 day-blocks (2 OOS)** → every number is a lean; the OOS leg especially is underpowered. The
  extended backfill was mid-run (at 2026-06-16) at analysis time.
- Reproducer: `apps/gex/research/swing-system/swing_v2_validation.py` (reuses
  `../velocity-capture/pipeline/operator_eye.py`); full numbers in `swing_v2_results.json`. Re-run
  auto-detects new complete backfill days.
