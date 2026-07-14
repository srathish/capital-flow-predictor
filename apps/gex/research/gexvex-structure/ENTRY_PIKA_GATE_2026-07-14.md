# ENTRY PIKA GATE — pre-registered test (2026-07-14)

**RESEARCH ONLY (Clause 0).** No live code touched. Any recommendation lives in DECISIONS NEEDED.

**Scripts:** `research/gexvex-structure/entry_pika_gate.mjs` (pre-registered sweep),
`research/gexvex-structure/entry_pika_gate_bull.mjs` (confounder autopsy of the one live-looking cut).

## VERDICT: **NULL — REJECT.** And the motivating case kills it in the most direct way possible.

The hypothesis was that a near, significant *opposing* pika at fire time marks a
negative-EV entry. On 1,295 replay fires / 61 days it does not. **The blocked cohort
is *profitable*** (+5.5% to +10.6% avg realized, win rate 51–54% vs a 53% baseline) —
the gate does not find bad fires, it finds *ordinary* fires and deletes 11–56% of the
winners along with them. **0 of 36 pre-registered cells pass.**

Then the out-of-sample forensic on the very day that motivated the study (below):
the gate **misses the −63% worst loser entirely** and **blocks the +60% winner**.

---

## Pre-registration

- **Gate (plain):** block a fire iff, at fire time, the opposing pika anchor — bull → strongest
  pika at/above spot (ceiling); bear → strongest pika at/below spot (floor), *exactly*
  `evaluateSurfaceExit`'s definition in `src/tracker/plays.js:242-244` — is within **X%** of spot
  AND has **relSig ≥ R**.
- **Gate (HARD variant):** plain + already-hardening vs a **pre-fire** baseline 30m before the fire:
  relSig ≥ 1.5× and gained ≥ 5pp (mirrors `INVALIDATE_ANCHOR_RATIO` / `_MIN_GAIN`).
- **Sweep:** X ∈ {0.3%, 0.5%, 1.0%} × R ∈ {0.08, 0.12, 0.20}. R anchors are the live constants
  (`INVALIDATE_ANCHOR_MIN_RELSIG=0.08`, `PIN_MIN_RELSIG=0.20`).
- **Pools:** ALL fires, and the **post-bull-tape-gate mix** (the incremental-value test).
- **Pass bar:** blocked cohort clearly negative-EV **AND** gated system beats ungated on **both**
  walk-forward halves **after** a multiple-comparisons discount.

**Data.** 1,295 fires with real per-minute UW option-mark paths (`research/exit-study/fires_index.json`
+ `cache/`), 61 days, 2026-04-10 → 2026-07-08, index-only. Surfaces reconstructed **causally** from
`data/skylit-archive/intraday/<day>/<TICKER>.jsonl.gz` — last 5-min frame **at or before** the fire
(median staleness 0.0m, p95 0.0m; fires land on frame boundaries). Nodes rebuilt exactly as
`fire-loop.js:199-216` / `domain/significance.js:56-57`: `relSig = |gamma| / Σ|gamma|`, `sign = gamma > 0 ? pika : barney`.

**P&L.** The verified scale-out ladder (⅓ @+50%, ⅓ @+100%, trail gb30/stop60), **2-consecutive-bar
confirmed rung fills, 3% haircut on market legs** — the realistic settings from
`exit-study/SCALEOUT_VERIFY_2026-07-13.md`. Robustness re-run under LIVE-TRAIL and HOLD-EOD.
Ungated baseline: **n=1,295, avg +7.1%, win 53%, PF 1.24.**

---

## 1. The blocked cohort is POSITIVE-EV. That alone ends it.

ALL fires, plain gate (ladder P&L, %):

| X | R | nBlk | **blkAvg** | blk 95% CI | kptAvg | ΔTrain | ΔTest | blkWin% | winner-kill | gain-kill |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.3% | 0.08 | 512 | **+8.5** | [+2.1, +15.3] | +6.2 | +3.8 | −6.0 | 53% | 40% | 41% |
| 0.3% | 0.12 | 350 | **+8.9** | [+0.8, +17.3] | +6.5 | +1.7 | −3.1 | 53% | 27% | 28% |
| 0.3% | 0.20 | 143 | **+10.6** | [−1.7, +23.9] | +6.7 | +0.5 | −1.4 | 54% | 11% | 12% |
| 0.5% | 0.08 | 635 | **+6.4** | [+0.4, +12.3] | +7.9 | +6.2 | −4.8 | 51% | 48% | 49% |
| 0.5% | 0.12 | 414 | **+6.3** | [−0.8, +13.8] | +7.5 | +2.8 | −2.0 | 51% | 31% | 33% |
| 0.5% | 0.20 | 157 | **+8.2** | [−3.9, +21.0] | +7.0 | +0.9 | −1.2 | 52% | 12% | 12% |
| 1.0% | 0.08 | 720 | **+5.5** | [+0.3, +11.1] | +9.2 | +8.3 | −4.6 | 51% | 54% | 55% |
| 1.0% | 0.12 | 453 | **+5.8** | [−1.3, +12.9] | +7.9 | +2.6 | −1.2 | 51% | 34% | 35% |
| 1.0% | 0.20 | 160 | **+6.8** | [−5.2, +19.2] | +7.2 | +1.2 | −1.1 | 51% | 12% | 12% |

The claim required these fires to be **negative**-EV. They are **positive**-EV in all 9 cells —
three of them with a bootstrap CI strictly **above** zero. The blocked cohort's win rate (51–54%)
is indistinguishable from baseline (53%). Blocked-minus-kept separation is a coin flip
(P(diff ≥ 0) = 0.19 … 0.71 across cells; every CI spans zero).

**ΔTest is negative in all 9 cells.** The gate is not just useless out of sample, it is *harmful*.

### The strongest cell is the wrong sign
Continuous relation, no thresholds — ladder avg by (anchor distance × relSig):

| dist \ relSig | [0, 0.08) | [0.08, 0.12) | [0.12, 0.20) | [0.20, 1) |
|---|---|---|---|---|
| **[0.0, 0.3%)** | +6.1 (210) | +7.8 (162) | +7.7 (207) | **+10.6 (143)** |
| [0.3, 0.5%) | +7.9 (118) | +2.9 (59) | −5.5 (50) | −15.9 (14) |
| [0.5, 1.0%) | +11.8 (164) | −1.9 (46) | +6.8 (36) | −68.3 (3) |
| [1.0, 2.0%) | +18.8 (51) | −20.6 (9) | −1.9 (5) | −64.1 (1) |
| [2.0%, ∞) | +24.4 (17) | — | — | — |

The hypothesis says the top-right cell (nearest + most dominant opposing pika) should be the
death zone. **It is the single best cell in the table** (+10.6%, n=143). The hypothesis's sign is
inverted right where it was supposed to be strongest. (The genuinely ugly cells sit at *medium*
distance with high relSig, but those are n = 14 / 3 / 9 / 5 / 1 — post-hoc noise, not a rule.)

## 2. The mirror inverts — the classic shadow signature

Blocked-cohort avg, by direction (ALL fires, plain gate):

| X | R | BULL blocked | BEAR blocked | BULL kept | BEAR kept |
|---|---|---|---|---|---|
| 0.3% | 0.08 | −1.0 (n=169) | **+13.2 (n=343)** | +16.6 | −1.1 |
| 0.5% | 0.08 | −0.3 (n=185) | **+9.1 (n=450)** | +17.2 | −0.1 |
| 1.0% | 0.12 | +0.3 (n=123) | **+7.9 (n=330)** | +14.0 | +3.0 |

For **bears** the gate blocks the *best* trades on the book (+13.2% avg). Two-thirds of everything
it blocks is a bear. A structural rule that works one way and reverses the other is exactly the
pattern that killed the bear tape gate (`BEAR_GATE_2026-07-13.md`) and 76 of 77 structure rules.

## 3. The one live-looking cut (bull-only) fails walk-forward — and the confounders are *not* what kills it

Bulls only (n=492, ungated avg +10.6%), ceiling gate X=0.5%/R=0.08:

- Full sample: blocked −0.3 vs kept +17.2 → **blk−kpt = −17.5**, day-clustered bootstrap CI
  **[−34.0, −1.1]**, p = 0.019. LOO-stable (worst −21.2, best −15.1). Present in all three tickers
  (SPXW −15.6, SPY −20.8, QQQ −14.7). Looks alive.
- **It isn't.** Walk-forward:
  - **TRAIN** (30 days): blocked −5.2 / kept **+29.4** → Δsystem **+11.9**
  - **TEST** (30 days): blocked **+4.5** / kept **+1.0** → Δsystem **−1.5**

  Out of sample the *blocked* bulls are the **more** profitable cohort. The entire separation is a
  train-half artifact. **0 of 9 bull cells pass Bonferroni (α = 0.0056) plus both-halves-positive.**

I still ran the two confounders, because an honest null should say *why* it isn't an edge:

- **Not a tape shadow.** Overlap with the bull tape gate is only 6–11% of blocked fires. The gate
  fires at 39% of `n_above=0` fires and 35% of `n_above=3` fires — it is essentially orthogonal
  to tape, and the in-sample separation survives stratification by `n_above`.
- **Not mass-below-spot** (the one confirmed factor). Blocked fires have mildly *less* mass below
  (0.518 vs 0.607), but the in-sample separation persists inside every massBelow tercile
  (low −14.1, mid −12.9, high −30.0).

So this is not a shadow of a known rule — it is simply **an in-sample coincidence that does not
generalize.** Which is the more common failure mode, and the harder one to talk yourself out of.

## 4. Incremental over the bull tape gate: none

On the post-tape-gate mix (1,135 fires), the plain gate gets **worse**, not better: at X=0.3%/R=0.08
the blocked cohort is **+10.1%** (CI [+3.4, +17.1]) and ΔTest = **−5.9**. Every plain cell still has
ΔTest < 0. There is nothing left for it to add.

## 5. The HARD (already-hardening) variant: the only non-inverted family, still a null

Requiring the anchor to be *already hardening* at fire time (≥1.5× and +≥5pp vs 30m pre-fire) does
flip the blocked cohort mildly negative — the only version of the idea that points the right way:

| pool | X | R | nBlk | blkAvg | blk 95% CI | ΔTrain | ΔTest | winner-kill | nominal p |
|---|---|---|---|---|---|---|---|---|---|
| post-tape-gate | 1.0% | 0.12 | 99 | **−8.5** | **[−23.7, +7.3]** | +1.1 | +2.3 | 9% | 0.146 |
| post-tape-gate | 0.5% | 0.12 | 95 | −8.0 | [−23.5, +7.8] | +1.3 | +1.8 | 8% | 0.159 |
| ALL | 1.0% | 0.12 | 110 | −4.7 | [−19.5, +10.5] | +1.1 | +1.4 | 9% | 0.259 |

This is the only cell family with **both walk-forward halves positive** and a low winner-kill (8–9%).
It is also **not significant**: the blocked-cohort CI straddles zero, nominal p = 0.15 against a
Bonferroni α of **0.05/36 = 0.0014**. A ~100-fire cohort with a mean of −8.5% and a 31-point CI is
not evidence of negative EV; it is evidence of nothing. **Pre-registered pass bar: FAIL.** I am
recording it because it is the only direction worth *re-testing* on future data, not because it is
an edge today. Note that this variant only blocks 9–13% of fires — the effect it is chasing is
rare, which is precisely why it cannot be resolved with 61 days.

## 6. The forensic that ends the argument: 2026-07-14 itself

The archive stops 2026-07-08, so the motivating day is **true out-of-sample**. I reconstructed the
gate from each play's own persisted `supporting_state.surfaceBaseline` (the fire-time surface the
live system actually recorded), and applied the gate to all five fires:

| time (ET) | play | peak | realized | opposing anchor @ fire | gate (0.5%, 0.08) |
|---|---|---|---|---|---|
| 09:30 | SPXW 7530C | +11% | +3% | $7600, relSig 4.6%, dist 0.93% | allow |
| **09:45** | **QQQ 720C** | **−13%** | **−63%** | $726, relSig **7.6%**, dist **0.85%** | **ALLOW ❌** |
| 11:51 | QQQ 720C | −2% | −36% | $723, relSig 13.8%, dist 0.43% | **BLOCK ✓** |
| 11:51 | SPXW 7540C | +48% | +33% | $7585, relSig 4.8%, dist 0.63% | allow |
| **15:11** | **QQQ 720C** | **+73%** | **+60%** | $720, relSig **19.6%**, dist **0.00%** | **BLOCK ❌** |

- The **worst loser (−63%)** — the fire that motivated the whole hypothesis — sits at relSig **7.6%**,
  just *under* the R=0.08 floor, and 0.85% away. **The gate lets it through.** Loosening R to catch it
  would blow up the block count and the winner-kill.
- The **winner (+60%)** has the **nearest and most dominant** opposing pika of any fire that day
  (dist 0.00%, relSig 19.6%) — it fires *harder* on the winner than on either loser. **The gate kills it.**
- Net effect on 2026-07-14: removes −36% and +60%. **Strictly worse.**

This is the continuous table from §1 playing out live: near + dominant opposing pika is not death,
it's the *best* bucket. The 720 pika was the same node in all three trades. **What differed was
the tape, not the map.** The 15:11 call won *into* a dominant $720 pika because price was pushing
through it; the 09:45 call died with a *weaker* one because it wasn't.

---

## What this actually says about the two losers

The granularity study's finding stands — the loss *was* baked in at entry (negative peak, never
green). But **"baked in at entry" ≠ "visible in the fire-time surface."** The opposing-pika
configuration at 09:45 (−63%) was *milder* than at 15:11 (+60%). The entry-time map did not know.
The hardening that killed those trades happened **after** the fire — which is exactly why
`evaluateSurfaceExit` (a *diff* against a baseline) catches it and a *static* fire-time snapshot
cannot. The exit rule fired correctly on all three; two of them simply had nothing left to save.

The 77-study prior held. This is the 78th.

---

## DECISIONS NEEDED

**None. Do not ship an entry pika gate.** No parameterization tested is even directionally safe:
the plain gate deletes profitable fires and, on the motivating day, would have vetoed the winner
while waving through the worst loser.

Optional, zero-risk follow-up (research only, no code):
1. **Log, don't gate.** The HARD variant (anchor already hardening pre-fire, X=1.0%, R=0.12) is the
   only non-inverted signal. It blocks ~9% of fires. Worth *recording* per fire in the paper tracker
   so the cohort accumulates; re-test at n≈300 blocked. Today it is a null.
2. The real open question the 07-14 data raises is the **wall-vs-escalator** one already on the board
   (`project_wall_vs_escalator`): a dominant pika at spot is *bullish fuel when price is pushing
   through it* and *death when it isn't*. That conditioning variable — not the pika's presence — is
   where the next entry edge, if any, lives.
