# EXHAUSTION ENTRY — flagship entry-timing study

**2026-07-14 · RESEARCH ONLY (Clause 0) · no live code touched · recommendations → DECISIONS NEEDED**

Script: `apps/gex/research/gexvex-structure/exhaustion_entry.mjs`
Run: `node exhaustion_entry.mjs 0.03` (and `0.02` for the haircut check)

---

## VERDICT: **NULL — and the core premise is INVERTED.**

There is **no exogenous, signal-time discriminator** between impulse-exhaustion fires and
trend-continuation fires. 22 causal features (tape extension, velocity, deceleration, and the
Skylit surface ahead), swept over 5 gate sizes, walk-forwarded, and scored against a
volume-matched random skip: **11/22 beat a coin-flip skip out-of-sample. Coin-flip expects 11.**
Every day-block bootstrap p-value is >> 0.05. Nothing survives an MC discount.

The pre-registered exhaustion score **points the wrong way**: rank-corr with realized P&L is
**+0.049**, not negative. The most-exhausted decile (D10) is the *second most profitable*
(+12.7%/fire, PF 1.41) while the *least*-exhausted decile is the worst (−13.1%, PF 0.69).

The timing variant produced the single most useful result in the study, and it is a
**conservation law, not an edge** — see §5. This is the fourth consecutive entry hypothesis to die.

---

## Setup

| | |
|---|---|
| Fires | 1,355 replay+live → **1,035 usable** (dropped: 60 no option path, 260 <30m of tape history, 0 no surface) |
| Days | 61 (2026-04-10 → 2026-07-10) |
| Walk-forward | split at 2026-05-22 · TRAIN 540 / TEST 495 |
| Exit (baseline **and** every treatment) | LIVE TRAIL arm 0.50 / giveback 0.15 → EOD |
| Fills | 3% haircut on entry **and** exit (`((1+g)(1−h))/(1+h) − 1`); 2% re-run identical |
| **Baseline** | **−6.2%/fire · win 54.6% · PF 0.84 · total −6,396% of premium risked** |

Features are all strictly causal: underlying 1-min bars up to the fire minute (SPY proxies SPXW),
and the last Skylit archive frame **at or before** fire time. Nothing reads the option's own path —
that was the error that killed `PULLBACK_ENTRY_2026-07-14`.

---

## 1. Pre-registered EXHAUSTION score — fails, and inverts

`EXH = mean[ z(range_pos), z(spent), z(vwap_dist), z(ma20_dist), z(−accel), z(−barney), z(+wall_rs) ]`
z-stats fit on TRAIN only. **Prediction (stated before any outcome was inspected): high EXH → negative realized.**

Decile table, full sample:

| dec | n | mean realized | win% | PF | range_pos | accel | barney | wall_rs |
|---|---|---|---|---|---|---|---|---|
| D1 (least exhausted) | 103 | **−13.1%** | 53% | 0.69 | 0.13 | 9.0bp | 24.8% | 8.5% |
| D2 | 103 | −10.3% | 54% | 0.73 | 0.19 | 4.0bp | 18.8% | 10.0% |
| D3 | 103 | −15.1% | 49% | 0.65 | 0.24 | 0.0bp | 17.6% | 11.5% |
| D4 | 103 | −17.3% | 50% | 0.56 | 0.37 | 1.2bp | 17.9% | 10.6% |
| D5 | 103 | +0.5% | 53% | 1.01 | 0.43 | 0.8bp | 15.0% | 11.3% |
| D6 | 103 | +16.7% | 71% | 1.63 | 0.52 | 1.3bp | 13.8% | 12.1% |
| D7 | 103 | −8.6% | 56% | 0.77 | 0.61 | 0.7bp | 14.2% | 14.2% |
| D8 | 103 | −8.1% | 52% | 0.79 | 0.78 | 1.1bp | 14.4% | 10.8% |
| D9 | 103 | −20.2% | 45% | 0.54 | 0.83 | −1.9bp | 11.9% | 12.1% |
| **D10 (most exhausted)** | 108 | **+12.7%** | 62% | **1.41** | 0.89 | −0.2bp | 9.6% | 16.9% |

Non-monotone, and the sign is backwards. The signal does **not** get worse as price gets more
extended, more spent, further from VWAP, more decelerated, and closer to a wall. If anything the
*most* extended fires do best. The premise "we buy exhaustion, so measure exhaustion and skip it"
is **empirically false on this fire set**.

The `EXH` gate confirms it: suppressing the top-10% most-exhausted fires *skips a cohort whose
baseline P&L is **+13.2%**, win 62%* — we would be skipping winners. System P&L goes from −6.2% to
−7.5%, at the **1.1st percentile** of a volume-matched random skip. It is significantly *worse than
random*.

## 2. Univariate: no feature separates

Mean realized by quintile, and rank-corr with realized (full sample, n=1,035):

| feature | Q1 | Q2 | Q3 | Q4 | Q5 | rank-corr |
|---|---|---|---|---|---|---|
| imp_age | −8.2% | −12.8% | −12.6% | −2.5% | +5.2% | **+0.069** |
| barney (neg-gamma "fuel" ahead) | +0.7% | −0.8% | −2.3% | −16.1% | −12.4% | **−0.067** |
| spent (share of typical daily range) | −11.1% | −5.8% | −1.6% | −14.9% | +2.4% | +0.050 |
| accel (5m momentum change) | −14.6% | −10.5% | −1.4% | −4.5% | +0.1% | +0.044 |
| vwap_dist | −15.7% | +0.8% | −10.7% | −4.3% | −1.1% | +0.039 |
| range_pos | −15.5% | −2.7% | −6.3% | −1.6% | −4.8% | +0.037 |
| wall_rs (opposing pika ahead) | −1.9% | −7.2% | −11.3% | −6.8% | −3.7% | −0.007 |
| mass_below | +0.4% | −8.0% | −11.8% | −9.7% | −1.8% | −0.004 |
| r5 / r15 / r30 | — | — | — | — | — | +0.003 / −0.014 / +0.000 |
| **EXH (pre-registered)** | −12.1% | −16.4% | +8.7% | −7.2% | −3.9% | **+0.049** *(wrong sign)* |
| **FUEL = z(wall_rs)×z(accel)** (hypothesis D) | −9.1% | −6.2% | −4.3% | −11.8% | +0.5% | +0.030 |

**Max |rank-corr| across all 18 raw features is 0.069.** Not one is monotone. The wall-vs-escalator
interaction `FUEL` — the leading hypothesis — has rank-corr **+0.030** and a non-monotone decile
table (D1 −9.1%, D10 +6.9%, D4 −11.8%). It is noise.

## 3. Gate sweep vs volume-matched random skip — worse than a coin flip

7 gates × 5 sizes, thresholds fit on TRAIN, evaluated on TEST, scored against a 2,000-draw
bootstrapped random skip of the same volume:

- **8/35 cells have positive TEST vs-random. Coin-flip null expects ~18.**
- Best-in-TRAIN cell (`vwap_dist` block-hi 50%, TRAIN vsRandom **+3.5%**) → **honest OOS TEST vsRandom −3.2%**, at the **4.9th percentile** of random. It inverted.
- Best-in-TEST cell (`fuel` block-lo 50%, +3.7%, 97.4th pctile) needs >99.86th pctile to clear Bonferroni across K=35. **FAILS.**

The random-skip control is doing exactly the job it was added for. Example: `exh(hi)` at 40% shows
system P&L improving from −6.2% → −4.0%, which looks like a win — but a *random* 40% skip
delivers −3.7%. The gate is at the **41.7th percentile of random**. It is a volume effect, not an edge.

## 4. Every feature its best shot (direction AND size fit on TRAIN) — exactly coin-flip

To be maximally fair, I let TRAIN choose each feature's gate *direction* (from the sign of its TRAIN
rank-corr) and its *size*, then evaluated once on TEST:

| feature | train-dir | X* | TRAIN vsRand | **TEST vsRand** | boot-pctile | day-block p |
|---|---|---|---|---|---|---|
| exh | block LO | 40% | +0.9% | **+5.6%** | 100.0% | 0.128 |
| imp_age | block LO | 50% | +3.8% | +3.3% | 96.3% | 0.384 |
| ext_open | block LO | 30% | +0.4% | +3.2% | 96.8% | 0.428 |
| barney | block HI | 50% | +4.3% | +3.2% | 96.5% | 0.375 |
| range_pos | block LO | 10% | +2.0% | +2.7% | 99.1% | 0.478 |
| accel | block LO | 40% | +2.9% | +2.6% | 91.8% | 0.374 |
| **fuel2** (TRAIN's pick) | block HI | 40% | **+4.4%** | **+1.0%** | 70.3% | **0.734** |
| fuel | block LO | 20% | +1.5% | +1.0% | 72.5% | 0.759 |
| wall_rs | block HI | 50% | +3.3% | −1.8% | 16.3% | 0.472 |
| spent | block HI | 50% | +2.0% | −2.5% | 9.6% | 0.543 |
| vwap_dist | block HI | 50% | +3.5% | −3.2% | 3.5% | 0.461 |
| mass_below | block LO | 50% | +4.3% | −4.3% | 1.1% | 0.055 |
| *(10 more, all p > 0.4)* | | | | | | |

- **11/22 positive OOS. Coin-flip expects 11.** This is the cleanest possible null.
- **Every single day-block p-value is > 0.05** (the only one near it, mass_below p=0.055, is *negative* OOS).
- TRAIN's actual pick (`fuel2`) decays from +4.4% → **+1.0% OOS, p=0.734**.
- The apparently-strong `exh` block-LO cell (TEST +5.6%, 100th pctile) is (a) the **opposite** of the pre-registered direction — it says *skip the calm fires* — (b) worth only +0.9% in TRAIN, so TRAIN would never have picked it, and (c) day-block p = 0.128. It is a day-clustered artifact.

## 5. Timing variant — the one real finding, and it is a **conservation law**

The operator's actual ask. Exogenous continuation confirmation, computed on the **underlying**:
after the fire, wait for a minute where (a) the underlying has made a new extreme ≥ C in the trade
direction beyond the fire-time spot **and** (b) the last-5m directional return is > 0 (momentum
re-accelerating). Enter at that minute's option close. No confirmation within W → **no trade (P&L 0)**.

| C | W | fill% | SYS base | SYS confirm | vsRandom | boot-pctile | **SELECT-only** | **delay-cost** | perTrade | PF |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.05% | 10m | 40% | −6.2% | −1.0% | +1.5% | 87.3% | **+8.9%** | **−9.9pt** | −2.4% | 0.93 |
| 0.05% | 30m | 60% | −6.2% | −3.2% | +0.5% | 63.7% | **+11.3%** | **−14.5pt** | −5.3% | 0.84 |
| **0.10%** | **10m** | **21%** | −6.2% | **+0.4%** | +1.6% | 92.5% | **+8.0%** | **−7.7pt** | **+1.7%** | **1.06** |
| 0.10% | 30m | 38% | −6.2% | −1.4% | +0.9% | 75.3% | **+13.3%** | **−14.8pt** | −3.8% | 0.88 |
| 0.20% | 10m | 5% | −6.2% | −0.7% | −0.4% | 28.0% | +3.9% | −4.6pt | −14.0% | 0.63 |

**`SELECT-only`** = take *the same confirmed cohort* but at the **original signal price**. It is not
implementable (you cannot know at fire time who will confirm) — it exists to decompose the result.
And it decomposes it completely:

> **The continuation confirmation is a genuinely powerful selector — the fires it picks would have
> earned +8% to +13% per fire from the signal price, against a −6.2% baseline. But the price you pay
> to observe the confirmation costs −8 to −15 points, which consumes the entire selection alpha.
> Net: +0.5% to +1.8% vs a random skip, day-block p = 0.21 to 0.98, Bonferroni-adjusted across the
> 49 cells in this study = 1.000.**

The information is real and it is *exactly* priced into the option. You cannot buy the confirmation
and keep the alpha. Walk-forward: 5/9 cells positive OOS (coin-flip: 4.5); best-in-TRAIN
(C=0.05%, W=10m) → OOS vsRandom +1.1%, **day-block p = 0.679**.

Controls:
- **Pure time-delay** (enter unconditionally at fire+W, no confirmation): −2.3 / +0.4 / +0.3 / −3.1 / +2.1 pt at W = 5/10/20/30/45m. Non-monotone noise. No free lunch from just waiting.
- **Hybrid** (calm fires at signal, exhausted fires must confirm): vsRandom +1.3% at best, boot-pctile 88.6%, and it decays with C. Nothing.

## 6. Symmetry and fat tails

**Direction split.** Calls n=399 (base −3.6%), puts n=636 (base −7.8%). The EXH gate's vs-random is
negative in 4/5 sizes for calls and 3/5 for puts, with no consistent sign. Not symmetric, not real.

**Fat-tail check** (top-decile winners vs bottom-decile losers, in standardized units):

| feature | winners | losers | std-separation |
|---|---|---|---|
| **king_share** | 0.215 | 0.154 | **+0.64** |
| **wall_rs** (opposing pika ahead) | 0.130 | 0.086 | **+0.51** |
| wall_dist | 0.0027 | 0.0038 | −0.40 |
| king_dist | +0.0001 | −0.0010 | +0.32 |
| imp_age | 31.0 min | 26.1 min | +0.23 |
| barney | 0.140 | 0.167 | −0.21 |
| *(all velocity / extension features)* | — | — | **|sep| ≤ 0.19** |

The only two features that separate the tails at all are **king_share** and **wall_rs** — and both say
the **opposite** of the exhaustion premise: **the big winners fire with a BIGGER opposing wall ahead
and a BIGGER king, closer**. Not a smaller one. Consistent with `ENTRY_PIKA_GATE`'s inversion. But
the relation is tail-only, not monotone (wall_rs rank-corr = −0.007), so it is not gateable — which is
exactly why the pika gate failed.

**Haircut.** Identical conclusions at 2%/side (baseline −4.3%/fire; 11/22 positive OOS; TRAIN's pick
`fuel2` → OOS +1.0%, p=0.728). Nothing here is a fill artifact.

---

## What this narrows

Three things are now established, and they should stop future search from re-treading:

1. **"Exhaustion" is not measurable from extension or velocity.** Every proxy for "price has spent
   itself" (day-range position, distance from VWAP/MA, share of typical daily range used, 5/15/30m
   returns, deceleration, impulse age) is uncorrelated with what the trade goes on to do
   (|rank-corr| ≤ 0.069). The −31.7% median drawdown is real, but it is **unconditional** — it happens
   to the winners too. It is not a property of a *subset* of fires that we can identify in advance.

2. **The wall-vs-escalator interaction is not a signal-time quantity.** `z(wall_rs) × z(accel)` — the
   explicit construction of "momentum through the node" — has rank-corr +0.030 and a non-monotone
   decile table. Whether price *pushes through* the pika is determined **after** the fire, not before it.
   The pika gate's closing insight was correct as a *description* and useless as a *predictor*.

3. **The continuation confirmation is real information that is exactly priced.** This is the sharpest
   result: a filter that identifies +8 to +13%/fire cohorts out of a −6.2% baseline, whose entire
   value is consumed by the 8–15 points you pay to see it. Any future rule of the form "wait for X to
   confirm, then buy" must clear this bar, and the bar is that **the option market has already paid
   itself for X**.

Corollary for the doctrine: **`barney` ahead has the strongest raw signal in the whole feature set
(rank-corr −0.067, Q1 +0.7% → Q5 −12.4%) and its sign is the OPPOSITE of the escalator thesis** —
more negative-gamma mass in the path ahead is associated with *worse* outcomes, not better. It does
not survive OOS (day-block p=0.375), so it is not tradeable, but it is a live contradiction of a
doctrine belief and worth flagging.

---

## DECISIONS NEEDED

Nothing to ship. No live-code change is proposed or warranted.

1. **Abandon the entry-timing line.** Four hypotheses (pullback, static pika gate, exhaustion score,
   continuation confirmation) have now died on the same fire set with the same control. The evidence
   is not "we haven't found it yet" — it is that the **only** informative signal-time quantity found in
   1,035 fires (the continuation confirmation) is exactly priced. Recommend the program stop
   searching for a *better entry* and accept the fire as given.

2. **The real lever is the exit, and it is already the productive one.** The baseline is −6.2%/fire at
   PF 0.84 under trail-to-EOD; the verified scale-out ladder and the gate×STOP-30 work have been the
   only things to move it. Recommend redirecting to exit/position-sizing.

3. **Optional, cheap:** the `barney`-ahead sign contradiction (§6 corollary) deserves one confirmatory
   look against the Skylit doctrine before it is either dismissed or written into `KNOWLEDGE_BASE.md`
   as a caveat.
