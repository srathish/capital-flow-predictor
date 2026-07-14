# Path Obstruction as a Dynamic EXIT / HOLD Signal — Pre-Registered Follow-Up

**Date:** 2026-07-14  **Status:** RESEARCH ONLY (Clause 0 — no live-code change; any
recommendation lives in DECISIONS NEEDED at the bottom).
**Script:** `research/gexvex-structure/path_obstruction.mjs` (reproducible; `node` it).
**Lineage:** direct follow-up flagged by `NODE_POSITION_2026-07-14.md` §7 / DECISION #3 —
path **obstruction** (a large gamma node between spot and the trade's target direction)
was the one doctrine concept that pointed the right way on both walk-forward halves and
survived the distance confound as an *entry* signal, but fell short of significance
(p≈0.08). The prior report's #1 recommendation: **test it as a HOLD/EXIT signal, not an
entry gate.** This is that study.
**Data:** replay fire set `research/exit-study/fires_index.json` → **1,295 fires / 61 days**
(60 dropped for missing option marks; 0 for missing surface). Surface features read
**causally** from `data/skylit-archive/intraday/<date>/<TICKER>.jsonl.gz` (clean 5-min
frames), snapshot **at or before** the evaluation time — fire-time staleness median/p95
= 0.0m. relSig mirrors `src/domain/significance.js`. Per-minute UW option marks for P&L.
**Baseline exit for every arm:** LIVE TRAIL (arm 0.50 / gb 0.15 / stop 0.60), 3% haircut.

---

## Pre-registration (formulas frozen before any outcome was computed)

**OBSTRUCTION SCORE** at an evaluation time, from the causal snapshot:
- **Primary:** sum of `relSig` over nodes with `relSig ≥ 0.08` strictly inside the
  directional window — `(spot, spot·1.015)` for calls / `(spot·0.985, spot)` for puts —
  **excluding the entry-strike node** (node nearest `fire.K`, which is ~ATM: median K−spot
  = 0.00%). `relSig = |gamma| / Σ|gamma|` over the frame (magnitude, sign-agnostic — a
  "wall in the path" per the doctrine).
- **Sensitivity:** same with `relSig ≥ 0.12` and a ±1.0% window.

**Hypotheses:**
- **H-A** (entry context, *confirmatory only*): high obstruction **at fire** → worse
  realized. Replicates the prior study's lean; **not** the primary claim.
- **H-B** (the **primary** claim — dynamic/exit): obstruction that **appears or grows after
  entry** kills the trade. Signal at a post-entry snapshot T: `O(T) ≥ 0.08 AND b0 < 0.08`
  (appeared) **OR** `b0 > 0 AND O(T) ≥ 2·b0` (doubled). Treatment = live trail **plus**
  force-exit on that signal (first of stop / obstruction / trail-giveback). Compared vs
  (1) the trail alone and (2) a **volume/exit-count-matched RANDOM exit-timing control**.
- **H-C** (the HOLD side): clear path + obstruction **not** growing → **suppress the
  trail's give-back this tick** (let winners run); hard stop never suppressed. Mirror of
  the live barney-fuel HOLD. Compared vs the trail alone.

**Controls (all mandatory, all run):** walk-forward both halves; matched random
exit-timing control for H-B (the rule only counts if it beats exiting at random snapshot
times on the *same* fires at the *same* frequency); day-block bootstrap p-values (resample
whole days, 5,000 draws); 3% haircut (2% reported as sensitivity); Bonferroni across cells.

**Baseline (all fires, live trail, 3% haircut): avg −4.5% / fire, win 47%, PF 0.86.**

---

## VERDICT

| hypothesis | claim | result |
|---|---|---|
| **H-B (PRIMARY)** | obstruction appearing/growing after entry is a useful EXIT | **NULL** — worse than the trail AND worse than random exit-timing |
| **H-C** | clear-path HOLD lets winners run, beats the trail | **NULL** — directionally +, not significant, walk-forward-unstable |
| **H-A** (confirmatory) | obstruction at entry predicts worse realized | **LEAN** — replicates prior (+9.8pt clear−obstructed) but p=0.094, OOS-fragile, non-monotone |

**The primary claim fails.** Using path obstruction as a dynamic exit does **not** enhance
the live trail; it actively **hurts** — and it loses to a coin-flip on exit timing. The
mechanism is clean and damning (see §H-B): obstruction *appears* precisely when price
travels toward its target, i.e. **when the trade is working**, so exiting on it **chops
winners**. The HOLD mirror (H-C) is a directionless null. The only surviving pulse is the
same entry-context lean the prior study already flagged (H-A), and it again fails to clear
significance. **This is the 14th consecutive structural hypothesis to die and it closes out
the structural entry/exit program.** The one validated edge remains the bull tape gate
(price structure, not the GEX surface).

---

## H-A — Entry context (confirmatory): CLEAR entry beats OBSTRUCTED, but not cleanly

Obstruction is common at fire: **75% of fires** enter with `b0 ≥ 0.08` (median b0 = 0.143).

| cohort | n | avg% | win | PF | train | test |
|---|---|---|---|---|---|---|
| **CLEAR at entry (b0 < 0.08)** | 322 | **+2.8** | 52% | 1.09 | +8.6 | **−2.2** |
| OBSTRUCTED entry (b0 ≥ 0.08) | 973 | **−7.0** | 46% | 0.80 | −8.2 | −5.6 |
| heavy (b0 ≥ 0.16) | 604 | −7.7 | 46% | 0.77 | −9.5 | −5.5 |

**clear − obstructed = +9.8pt**, day-block **p = 0.094**. Direction matches the prior study
(obstructed entries are worse) — so the lead **replicates** — but three things keep it a
LEAN, not an edge: (1) it does not clear nominal 0.05, let alone Bonferroni 0.01; (2) the
CLEAR cohort's edge is **train-only** (+8.6 train → **−2.2 test**); (3) the b0 deciles are
**non-monotone** — there is no dose-response, the signal collapses to a single spike at
*exactly-zero* obstruction:

| decile | b0 range | n | avg% |
|---|---|---|---|
| dec0 | [0.000, 0.000] | 129 | **+10.3** |
| dec1 | ~0.000 | 130 | −1.5 |
| dec2 | [0.000, 0.089] | 129 | −11.0 |
| dec3–9 | 0.089 → 0.685 | 908 | −1 … −11 (no ordering) |

So "obstructed = bad" is really "**exactly-clear = good**, everything else ≈ baseline-bad."
That is a fragile, non-graded signal, and OOS it evaporates. Confirmatory but not shippable.

---

## H-B — Dynamic obstruction EXIT (the primary claim): NULL, loses to random timing

Signal fired on **800/1,295** fires; it **bound** (moved the exit earlier than the trail)
on **449 (35%)**.

| arm | avg% | vs baseline | vs random |
|---|---|---|---|
| baseline live trail | −4.5 | — | — |
| **obstruction-exit (treatment)** | **−5.1** | **−0.6pt** (p=0.643) | **−0.8pt** (p=0.750) |
| matched random exit-timing | −4.4 | +0.1pt | — |

The treatment is **worse than the trail** and **worse than exiting at random times** at the
same frequency. Both walk-forward halves agree (treat−random = −0.4 train, −1.2 test).
Robustness — **same verdict** under every cut:
- **Sensitivity** definition (thr0.12 / ±1.0% / rel0.12): treat−random −0.7pt, p=0.722.
- **2% haircut**: treat−random −0.8pt, p=0.757.

**Why it fails — the mechanism (diagnostic).** On the 449 binding fires, the obstruction
exit fires at a mean option gain of **+10.4%** (median +2.8%); **53% of exits happen while
the option is in profit** (227 in profit vs 202 in loss). Obstruction *appears/grows in the
path* precisely because **price is moving toward its target and closing on the wall** — i.e.
the signal lights up **when the trade is working**. So the rule systematically **caps
winners early**:

| binding fires (n=449) | avg% |
|---|---|
| baseline (trail rides them) | **+9.1** |
| obstruction-exit | +7.4 |
| random exit | +4.3 |

Obstruction-timing *does* beat random-timing here (+3.1pt, nominal p=0.091) — but that is a
selection artifact: these are fires that were **winning**, so *any* forced early exit hurts,
obstruction-timed simply hurts **less** than random-timed. Both lose to **not forcing an
exit at all** (−1.7pt vs baseline). There is no usable exit edge: the honest all-fires test
(treat vs random) is −0.8pt at p=0.75.

---

## H-C — HOLD side (clear-path let-winners-run): NULL and walk-forward-unstable

Suppressing the trail's give-back whenever the path is clear (`O < 0.08`) and not growing
(`O ≤ b0`), hard stop retained:

| variant | fires changed | avg% (base→hold) | diff | day-block p | WF train / test |
|---|---|---|---|---|---|
| primary (thr0.08 / ±1.5%) | 100 | −4.5 → −4.0 | +0.6pt | 0.169 | −0.4 / **+1.6** |
| sensitivity (thr0.12 / ±1.0%) | 268 | −4.5 → −4.1 | +0.5pt | 0.420 | **−2.1** / **+3.1** |

Directionally positive but **not significant**, and the two halves have **opposite signs**
in both variants (the sensitivity variant swings −2.1 → +3.1). That is noise, not a HOLD
edge. The barney-fuel HOLD mirror does not transfer to obstruction.

---

## Multiple comparisons

5 decision cells; Bonferroni α = 0.05/5 = 0.010.

| cell | p | verdict |
|---|---|---|
| H-B primary — treat vs random | 0.751 | null |
| H-B sensitivity — treat vs random | 0.739 | null |
| H-C primary — hold vs trail | 0.175 | null |
| H-C sensitivity — hold vs trail | 0.419 | null |
| H-A — clear vs obstructed | 0.094 | nominal-only, does not survive |

**Survivors: 0.** Nothing clears Bonferroni; nothing clears even nominal 0.05.

---

## DECISIONS NEEDED (proposals only — no code touched)

1. **Do NOT ship an obstruction-based EXIT or HOLD rule.** As a dynamic exit (H-B, the
   pre-registered primary claim) it *underperforms the live trail and a random exit of the
   same frequency* — because "obstruction appears in the path" is largely a proxy for "price
   moved toward its target," so the rule chops winners. As a HOLD (H-C) it is an unstable
   null. **No rule goes to a ghost/shadow test** from this study — neither H-B nor H-C
   produced a specification worth simulating.

2. **Retire the path-obstruction lead.** The prior study flagged it (p≈0.08 as an entry
   gate) and recommended this exact exit/HOLD test as the highest-value next step. That test
   is now done and negative. The only thing that keeps recurring is the weak **entry-context**
   observation (H-A: clear-path entries realize better) — but it is p=0.094, train-only,
   non-monotone, and does not survive Bonferroni, exactly as it didn't in the node-position
   study. It is not a rule; treat it as a closed question, not an open lead.

3. **The structural entry/exit program is complete — 14 consecutive clean kills.** Node
   position, R:R-3:1, direction-alignment, extremes-vs-midpoints, gatekeeper-entry, and now
   obstruction-as-exit have all died against the volume/timing-matched random controls. The
   consistent finding across all of them stands: **GEX surface geometry is a map, not a
   forward-P&L signal.** The single validated edge remains the **bull tape gate** (price
   structure). Recommend directing further exit research toward price/tape-based structure
   (the escalator/pin and node-touch work), not the GEX node field.
