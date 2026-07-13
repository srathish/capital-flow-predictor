# Trailing-Stop Re-Calibration + Trajectory-Conditioned Exit — 2026-07-13

**Status:** RESEARCH ONLY (Clause 0). No live-code change is proposed as shipped.
Any candidate goes to **DECISIONS NEEDED**, not to the tracker.

## Question
The tracker's trail arms at +50% peak and exits on a 15% giveback
(`TRAIL_ARM_MIN_GAIN=0.50`, `TRAIL_GIVEBACK_PCT=0.15`, `plays.js`). Those were
picked on a **one-day** grid (2026-07-08, 34 fires). Two tests on the FULL replay
set:
1. **Re-calibrate the trail:** arm ∈ {.30,.50,.75,1.00} × giveback ∈ {.10,.15,.20,.30}
   (16 cells) + a **two-stage** trail (lock/scale ½ at +50%, trail the remainder at
   20–30%). Which maximizes REALIZED, does it survive walk-forward + a 2–3% fill
   haircut, and is 0.50/0.15 near-optimal or beaten?
2. **Winner-runner vs early-cut split:** split fires by whether they reach +25%
   within the first N minutes; test a trajectory-conditioned exit (looser trail for
   runners, faster cut for non-runners) vs the flat trail.

## Answer up front
- **0.50/0.15 is NOT the optimum, but it is inside the noise band of it.** The best
  direction is to **arm EARLIER (0.30) and give the giveback a touch more room
  (0.20–0.25)**. That corner beats current by **+1.5 to +2.2 pts** realized,
  survives walk-forward, and keeps its edge under fills — but the margin is
  **< the ~3% mid-vs-trade noise band, p ≥ 0.08, and fails a multiple-comparisons
  discount**. Directional nudge, not a mandate.
- **Two-stage is clearly WORSE** (−3 to −4 pts vs current, fails WF, p≈1.0). Locking
  half at +50% caps the fat right tail that carries the mean. **Reject.**
- **The trajectory split is real** — reaching +25% early is a strong outcome
  predictor — **but its actionable content reduces to "let runners run" = widen the
  giveback**, which is the same lever as Q1. The "faster cut for non-runners" adds
  little because non-runners rarely arm. Conditioned exits that pass WF beat current
  by only +1.3 to +1.6 — no better than the simpler global re-cal.
- **Honest headline (consistent with `EXIT_VARIANTS`):** once realistic fills apply,
  **no trail beats HOLD-EOD on the mean.** The current trail's genuine value is
  **median / win-rate consistency**, not mean.

---

## Method
- **Infra reused:** `build_dataset.mjs` cache (real per-minute UW option marks) +
  `buildPath()` (entry = option close at first candle ≥ fire+60s; all exits on
  candle **close** only, no look-ahead). New driver: `backtest_trail_recal.mjs`
  (arg = fill haircut). **1,295 of 1,355 fires built a usable path, 61 days
  (Apr-10 → Jul-08).** State mix: 771 BEAR_RUG, 492 BULL_REVERSE (dominant), 32 other.
- **Tracker fidelity:** the live trail exits when `mid ≤ peak_mark·(1−gb)` after
  `peak_gain ≥ arm`. That exit-gain is algebraically `peak_g − gb·(1+peak_g)` —
  identical to `backtest_strategies.mjs` `trail()`. **There is no pre-arm hard stop
  in the live trail, so the pure trail here has none either.** The live structural
  exit needs the Skylit surface (absent on the replay set), so the trail is isolated
  — which is exactly the right object for a parameter recal.
- **Baselines (report vs BOTH):** `CURRENT = trail(0.50,0.15)` and `HOLD-EOD`.
- **Fill haircut** applied to reactive (trail/scale) exits only; HOLD-EOD sells at
  the scheduled close and takes none. Both the current trail and every grid cell
  take the haircut, so grid-vs-current stays apples-to-apples; the honest asymmetry
  is trail-vs-hold.
- **Validation:** chronological day-half walk-forward (train 30d / test 31d), paired
  bootstrap 95% CI + one-sided p vs current, leave-one-day-out worst Δ, Bonferroni.

---

## Result 1 — the grid (frictionless), vs CURRENT and vs HOLD-EOD

Baselines all-fires: **HOLD-EOD −0.6%** (median −67.3%, win 33%) · **CURRENT
0.50/0.15 −1.0%** (median **+21.6%**, win **56%**). Note current is fractionally
*worse* on the **mean** than doing nothing, but far better on median/win — it buys
consistency by clipping the fat tail.

| Cell | avg | med | win% | Δcurr | Δhold | boot95 (vs curr) | p | LOOw | WF |
|---|---:|---:|---:|---:|---:|:--:|---:|---:|:--:|
| HOLD-EOD | −0.6% | −67.3% | 33 | +0.4 | +0.0 | — | — | — | — |
| **CURRENT 0.50/0.15** | **−1.0%** | **+21.6%** | **56** | +0.0 | −0.4 | — | — | — | — |
| trail 0.30/0.10 | −0.2% | +17.3% | **65** | +0.8 | +0.3 | [−2.0,+3.7] | 0.294 | +0.5 | YES |
| trail 0.30/0.15 | +0.4% | +12.9% | 64 | +1.4 | +0.9 | [−1.0,+3.8] | 0.130 | +1.1 | YES |
| trail 0.30/0.20 | +0.7% | +6.9% | 59 | +1.7 | +1.3 | [−1.0,+4.5] | 0.117 | +1.2 | YES |
| trail 0.30/0.30 | **+1.2%** | −4.2% | 45 | **+2.2** | +1.8 | [−0.8,+5.8] | 0.080 | +1.4 | YES |
| trail 0.50/0.10 | −1.6% | +27.7% | 56 | −0.6 | −1.1 | [−2.2,+0.7] | 0.781 | −0.8 | both− |
| trail 0.50/0.20 | −0.2% | +15.6% | 55 | +0.8 | +0.3 | [−0.6,+2.6] | 0.152 | +0.2 | YES |
| trail 0.50/0.30 | +0.1% | +4.0% | 52 | +1.1 | +0.6 | [−1.5,+3.9] | 0.216 | +0.3 | YES |
| trail 0.75/0.15 | −2.1% | −10.2% | 48 | −1.1 | −1.5 | [−3.4,+1.4] | 0.809 | −1.7 | both− |
| trail 0.75/0.30 | −0.1% | −13.8% | 48 | +0.9 | +0.5 | [−2.7,+4.8] | 0.329 | +0.1 | YES |
| trail 1.00/0.15 | −1.7% | −36.0% | 44 | −0.7 | −1.1 | [−3.7,+2.5] | 0.667 | −1.4 | mixed |
| **2stage +50/tr25** | −4.0% | +29.1% | 56 | **−3.0** | −3.5 | [−5.0,−1.0] | 1.000 | −3.4 | both− |
| **2stage +50/tr30** | −4.7% | +26.3% | 56 | −3.7 | −4.2 | [−5.6,−1.8] | 1.000 | −4.1 | both− |
| **2stage +50/tr20** | −4.9% | +32.4% | 56 | −3.9 | −4.3 | [−5.6,−2.1] | 1.000 | −4.1 | both− |

Reading:
- **Arm is the lever; 0.50 is slightly too high.** Every `0.30/*` cell beats current
  and passes walk-forward. Mechanism (un-p-hacked): arm 0.50 gives **no** protection
  to a play that peaks at +30–50% and dies (never arms → rides to a bad EOD). Arm
  0.30 arms those, stops them near their peak, and **converts +30–50% peakers from
  losses into small wins → win% 56→65** (trail 0.30/0.10). That is the single most
  consistent, mechanistic improvement in the grid.
- **Raising the arm (0.75/1.00) is clearly worse** — arms too late, especially on
  bears whose puts often never reach +75%.
- **Giveback is second-order and noisy.** At arm 0.50, widening 0.15→0.25 nominally
  helps but non-monotonically; there is a mean/consistency trade — wider giveback
  lifts the mean (rides the tail) but tanks the median and win% (0.30/0.30: mean
  +1.2 but median −4.2, win 45). **Current 0.50/0.15 has the best median+win of any
  reasonable cell.**
- **Two-stage: reject outright.** Locking half at +50% removes half the position
  from the +200–400% movers that carry the mean; the remainder still gives back.
  Great median (+26–32%), terrible mean (−4 to −5%), p≈1.0, fails every cut.

## Result 2 — sensitivity: slope on arm, noise on giveback (no clean plateau)

- **Giveback @ arm 0.50** (Δ vs HOLD-EOD): −0.7 / −1.1 / −0.4 / +0.3 / **+2.0** /
  +0.6 / +0.9 at gb = 5/10/15/20/25/30/40%. The +2.0 at 25% is a **spike**, not a
  plateau — neighbours are +0.3 and +0.6. Noise.
- **Arm @ gb 0.15** (Δ vs HOLD-EOD): **+0.9 / +0.9** / +0.0 / −0.4 / −1.5 / −1.1 /
  +0.6 at arm = 25/30/40/50/75/100/150%. A **monotone decline** from the tight-arm
  region (25–30%, a two-cell +0.9 plateau) down through 75–100%. Directionally
  clean, but the whole span is ~2.5 pts — **inside the noise band**.

## Result 3 — realistic fills

At a 2–3% haircut every trail (including current) goes negative in absolute mean.
The **relative** ranking is fill-robust because both current and the grid cells take
the haircut — the low-arm/wide-giveback corner keeps its +0.4 to +2.1 Δcurr edge:

| Cell | Δcurr (0%) | Δcurr (2%) | Δcurr (3%) | Δhold (3%) |
|---|---:|---:|---:|---:|
| trail 0.30/0.15 | +1.4 | +1.1 | +1.0 | −1.0 |
| trail 0.30/0.20 | +1.7 | +1.5 | +1.4 | −0.6 |
| trail 0.30/0.30 | +2.2 | +2.1 | +2.0 | −0.0 |
| trail 0.50/0.30 | +1.1 | +1.2 | +1.2 | −0.8 |
| 2stage +50/tr30 | −3.7 | −3.1 | −2.9 | −4.9 |

But **vs HOLD-EOD, every trail is ≤ 0 at a 3% haircut** (best, trail 0.30/0.30,
Δhold −0.0). HOLD-EOD takes no reactive-exit slippage. So with honest fills, no
trail beats simply holding to EOD on the mean — trails earn their keep only in
median/win consistency and in truncating catastrophic single-name decay.

## Result 4 — trajectory split (Q2): the premise is TRUE, the fix collapses to Q1

Split by "reached +25% within first N minutes":

| N | runners (share) | HOLD-EOD run / non | CURRENT-trail run / non |
|---|---|---|---|
| 5m | 249 (19%) | +47.6% / −12.0% | +39.4% / −10.6% |
| 10m | 397 (31%) | +45.7% / −21.0% | +39.6% / −18.9% |
| 15m | 470 (36%) | +38.3% / −22.7% | +38.6% / −23.5% |
| 30m | 623 (48%) | +35.0% / −33.6% | +36.4% / −35.7% |

Early trajectory is a **strong** separator — runners are hugely positive, non-runners
deeply negative. Two things follow:
- The **current trail clips the runners** (+39.6% vs hold's +45.7% at N=10 — the trail
  costs ~6 pts on the winners by giving back).
- The current trail **barely helps non-runners** (−18.9% vs hold −21.0%, only +2 pts)
  because non-runners often **never reach +50% → never arm** → the trail never
  engages.

Conditioned exits (split at +25% within 10m), vs CURRENT, frictionless:

| Conditioned rule | avg | Δcurr | p | WF |
|---|---:|---:|---:|:--:|
| run→hold / non→tr30/15 | +1.8% | +2.9 | 0.150 | no |
| run→hold / non→tr30/10 | +1.4% | +2.4 | 0.190 | no |
| run→tr75/30 / non→tr30/10 | +0.6% | +1.6 | 0.188 | **YES** |
| run→tr50/30 / non→tr30/15 | +0.3% | +1.3 | 0.166 | **YES** |
| run→tr50/30 / non→tr30/10 | −0.2% | +0.8 | 0.276 | no |

The highest-Δ variant (**run→hold**) fails walk-forward (it is a trend-tail
artifact). The variants that pass WF give **+1.3 to +1.6 Δcurr** — **no better than
the single-parameter Q1 nudge** (trail 0.30/0.20–0.30 is +1.7 to +2.2), and more
complex / more overfit-prone. The "faster cut on non-runners" contributes little:
non-runners don't arm, so cutting them requires a hard/time stop, which
`EXIT_VARIANTS_2026-07-13` already showed dies under fills. **The split's real
content is "let runners run" = widen the giveback — already captured globally by
lowering the arm.**

## Multiple-comparisons discount
~24 configs tested (16 grid + 3 two-stage + 5 conditioned + sensitivity sweeps).
Best one-sided p vs current = **0.080** (trail 0.30/0.30, frictionless). Expected
best-of-24 under the null ≈ 1/25 ≈ 0.04 — **the observed best is worse than chance
would predict.** Bonferroni α=.05/24 ≈ **0.002**; nothing is within an order of
magnitude. **No cell clears the discount.** This is a plateau of direction, not a
significant optimum.

---

## Verdict

**Is 0.50/0.15 near-optimal or beaten?** *Beaten on the mean, but only inside the
noise band, and it wins the median/win-rate objective outright.* The clean,
mechanistic finding is that **the arm (0.50) is a touch too high**: arming at **0.30**
protects the +30–50% peakers the current setting abandons, lifting win% 56→65 and
mean by +0.8 to +1.7 pts, surviving walk-forward and fills. Widening giveback to
0.20–0.25 adds a little more mean at the cost of median/win. Two-stage is strictly
worse. Trajectory-conditioning is a true diagnostic that reduces to the same lever.

**None of it clears the multiple-comparisons discount, and vs a plain HOLD-EOD every
trail is ≤ 0 on the mean once fills are real.** So this is a *directional* result:
if anything is A/B'd forward, the defensible single change is **arm 0.50 → 0.30**
(keep giveback ≈ 0.15). It is a small, sane, fill-robust nudge — not a proven edge.

### DECISIONS NEEDED (not shipped)
- **D1 — Lower `TRAIL_ARM_MIN_GAIN` 0.50 → 0.30?** Best-supported single change:
  arms the +30–50% peakers current abandons; +0.8–1.7 pts mean, +9 pts win%, WF- and
  fill-robust *relative to current*. Margin is sub-noise-band and MC-insignificant —
  paper it against the live trail before any code change.
- **D2 — Widen `TRAIL_GIVEBACK_PCT` 0.15 → 0.20?** Optional add-on to D1 for a little
  more mean; **costs median/win consistency**. Only if the objective is mean realized,
  not hit-rate. Do NOT go to 0.30 (median collapses).
- **D3 — DROP the two-stage idea.** −3 to −4 pts, fails every cut. Locking half kills
  the tail that pays for the strategy.
- **D4 — DROP trajectory-conditioned exit as a separate mechanism.** Its edge is
  fully captured by the D1/D2 global nudge with far less complexity.
- **D5 — The real ceiling is elsewhere.** vs HOLD-EOD no trail wins on the mean after
  fills; on BULL_REVERSE (the doctrine edge) HOLD-EOD +12.1% beats every trail. The
  trail's justified role is consistency + tail-truncation, not mean alpha — matching
  `EXIT_SIM`/`EXIT_VARIANTS`. Bigger gains live in entry quality / structural-exit
  timing, not trail parameters.

## Reproduce
- `node backtest_trail_recal.mjs <fillHaircut>` (e.g. `node backtest_trail_recal.mjs 0.03`).
- Reuses `build_dataset.mjs` `cache/` (UW per-minute marks) + `fires_index.json`;
  grid, two-stage, trajectory split, WF, LOO, bootstrap, sensitivity all inline.
- Baselines: CURRENT `trail(0.50,0.15)` and HOLD-EOD.
