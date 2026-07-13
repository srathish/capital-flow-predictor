# ENTRY QUALITY — are any fires non-golden and worth filtering?

**Date:** 2026-07-13 · **Clause 0 — RESEARCH ONLY, no live-code changes.**
Recommendations live in DECISIONS NEEDED at the bottom.

**Script:** `research/gexvex-structure/entry_quality_study.py`
(digest → `entry_quality_recs.json`). Reuses the exit-study replay cache.

## Question
The 77-study found no entry *rule* beats the tape gate (−0.2pp incremental).
Separately, ~55% of fires reach +50% MFE, so entries seem to reach profit and
the leak is the exit. This study asks the entry-QUALITY / FILTERING version:
**is there a STATE / TIME-OF-DAY / CONFIDENCE / tape cut whose entries have
systematically LOW MFE (bad entries we could drop to raise avg quality without
killing volume) — and does the tape gate already capture that separation?**

## Data & method
- **1,295 fires** with a real per-minute option-mark path (of 1,355 in
  `fires_index.json`; replay Apr-10→Jul-08 + 16 live Jul-09/10). 60 dropped for
  empty/too-short option series.
- **MFE / MAE** on the real UW option-contract 1m path. Entry = first bar
  ≥ `fireTsMs + 60s` (matches `entry_segmentation.mjs`); MFE = peak %gain, MAE =
  worst %drawdown from that entry.
- **Tape-gate status** reconstructed exactly as the live gate reads it
  (`src/tracker/bull-tape-gate.js`): SPY/QQQ/SPXW spot at fire time vs prior
  session close, from `data/skylit-archive/intraday`. BULL blocked if all 3
  below prior close; BEAR blocked (G7-PC) if the fired ticker is ≥ its prior
  close. 12 fires `unknown` (live days after archive ends).
- **Walk-forward** split by day at 2026-05-22 (train 660 / test 635).
- Pre-registered breakdowns: STATE, gate, time-of-day, confidence.

## Headline result — entries are GOLDEN; the leak is the exit

| Cut | n | reach +25% | **+50%** | +100% | MFE med | MAE med | never < −15% |
|---|---|---|---|---|---|---|---|
| ALL FIRES | 1295 | 70% | **55%** | 37% | +60% | −88% | 9% |
| BEAR_RUG | 771 | 67% | 54% | 36% | +57% | −94% | 8% |
| BEAR_CONTINUE | 32 | 72% | 62% | 56% | +144% | −94% | 9% |
| BULL_REVERSE | 492 | 73% | 57% | 37% | +61% | −77% | 11% |

Two facts dominate:

1. **Every state reaches profit more than half the time** (+50% MFE: 54–62%),
   median MFE +57–144%. No state has "rarely-works" entries — the spread across
   states is narrow. Entries are broadly golden.
2. **MAE is catastrophic and uniform: median −88%; only 9% never dip below
   −15%.** The same entries that reach +50–100% crater first. This is 0DTE
   gamma convexity, not an entry defect — it is an **exit-design constraint**
   (tight stops are impossible), which is exactly the exit-study's premise.

→ **The leak is the exit, confirmed at the MFE/MAE level. Entries reach the
money; the system gives it back.**

## The one real entry-quality separator IS the tape gate — already captured

| Cut | n | reach +50% | MFE med | **+30m drift** |
|---|---|---|---|---|
| gate = ALLOW | 677 | **59%** | +68% | **+6%** |
| gate = BLOCK | 606 | **50%** | +51% | **−5%** |

The gate separates entry quality on every metric, and the **+30-min drift flips
sign** (+6% allowed vs −5% blocked) — the tell that it splits timed-edge fires
from fight-the-drift fires. The separation is concentrated in BEAR:

| dir · gate | n | reach +50% | +30m drift |
|---|---|---|---|
| BEAR ALLOW | 366 | 62% | +4% |
| BEAR BLOCK | 428 | 48% | −5% |
| BULL ALLOW | 311 | 57% | +9% |
| BULL BLOCK | 178 | 56% | −2% |

Bear gate does real work (14pp MFE gap, drift sign flip); bull gate is marginal
on MFE (57 vs 56) though it still fixes the drift sign. **Consistent with the
gate being the validated edge — and it captures the entry-quality gradient, not
just realized PnL.**

## No incremental filter beyond the gate (walk-forward)

Within **gate = ALLOW**, every sub-cut clusters 53–68% reach+50% with positive
drift — nothing is robustly low-MFE:

| within ALLOW | n | reach+50% | train / test |
|---|---|---|---|
| BEAR_RUG | 344 | 61% | 53 / 69 |
| BULL_REVERSE | 311 | 57% | 58 / 55 |
| open 9:30-10:00 | 151 | 58% | 62 / 54 |
| midday 10:00-15:00 | 408 | 62% | 57 / 67 |
| lasthr 15:00-16:00 | 97 | 53% | 50 / 55 |

- **Time-of-day gives no usable RTH filter.** Open / midday / lasthr all sit
  52–57% reach+50%. The only weak bucket is post-16:00 (n=42, 38% reach+50%),
  which the **existing 15:15 ET no-fire cutoff already removes.**
- **The one apparent within-state edge overfit.** BULL_REVERSE at the open was
  79% reach+50% in train → 56% in test (state × TOD table). Do not filter on it.
- **Worst tape sub-cells inside ALLOW** (BULL n_above=2: 54%; lasthr: 53%) are
  small, noisy, and still positive-drift — no clean low-MFE pocket to excise.

## Confidence cut — NOT TESTABLE at scale (data gap, not a null)
98.8% of the sample (replay fires) carries no `supporting_state`, and the 16
live fires that do have `patternDetection.confidence/score` all lack a usable
post-entry option path (late-day / short series). Confidence-vs-MFE cannot be
evaluated with current data. See DECISIONS NEEDED #2.

## Verdict — NULL on a new entry filter (a valid, useful result)
Entries are golden: uniformly high MFE across states, ~55% reach +50%. The only
separation in entry quality is the tape gate, and **the gate already captures
it** (ALLOW 59% vs BLOCK 50% reach+50%, +6% vs −5% drift). No STATE, TIME-OF-DAY
or tape sub-cut delivers a robust incremental low-MFE filter — the lone
candidate (bull-open) failed walk-forward. This matches the 77-study
(−0.2pp for any added entry rule) and the exit-study premise. **Do not
manufacture an entry filter. The leak is the exit** — the brutal, uniform MAE
(median −88%) and the fade after MFE are exit-timing problems, addressed in the
EXIT_VARIANTS / EXIT_SIM work.

## DECISIONS NEEDED
1. **No new entry filter.** Every state/TOD/tape candidate beyond the gate is
   either duplicative of the gate or fails walk-forward. Keep entries as-is;
   keep the tape gate.
2. **Data hygiene (research-only ask):** persist `patternDetection.confidence`
   & `score` on **all** logged fires (replay export + live), so a confidence →
   MFE cut becomes testable. It is the one requested breakdown we currently
   cannot run.
3. **Reaffirm exit focus.** With +50% MFE reached 55% of the time but median MAE
   −88%, entry quality is not the constraint — exit timing/trailing is. Direct
   effort there (EXIT_VARIANTS), not at the entry.
