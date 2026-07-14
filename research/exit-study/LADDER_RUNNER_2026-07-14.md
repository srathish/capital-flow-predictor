# Exit DESIGN — LADDER × RUNNER: can a scale-out keep the fat tail? — 2026-07-14

**Status:** RESEARCH ONLY (Clause 0). No live-code change. Candidates → DECISIONS NEEDED.
**Lane:** follow-on to `SCALEOUT_2026-07-13.md`. That report established the ⅓@+50 / ⅓@+100 /
trail-final-third ladder beats both baselines by ~+11–12 pt. Ghost A/B on 4 live days then
**lost −3.9 pt on the day containing a +432% runner** — booking ⅔ of the position caps the tail.
This report asks whether a **runner-preserving** variant keeps the round-trip capture *and* the tail.

---

## Answer up front

**QUALIFIED YES — but the win is much smaller than the framing suggests, and the underlying
trade-off is only ~10% reducible.**

1. **Every UNCONDITIONAL loosening variant is a strict, losing trade.** Holding the final third to
   EOD (hypothesis (a)) buys +11.6 pt on runners and **pays −46.9 pt on round-trips**; pooled it is
   the **worst variant tested (−6.1 pt vs base)**. Loose trails (b/c) are the same trade at smaller
   scale. All are pooled-negative and all fail walk-forward. **Hypotheses (a), (b) and (c) are NULLS.**
2. **CONDITIONAL loosening works.** **(d1) RUNNER-AWARE**: run the base ladder, but if the causal
   running peak has already reached **+150%** at the bar where the +100 rung would fill, **skip rung 2**
   and let the remaining ⅔ ride on a loose 40% trail. Pooled **+1.8 pt** (p=0.0009), **RUNNER +10.1 pt**,
   **ROUND-TRIP −0.9 pt**, walk-forward passes both splits, LOO worst +1.4. It clears Bonferroni.
   It fires on only **5.6% of fires** (84% of which are true runners) and is **exactly the base ladder
   on the other 94.4%** — so it cannot damage the round-trip capture by construction.
3. **But the tail-vs-consistency trade is NOT eliminated — it is irreducible in the large.** On the
   RUNNER subset, **HOLD-EOD makes +204.3% vs the base ladder's +106.4%** — a **98 pt gap**. (d1)
   recovers **~10 pt of that 98** (10%). The remaining ~88 pt of tail is the *price* of the ladder's
   **+113.7 pt** round-trip capture (HOLD-EOD −74.6% vs ladder +39.0% on round-trips). **You cannot
   buy the tail back at scale. You can only buy a slice of it, and only conditionally.**
4. **(d1) is a mean-only, right-tail effect — it does not make the ladder more consistent.** Median
   triggered fire gains just +4.8 pt; **33 of 73 triggered fires are WORSE than base**; day-level it is
   **17 better / 18 worse / 26 identical**. It raises the mean and the variance. It is a lottery-ticket
   adjustment, correctly priced, not a smoother.
5. **On the ghost A/B itself — the honest read is the opposite of the alarm.** Over all 58 contiguous
   4-day windows in replay, the base ladder is **negative vs LIVE-TRAIL in only 2/58 (3%)**. So the
   observed −3.9 pt *is* an unusual window (~3rd pct) — **but it is n=1, it was inspected precisely
   because it looked bad, and (d1) would not have prevented it as a class** (d1's negative-window rate
   is 3/58, no better). **Runner days are on average the ladder's BEST days**: on the 50 replay days
   containing a ≥+200% runner the ladder makes **+11.8%** vs the live trail's **−1.9%**.

---

## Data & method

- **Dataset:** shared `build_dataset.mjs` cache. **1,295 of 1,355 fires** built a usable real
  per-minute UW option-mark path; **61 days** (2026-04-10 → 2026-07-08); index tickers only (0DTE scope).
- **Driver:** `apps/gex/research/exit-study/ladder_runner.mjs` (new; independent of `scaleout_regime.mjs`).
- **Fidelity:** entry = option close at first candle ≥ fire+60 s; every exit close-basis (no intra-bar
  look-ahead); running peak is **causal** (`peakUpTo[i]` uses bars ≤ i only).
- **Conservative fills (per brief):** a limit rung is credited **only if the level HOLDS ≥2 consecutive
  bar closes**; **3% haircut on the market-exited fraction** (trail/stop/EOD legs). Swept 0/2/3/5% and
  2-bar/3-bar confirms; an all-leg haircut mode also run.
- **Validation:** chronological day-half walk-forward (train 30 d / test 31 d), leave-one-day-out worst
  Δ, paired bootstrap 95% CI + one-sided p (3k, 20k for headline), Bonferroni.

### Pre-registered variants (fixed before any result was inspected)
Baselines: **HOLD-EOD**, **LIVE-TRAIL** (a0.50/gb0.15/stop0.60), **BASE-LADDER** (⅓@50/⅓@100/trail gb30/stop60).
Candidates (9): **(a)** ⅓/⅓/final third HOLDS to EOD · **(b1)** ⅓/⅓/trail gb40 · **(b2)** ⅓/⅓/trail gb50 ·
**(c1)** ⅓@50 + ⅔ trail gb30 · **(c2)** ⅓@50 + ⅔ trail gb40 · **(d1)** runner-aware R=150% → ⅔ trail gb40 ·
**(d2)** runner-aware R=200% → ⅔ trail gb40 · **(e1)** runner-aware R=150% → ⅔ trail gb50 ·
**(e2)** runner-aware R=150% → ⅔ HOLD to EOD.

**Pre-registered dominance screen:** a variant *dominates* iff pooled Δ > 0 **and** RUNNER Δ > 0 **and**
ROUND-TRIP Δ > −2 pt **and** pooled walk-forward passes both splits.

### Subsets (diagnostic labels — post-hoc, NOT tradeable rules)
- **RUNNER** = fires reaching **≥ +200% MFE** — n=252 (50 days). *Does the variant stop giving away the tail?*
- **ROUND-TRIP** = **MFE ≥ +50% AND EOD ≤ 0** — n=299 (60 days). *Does it keep the capture?*
- **NEITHER** = n=781. (RUNNER ∩ ROUND-TRIP = 37.)
- MFE distribution: p50 **+60%**, p75 **+157%**, p90 **+301%**, p95 **+409%**, p99 **+775%**, max **+3,796%**.

---

## Results (3% market-leg haircut, 2-bar rung confirm)

### POOLED (n=1,295)

| family | avg | med | win% | Δ vs BASE [CI] | p | LOO | WF (tr/te) |
|---|---:|---:|---:|---|---:|---:|---|
| HOLD-EOD | −3.6% | −70.3% | 33 | −10.7 [−16.2,−4.8] | 1.000 | −15.8 | no |
| LIVE-TRAIL a50/gb15 | −4.5% | −42.6% | 47 | −11.7 [−14.8,−8.7] | 1.000 | −12.3 | no |
| **BASE ⅓@50 ⅓@100 tr30** | **+7.1%** | +12.9% | 53 | — | — | — | — |
| (a) ⅓/⅓/HOLD-EOD | +1.1% | −39.9% | 43 | **−6.1** [−8.1,−4.0] | 1.000 | −7.5 | no |
| (b1) ⅓/⅓/tr40 | +5.8% | +6.5% | 52 | −1.3 [−2.3,−0.3] | 0.992 | −1.8 | no |
| (b2) ⅓/⅓/tr50 | +4.8% | −0.8% | 49 | −2.3 [−3.6,−1.0] | 1.000 | −3.0 | no |
| (c1) ⅓@50 + ⅔ tr30 | +4.7% | +11.2% | 53 | −2.4 [−3.9,−0.8] | 0.996 | −2.6 | no |
| (c2) ⅓@50 + ⅔ tr40 | +4.3% | +2.6% | 50 | −2.8 [−5.2,−0.3] | 0.985 | −4.0 | no |
| **(d1) RA150 → ⅔ tr40** | **+8.9%** | +11.9% | 52 | **+1.8** [+0.6,+3.2] | **0.0009** | **+1.4** | **+1.3/+2.3 YES** |
| (d2) RA200 → ⅔ tr40 | +8.1% | +11.9% | 52 | +1.0 [+0.2,+1.9] | 0.0090 | +0.7 | +1.0/+1.0 YES |
| (e1) RA150 → ⅔ tr50 | +8.5% | +11.6% | 52 | +1.4 [+0.2,+2.7] | 0.011 | +1.1 | +0.5/+2.2 YES |
| (e2) RA150 → ⅔ HOLD | +7.6% | +5.5% | 51 | +0.5 [−1.0,+1.9] | 0.270 | +0.1 | no |

### RUNNER subset (n=252) — *does it stop giving away the tail?*

| family | avg | Δ vs BASE | p | WF |
|---|---:|---:|---:|---|
| **HOLD-EOD** | **+204.3%** | **+97.9** | 0.000 | YES |
| LIVE-TRAIL | +73.7% | −32.7 | 1.000 | no |
| **BASE ladder** | **+106.4%** | — | — | — |
| (a) ⅓/⅓/HOLD-EOD | +118.0% | +11.6 | 0.002 | YES |
| (b2) ⅓/⅓/tr50 | +114.6% | +8.2 | 0.004 | YES |
| (c2) ⅓@50 + ⅔ tr40 | +123.9% | **+17.5** | 0.001 | YES |
| **(d1) RA150 → ⅔ tr40** | **+116.5%** | **+10.1** | 0.000 | YES |
| (e1) RA150 → ⅔ tr50 | +114.4% | +8.0 | 0.001 | YES |

### ROUND-TRIP subset (n=299) — *does it keep the capture?*

| family | avg | Δ vs BASE | p |
|---|---:|---:|---:|
| HOLD-EOD | **−74.6%** | **−113.7** | 1.000 |
| LIVE-TRAIL | +38.9% | −0.1 | 0.505 |
| **BASE ladder** | **+39.0%** | — | — |
| (a) ⅓/⅓/HOLD-EOD | −7.9% | **−46.9** | 1.000 |
| (b2) ⅓/⅓/tr50 | +21.8% | −17.3 | 1.000 |
| (c2) ⅓@50 + ⅔ tr40 | +21.4% | −17.7 | 1.000 |
| **(d1) RA150 → ⅔ tr40** | **+38.1%** | **−0.9** | 0.842 |
| (d2) RA200 → ⅔ tr40 | +38.7% | −0.3 | 0.633 |

### Dominance screen

| variant | POOLED | RUNNER | ROUND-TRIP | pooled WF | verdict |
|---|---:|---:|---:|---|---|
| (a) ⅓/⅓/HOLD-EOD | −6.1 | +11.6 | −46.9 | no | reject |
| (b1) ⅓/⅓/tr40 | −1.3 | +3.9 | −8.9 | no | reject |
| (b2) ⅓/⅓/tr50 | −2.3 | +8.2 | −17.3 | no | reject |
| (c1) ⅓@50 + ⅔ tr30 | −2.4 | +4.6 | −5.2 | no | reject |
| (c2) ⅓@50 + ⅔ tr40 | −2.8 | +17.5 | −17.7 | no | reject |
| **(d1) RA150 → ⅔ tr40** | **+1.8** | **+10.1** | **−0.9** | **YES** | **★ DOMINATES** |
| **(d2) RA200 → ⅔ tr40** | **+1.0** | **+5.1** | **−0.3** | **YES** | **★ DOMINATES** |
| (e1) RA150 → ⅔ tr50 | +1.4 | +8.0 | −2.6 | YES | fails RT bound |
| (e2) RA150 → ⅔ HOLD | +0.5 | +4.3 | −8.0 | no | reject |

**Read the (a)/(b)/(c) rows as one sentence: every point of runner upside bought unconditionally costs
1–4 points of round-trip capture, and the net is always negative.** That is the irreducible trade.
(d1)/(d2) escape it *only* because they loosen on a tiny, already-proven-explosive subset.

---

## Why (d1) works — mechanism, and why it can't be a fluke

- **It is the base ladder on 94.4% of fires** (Δ = exactly 0 by construction). The entire effect lives in
  **73 triggered fires across 35 different days**: Δ = **+31.5 pt** each [CI +10.7, +55.6], p=0.0011.
- **Trigger precision:** of those 73, **61 (84%) are true ≥+200% MFE runners**. (d2 at R=200%: 31 triggers,
  **100% precision**.) Recall is low (24%) — it only catches runners that **gap through** the +100 rung,
  not those that grind up through it. That low recall is exactly why round-trip capture is unharmed.
- **Threshold × back-trail sensitivity is a flat plateau, not a spike** — every one of the 24 grid cells is
  pooled-positive and 23/24 pass pooled WF:

  | runT \ back | tr30 | tr40 | tr50 | HOLD |
  |---|---|---|---|---|
  | 1.25 | +2.1/+12.7/−0.0 | +2.4/+15.9/−2.3 | +2.6/+17.4/−4.8 | +2.3/+18.4/−12.7 |
  | **1.50** | **+1.9/+9.9/+0.7** | **+1.8/+10.1/−0.9** | +1.4/+8.0/−2.6 | +0.5/+4.3/−8.0 |
  | 1.75 | +1.3/+7.0/+0.8 | +1.1/+5.6/−0.2 | +0.8/+4.3/−1.5 | +0.1/+1.0/−5.6 |
  | 2.00 | +1.2/+6.1/+0.6 | +1.0/+5.1/−0.3 | +0.8/+4.0/−1.3 | +0.2/+1.1/−3.7 |
  | 2.50 | +0.6/+2.9/+0.3 | +0.6/+3.3/+0.1 | +0.6/+3.3/−0.3 | +0.4/+2.1/−1.4 |
  | 3.00 | +0.5/+2.7/+0.3 | +0.6/+3.1/+0.0 | +0.7/+3.5/−0.1 | +0.3/+1.7/−1.1 |

  *(cells = pooled Δ / RUNNER Δ / ROUND-TRIP Δ, pts vs BASE)*
  Note **RA150 → ⅔ tr30** is the only cell **non-negative on all three subsets** (+1.9 / +9.9 / **+0.7**).
  It is a post-hoc grid pick, not a pre-registered claim — flagged as a co-candidate, not a result.
- **Fill-severity invariant:**

  | fills | (d1) pooled Δ | RUNNER Δ | ROUND-TRIP Δ | pooled WF |
  |---|---:|---:|---:|---|
  | frictionless | +1.8 | +10.3 | −0.8 | YES |
  | 3% market-leg / 2-bar (headline) | +1.8 | +10.1 | −0.9 | YES |
  | 3% ALL-leg / 2-bar | +1.8 | +10.3 | −0.8 | YES |
  | 5% market-leg / 2-bar | +1.7 | +9.9 | −0.9 | YES |
  | 3% market-leg / **3-bar confirm** | **+2.5** | **+13.9** | −1.2 | YES |

  It gets **better** under harder fills (3-bar confirm delays the +100 rung, so more runners gap past it).
  (d1) also pays *more* haircut than base when triggered (⅔ exits at market vs ⅓) and still wins.
- **Independent corroboration (EXPLORATORY, post-registration):** a **velocity** trigger — skip rung 2 if
  +100% confirms within K bars of entry — reproduces the effect from a different angle: K=20 → pooled
  **+1.5**, RUNNER **+10.4**, ROUND-TRIP −0.7, WF YES, LOO +1.1. Combining (RA150 **OR** fast ≤15 bars)
  gives pooled **+2.0** / RUNNER **+12.3** / RT −1.8. Same mechanism, different detector → the finding is
  about **explosive early velocity**, not about the number 150.

## Multiple-comparisons discount
9 pre-registered candidates. **Bonferroni α = 0.05/9 = 0.0056.** Charging for the 3 subsets too (27 tests)
→ **α = 0.0019**. Charging for the exploratory grid as well (~40 tests) → **α ≈ 0.00125**.
- **(d1) pooled p = 0.0009 → clears all three thresholds.**
- **(d2) p = 0.0090 and (e1) p = 0.011 → do NOT clear Bonferroni.** They are directionally consistent
  with (d1) but are not independently significant. **(d1) is the single surviving variant.**
- (a)/(b)/(c) are all p ≥ 0.98 in the wrong direction — not marginal, decisively rejected.

---

## The uncomfortable part — read this before getting excited

1. **(d1) does not make the ladder more consistent; it makes it more skewed.**
   - Median triggered fire: **+4.8 pt**. **33 of 73 (45%) triggered fires are WORSE than base.**
   - Per-fire Δ range: worst **−139.8**, p10 −30.6, p90 +154.6, best **+539.2**.
   - Day-level vs base: **17 better / 18 worse / 26 identical.** A coin flip.
   The +1.8 pooled is a right-tail expectation, carried by a handful of fires (best day 2026-06-09 +30 pt).
2. **It does not fix the ghost-A/B failure mode.** Frequency of the ladder losing to LIVE-TRAIL:
   - per day: BASE **17/61 (28%)**, d1 **18/61 (30%)**.
   - per 4-day window: BASE **2/58 (3%)**, d1 **3/58 (5%)**. Worst window **−5.7 pt for both**.
   (d1) raises the 4-day window **mean** (11.9 → 13.7) and **best** (32.5 → 42.3) and leaves the **worst
   unchanged**. It is a tail-enhancer, not a downside protector.
3. **The ghost A/B alarm was partly a misdiagnosis.** Runner days are the ladder's *best* days: on the 50
   replay days containing a ≥+200% runner, BASE = **+11.8%** vs LIVE-TRAIL **−1.9%**. The real mechanism of
   the observed loss is narrower: on **31% of runner fires the tight live trail (gb15) rides further than
   the ladder** — a near-monotone climb never triggers a 15% giveback, so the trail captures the whole run
   while the ladder sold ⅔ into it. **(d1) barely changes that share (31%)**, though it does raise the mean
   on the most extreme fires (≥+400% MFE: TRAIL 115% → BASE 137% → **d1 174%**).
4. **The −3.9 pt over 4 live days is a ~3rd-percentile window, not routine noise.** It should not be waved
   away — but a single 4-day window has enormous sampling error and was selected for inspection *because*
   it looked bad. **The ghost A/B needs ≥20 days before it can adjudicate anything.**
5. **Effect size vs mark noise.** UW `close` is a trade print; the SCALEOUT report set a ~3% noise band.
   Pooled +1.8 pt is *below* that band — but the comparison is **paired on identical paths and 94.4% of
   fires are Δ = 0 exactly**, so the noise argument does not bite: the effect is +31.5 pt on 73 fires,
   far above noise, diluted by construction. Report the triggered-subset number, not the pooled one.
6. **Subset labels are post-hoc.** RUNNER/ROUND-TRIP are diagnostic partitions of outcomes, not signals
   available at fire time. Only the **(d1) trigger itself is causal** (running peak, bars ≤ i).
7. **Pre-gate mix.** As in SCALEOUT, these numbers are on the pre-bull-tape-gate fire mix. Re-estimate on
   the surviving mix before sizing.

---

## VERDICT

**The tail-vs-consistency trade is ~90% irreducible, and 10% buyable — conditionally.**

- **Is there a variant that beats the base ladder on RUNNER without losing round-trip capture?**
  **Yes: (d1) RUNNER-AWARE R=+150% → remaining ⅔ on a loose 40% trail.** RUNNER **+10.1**, ROUND-TRIP
  **−0.9**, pooled **+1.8** (p=0.0009), WF passes both splits, LOO +1.4, stable across every fill regime,
  clears Bonferroni. It is the only pre-registered variant to do so.
- **Is the trade irreducible?** **In the large, yes — and that is the honest headline.** No exit that books
  ⅔ of the position can approach HOLD-EOD's +204% on runners; the ladder forfeits ~98 pt of runner upside
  and (d1) recovers only ~10 of it. **Anyone hoping a clever ladder recovers the +432% monster should stop
  hoping.** The ladder's +114 pt round-trip capture *is* the payment for that tail, and the payment is
  correct: pooled, the ladder beats HOLD-EOD by +10.7 pt.
- **Unconditional loosening — hypotheses (a), (b), (c) — is a NULL.** Every variant is pooled-negative and
  fails walk-forward. **In particular the brief's hypothesis (a) (final third holds to EOD) is the worst
  variant tested** (pooled −6.1, round-trip −46.9). Holding a 0DTE runner to the close is not tail capture;
  it is a coin flip — see 2026-06-25 QQQ: **+963% MFE, −98.6% EOD**.
- **(d1) is a variance-adding, mean-improving overlay, not a consistency fix.** It will still lose to the
  live trail on ~30% of days. Adopt it for expectancy, not for comfort.

## DECISIONS NEEDED (not shipped)

- **D1 — Paper-forward (d1) RUNNER-AWARE as a bounded overlay on the verified ladder.** Rule: run
  ⅓@+50 / ⅓@+100 / trail; **if the causal running peak ≥ +150% at the bar the +100 rung would fill, skip
  rung 2 and trail the remaining ⅔ at giveback 40% (stop 60%).** It is a no-op on 94.4% of fires, so the
  blast radius is bounded to ~1 fire in 18. Log the trigger flag live.
- **D2 — REJECT unconditional loosening** ((a) hold-final-third, (b) loose trails, (c) single-rung).
  All pooled-negative, all fail WF. Close hypotheses (a)/(b)/(c).
- **D3 — Do NOT let the 4-day ghost A/B adjudicate the ladder.** 4-day windows are negative in only 2/58
  historical cases; observing one proves little. **Extend the ghost A/B to ≥20 days** before any call.
  Track the per-day ladder-vs-trail sign, not just the mean.
- **D4 — Co-candidate: RA150 → ⅔ trail gb30** (the only sensitivity cell non-negative on all three
  subsets: +1.9 / +9.9 / **+0.7**). Post-hoc pick — confirm forward alongside (d1), do not prefer it on
  this evidence.
- **D5 — Exploratory: a VELOCITY trigger** (+100% confirmed within ~15–20 bars of entry) reproduces the
  effect independently and combines additively with RA150 (pooled +2.0 / RUNNER +12.3). Worth
  pre-registering as its own study; **not** actionable off this run.

## Reproduce
- `node apps/gex/research/exit-study/ladder_runner.mjs [haircut=0.03] [nbar=2] [all]`
  - `node ladder_runner.mjs 0.03 2` — headline (3% market-leg haircut, 2-bar rung confirm)
  - `node ladder_runner.mjs 0.03 3` — harder fills (3-bar confirm)
  - `node ladder_runner.mjs 0.03 2 all` — haircut on every leg including limit rungs
- Reuses `build_dataset.mjs` `cache/` + `fires_index.json`. Subsets, WF, LOO, bootstrap, the RA
  sensitivity grid and the exploratory velocity variants are all inline in the driver.
