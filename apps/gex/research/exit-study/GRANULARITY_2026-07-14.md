# Decision Granularity — is 60s the bottleneck?

**Date:** 2026-07-14
**Status:** RESEARCH ONLY (Clause 0 — no live code touched; any recommendation lands in DECISIONS NEEDED)
**Operator's question:** *"Do we need to increase the granularity at which we make play decisions?"*

Motivating incident: on 2026-07-14 two losers (−63%, −36%) both closed on
`closed_structure_invalidated:opposing_pika_$720_hardened`. The structure turned
against them and we acted a minute-plus later.

- **H1 (operator):** finer granularity catches invalidation earlier → smaller losses.
- **H0 (counter):** faster polling = faster **noise** → more whipsaw, premature exits, worse realized.

---

## 0. PRE-REGISTRATION (written before any outcome was computed)

### System as-built (verified in code, not assumed)

| Component | File | Cadence |
|---|---|---|
| Fire loop (pulls Skylit surface, publishes to cache) | `src/tracker/fire-loop.js:36` | `FIRE_LOOP_INTERVAL_MS \|\| 60_000` → **60s** |
| Refresh loop (marks + trail + structure exit) | `src/tracker/refresh-loop.js:21` | `REFRESH_LOOP_INTERVAL_MS \|\| 60_000` → **60s** |
| Surface staleness guard | `src/tracker/surface-cache.js:18` | 3 min |

Live exit rules (`src/tracker/plays.js`):
- Trail: `TRAIL_ARM_MIN_GAIN = 0.50`, `TRAIL_GIVEBACK_PCT = 0.15` (L146-147).
- **There is NO hard stop in the live tracker.** The task brief mentioned
  `hardstop=0.60`; `grep -rni "hard.?stop|STOP_LOSS|0\.60" src/tracker src/domain`
  returns nothing. Primary Arm-A sim is therefore **live-faithful (no hardstop)**;
  a `+0.60 hardstop` variant is run as a labelled secondary so the brief's spec is
  still answered.
- Structure exit (`evaluateSurfaceExit`, L216+) runs **before** the trail and
  short-circuits it; the trail is additionally suppressed when barney-fuel says HOLD.

### Arm A — exit-decision cadence sweep

Dataset: replay option-path cache (`research/exit-study/cache/`, `buildPath()` from
`backtest_trail_recal.mjs`), ~1,295 fires / 61 days, per-minute UW option marks.

Simulate the live trail where the refresh loop **only observes the mark every k
minutes** — peak (`best_mark`) updates *and* exit checks both happen only on
observed samples, exactly as the live loop behaves. k ∈ {1, 2, 5, 15} min.
- Phase-averaged over all k offsets (0..k−1) so no result is a phase artifact.

**Plus a genuine sub-minute bound.** UW candles carry `high`/`low`, so I can
simulate *continuous* (k→0) monitoring: peak tracks the candle **high**, the stop
triggers off the candle **low**, and fills at the stop price
`peak_g − gb·(1+peak_g)`. Intra-candle ordering is unknowable, so I report a
**band**: CONT-optimistic (low checked before high updates peak) and
CONT-pessimistic (high updates peak first). The truth is inside the band. This is
the closest thing to "what would sub-60s polling do to the trail" that the data
permits — and it is a real test, not an extrapolation.

Haircuts: 0% / 2% / 3% return points on reactive exits. Walk-forward: days split in
half (train = first 50%, test = last 50%), identical to the existing harness.

**Pass bar:** a finer cadence must beat the current one on **both** walk-forward
halves at a realistic (2-3%) haircut.

### Arm B — structure-exit latency bound

n ≈ 30 plays with `close_reason LIKE 'closed_structure_invalidated%'` (2026-07-09 →
07-14). Pull each option's 1-min path from UW and compute, in return points vs
`entry_mark`:

```
Δ(N) = (mark[close_ts + N min] − close_mark) / entry_mark
```

Sign convention: **Δ(−1) > 0 means exiting 1 minute EARLIER would have been better.**
N ∈ {−5, −2, −1, 0, +1, +2, +5}.

**The load-bearing inference.** The structural condition is evaluated by a **60s**
poll. A condition that fires at poll time *T* became true somewhere in *(T−60s, T]*.
Sub-60s polling therefore cannot detect it before it exists — it can capture *at
most* the move from T−1min to T, and in expectation only about **half** of it
(arrival is ~uniform within the minute). So:

> **E[gain from infinitely fast polling] ≤ Δ(−1),  realistically ≈ 0.5 · Δ(−1).**

Δ(−1) is a **hard upper bound** on the entire value of Arm-A/Arm-B granularity work.
Δ(−2)/Δ(−5) are *not* granularity — they measure whether the *signal itself* should
lead, which is a different (and separately-testable) change. Δ(+1/+2/+5) tests the
opposite worry: are we already exiting too hastily?

**Decision rule (pre-registered):** to justify engineering, Δ(−1) must be (a)
positive, and (b) materially larger than the round-trip fill haircut (~2-3 return
points). A Δ(−1) that is negative, ~zero, or smaller than the haircut ⇒ **NULL**,
and the honest answer is *no*.

n=30 is small; I will not read significance into a sub-haircut effect, and I report
the cohort splits (opposing_pika vs pin_forming, winners vs losers) as descriptive
only.

### Arm C — declared data limit (stated up front, not discovered late)

**Sub-60s SURFACE granularity is NOT testable, and I will not fake it.**
- Skylit live is an SSE stream (`src/heatseeker/client.js`, `STREAM_URL`); the fire
  loop samples it at 60s and publishes to an **in-memory** `surface-cache`.
- **The tracker never persists surfaces to disk.** There is no local archive of what
  the map looked like at 10s resolution.
- The only historical surface source is Skylit's `/api/data?timestamp=…` endpoint,
  which is coarse (~5-min) — *coarser* than the live loop, so it cannot be used to
  simulate anything finer.

⇒ Finer-than-1-min structure **detection** can only be **bounded** (Arm B), never
simulated. Arm A tests granularity of the **mark-based** exit, which *is* fully
simulable. Any claim about sub-60s surface polling in this doc is a bound, and is
labelled as one.

### Pre-registered prediction

I expect **H0 (null / cadence is not the bottleneck)**. Rationale, stated before
seeing results: (i) prior studies in this program found hard stops and mark-gates
both *failed*, implying the option mark is noise-dominated at short horizons; (ii) a
*giveback* trail is mechanically more trigger-happy the more often you sample it, so
finer observation should cost, not gain; (iii) I therefore predict CONT ≤ 1min ≤
5min in realized terms. If instead 1-min clearly beats 5/15-min, H1 gains real
support and finer is worth costing out.

---

## 1. VERDICT

> **NO. Do not increase decision granularity. The cadence is not the bottleneck.**
>
> The pre-registered prediction (H0) held on both arms. Going *finer* than 60s is
> not merely useless for the mark-based trail — it is **measurably harmful**, and it
> is **provably near-worthless** for the structure exit.
>
> **And the two losers that motivated the question would have been made WORSE, not
> better, by finer granularity.** Both were *never green*. They were bad **entries**,
> not slow **exits**.

Scripts: `cadence_study.mjs` (Arm A), `latency_bound.mjs` (Arm B). Both reproducible.

---

## 2. ARM A — exit-decision cadence (n=1,295 fires / 61 days, Apr10→Jul08)

Live-faithful trail (0.50/0.15, no hardstop), 2% fill haircut:

| cadence | avg | med | win% | Δ vs 1-min | boot95 | train Δ | test Δ | walk-fwd |
|---|---|---|---|---|---|---|---|---|
| HOLD-EOD (null) | −0.56% | −67.35% | 33% | +1.49 | [−4.78, +7.76] | −3.39 | +6.57 | mixed |
| **CONTINUOUS (pessim)** | **−5.68%** | +28.36% | 62% | **−3.63** | **[−6.91, −0.53]** | −2.33 | −4.98 | **worse both** |
| **CONTINUOUS (optim)** | **−5.71%** | +28.33% | 62% | **−3.66** | **[−6.95, −0.57]** | −2.37 | −4.99 | **worse both** |
| **1 min (= CURRENT)** | −2.05% | +19.57% | 56% | — | — | — | — | — |
| 2 min | −1.64% | +13.22% | 53% | +0.41 | [−0.91, +1.82] | +0.50 | +0.32 | beats 1-min both |
| 5 min | −1.56% | −3.60% | 49% | +0.49 | [−2.08, +3.10] | +0.49 | +0.49 | beats 1-min both |
| 15 min | −1.51% | −26.02% | 43% | +0.55 | [−3.31, +4.88] | −1.85 | +3.03 | mixed |

Two things, and only the first is a real finding:

**(a) Sub-minute monitoring is significantly WORSE — this refutes H1 directly.**
The CONTINUOUS bound (the honest simulation of "what if we saw every tick") loses
**−3.6 return points vs the current 1-min loop**, with a bootstrap CI that
**excludes zero**, and it is worse on **both** walk-forward halves, at **every**
haircut, under **both** the live trail and the hardstop variant. This is the single
most robust result in the study, and it points the opposite way from the operator's
intuition.

**(b) Coarser is *directionally* better but NOT significant — I am not recommending it.**
2-min and 5-min beat 1-min on both WF halves at every haircut, but by only +0.4 to
+0.6 points with CIs spanning zero, and median/win% get materially *worse* (the
distribution shifts to all-or-nothing). The honest read is that the mean is **flat
across 1/2/5/15-min** (all within 0.7 pts, all CIs spanning zero). Cadence, in the
1–15 min band, is simply not a lever. **No change recommended.**

### The mechanism — noise-harvesting, measured directly

| cadence | exit-rate | avg gain \| exited | avg gain \| held |
|---|---|---|---|
| 15 min | 33.9% | **+68.53%** | −36.42% |
| 5 min | 43.8% | +67.49% | −53.89% |
| 2 min | 49.6% | +64.32% | −64.53% |
| 1 min (current) | 52.5% | +60.05% | −68.52% |
| **CONTINUOUS** | **61.2%** | **+45.17%** | −82.86% |

Read the two middle columns together. As sampling gets finer, the giveback trail
**fires more often** (33.9% → 61.2%) and **each exit gets worse** (+68.5% → +45.2%),
monotonically. That is the counter-hypothesis rendered as a measurement: a *giveback*
trail is mechanically more trigger-happy the more often you look at it, and the extra
triggers are noise, harvested at worse prices. **Finer sampling doesn't find the exit
sooner; it finds a worse exit sooner.**

Also load-bearing: **44.9% of fires never reach +50%, so the trail never arms and
exit cadence is irrelevant to them by construction.** Any cadence change can only
touch half the book.

---

## 3. ARM B — structure-exit latency bound (n=30, all structure exits, 07-09→07-14)

Δ in return points vs entry. **Δ(−1) > 0 ⇒ exiting 1 min EARLIER would have been better.**

| offset | mean Δ | med Δ | boot95 | better% |
|---|---|---|---|---|
| T−5 (earlier) | **−10.34** | −7.28 | **[−19.98, −3.46]** | 23% |
| T−2 (earlier) | +0.46 | +1.07 | [−2.31, +3.17] | 53% |
| **T−1 (earlier)** | **+1.97** | +0.45 | **[−0.35, +4.99]** | 57% |
| T0 (actual) | +0.09 | +0.73 | [−3.42, +3.38] | 57% |
| T+1 (**later**) | **+2.67** | +1.71 | [−1.26, +6.65] | 60% |
| T+2 (later) | −0.42 | −0.16 | [−4.37, +3.57] | 43% |
| T+5 (later) | −2.39 | −1.46 | [−11.98, +5.70] | 43% |

### The bound

```
Δ(-1) mean            = +1.97 return points   boot95 [-0.35, +4.99]  ← CI includes ZERO
Realistic gain ≈ 0.5·Δ(-1) = +0.98 return points
Round-trip fill haircut    = 2.00 – 3.00 return points
                             ------------------------------------
NET of an infinitely fast surface poll:  NEGATIVE
```

The structural condition is polled every 60s, so a condition firing at *T* became
true within *(T−60s, T]*. Sub-60s polling cannot detect it before it exists — it can
capture **at most** the T−1→T move, and in expectation about half of it. So **Δ(−1)
is a hard ceiling on the entire value of finer surface polling**, and that ceiling is
(i) not statistically distinguishable from zero, and (ii) **smaller than the fill
haircut it would cost to harvest.** Even the perfect version of the operator's
proposal loses money.

Meanwhile **Δ(−5) = −10.34, CI [−19.98, −3.46]** — exiting 5 minutes earlier is
*significantly worse*. The structure exit is **not** firing late; if anything the
signal should not lead at all. And **Δ(+1) = +2.67** — the only directional evidence
in the table says we are marginally **hasty**, not slow. That is the opposite of the
operator's premise.

### The decisive cut: the losers gain NOTHING from earlier exit

| cohort | n | Δ(−1) | boot95 | Δ(−5) |
|---|---|---|---|---|
| **LOSERS at exit** | **16** | **−0.11** | **[−1.88, +1.75]** | −2.20 |
| WINNERS at exit | 14 | +4.35 | [+0.26, +10.10] | −19.65 |
| NEVER GREEN (peak ≤ 0) | 4 | +0.04 | [−3.63, +4.07] | **−4.55 [−6.08, −3.15]** |

The losing plays — *the exact cohort the operator wants to save* — have **Δ(−1) =
−0.11 return points. Literally zero.** Exiting the losers a minute earlier buys
nothing, because by the time the structure hardens, the damage is already in the mark.

The whole +1.97 all-cohort figure is carried by the **winners** (Δ(−1) = +4.35, 79%
better) — i.e. on plays we exit *green*, we give back a point or two of profit by
selling a minute after the local top. That is a **profit-taking timing** artifact, not
an **invalidation-latency** problem, and it is not what was asked. It is also the one
cell in the table that would **not** survive a multiple-comparisons correction (42
cohort×offset cells tested; Bonferroni α ≈ 0.0012 vs a CI that only barely clears
zero). **I am not claiming it as an edge.**

### The two 2026-07-14 losers that started this — finer would have HURT both

| play | realized | **peak** | Δ(−5) | Δ(−2) | Δ(−1) | Δ(+1) |
|---|---|---|---|---|---|---|
| 175 QQQ 720C | **−62.99** | **−13.09** | −6.75 | −4.70 | **−0.20** | **+11.66** |
| 177 QQQ 720C | **−35.99** | **−2.23** | −4.78 | −9.24 | **−4.78** | +0.32 |

**Both had a NEGATIVE peak gain. They were never green, not for one minute.** There
was no profit to protect and no earlier moment at which exiting would have salvaged
them — exiting earlier was **worse at every single horizon** (−0.20, −4.70, −6.75 and
−4.78, −9.24, −4.78). For play 175, exiting one minute *later* would have been
**+11.66 points better**.

The loss on these two was **baked in at entry.** No amount of polling speed reaches
back before the fire to fix a play that never traded green. Attributing them to exit
latency is a misdiagnosis, and building faster polling on that diagnosis would have
made 2026-07-14 *worse*.

---

## 4. ARM C — the data limit, stated plainly

**Sub-60s SURFACE granularity is NOT testable, and I did not fake it.**

- Skylit live is an **SSE push stream**; the fire loop samples it at 60s and publishes
  to an **in-memory** `surface-cache` (`src/tracker/surface-cache.js`).
- **The tracker never persists surfaces to disk.** There is no archive of what the map
  looked like at 10s resolution — it does not exist and cannot be reconstructed.
- Skylit's only historical endpoint (`/api/data?timestamp=…`) is ~5-min — *coarser*
  than the live loop, so it cannot simulate anything finer.

⇒ Finer-than-1-min structure **detection** can only be **bounded** (Arm B), never
simulated. Every sub-60s claim in this document is a bound and is labelled as one.
Arm A's CONTINUOUS row is a real simulation, but of the **mark-based trail** (which
has 1-min OHLC and therefore intra-minute high/low), *not* of the surface.

---

## 5. Honesty notes

- **Bug found and fixed in my own harness.** Two cache schemas coexist: UW pulls give
  `{start_time, close, high, low}`; the 07-09/07-10 files were written by an earlier
  script as `{ts, close}`. The first version of `latency_bound.mjs` parsed only
  `start_time` and **silently dropped 15 of 30 plays as `n/a`**. Fixed; all results
  above are the full n=30. Arm A is unaffected (its replay set is Apr10→Jul08, all
  `start_time`, and its continuous bound *requires* the high/low that the `{ts,close}`
  files lack — so excluding them there is correct, not convenient).
- **The brief's `hardstop=0.60` is not in production.** `grep -rni "hard.?stop|STOP_LOSS"
  src/tracker src/domain` returns nothing; live is trail-only (`plays.js:146-147`). Ran
  it as a labelled secondary anyway — **same conclusion, no sign flips.**
- **Multiple comparisons.** ~24 cells in Arm A, ~42 in Arm B. At α=0.05 that predicts
  ~3 false positives. The results I am *relying* on all point at the **null** (a null
  is not a multiple-comparisons hazard; a spurious *edge* is). The one nominally
  "significant" positive — WINNERS Δ(−1) — is exactly the cell I expect to be a false
  positive, and I explicitly decline to claim it.
- n=30 for Arm B is **small**. But the bound is a *ceiling* argument, and the ceiling is
  below the fill cost even taking the point estimate at face value — the conclusion does
  not depend on the CI.

---

## 6. DECISIONS NEEDED (no live code touched — Clause 0)

1. **REJECT the granularity change.** Do not lower `FIRE_LOOP_INTERVAL_MS` or
   `REFRESH_LOOP_INTERVAL_MS` below 60s. It is a measured loss on the trail (Arm A:
   −3.6 pts, CI excludes zero, worse on both WF halves) and a sub-haircut null on the
   structure exit (Arm B: ceiling +0.98 pts vs 2–3 pts of fill cost). It would also
   raise Skylit/UW API load for negative expected return.
2. **Do NOT switch to a coarser cadence either.** 2/5-min beat 1-min on both WF halves,
   but insignificantly (CIs span zero) and with worse median/win%. Cadence is flat in
   1–15 min. **Leave 60s alone.** Not a lever in either direction.
3. **Re-aim at ENTRY QUALITY — that is where the 07-14 losses actually live.** Both
   motivating losers had a *negative peak*: they never traded green, so no exit policy
   of any speed could have saved them. The open question this study surfaces is not
   "how fast do we exit?" but **"why did we fire on two plays that never went green?"**
   Both were `opposing_pika_$720_hardened` on the *same strike, same ticker, same day* —
   worth asking whether the fire should have been suppressed when a hardening opposing
   pika was *already* near spot at fire time. That is a pre-trade gate, and it is
   testable on the replay set.
4. **(Optional, low conviction) Profit-taking timing.** Winners give back ~4 pts by
   selling ~1 min after the local top. This is the one place granularity *could* pay —
   but it is a multiple-comparisons-fragile result on n=14, it is a *different* problem
   from the one asked about, and it cuts against Arm A's finding that finer trail
   sampling is harmful. **Do not action without a dedicated pre-registered study.**

---

## 7. Reconciliation with the program

This is consistent with everything else the exit-study program has found:
the **hard stop failed**, the **mark gate failed**, the **structure exit is already a
competent near-peak seller** (Δ(0) ≈ +0.09, and exiting 5 min earlier is −10.3).
The exit machinery is not where the remaining edge is. **The cadence is not the
bottleneck. Entry selection is.**
