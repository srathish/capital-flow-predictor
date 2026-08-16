# Per-expiry OOS research — what survives, what's overfitting

**Question posed:** "keep iterating until you find something that works without overfitting."
**Status:** UNCOMMITTED research (per instruction). Session 2026-08-16 (Sun).

## Protocol (anti-overfit design)
- The `perexpiry` grade was built looking ONLY at Aug-17 / MU. Testing it on the **4 prior
  Talon weeks (Jul 13–Aug 7)** it was never fit to = genuine out-of-sample.
- **72 directional setups** (system's own LLM plans from `*_sysval.json`), RE-RESOLVED with
  the corrected gap-aware fill (the saved `R_stop` were the old phantom-fill bug ≈ +67R;
  corrected ≈ +31R). Data cached in `dataset.json` → sliced without re-pulling.
- Rules held: pre-specify a few mechanism-grounded hypotheses; require consistency ACROSS
  weeks; **stratified permutation test** (shuffle labels within each week, 20k draws) as the
  significance gate; report nulls; treat 72 rows / 4 weeks as WEAK evidence.

## Baseline
Take-everything: **meanR +0.43, hit 54%, totR +31.3** (capped −1R). This is the number any
edge must beat AND hold across weeks.

## Finding 1 — SELECTION signals are NOISE (the overfitting trap, avoided)
Permutation p-values (gap in meanR vs random within-week shuffles):

| signal | A (mean) | B (mean) | gap | p |
|---|---|---|---|---|
| near wall ≤4% vs far/none | +0.62 | +0.25 | +0.37 | **0.287** |
| CONFIRM grade vs not | +0.50 | +0.30 | +0.20 | **0.299** |
| strong gamma floor vs not | +0.52 | +0.36 | +0.16 | **0.256** |
| vanna magnet <50M vs ≥50M | +0.42 | +0.45 | −0.03 | 0.341 |
| near-wall & magnet<50M vs rest | +0.82 | +0.30 | +0.52 | 0.086 † |

† the only sub-.10, but a **post-hoc conjunction out of ~20 slices** → ×20 multiple-comparisons
≈ not significant. **Nothing sorts winners reliably.**

**The seductive "rank by biggest vanna magnet" is REFUTED:** large magnets (≥53M) went
−0.50 / −0.64 in two of four weeks; magnet 50–200M was positive in only **1 of 4 weeks**.
corr(log magnetM, R)=+0.14 (noise). The thing Aug-17 makes tempting (TSM 779M, MU 267M,
AMZN 258M "must be best") is exactly the curve-fit.

➡️ The per-expiry map is a real **analytical lens** (separates MU's 8/17 short-gamma pocket
from the 8/21 vanna king → picks the option EXPIRY correctly). It is **not** a selection edge.

## Finding 2 — MANAGEMENT works: close-basis stop > intraday stop (SIGNIFICANT)
Exit-policy test (same 72 plans, global rule):

| policy | meanR | totR |
|---|---|---|
| bank-at-T1 (close) | +0.44 | +28.0 |
| all-runner (close) | +0.54 | +33.7 |
| 2-scale ½/½ (close) | +0.50 | +31.3 |
| **2-scale (intraday stop)** | **+0.23** | **+14.4** |

- **Close-basis vs intraday hard stop: Δ+0.19R/trade, p=0.029** (realistic uncapped);
  with a −1.5R disaster cap, Δ+0.19, **p=0.022**. Holds every week. Mechanism = "wick isn't
  failure": high-beta names tag the structural level intraday then close fine; a hard intraday
  stop books −1R for nothing. **This is the edge — and it's management, not selection.**
- **Disaster cap sweet spot ~1.25–1.5R:** capping the 12/72 gap-through losers *raises*
  expectancy (+0.36→+0.41) AND bounds the worst case (−1.82→−1.25).
- **Runner vs bank-at-T1: +0.09, p=0.265 — NOT significant.** The 2-scale is fine; letting it
  all run is not a proven edge.

## Finding 3 — the dominant caveat: BULL SAMPLE
Per-week baseline: 07/13 +0.20 (44% hit) · 07/20 **+0.06 (31% hit)** · 07/27 +0.41 (58%) ·
08/03 **+1.07 (81%)**. The +0.43 is **carried by one up-week**; two weeks barely cleared zero.
**No genuine down/chop week in the sample.** Regime dependence is unproven and is the #1
forward risk — broad participation + close-basis stops could bleed in chop.

## Conclusion (non-overfit)
Don't build a selection filter — it overfits and cuts participation (which already misses
up-weeks). What survives scrutiny:
1. **Participate broadly** (selection signals don't beat the baseline).
2. **Close-basis structural stop + ~1.25–1.5R disaster cap** — the one significant lever.
3. **Partial runner (2-scale)** — fine, but not a proven edge on its own.
4. Use per-expiry decomposition to pick the **option expiry**, not to rank names.

**Forward test is the real gate** — especially the first non-bull week. Until then this is a
bull-validated hypothesis, not a proven system.

## Files (uncommitted)
`oos.mjs` build+cache · `dataset.json` cache · `stats.mjs` slices · `stats2.mjs` robustness
· `stats3.mjs` permutation · `exits.mjs` policy test.
