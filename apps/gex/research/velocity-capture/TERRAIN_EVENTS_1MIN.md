# Terrain Entry System — Event Layer at 1-Minute Resolution

**RESEARCH ONLY (Clause 0). No live-code changes. Findings → DECISIONS NEEDED.**
Snapshot: 2026-07-14 PM. 8 trading days of 1-min Skylit surfaces (backfill still filling; re-run to extend).
Everything here is pre-registered (§1, frozen before outcomes) and mirror-controlled. Magnitudes are
descriptive; day-block bootstrap and Bonferroni discount are applied to every primary claim.

**One-line verdict:** The event layer is built and works. **Nothing survives the mirror** — real dealer-gamma
node bands do **not** beat distance-matched phantom bands on forward drift, at 1-min just as the 5-min study
found. Bounce-vs-break **is** predictable ex-ante (walk-forward test AUC **0.69**, driven by approach velocity:
fast→break), but that prediction **does not monetize**: the outcome it predicts carries no forward-drift edge over
a phantom level, and ATM 0DTE option P&L under the live trail is negative and no better than random entry.
The conservation law holds again. **No rule is proposed for ghost testing.**

---

## 0. Data & inputs

| Input | Path | Shape |
|---|---|---|
| 1-min surfaces | `research/velocity-capture/backfill/<date>/{SPXW,SPY,QQQ}.jsonl.gz` | 391 frames/day (09:30–16:00 ET), ~200 strikes/frame `{strike,gamma,vanna}` |
| Option P&L | UW `option-contract/{occ}/intraday?date=` (Bearer + UA), cached `pipeline/prices_v0/` | ATM 1-min OHLC, live trail arm .50 / gb .15, 3% round-trip haircut |
| Engine | `pipeline/terrain_events.py` (reuses `pnl_v0.py` for fetch/trail/bootstrap) | emits `terrain_events.jsonl` + `pipeline/terrain_results.json` |

**Days used (per (day,ticker), ≥380 frames required):** 2026-07-02, -06, -07, -08, -09, -10, -13, -14 →
**22 series** (8 SPXW · 7 SPY · 7 QQQ). 07-02 has SPXW+SPY only; 07-06 QQQ was incomplete (dropped).
`pika` = +gamma (dampening; doctrine says bounces are *real*). `barney` = −gamma (accelerating; doctrine says
bands *shouldn't* bounce). VWAP position uses a session running-mean-of-spot proxy (volume-agnostic, uniform
across all three tickers because SPX index candles are unavailable via the stock OHLC endpoint — see §7 limits).

---

## 1. Pre-registration (frozen before any outcome was computed)

1. **Strong node** = strike with `relSig = |gamma|/Σ|gamma| ≥ 0.10` sustained **≥5 consecutive minutes** (kills flicker).
   Node **arms** at the 5th minute; strength = mean relSig over the arming window; **sign** = sign of mean gamma over it.
   Each strike arms at most once/day; node active from arm→EOD. **Band = strike ± 0.05% of spot** (per-minute).
2. **BOUNCE** = spot enters a band from one side, dwells ≤ **K=5** min, exits the **same** side, penetrating **≤40%** of the
   half-width past the strike. Implied trade = **away** from band (floor→call, ceiling→put).
3. **BREAK** = spot enters and exits the **far** side within K=5 min. Implied trade = **continuation** (through the band).
   `approach velocity` = 5-min spot return into the band; hypothesis fast→break, slow/decel→bounce.
4. **MIRROR CONTROL (mandatory):** for every real node, a **phantom band** at `K_ph = 2·S_arm − K` (reflect strike across
   spot at the node's arm minute — a *fixed*, no-node level, distance-matched at arm). On-price pins (`|K−S_arm| <` half-width)
   get no phantom and are excluded from mirror-gated claims. Identical event detection on the phantom. *(A per-minute
   reflection `2·spot_t−K` is mathematically degenerate — it contains spot exactly when the real band does — so the mirror
   must be a fixed level; arm-spot is the frozen choice.)*
5. **Outcomes:** signed forward underlying drift at **15 / 30 / 60 min** after the resolution minute (signed by implied
   direction) + **ATM option P&L** via the live trail. Splits: node sign, strength tercile, ticker, approach-velocity tercile.
   Walk-forward halves by day. **Day-block bootstrap** (resample whole days — this is the correct unit given within-day
   event correlation from overlapping/oscillating bands).
6. **Primary family (m=5), Bonferroni α\* = 0.05/5 = 0.01:**
   P1 bounce-pika drift@30 real>0 **and** real>phantom · P2 break-barney real>0 **and** real>phantom ·
   P3 break-pika real>phantom · P4 bounce-barney real>phantom (doctrine expects null) · P5 bounce-vs-break test-AUC>0.5 (CI excl. 0.5).
   Secondary splits (ticker/strength/velocity terciles, 15 & 60-min horizons) are exploratory, not gating.

---

## 2. Event counts — real vs phantom (mirror), per day/ticker

| day | ticker | R-bounce | R-break | R-other | Ph-bounce | Ph-break | Ph-other |
|---|---|---|---|---|---|---|---|
| 2026-07-02 | SPXW | 9 | 8 | 4 | 18 | 8 | 4 |
| 2026-07-02 | SPY | 14 | 6 | 7 | 17 | 11 | 8 |
| 2026-07-06 | QQQ | 36 | 7 | 13 | 32 | 14 | 22 |
| 2026-07-06 | SPXW | 29 | 1 | 15 | 6 | 1 | 8 |
| 2026-07-06 | SPY | 20 | 2 | 12 | 8 | 2 | 4 |
| 2026-07-07 | QQQ | 6 | 3 | 8 | 5 | 2 | 3 |
| 2026-07-07 | SPXW | 23 | 3 | 9 | 16 | 1 | 3 |
| 2026-07-07 | SPY | 10 | 1 | 12 | 26 | 3 | 24 |
| 2026-07-08 | QQQ | 19 | 12 | 13 | 13 | 6 | 8 |
| 2026-07-08 | SPXW | 10 | 3 | 9 | 16 | 2 | 6 |
| 2026-07-08 | SPY | 21 | 10 | 10 | 15 | 2 | 5 |
| 2026-07-09 | QQQ | 8 | 2 | 9 | 19 | 5 | 6 |
| 2026-07-09 | SPXW | 12 | 2 | 3 | 1 | 1 | 3 |
| 2026-07-09 | SPY | 12 | 4 | 11 | 9 | 5 | 5 |
| 2026-07-10 | QQQ | 21 | 7 | 5 | 16 | 0 | 9 |
| 2026-07-10 | SPXW | 20 | 4 | 6 | 11 | 0 | 5 |
| 2026-07-10 | SPY | 15 | 4 | 17 | 33 | 6 | 8 |
| 2026-07-13 | QQQ | 34 | 17 | 6 | 26 | 7 | 6 |
| 2026-07-13 | SPXW | 22 | 5 | 5 | 16 | 0 | 4 |
| 2026-07-13 | SPY | 29 | 3 | 19 | 19 | 7 | 13 |
| 2026-07-14 | QQQ | 39 | 15 | 9 | 7 | 5 | 9 |
| 2026-07-14 | SPXW | 14 | 2 | 14 | 14 | 0 | 5 |
| 2026-07-14 | SPY | 20 | 1 | 8 | 0 | 0 | 0 |
| **TOTAL** | **22 series** | **443** | **122** | **224** | **343** | **88** | **168** |

**Reads.** (a) **Bounces dominate** (443 vs 122 breaks; base rate break ≈ 21%) — a slow index mostly pauses/rejects at
*any* level. (b) Real bands generate **~32% more interactions** than phantoms (789 vs 599 events) — gamma nodes do
*attract* price traffic. Whether the *reaction* there is special is §3. (c) `other` (224) = dwelled >5 min inside, or
same-side exit with >40% penetration (failed deep probe) — neither a clean bounce nor break.

---

## 3. PRIMARY — signed forward drift, real vs phantom (kind × sign)

Signed so **positive = price moved in the implied-trade direction** (bounce→away, break→continuation).
`bp` = basis points of underlying. Day-block bootstrap 90% CI; `p2` = two-sided bootstrap p for (real − phantom).

| cell | REAL drift@30 (n, %pos) | REAL boot 90% CI | PHANTOM drift@30 (n) | real−phantom | p2 | Bonferroni-α\*=0.01? |
|---|---|---|---|---|---|---|
| **bounce-pika** | **+1.4 bp** (282, 55%) | [−0.4, +3.2] p⁺=89% | −0.6 bp (206) | +1.9 bp | 0.135 | ✗ |
| **bounce-barney** | −2.0 bp (121, 40%) | [−4.6, +0.2] p⁺=7% | +2.8 bp (88) | −5.1 bp | 0.070 | ✗ |
| **break-pika** | −3.8 bp (85, 47%) | [−7.4, +1.0] p⁺=9% | −0.7 bp (50) | −2.9 bp | 0.363 | ✗ |
| **break-barney** | −2.5 bp (26, 46%) | [−7.4, +1.5] p⁺=15% | +3.2 bp (23) | −5.7 bp | **0.011** | ✗ (and wrong sign) |

Horizon consistency (real, mean drift): bounce-pika +1.1/+1.4/+1.1 bp @15/30/60; bounce-barney −2.4/−2.0/−0.4;
break-pika −2.0/−3.8/−3.9; break-barney +1.6/−2.5/−0.1.

**Verdict on the mirror (the whole ballgame): FAIL.**
- **No cell beats its phantom in the hypothesized direction at α\*=0.01, or even at an uncorrected 0.05.** The only
  significant real−phantom difference is **break-barney (p2=0.011)** — and it's the **wrong sign** (real *underperforms*
  the empty level). This **replicates the 5-min "King-as-level" kill at 1-min resolution**: reactions are ubiquitous on a
  slow index, and a distance-matched no-node level reacts as much as the real node.
- **Directionally**, the doctrine's *shape* is faintly visible but never significant: pika bounces alone drift the "right"
  way (+1.4 bp, 55% pos, p⁺=89% of bootstrap draws positive) and are the only cell that even beats its phantom; **barney
  bounces fail** (−2.0 bp, 40% pos — price that pauses at a −γ node does *not* hold, consistent with "barney shouldn't
  bounce"); **pika breaks reverse** (−3.8 bp — breaking a +γ dampening node gets pulled back). But at ~1–4 bp these are
  economically negligible and inside the noise.

Secondary splits reinforce the null: **every** ticker (SPXW −0.7, SPY +0.3, QQQ −0.9 bp), **every** strength tercile
(−0.2 / −1.4 / +0.0 bp lo/mid/hi), and **every** velocity tercile (+1.3 / −1.9 / −0.9 bp) sit within ±2 bp of zero at
~50% pos. Walk-forward halves: train −1.4 bp (46% pos) vs test +0.3 bp (52% pos) — indistinguishable from zero both halves.

---

## 4. Approach velocity → break-rate (the one robust structural fact)

Approach-speed terciles (`|5-min spot return|` into the band): slow ≤0.027%, mid 0.027–0.072%, fast >0.072%.

| tercile | n | break-rate |
|---|---|---|
| slow | 189 | 14% |
| mid | 188 | 13% |
| **fast** | 188 | **37%** |

**Clean and monotone-at-the-top: a fast approach nearly triples the break-rate (37% vs ~13%).** This confirms the
pre-registered mechanism (fast→break, slow→bounce). It is the study's one durable descriptive finding — and it feeds §5.

---

## 5. PAYOFF QUESTION — can bounce-vs-break be called at the band, ex-ante?

Pre-registered logistic: target break=1 / bounce=0; features known **at the entry minute** = `[approach_speed,
band_strength, sign(pika=1), vwap_pos]`; standardized; **walk-forward** (train = 07-02…07-08, test = 07-09…07-14).

| metric | value |
|---|---|
| n train / test | 253 / 312 |
| base-rate(break) train / test | 0.22 / 0.21 |
| **test AUC** | **0.687**, day-bootstrap 90% CI **[0.630, 0.761]** → **excludes 0.5** |
| train AUC | 0.636 |
| test accuracy @0.5 / majority baseline | 0.78 / 0.79 |
| weights (std.) | approach_speed **+0.276**, sign_pika +0.160, vwap_pos −0.125, strength +0.036, bias −1.29 |

**P5 PASSES: bounce-vs-break is genuinely predictable at the moment price reaches the band**, and it survives a
walk-forward split (test AUC 0.69, CI excludes 0.5). The signal is **almost entirely approach velocity** (weight +0.28,
dwarfing the rest); band strength is inert (+0.04). Accuracy≈majority is expected under a 79/21 skew — AUC is the honest
metric here, and it's real.

---

## 6. Option P&L — does the classification monetize? (ATM 0DTE, live trail, 3% haircut)

Entry at the **resolution minute** close (call if implied-up, put if implied-down), ATM strike, live trail arm .50 / gb .15.
Random control = the **same contracts**, random entry minutes (09:35–15:30), 20 draws each.

| cohort | n | mean net | median net | hit | day-block 90% CI | P(mean>0) |
|---|---|---|---|---|---|---|
| **BOUNCE real** | 443 | **−11%** | +19% | 56% | [−23%, +1%] | 6% |
| bounce random | 8,860 | −16% | +2% | 50% | — | — |
| **BREAK real** | 122 | **−17%** | +18% | 55% | [−26%, −6%] | 1% |
| break random | 2,440 | −13% | +4% | 51% | — | — |

**FAIL.** Both cohorts have **positive medians (+18–19%) but negative means** — the classic 0DTE-ATM signature: the
trailing stop + theta produce a heavy left tail that the typical winner can't outweigh. Bounce real (−11%) edges its
random control (−16%) and hits 56% vs 50%, but the bootstrap says P(mean>0)=6% — not a positive-expectancy system.
**Break real (−17%) is *worse* than its random control (−13%)** and the CI is entirely negative. Buying the momentum
continuation at a fresh break, under this trail, bleeds.

---

## 7. Synthesis, limitations, and DECISIONS NEEDED

**What we learned.**
1. **The mirror kills it again.** At 1-min, real dealer-gamma node bands provide **no forward-drift edge over a
   distance-matched phantom** in any kind×sign cell (§3). Nodes *attract* ~32% more price interaction (§2), but the
   *reaction* is not more predictive than empty space. This is the 5-min "King-as-level" result, replicated.
2. **Bounce-vs-break is forecastable** ex-ante from approach velocity (fast→break, break-rate 37% vs 13%; walk-forward
   test AUC 0.69, CI excludes 0.5). This is a real classifier (§4–5).
3. **…but the forecast is not monetizable.** The thing it predicts (bounce vs break) has **no forward-drift edge over the
   mirror**, and ATM 0DTE P&L under the live trail is negative for both classes and no better than random entry (§6).
   So "predictable discrimination **+ direction** = entry system" **fails at the second step**: the direction has no edge.

**Plainly:** you *can* tell whether price will bounce or break at a strong node — approach speed is the tell — but knowing
which one it is buys you nothing, because both outcomes drift like a coin flip relative to a phantom level, and the
option structure bleeds. **The conservation law holds.**

**Limitations (honest).** (a) 8 days / effectively 8 day-blocks → wide CIs; a real ~1–2 bp bounce-pika effect can't be
resolved at this n, but 1–2 bp is not tradeable regardless. (b) VWAP feature is a running-mean-of-spot proxy (no volume;
SPX index candles unavailable) — a true volume-VWAP is a cheap upgrade for SPY/QQQ but wouldn't change the mirror verdict.
(c) Nodes held active arm→EOD with sign fixed at arm; re-arming with a flipped sign is treated as the same node. (d) Overlapping
adjacent-strike bands produce correlated events — handled by day-block bootstrap, not by dedup.

**DECISIONS NEEDED (no live-code change is proposed):**
- **No rule qualifies for ghost testing.** Nothing survived mirror + walk-forward + Bonferroni with positive expectancy.
- **Do NOT** build a standalone bounce-fade or break-momentum entry from this — the predictable target has no edge.
- **Candidate for a *future* study (not now):** the fast-approach→break classifier (AUC 0.69) is real and could serve as a
  **context filter** layered on the *already-validated* bull-tape gate — e.g., "suppress a bounce-fade when approach is
  fast" — rather than as a trigger. That is a conditional-interaction study, and it must clear its own mirror.

---

## 8. Reproduce

```
cd apps/gex/research/velocity-capture/pipeline
python3 terrain_events.py          # rebuilds events, outcomes, mirror, logistic, option P&L
# -> ../terrain_events.jsonl        (789 real events: {day,ticker,minute,strike,sign,kind,strength,approach_vel,...})
# -> terrain_results.json           (all numbers behind this report)
```
Re-run as the backfill fills (up to ~35 days) to tighten the CIs; the pre-registration (§1) is frozen — do not retune it.
`terrain_events.jsonl` carries every real event for the terrain viewer to plot (entry+resolution minute, strike, sign,
kind, strength, approach velocity, implied direction, drift30).
```
```
