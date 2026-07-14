# Minimum Contract Price Filter — Hostile Validation

**Date:** 2026-07-14
**Status:** RESEARCH ONLY (Clause 0). No live code touched. Recommendations in DECISIONS NEEDED.
**Verdict:** **KILLED as stated.** The min-price filter does not replicate, the proposed
mechanism is false, and the "price effect" is a **measurement artifact of a strike-ladder
pooling bug** plus a **ticker proxy**. One real, mechanically-sound variable survives —
**moneyness** — but it is *not* the system's live problem, because the system already
buys ATM. See DECISIONS NEEDED.

---

## Pre-registration (fixed before looking)

- **H1:** realized P&L is monotonically increasing in entry price; a min-price threshold
  improves system expectancy/PF.
- **H0:** artifact of the small live sample, and/or a proxy for moneyness / time-of-day /
  DTE / ticker / IV — does not replicate.
- **Pass bar:** hold on BOTH walk-forward halves of the replay set, survive a realistic
  fill haircut, and clear a multiple-comparisons discount over the thresholds tested.

**Result: H1 fails every leg of the pass bar. H0 is accepted.**

---

## 0. The headline: the finding is an artifact of pooling a strike ladder

This is the single most important result in the study, and it invalidates the input data
of the original finding.

`tracked_plays` does **not** contain 72 independent trades. It contains **71 fire events →
175 rows**, because the tracker logs a **candidate strike ladder** per fire — typically 4
rows: the ATM strike, then progressively further-OTM strikes on the *same signal, same
second, same ticker, same direction*.

One real QQQ fire (2026-07-08, `fire_ts_ms=1783517456311`), all four rows:

| rung | strike | spot | moneyness | entry mark |
|---|---|---|---|---|
| 0 | 706 | 706.13 | 0.02% | **$3.715** |
| 1 | 701 | 706.13 | 0.73% | $1.985 |
| 2 | 696 | 706.13 | 1.43% | $1.010 |
| 3 | 681 | 706.13 | **3.56%** | **$0.135** |

Within a fire, **a cheaper contract is *always* the further-OTM one.** Entry price and
moneyness are therefore not "correlated" — they are the *same variable*, by construction.

**Provenance check.** Bucketing the pooled 175 ladder rows by entry price reproduces the
reported finding almost exactly:

| bucket | reported PF | pooled-ladder PF (this study) | n | exp | **avg \|moneyness\|** |
|---|---|---|---|---|---|
| <$1 | 0.25 | 0.09 | 70 | −42.6% | **1.48%** |
| $1–3 | 0.13 | 0.18 | 39 | −36.8% | 0.15% |
| $3–10 | **1.54** | **1.53** | 35 | +15.4% | 0.12% |
| >$10 | 1.49 | 1.31 | 31 | +10.6% | 0.07% |

The $3–10 bucket matches to within 0.01 PF. **The finding was computed on the pooled strike
ladder, not on 72 distinct trades.** Note the last column: average moneyness climbs
monotonically as price falls. The "price effect" *is* the moneyness effect, mislabelled.

**Two further consequences:**

1. **The sample is not n=72 independent observations.** Each fire contributes up to 4
   highly-correlated rows. The effective sample size is ~71 fire events, and the
   within-fire rows are near-perfectly dependent.
2. **~22% of the rows are untradeable.** 38 of 175 rows have entry < $0.10 (avg **$0.023**),
   with a recorded **65% relative bid/ask spread** and `close_mark` quantized to $0.01.
   Their "returns" are tick-rounding artifacts (entry $0.015 → close $0.01 = "−33%";
   entry $0.035 → $0.01 = "−71%"). You cannot trade a 1.5-cent option. These rows
   manufacture a large share of the <$1 bucket's terrible PF.

### On the actually-traded contracts, monotonicity already fails

De-duping to the contract the system actually enters (nearest-ATM per fire, n=71):

| bucket | n | exp | PF | ticker composition |
|---|---|---|---|---|
| <$1 | 12 | **−19.4%** | 0.49 | SPY 9, QQQ 3 |
| $1–3 | 29 | **−42.5%** | 0.15 | SPY 13, QQQ 16 |
| $3–10 | 14 | −7.8% | 0.71 | SPXW 9, QQQ 5 |
| >$10 | 16 | +15.0% | 1.51 | **SPXW 16 (100%)** |

The claimed monotone ordering **breaks at the first step**: <$1 (−19.4%) is *better* than
$1–3 (−42.5%). (It breaks in the reported numbers too — PF 0.25 > 0.13.) The pattern is not
"monotone in price." It is a **two-regime split: SPY/QQQ bad, SPXW okay.**

Look at the ticker column. **The price buckets *are* ticker buckets.** >$10 is 100% SPXW;
<$1 and $1–3 are 100% SPY/QQQ. There is almost no within-ticker price variation from which
a price effect could even be identified. "Buy contracts over $10" and "buy SPXW" are the
same instruction on this data.

### And the surviving edge is 2 fires on one day

The >=$3 filter on the actually-traded set: n=30, exp +4.3%, PF 1.15 (already far short of
the claimed ~1.5). Per-day decomposition of its total +131pp:

| day | n | exp | sum of returns |
|---|---|---|---|
| 2026-07-08 | 19 | −6.7% | **−127pp** |
| **2026-07-09** | **2** | **+65.8%** | **+132pp** |
| 2026-07-10 | 1 | +31.5% | +32pp |
| 2026-07-13 | 6 | +9.7% | +58pp |
| 2026-07-14 | 2 | +17.8% | +36pp |

**Two QQQ fires on 2026-07-09 contribute +132pp of the +131pp total.** Leave-one-day-out
confirms: drop 2026-07-09 and the filter's expectancy collapses to **−0.1%, PF 1.00**.
The entire live "edge" of the min-price filter rests on two fires.

Separately, the live sample is dominated by a single day: **2026-07-08 is 36 of 71 fires
(51%)** at −34% expectancy. The live set is 5 trading days. It cannot support this finding.

---

## 1. Bucket reproduction on the replay set (1,295 fires / 61 days)

Same buckets, not re-tuned. Real per-minute UW option marks. Entry = close of first candle
≥ fire+60s. Four exit policies; **STRUCT** = the engine's own structure exit (the faithful
system proxy, reconstructed from each replay fire's recorded `exitTsMs`).

**STRUCT (system proxy):**

| bucket | n | win% | exp | PF |
|---|---|---|---|---|
| <$1 | 291 | 39% | **+4.2%** | **1.17** |
| $1–3 | 491 | 41% | +0.5% | 1.02 |
| $3–10 | 272 | 32% | **−11.0%** | **0.68** |
| >$10 | 241 | 42% | −3.1% | 0.89 |
| ALL | 1295 | 39% | −1.7% | 0.94 |

**The effect does not merely fail to replicate — it inverts.** On the replay set the *cheap*
buckets are the profitable ones and $3–10 is the worst. Under STOP30 the inversion repeats
(<$1 PF 1.17, $3–10 PF 0.77). Only under HOLD_EOD is there a weak >$10 tilt (PF 1.12), and
it does not survive the MC discount (below).

---

## 2. Threshold sweep, walk-forward, multiple-comparisons

Thresholds $1 / $2 / $3 / $5 / $10. Walk-forward halves: H1 = 2026-04-10..05-21 (n=660),
H2 = 2026-05-22..07-08 (n=635).

**STRUCT** — every threshold *reduces* expectancy, and none passes walk-forward:

| min price | volume kept | n | exp | PF | Δexp | H1 exp | H2 exp | WF pass |
|---|---|---|---|---|---|---|---|---|
| ≥$1 | 78% | 1004 | −3.5% | 0.88 | −1.7% | −3.1% | −3.8% | no |
| ≥$2 | 49% | 638 | −4.9% | 0.84 | −3.2% | −2.2% | −7.2% | no |
| **≥$3** | **40%** | 513 | **−7.3%** | **0.77** | **−5.5%** | −4.2% | −10.0% | **no** |
| ≥$5 | 33% | 423 | −7.7% | 0.75 | −6.0% | −7.1% | −8.2% | no |
| ≥$10 | 19% | 241 | −3.1% | 0.89 | −1.4% | −5.3% | −1.4% | no |

The proposed **≥$3 filter discards 60% of volume and makes the system worse** (PF 0.94 → 0.77).

Under HOLD_EOD, two thresholds pass walk-forward on sign (≥$2, ≥$10) — but the
multiple-comparisons discount kills them:

**Permutation test** (shuffle the entry-price label against returns, B=2000, family-wise
over all 5 thresholds; reports P(max Δ under null ≥ max Δ observed)):

| policy | best Δexp | **FWER p** |
|---|---|---|
| STRUCT | −1.4% | 0.957 |
| HOLD_EOD | +6.8% | **0.275** |
| STOP30 | −1.1% | 0.918 |
| LADDER | −0.6% | 0.896 |

**Nothing is significant.** The best case across all policies and thresholds is p = 0.27.

---

## 3. Confound controls — what is entry price actually made of?

Spearman correlations of entry price on the replay set:

| vs | ρ |
|---|---|
| **is-SPXW** | **0.729** |
| minutes-to-close | 0.384 |
| \|moneyness\| | −0.352 |
| IV at entry | 0.139 |

Entry price is, first and foremost, **a ticker label**. SPXW avg entry $11.93; SPY $1.30;
QQQ $1.80. An SPX option is ~10× the notional of an SPY option — of course it costs more.

### (a) Ticker — the effect reverses out-of-sample

On the **live** set SPXW is the good ticker (exp +0.8%) and SPY/QQQ are terrible (−27%, −32%).
On the **replay** set (1,295 fires, 61 days):

| ticker | n | exp | PF |
|---|---|---|---|
| SPXW | 468 | **−4.6%** | **0.86** |
| SPY | 409 | +1.5% | 1.06 |
| QQQ | 418 | −1.7% | 0.94 |

**SPXW is the *worst* ticker on the replay set.** The live ticker effect is sign-flipped
out-of-sample. Confirmed on the tape-gate test below, where `ticker=SPXW` swings from
H1 **+13.0%** to H2 **−10.2%** — a textbook overfit signature.

### (b) Time-of-day — the live afternoon collapse does not replicate

Live shows a severe afternoon: 13:00 −44.5%, 14:00 −33.5%, 15:00 −31.6%. On replay, hourly
expectancy (HOLD_EOD) is **11:00 +3.3%, 13:00 −6.6%, 14:00 +0.4%, 15:00 +10.3%** — the
*last* hour is the *best*. Cutoff sweep (no new fires after H):

| cutoff | kept | STRUCT Δexp | H1Δ | H2Δ | WF |
|---|---|---|---|---|---|
| before 12:00 | 48% | +0.0% | −0.3% | +0.3% | no |
| before 13:00 | 59% | −0.2% | −1.0% | +0.6% | no |
| before 14:00 | 71% | −0.9% | −1.7% | −0.1% | no |

**MC-discounted: STRUCT FWER p = 0.780, HOLD_EOD p = 0.948.** An earlier cutoff is a
complete null. The existing 15:15 ET cutoff should stay as-is; there is no case for
tightening it.

### (c) Moneyness — *the replay set structurally cannot see it*

**`scripts/replay-fires.js:9` — "Fire → ONE ATM strike (new ATM-only rule)"; `:95`
`atmStrike()` rounds spot to the nearest strike.** The replay set is **ATM-only by
construction**: max |moneyness| across all 1,339 fires is **0.076%**.

This is a significant finding in its own right, independent of this study:

> **The replay validation harness does not reproduce the live system's strike selection.**
> Replay always buys ATM. The live engine targets a structural node and, on SPY/QQQ, lands
> up to **3.56% OTM**. Every study in the 77-study program that used the replay set has been
> validating an ATM system that is not quite the system in production.

So moneyness had to be **manufactured**. See §5.

### (d) The hardest control: does price sort *within* ticker × moneyness cells?

Splitting each (ticker × moneyness) cell at its own median entry price and measuring
Δexp (expensive − cheap):

| cell | n | Δ (expensive − cheap) |
|---|---|---|
| SPXW ATM <2bp | 288 | +10.1% |
| SPXW 2–5bp | 180 | −9.9% |
| SPY ATM <2bp | 129 | −12.5% |
| SPY 2–5bp | 174 | +11.8% |
| SPY 5–10bp | 106 | −16.7% |
| QQQ ATM <2bp | 110 | +5.9% |
| QQQ 2–5bp | 192 | +0.4% |
| QQQ 5–10bp | 116 | −18.0% |

**4 of 8 cells positive. n-weighted mean Δ = −1.2%. Sign test p = 0.64.**

Once ticker and moneyness are held fixed, **entry price carries no information at all.**
It is a coin flip. This is the decisive control, and price fails it.

---

## 4. Friction — the proposed mechanism is false as stated

The claim: *"a $0.64 option with a $0.03 spread = ~5–10% round-trip friction vs ~1% on a
$15 contract."* The live DB records `entry_bid`/`entry_ask`, so this is directly testable.

**Split cheap contracts by moneyness, and ATM contracts by price:**

| cell | n | avg entry | **relative spread** |
|---|---|---|---|
| cheap (<$1) **& ATM** (<0.2%) | 14 | $0.71 | **2.2%** |
| cheap (<$1) **& OTM** (≥0.2%) | 42 | $0.16 | **26.2%** |
| ATM & cheap (<$1) | 14 | $0.71 | 2.2% |
| ATM & mid ($1–3) | 31 | $1.68 | **1.0%** |
| ATM & pricey (≥$3) | 58 | $10.78 | **1.4%** |

**Relative spread tracks moneyness, not price.** A cheap *ATM* contract is cheap to trade
(2.2%) — it does **not** pay 5–10%. Relative spread is essentially **flat in price** across
the ATM column (2.2% / 1.0% / 1.4%). The 20%+ friction the hypothesis attributes to
"cheapness" appears **only far-OTM** (26.2%).

**The mechanism as stated is falsified. Reframed onto moneyness, it is correct and large.**

And note the magnitudes: friction on the actually-traded contracts is ~1–2% of premium,
against a $1–3 bucket expectancy of **−42.5%**. Friction explains **essentially none** of
the underperformance of the real trades. That is directional failure, not slippage.

---

## 5. The real variable: MONEYNESS (a clean causal experiment, n=1,295)

Because the replay set is ATM-only, moneyness had to be **manufactured**. For every one of
the 1,295 replay fires I pulled the option marks for **the same fire at +0.5% / +1.0% /
+2.0% OTM** (2,898 additional contracts, real per-minute UW marks). Same signal, same
second, same ticker, same direction — **the only thing that varies is the strike.**

This is a properly paired causal design, and it is 18× the live sample.

**Marginal (STRUCT exit):**

| leg | n | win% | exp | PF | median ret | avg entry | rel spread |
|---|---|---|---|---|---|---|---|
| **ATM** | 1295 | **39%** | **−1.7%** | **0.94** | −16.3% | $5.30 | **2.4%** |
| +0.5% OTM | 1276 | 26% | −8.0% | 0.78 | −33.3% | $1.48 | 9.2% |
| +1.0% OTM | 1260 | 21% | −9.7% | 0.70 | −28.6% | $0.56 | 15.9% |
| +2.0% OTM | 1154 | 15% | −7.6% | 0.70 | −16.7% | $0.15 | 26.2% |

**Paired Δ vs the ATM leg of the same fire (STRUCT):**

| pair | n | mean Δ | median Δ | ATM wins | sign-test p |
|---|---|---|---|---|---|
| +0.5% vs ATM | 1276 | **−6.3%** | −6.6% | **841/1276 (66%)** | ~1e−30 |
| +1.0% vs ATM | 1260 | **−7.1%** | −6.7% | 749/1260 (59%) | ~1e−8 |
| +2.0% vs ATM | 1154 | **−5.1%** | −0.6% | 583/1154 (51%) | 0.42 |

**Walk-forward:** ATM beats OTM in **both halves at all three offsets** (STRUCT).
**Per-ticker:** the paired Δ is **negative for all three tickers at all three offsets** —
SPXW −6.8/−8.8/−5.6%, SPY −3.6/−5.0/−1.2%, QQQ −8.2/−7.4/−8.3%. Fully consistent.

**Net of friction the ATM advantage grows sharply**, because relative spread explodes with
distance from the money (2.4% → 9.2% → 15.9% → 26.2%):

| pair | gross Δ | **net of modeled round-trip spread** |
|---|---|---|
| +0.5% vs ATM | −6.0% | **−13.0%** |
| +1.0% vs ATM | −8.0% | **−21.8%** |
| +2.0% vs ATM | −6.6% | **−30.8%** |

**Moneyness is the one real, causal, mechanically-explicable variable in this study.**
Buying OTM instead of ATM on the same 0DTE signal costs 6–8pp gross and 13–31pp net.
This *is* the mechanism the original hypothesis was reaching for — it was simply attached
to the wrong variable (price instead of moneyness).

---

## 6. …but the system already fixed this, 6 days ago

`src/tracker/plays.js:16–27`:

> ```
> // ATM-only ladder. Prior versions fired 3-4 strikes per event covering out to
> // ±25 points, but the deep OTM legs die worthless (see 2026-07-08 EOD:
> // BEAR_RUG puts at -25 offset averaged −57% at close). Every fire is now a
> // single ATM contract — the strike Skylit's deflection doctrine actually
> // prices at the direct tap of the anchor.
> const CANDIDATE_STRIKES_BY_STATE = {
>   BEAR_RUG:       { type: 'put',  offsets: [0] },
>   ... all states: offsets: [0]
> };
> ```

Every state fires `offsets: [0]` — **one ATM contract**. And the multi-rung ladder rows in
the DB are confined to exactly one day:

| day | fire events | rungs/event | max \|moneyness\| |
|---|---|---|---|
| **2026-07-08** | 37 | **{3: 5, 4: 32}** | **3.56%** |
| 2026-07-09 | 5 | {1: 5} | 0.05% |
| 2026-07-10 | 11 | {1: 11} | 0.04% |
| 2026-07-13 | 14 | {1: 14} | 0.07% |
| 2026-07-14 | 5 | {1: 5} | 0.03% |

**The entire strike ladder — and every OTM contract in the live database — is 2026-07-08,
a deprecated code path.** From 2026-07-09 onward the system fires exactly one ATM contract
per fire, max 0.07% from spot.

This resolves the premise of the task. The claim that *"the strike selector targets a
structural node, so on SPY/QQQ it lands ~1% (up to 3.5%) OTM"* is **true only of
2026-07-08 data**. It is not true of the current system. The `offsets: [0]` fix was shipped
on 07-09 — **for exactly the reason this study independently confirms** ("the deep OTM legs
die worthless").

On 2026-07-08 itself, the removed legs were indeed the poison:

| 2026-07-08 slice | n | win% | exp | PF |
|---|---|---|---|---|
| pooled ladder (as the finding sampled it) | 140 | 18% | −24.6% | 0.46 |
| ATM legs only (kept) | 67 | 25% | −18.3% | 0.61 |
| **OTM legs (≥0.2%, now REMOVED)** | 73 | **11%** | **−30.3%** | **0.30** |

**So the "min contract price filter" is a rediscovery, through a pooling artifact, of a bug
that was already fixed.** Filtering out cheap contracts on the 07-08 pooled data removes
the deep-OTM ladder legs — which the code no longer generates.

---

## 7. Does the filter help the *current* (ATM-only) system?

The post-fix live set: 35 ATM fires, 4 days (2026-07-09..07-14). exp −3.2%, PF 0.86.

| cut | n | win% | exp | PF | ticker composition |
|---|---|---|---|---|---|
| all | 35 | 54% | −3.2% | 0.86 | — |
| **entry ≥ $3** | **11** | 73% | **+23.4%** | **3.11** | **SPXW 9, QQQ 2** |
| entry < $3 | 24 | 46% | −15.4% | 0.45 | SPY 11, QQQ 13 |

This looks spectacular — and it is the strongest-looking number in the entire study. It is
also, once again, **the SPXW cut** (9 of 11), on **11 fires over 4 days**.

Set it against the replay evidence, which is the same instrument, the same engine, real
marks, **513 fires over 61 days**:

- replay, entry ≥ $3 → **PF 0.77** (vs 0.94 unfiltered) — the filter *hurts*
- replay, SPXW → **PF 0.86, the worst of the three tickers**
- replay, SPXW over the tape gate → **H1 +13.0% / H2 −10.2%** (sign flip between halves)

**11 observations say buy SPXW. 513 observations say the opposite.** The post-fix live
number is a small-sample echo of the same ticker confound, not independent confirmation.

---

## 8. Incremental value over the bull tape gate

Reconstruction of `bull-tape-gate.js` on the replay set (SPY+QQQ vs prior close; SPY stands
in for the SPX leg). The gate blocks 169 of 1,283 fires and is, as in every prior study,
the only thing that works: STRUCT expectancy −1.8% → **−0.1%**, PF 0.94 → **1.00**.

Adding each candidate **on top of the gate** (STRUCT):

| candidate | n | exp | PF | Δ vs gate | H1Δ / H2Δ | WF |
|---|---|---|---|---|---|---|
| price ≥ $3 | 428 | −6.3% | 0.80 | **−6.2%** | −1.9% / −10.2% | no |
| price ≥ $5 | 344 | −7.1% | 0.77 | −7.0% | −5.3% / −8.6% | no |
| before 13:00 ET | 657 | −1.9% | 0.93 | −1.8% | −1.9% / −1.7% | no |
| before 14:00 ET | 788 | −2.4% | 0.91 | −2.3% | −2.4% / −2.2% | no |
| ticker = SPXW | 382 | −3.7% | 0.89 | −3.6% | **+1.6% / −8.5%** | no |
| ticker ≠ SPXW | 732 | +1.7% | 1.07 | +1.9% | −0.8% / +4.7% | no |

**Nothing beats the gate. Every candidate fails walk-forward; the price filter actively
harms it (−6.2pp).** This is the 78th consecutive rule to be absorbed by the tape gate.

---

## VERDICT

**The minimum-contract-price filter is dead.** It fails every leg of the pre-registered
pass bar:

| pass-bar criterion | result |
|---|---|
| replicate on the replay set | **No — it inverts** (cheap buckets are the profitable ones under STRUCT) |
| hold on both walk-forward halves | **No** — 0 of 5 thresholds pass under the system-proxy exit |
| survive a realistic fill haircut | **No** — friction is ~1–2% and flat in price on tradeable contracts |
| clear the multiple-comparisons discount | **No** — best FWER p = 0.27 across all policies |
| beat the bull tape gate | **No** — actively harms it (−6.2pp) |

**What it actually was**, in order of contribution:

1. **A strike-ladder pooling artifact.** The source table holds 71 fire *events* as 175
   *rows* (up to 4 candidate strikes per fire). Within a fire, cheaper ≡ further-OTM. The
   "price effect" is the moneyness effect, mislabelled — and it reproduces the reported PFs
   to within 0.01. All ladder rows are from **2026-07-08, a deprecated code path**.
2. **A ticker proxy.** On the real traded contracts, >$10 is **100% SPXW** and <$3 is
   **100% SPY/QQQ** (ρ(price, is-SPXW) = 0.73). "Min price $3" ≈ "trade SPX." And SPXW is
   the **worst** ticker on 61 days of replay, with a sign flip across walk-forward halves.
3. **Two fires.** The live ≥$3 edge is carried by **2 QQQ fires on 2026-07-09** (+132pp of
   a +131pp total); leave-that-day-out → exp −0.1%, PF 1.00.
4. **Tick-quantization noise.** 22% of the source rows are sub-$0.10 contracts (avg $0.023,
   65% relative spread) whose "returns" are $0.01 rounding artifacts.

**The proposed mechanism is falsified as stated.** Cheap contracts do *not* pay 5–10%
round-trip friction. A cheap **ATM** contract pays **2.2%**; a cheap **OTM** contract pays
**26.2%**. Relative spread is flat in price (2.2% / 1.0% / 1.4% across the ATM column) and
steep in moneyness. Friction is a **moneyness** phenomenon. And on the traded contracts it
is ~1–2% against a −42.5% bucket expectancy — friction explains **essentially none** of the
underperformance. That is directional failure.

**The real variable is MONEYNESS**, and it is causally established: on 1,295 paired fires,
buying +0.5%/+1.0% OTM instead of ATM on the *identical signal* costs **6–8pp gross,
13–22pp net of spread**, consistent in both walk-forward halves and across all three
tickers. This is real, large, and mechanically obvious (OTM 0DTE = no intrinsic value,
pure theta, and a 10–26% spread).

**But it is not actionable, because the system already does the right thing.** It has fired
`offsets: [0]` — one ATM contract — since 2026-07-09. The moneyness finding is a
*confirmation of a shipped fix*, not a new edge. Its remaining value is as a **guardrail**.

**Neither the afternoon cutoff nor the ticker filter survives either.** The live afternoon
collapse (13:00 −44.5%) does not replicate — on replay, **15:00 is the best hour**
(+10.3%), and the cutoff sweep is a clean null (FWER p = 0.78 / 0.95). Keep 15:15 ET.

The honest summary of the live system's problem: **it is not buying the wrong contracts.
It is 35 ATM fires over 4 days at PF 0.86, which is a sample too small to diagnose, sitting
on a replay set that says the engine's edge is ~zero before the tape gate and ~breakeven
after it.**

---

## DECISIONS NEEDED

1. **Do NOT ship a minimum contract price filter.** It is an artifact. On the replay set it
   discards 60% of volume and moves PF 0.94 → 0.77.
2. **Do NOT tighten the intraday cutoff.** The 15:15 ET cutoff should stay. An earlier
   cutoff is a null (FWER p = 0.78).
3. **Do NOT add a ticker filter (SPXW-only).** It is the same variable as the price filter
   and it sign-flips across walk-forward halves.
4. **Consider a moneyness *guardrail* (proposal, not an edge).** The ATM-only selector is
   correct and is validated causally by this study. Recommend an assertion in
   `plays.js` that refuses any strike more than ~0.3% from spot, so the deep-OTM ladder
   cannot regress back in. This changes no behaviour today; it locks in a fix that is worth
   6–8pp gross / 13–22pp net per fire.
5. **Fix the analysis substrate (highest-value item).** `tracked_plays` mixes 2026-07-08's
   4-rung ladder with post-fix single-ATM rows. **Any query that does not de-duplicate by
   `(fire_ts_ms, ticker)` will silently over-weight 2026-07-08 by 4× and manufacture
   spurious price/moneyness gradients.** This is what produced the finding under review, and
   it will produce more. Recommend either a `is_entered` / `rung` column, or a materialized
   view exposing one row per fire event.
6. **Flag for the 77-study program:** `scripts/replay-fires.js` uses `atmStrike()` and is
   **ATM-only by construction** (max moneyness 0.076%). The replay harness therefore cannot
   observe moneyness at all. That is fine *now* (the live system is also ATM-only), but the
   two must be kept in lockstep — if strike selection ever changes live, every replay-based
   study silently stops matching production.

---

## Reproduction

| script | purpose |
|---|---|
| `research/exit-study/min_price_filter.mjs` | bucket reproduction, threshold sweep, WF, MC, confound controls, friction |
| `research/exit-study/live_horserace.mjs` | live-set horse race (price vs moneyness vs ToD vs ticker), real bid/ask |
| `research/exit-study/ladder_rung_test.mjs` | provenance: pooled-ladder reproduction + within-fire rung pairing |
| `research/exit-study/tod_and_gate.mjs` | time-of-day cutoff sweep + incremental over the bull tape gate |
| `research/exit-study/pull_otm_ladder.mjs` | pulls the +0.5/+1.0/+2.0% OTM legs (2,898 contracts) |
| `research/exit-study/analyze_otm.mjs` | the paired moneyness experiment |

All research-only. No live code modified (Clause 0).
