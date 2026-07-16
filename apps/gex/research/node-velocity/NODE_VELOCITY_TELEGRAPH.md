# Node-Velocity Telegraph — do CHANGING 0DTE GEX/VEX nodes predict price turns, beyond the ATM confound?

**Program:** Bellwether 0DTE / GEX-VEX structure. **Status:** RESEARCH ONLY (Clause 0 — no live-code/system changes; research artifact only).
**Date:** 2026-07-15. **Data:** 1-min SPXW backfill (`research/velocity-capture/backfill/<date>/SPXW.jsonl.gz`), **44 usable days** (2026-04-20 → 2026-07-15; dropped 05-21 = 45 recs). Gamma col-0 (0DTE) verified vs Skylit. Real option prints: UW `option-contract/{occ}/intraday` (1-min OHLC + IV), verified available for **every day recent and old**.

---

## LEAD — the three answers the operator asked for

1. **After the ATM-confound control, do nodes build MORE before turns than before phantoms/non-turns? NO.**
   Raw node-gamma builds *less* before turns than before matched non-turns (+2.8M vs +6.8M/15min). After removing the mechanical "gamma rises as spot approaches," the **ATM-residual gamma velocity is *negative* before turns** (−4.05M) and does **not** beat the equidistant phantom (phantom +0.06M; real-beats-phantom AUC 0.38). Day-clustered permutation p = 0.0005 that the residual is *below* chance. **Translation: "the node grew" before a turn is, on average, just "price moved there." The 7/15 "7540 floor grew 5×" was dominated by price bleeding from 7572 down onto 7540 — mechanical, not a telegraph.**

2. **Is the VANNA signal a real, independent predictor? YES — but it is vanna VELOCITY, not the "flip."**
   The discrete zero-crossing **flip flag is noise** (turn rate 0.081 vs non-turn 0.104, AUC 0.489, +0.0% real P&L). But **supportive vanna *velocity*** (vanna moving positive at a floor / negative at a ceiling over the prior 15 min) cleanly separates turns from matched non-turns: **AUC 0.656** (floor 0.665 / ceil 0.646), **day-clustered permutation p = 0.0005**, **node-specific** (real +203M vs phantom −184M; real-beats-phantom AUC 0.687), **proximity-independent** (AUC 0.661 within d<8bp), and it is **not an ATM artifact** (vanna sign/velocity is not mechanically forced by spot approaching a strike). This is the **first ATM-robust dynamic signal the program has found.**

3. **Does the velocity filter beat a bare node touch? YES on the tape, MODESTLY at the option level.**
   Underlying forward drift @15min: **random +0.4bp → bare-touch +2.0bp → vanna-velocity filter +4.1bp → oracle(true turns) +12.1bp.** Real 0DTE ATM prints (entry@ask/exit@bid, 1.1% RT spread, −50% stop), expectancy/trade @15min: **random +0.8% → bare +2.9% → vanna filter +6.8% → oracle +25.5%.** The vanna filter ≈ doubles bare and beats phantom (+3.0%) and the flip flag (+0.0%). But win-rate stays sub-50% (46-47%) — the edge is 0DTE **convexity/right-tail**, not hit-rate — and it is an in-sample cut; the disciplined out-of-sample measure is the AUC (0.66). **It rescues node entries relative to bare touches, but as a standalone 0DTE it is a modest positive-expectancy convexity edge, not a high-probability reversal caller.**

**One-line verdict:** The operator's hypothesis is **half right, and the right half is the counter-intuitive half.** Node *gamma* "building" into a turn is the mechanical ATM artifact (falsified as a telegraph). Node *vanna* velocity is a genuine, ATM-robust, out-of-sample turn predictor — the flip *event* is not; the flip *direction/magnitude* is.

---

## Pre-registration (fixed before computing outcomes)

- **Turns:** percentage ZigZag on 1-min spot at **0.15% (primary)** and **0.25%** thresholds, all days. L pivot = bounce (floor side), H pivot = rejection (ceiling side).
- **Event unit = touch episode:** contiguous minutes where spot is within **0.2%** of a same-side `gamma>0` node; entry = deepest-approach minute; supporting node = strongest (max γ) qualifying strike (below for floor, above for ceiling).
- **Turn** = same-kind pivot within ±3 min of entry; **non-turn** = no same-kind pivot within ±10 min (4-10 = ambiguous, excluded). Both classes are matched on "price near a node."
- **Causal features over [t−15, t] only:** raw γ-velocity; **ATM-residual γ-velocity** (multiplicative "expected-from-approach": `γ_t − γ_{t−15}·shape(d_t)/shape(d_{t−15})`, where `shape(d)` = pooled normalized per-contract gamma vs |distance|; additive regression residual as cross-check); vanna velocity; supportive-flip flag; net-gamma regime; distance.
- **Controls:** (a) **non-turn** matched minutes; (b) **phantom/mirror** = grid-nearest `2·spot − node` (equidistant, price receding), same features.
- **Predictive:** walk-forward logistic (days split into 2 chronological halves, train-one/test-other), OOS AUC both halves.
- **Monetize:** long ATM 0DTE call at floor / long ATM 0DTE put at ceiling; real prints entry@ask exit@bid, RT spread = max(observed, 1.0%) → operator-verified ~1.1%; −50% stop; hold 15/30 min. Compare vs bare-touch (no velocity filter), random-timing, phantom-signal.

---

## 1. Turns

| ZigZag | pivots (44d) | L (bounce) | H (reject) | at a ≤0.2% `γ>0` node |
|---|---|---|---|---|
| 0.15% | 452 (10.3/day) | 228 | 224 | **99 (22%)** |
| 0.25% | 179 (4.1/day) | 90 | 89 | **41 (23%)** |

Touch episodes (price within 0.2% of a same-side positive-gamma node): **563.** Only ~22% of ZigZag pivots actually occur at a tight positive-gamma node — most turns are not at a node at all. The node-turn sample: **99 turns vs 376 matched non-turns** (0.15%).

## 2-4. Velocity: turn vs non-turn vs phantom, with the ATM control (0.15%)

Mean over [t−15,t]. AUC = separates turn from non-turn (0.5 = none). Perm p = within-day label-shuffle (preserves intraday autocorrelation).

| Feature (supporting node) | turn mean | non-turn mean | AUC | perm p |
|---|---|---|---|---|
| raw γ-velocity | +2.84M | +6.80M | 0.460 | — (turns build *less*) |
| **ATM-residual γ-velocity (mult.)** | **−4.05M** | +4.24M | **0.346** | **0.0005** (anti) |
| ATM-residual γ-velocity (additive) | −6.33M | +3.14M | 0.306 | — |
| **supportive vanna velocity** | **+203M** | −110M | **0.656** | **0.0005** |
| vanna FLIP rate (zero-cross) | 0.081 | 0.104 | 0.489 | ns |

**Real node vs equidistant PHANTOM (turns only):**

| | real node | phantom (mirror) | AUC(real > phantom) |
|---|---|---|---|
| ATM-residual γ-velocity | −4.05M | +0.06M | 0.379 (real *worse*) |
| raw γ-velocity | +2.84M | +1.64M | 0.591 |
| **supportive vanna velocity** | **+203M** | **−184M** | **0.687** |
| flip rate | 0.081 | 0.101 | — |

**Reading:** Gamma "building" is a red herring — after the ATM control the real node builds *less* than mechanical and *less* than its phantom, so the build is the price-approach, not a wall being reinforced ahead of a turn. **Vanna velocity is the opposite:** strongly positive-for-support before turns, node-specific (16× the phantom on 7/15; +203M vs −184M in aggregate), and it survives every control.

**Side symmetry & sign (confirms mechanism, not a fit):** floor-turn raw vanna velocity **+2.6e8** (supportive = positive), ceiling-turn **−1.45e8** (supportive = negative); vanna-velocity AUC floor 0.665 / ceil 0.646. **Proximity is not the driver:** turns are slightly *farther* from the node than non-turns (7.3 vs 5.8 bp); within the near subset (d<8bp) vanna AUC is unchanged at 0.661.

## 5. Predictive — walk-forward OOS AUC (2 chronological halves, disjoint days)

| Model (pre-turn features only) | H2 test | H1 test | mean |
|---|---|---|---|
| **supportive vanna velocity (alone)** | 0.652 | 0.663 | **0.658** |
| vanna velocity + ATM-residual γ-vel | 0.687 | 0.664 | **0.676** |
| ATM-residual γ-vel (alone) | 0.666 | 0.644 | 0.655 *(learns the negative sign)* |
| raw γ-velocity (alone) — naive "building" | 0.563 | 0.513 | 0.538 |
| vanna FLIP flag (alone) | — | — | AUC 0.489 (noise) |
| full 6-feature (with flip, regime, dist) | 0.634 | 0.582 | 0.608 *(diluted)* |

- **Vanna velocity predicts turns out-of-sample (AUC ≈ 0.66, stable across both halves).** Independent of the ATM confound.
- **The naive "node is building" (raw γ-velocity) is ≈ coin-flip OOS (0.54).** The residual carries information but *in the opposite direction to the hypothesis* (turns happen where the node builds **less** than the approach implies).
- **The flip flag adds nothing** (removing it *raises* AUC). Adding net-gamma regime hurts. Parsimonious model = {vanna velocity, ATM-residual γ-velocity}, OOS AUC 0.68.

## 6. Monetization — long 0DTE ATM at the telegraphed reversal

**Model-free forward drift** (dir-adjusted, bps) and **real 0DTE ATM prints** (entry@ask / exit@bid, 1.1% RT spread, −50% stop). All strategies trade the real node contract; they differ only by the selection filter (random differs by entry minute).

**@15-min hold:**

| Strategy | N | fwd drift | real-print win% | real-print exp/trade | median |
|---|---|---|---|---|---|
| ORACLE (true turns) | 99 | +12.1 bp | 75% | **+25.5%** | +18.5% |
| **VANNA-VEL top-tercile (the signal)** | 188 | +4.1 bp | 47% | **+6.8%** | −2.3% |
| VANNA-VEL > 0 | 278 | +3.2 bp | 46% | +5.4% | −3.6% |
| BARE node touch (no filter) | 560 | +2.0 bp | 46% | +2.9% | −3.5% |
| PHANTOM signal (mirror vanna>0) | 251 | +1.0 bp | 43% | +3.0% | −5.8% |
| RANDOM timing | 563 | +0.4 bp | 40% | +0.8% | −6.8% |
| VANNA-FLIP flag | 56 | +0.8 bp | 34% | +0.0% | −7.7% |
| "building" filter (resid_γ>0 & flip) | 37 | −0.6 bp | 35% | +0.2% | −10.5% |

**@30-min hold** (theta bites the un-selected books): vanna-tercile +5.0%, bare +3.9%, phantom +2.4%, random **−3.6%**, flip **−7.6%**, oracle +24.4%.

**Reading:** the ordering random < bare < vanna-filter < oracle is monotone on both the tape (drift) and real option P&L. The vanna filter is the only filter that improves on bare touch; the **flip flag and the "building" filter actively hurt** (they select the ATM artifact + noise). Positive expectancy is right-tail/convexity-driven (win-rate < 50%), not a high hit-rate.

## The 7/15 motivating example, dissected

At the **16:37 UTC (12:37 ET) noon low** (spot 7528.53), the **7540 floor** over the strict 15-min causal window: raw γ-velocity **+5.2M** (34.15M→39.35M), **ATM-residual +15.5M** (a genuine *excess* build that day), supportive vanna velocity **+1975M** (1420M→3395M). The equidistant phantom (7515) had supportive vanna velocity of only **+124M (16× weaker)**. The "−1353M→+3395M flip" the operator cited spans a *longer* window than 15 min — within the strict pre-turn window vanna was already positive (flip flag = 0). **So 7/15 was a genuinely strong instance of the real signal (huge, node-specific supportive vanna) — and also a day where gamma happened to build in excess.** But across 44 days the gamma-excess does **not** generalize (average residual is negative) while the **vanna velocity does**. The operator read the right *tape* on 7/15; the transferable, ATM-proof component of that read is the **vanna**, not the "5× floor."

---

## Key questions — explicit answers

**(i) Do nodes build more before turns than non-turns/phantoms after the ATM-residual control?** **No.** Raw build is *lower* before turns; ATM-residual build is *negative* before turns and loses to the phantom. Node-gamma "building" as a turn telegraph is **falsified** — it is the mechanical approach.

**(ii) Is the vanna flip a real independent predictor?** The **zero-cross flip event: no** (AUC 0.489, useless). The **supportive vanna *velocity*: yes** — AUC 0.656, OOS 0.658, perm p 0.0005, node-specific vs phantom, proximity-independent, symmetric across sides, not an ATM artifact.

**(iii) Does node-velocity predict turns OOS?** **Yes, modestly and robustly for vanna velocity** (OOS AUC ≈ 0.66 both halves; {vanna, residual-γ} = 0.68). **No for the naive gamma-building** (0.54).

**(iv) Does the velocity filter make node entries tradeable / beat bare-touch & random?** **Yes, incrementally.** Vanna filter roughly doubles bare-touch and 3-10× random on both forward drift and real 0DTE expectancy (+6.8% vs +2.9% vs +0.8% @15min) and beats phantom — but sub-50% win-rate and in-sample selection mean it is a modest convexity edge, well short of the +25% oracle.

## Honesty / limitations (LEAN — n≈44 days, one regime)

- Single low-vol-ish 2026 regime; 99 node-turns at 0.15%. Real p-values via day-clustered permutation (p=0.0005) mitigate but do not remove regime risk.
- Monetization expectancy is **right-tail-driven** (win% < 50%); mean is sensitive to the −50% stop, the 1.1% spread assumption, and close-to-close fills (UW intraday is trade OHLC, not live NBBO). The **OOS AUC (0.66), not the P&L, is the disciplined signal measure.**
- The vanna-velocity filter cut (top-tercile) is chosen on the full sample; treat the +6.8% as descriptive, the AUC as predictive.
- Residual-γ's OOS predictiveness runs *opposite* to the hypothesis and is partly entangled with how deep price tags; reported as a secondary, nuanced finding, not a headline.
- Not tested: whether vanna velocity is a proxy for a slower dealer-repositioning/charm process, and interaction with the existing bull-tape gate.

## Decisions needed (for the operator — no code changed)

1. **Promote vanna-velocity as a candidate entry-refinement**, measured against the existing tape-gate + n-flags baseline (does it add incremental AUC on gate-survivors, like the STOP-30 study?). It is the first ATM-robust dynamic factor — worth a gated forward paper-test.
2. **Retire "node is building" and "vanna flipped" as literal entry cues** — both are the ATM artifact / noise here. Reframe the operator's eye as "**supportive vanna is *loading* at the node**," not "the floor grew" and not "vanna crossed zero."
3. Confirm sign/þreshold on out-of-regime days as backfill extends; re-run `real_eval.py` with live NBBO if a quote feed is wired.

---

### Files & reproduction
- `nodevel_events.jsonl` — 188 nv trades (vanna-velocity top-tercile signal, 0.15%, 15-min hold, real prints). Schema: `day, ticker, minute(UTC HH:MM), strike:spot@entry, kind:"nv", implied:up|down, exit_minute, outcome:win|loss, pnl_pct`.
- Scripts (run from a scratch dir; `BACKFILL` path is absolute): `nv_lib.py` (loader/zigzag/nodes) → `nv_build.py` (events+features → `events.json`) → `nv_analyze.py` (tables/AUC/monetization) → `real_prints.py`+`real_eval.py` (real UW prints → `nodevel_events.jsonl`) → `nv_robust.py` (side split, sign, permutation).
