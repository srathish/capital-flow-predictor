# Exit-Variant Study — Hard-Stop Family, Broadened + Fill-Penalized — 2026-07-13

**Status:** RESEARCH ONLY (Clause 0). No live-code change proposed. This
pressure-tests the STOP-30 candidate from `EXIT_SIM_2026-07-13.md` and **fails to
confirm it** on the fuller dataset with realistic fills.

## Question
`EXIT_SIM` found a hard −30% stop was the only exit family that beat the current
structure-invalidation exit out-of-sample (+17%), but on 66 fires / 25 OOS. Three
tests here:
1. Does the edge survive on the **full replay dataset** (1,295 fires, 61 days)?
2. Is **−30% a robust optimum** (a plateau) or a point on a slope (an artifact)?
3. Does it survive a **2–3% stop-fill slippage haircut** and a
   **multiple-comparisons discount**?

## Method
- **Infra reused:** `build_dataset.mjs` cache (1,109 real per-minute UW option-mark
  paths) + `buildPath()` from `backtest_strategies.mjs`. New driver:
  `backtest_variants.mjs` (arg = fill haircut).
- **Fires:** 1,295 of 1,355 built a usable path (Apr-10 → Jul-08, 61 days). Entry =
  option close at first candle ≥ fire+60s; all exits close-basis, no look-ahead.
- **Baseline (null) = HOLD-TO-EOD.** Replay fires have no recorded live exit, so
  hold-EOD is the reconstructable no-management null. In `EXIT_SIM`, hold-EOD sat
  within +3pts of the current structure exit, so this is a faithful — and, if
  anything, *harder-to-beat* — stand-in than the badly-timed structure exit.
- **Families:** hard STOP −25/−30/−35/−40/−50; SCALE (½ at +50 or +75, hard-stop
  the rest at −30/−35/−40). Sensitivity sweep −20 → −60.
- **Validation:** chronological day-half walk-forward (train 30d / test 31d),
  leave-one-day-out worst Δ, paired bootstrap 95% CI + one-sided p, Bonferroni.

---

## Result 1 — the edge collapses on the full set (frictionless)

| Family | avg | median | win% | Δ vs hold-EOD | boot 95% CI | p | LOO-worst | WF pass |
|---|---:|---:|---:|---:|:--:|---:|---:|:--:|
| HOLD-EOD (null) | −0.6% | −67.3% | 33 | +0.0 | — | — | — | — |
| STOP-25 | +1.9% | −27.6% | 13 | **+2.5** | [−3.2,+7.8] | 0.197 | +1.7 | YES |
| STOP-30 | +0.9% | −32.4% | 15 | +1.5 | [−3.9,+6.6] | 0.283 | +0.8 | no |
| STOP-35 | −0.8% | −37.3% | 16 | −0.2 | [−5.2,+4.7] | 0.515 | −0.8 | no |
| STOP-40 | −1.8% | −41.8% | 18 | −1.2 | [−6.3,+3.5] | 0.692 | −1.8 | no |
| STOP-50 | −1.3% | −51.3% | 22 | −0.8 | [−5.2,+3.3] | 0.639 | −1.2 | no |
| SCALE +50/−30 | −1.8% | −31.0% | 35 | −1.3 | [−7.5,+4.7] | 0.665 | −2.3 | no |
| SCALE +50/−35 | −3.4% | −36.0% | 36 | −2.8 | [−8.6,+3.0] | 0.831 | −3.8 | no |
| SCALE +50/−40 | −4.0% | −40.6% | 37 | −3.4 | [−9.0,+2.1] | 0.879 | −4.4 | no |
| SCALE +75/−30 | −2.3% | −31.5% | 27 | −1.7 | [−7.8,+4.2] | 0.718 | −2.6 | no |

Even **frictionless**, STOP-30's edge shrinks from +17% (66 live fires vs the
structure exit) to **+1.5%** (1,295 fires vs hold-EOD), with **p=0.28** — the 95%
CI straddles zero. Only STOP-25 nominally passes the day-half walk-forward, and its
test-split Δ is **+0.3** — indistinguishable from zero.

## Result 2 — it is a slope, not a plateau (so −30 is not special)

Δ vs hold-EOD across stop level (frictionless): **+2.2 / +2.5 / +1.5 / −0.2 / −1.2
/ −0.4 / −0.8 / −1.1** at −20/−25/−30/−35/−40/−45/−50/−60. A robust edge shows a
**flat plateau** across neighbouring levels; this is a **monotone decline** that
crosses zero near −35 and peaks at the *tightest* stops (−20/−25), not at −30. −30
sits mid-slope. The entire range spans ~3.5 pts — **inside the ±3% mid-vs-trade
noise band** the prior study itself flagged. There is no stable optimum to lock to.

## Result 3 — realistic fills kill it

Stop-fills in fast 0DTE decay fill worse than the trigger close. The −30% stop
**triggers on 84% of fires**, so a per-stop haircut hits almost every trade:

| Family | Δ (frictionless) | Δ (−2% fill) | Δ (−3% fill) |
|---|---:|---:|---:|
| STOP-25 | +2.5 | +0.7 | −0.1 |
| STOP-30 | +1.5 | −0.2 | −1.0 |
| STOP-35 | −0.2 | −1.8 | −2.7 |
| STOP-40 | −1.2 | −2.8 | −3.6 |
| STOP-50 | −0.8 | −2.3 | −3.0 |
| SCALE +50/−30 | −1.3 | −2.9 | −3.8 |

At a **2% haircut STOP-30 is already negative** (−0.2, p=0.52) and **no family
passes walk-forward**. At 3% every family is negative. The sensitivity peak at −25%
also collapses to zero (−0.1 at 3%).

## Result 4 — on the actual signal edge, stops destroy value

BULL_REVERSE only (n=492, the state doctrine calls the real edge): **HOLD-EOD
+12.1%** vs STOP-30 **+4.7%**, STOP-25 +3.9%, every scale combo ≤ +1.4%. Stops
truncate exactly the winners that carry the alpha (55% of all fires reach ≥+50%
MFE). The hard stop is anti-correlated with the signal's payoff structure.

## Multiple-comparisons discount
12 configurations tested. Best frictionless result: STOP-25, Δ+2.5%, **p=0.197**.
Expected best-of-12 p under the null ≈ 1/13 ≈ 0.077 — the observed best is *worse*
than chance would predict. Bonferroni threshold (α=.05/12) = **0.0042**; nothing is
within two orders of magnitude. No family clears the discount.

---

## Verdict

**A hard stop does NOT robustly beat baseline on the fuller dataset, and does not
survive realistic fills. The −30% level is not special.** The `EXIT_SIM` +17%
result was an artifact of two things it named as caveats but under-weighted:

1. **A badly-timed baseline.** vs the structure-invalidation exit (which held
   losers into decay *and* cut winners, realizing −21% on 4 days) a dumb stop wins
   by +17. vs simply **holding to EOD** — a sane null available across 61 days — the
   same stop wins by **+1.5% frictionless, negative with fills, p≈0.3**. The gap the
   stop "captured" was mostly *the current exit being worse than doing nothing*, not
   a stop edge. **Fixing/relaxing the structure exit captures most of it without
   cutting winners.**
2. **Two unusually bad OOS days.** The 25-fire OOS window (7/10+7/13) had a deep
   holding-tail that made truncation look strong; the 61-day set does not reproduce
   it. −30% is a mid-slope point in a monotone, noise-band-width sensitivity curve.

Trailing stops fail again OOS (consistent with the Saturday study and `EXIT_SIM`).

### What IS true
- **The current structure-invalidation exit is poorly timed** — that finding
  survives (hold-EOD, and even a loose stop, beat it on the live days). The fix is
  the *exit logic itself*, not bolting a −30% stop onto it.
- **A very tight stop (−20/−25) is the only nominally-positive region frictionless**,
  but it is inside the noise band, fails the MC discount, and evaporates at a 2–3%
  haircut. Not actionable.

### DECISIONS NEEDED (not shipped)
- **D1 — DROP the "add a −30% hard stop" candidate (was D1 in EXIT_SIM).** It does
  not replicate out-of-sample on the full set and is negative with realistic fills.
- **D2 — Reframe the real problem as the structure-invalidation exit's timing.**
  It holds losers into deep decay (55% of fires end < −50% at EOD) *and* clips
  winners. Study that exit's trigger directly rather than overlaying a stop.
- **D3 — If any tail-truncation is A/B'd forward, paper it — expect it to lower
  realized P&L once fills are real**, per Result 3.

## Reproduce
- `backtest_variants.mjs <fillHaircut>` — e.g. `node backtest_variants.mjs 0.03`.
- Reuses `build_dataset.mjs` cache/ (UW per-minute marks) + `fires_index.json`.
- Baseline = hold-EOD; families, WF split, LOO, bootstrap, sensitivity all inline.
