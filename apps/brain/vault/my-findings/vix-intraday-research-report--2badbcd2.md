---
title: VIX Intraday Research Report
source_url: repo://apps/gex/research/vix/out/VIX_RESEARCH_REPORT.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:35:07Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- vix
- volatility
summary: '**Isolated research module — no trading-logic changes. See README for'
url_sha1: 2badbcd22ec2995ef3cfd8f2836943f59f439ac9
simhash: '2675784118274962174'
status: vault
ingested_by: seed
---

# VIX Intraday Research Report
**Isolated research module — no trading-logic changes. See README for reversal.**

Data: 64 trading days (2026-04-10 → 2026-07-08), 5-min Skylit frames (VIX native symbol), 5,056 aligned observations, 1,339 replayed fires joined, 34 real option plays (7/08).

## Q1 — VIX changes vs forward index returns
Strongest 12 of 90 feature×ticker×horizon correlations (Spearman):

| feature      | ticker   | horizon   |   spearman |   pearson |    n |
|:-------------|:---------|:----------|-----------:|----------:|-----:|
| vix_chg_open | QQQ      | eod       |      0.193 |     0.101 | 5056 |
| VIX          | QQQ      | eod       |      0.169 |     0.207 | 5056 |
| vix_z        | QQQ      | eod       |      0.169 |     0.207 | 5056 |
| VIX          | SPXW     | eod       |      0.159 |     0.190 | 5056 |
| vix_z        | SPXW     | eod       |      0.159 |     0.190 | 5056 |
| vix_z        | SPY      | eod       |      0.147 |     0.175 | 5056 |
| VIX          | SPY      | eod       |      0.147 |     0.175 | 5056 |
| vix_chg_open | SPY      | eod       |      0.112 |     0.062 | 5056 |
| vix_chg_open | SPXW     | eod       |      0.102 |     0.048 | 5056 |
| vix_roc_1h   | SPXW     | 1h        |     -0.079 |    -0.060 | 3520 |
| vix_roc_1h   | SPY      | 1h        |     -0.078 |    -0.059 | 3520 |
| vix_roc_1h   | QQQ      | 1h        |     -0.064 |    -0.077 | 3520 |

![corr](corr_heatmap.png)

## Q2/Q3 — rising vs falling VIX: continuation and follow-through
Forward returns conditioned on 15m VIX direction:

| ticker   | horizon   | bucket                    |    n |   mean_fwd_bps |   pct_up |
|:---------|:----------|:--------------------------|-----:|---------------:|---------:|
| SPY      | 30m       | VIX rising (roc15>+0.05)  | 1244 |          -0.18 |    50.24 |
| SPY      | 30m       | VIX falling (roc15<-0.05) | 1541 |           0.02 |    52.95 |
| SPY      | 30m       | VIX flat                  | 1695 |           0.86 |    50.38 |
| QQQ      | 30m       | VIX rising (roc15>+0.05)  | 1244 |           0.39 |    53.22 |
| QQQ      | 30m       | VIX falling (roc15<-0.05) | 1541 |           0.30 |    54.32 |
| QQQ      | 30m       | VIX flat                  | 1695 |           1.20 |    49.56 |
| SPXW     | 30m       | VIX rising (roc15>+0.05)  | 1244 |          -0.17 |    50.40 |
| SPXW     | 30m       | VIX falling (roc15<-0.05) | 1541 |          -0.05 |    53.15 |
| SPXW     | 30m       | VIX flat                  | 1695 |           0.83 |    50.62 |

## Q4/Q5 — is premium rich when VIX is high? (implied vs realized)
| vix_q   |   n |   vix_mean |   rv_rest_mean |   abs_fwd1h_spy |   vrp |
|:--------|----:|-----------:|---------------:|----------------:|------:|
| Q1 low  | 925 |      15.95 |           5.42 |           12.06 | 10.53 |
| Q2      | 945 |      16.86 |           6.55 |           13.36 | 10.32 |
| Q3      | 939 |      17.68 |           7.24 |           16.17 | 10.43 |
| Q4      | 927 |      18.48 |           8.01 |           17.59 | 10.48 |
| Q5 high | 936 |      19.74 |          11.50 |           23.04 |  8.23 |

![vrp](vrp_by_vix_quintile.png)

## Q6 — VIX move during the hold vs option P&L
- Replayed fires (option-EV proxy): corr(VIX change during hold, EV) — BULL -0.483, BEAR +0.517
- Real 7/08 option marks: corr(VIX change during hold, P&L%) — CALL -0.849, PUT +0.677

## Q7 — fire quality by VIX regime
By VIX 15m direction at fire:
| side   | vix_dir   |   n |   optEV |   win |
|:-------|:----------|----:|--------:|------:|
| BEAR   | falling   | 255 |    0.08 | 46.27 |
| BEAR   | flat      | 346 |    0.00 | 39.31 |
| BEAR   | rising    | 231 |    0.00 | 42.42 |
| BULL   | falling   | 171 |    0.08 | 49.71 |
| BULL   | flat      | 225 |    0.31 | 57.78 |
| BULL   | rising    | 111 |    0.10 | 54.05 |

By VIX level tercile at fire:
| side   | vix_lvl   |   n |   optEV |   win |
|:-------|:----------|----:|--------:|------:|
| BEAR   | low       | 276 |    0.04 | 45.29 |
| BEAR   | mid       | 269 |   -0.10 | 35.69 |
| BEAR   | high      | 287 |    0.13 | 45.64 |
| BULL   | low       | 171 |    0.18 | 50.29 |
| BULL   | mid       | 179 |    0.18 | 54.75 |
| BULL   | high      | 157 |    0.20 | 57.96 |

![tq](trade_quality_vix.png)

---

# Synthesis — what the data actually says

## Findings, ranked by strength

**1. VIX change during the hold is the strongest signal found (Q6) — but it's exit-side, and partly a direction confound.**
Real 7/08 option marks: calls corr −0.85 with hold-period VIX change; puts +0.68. The 1,339-play proxy agrees (−0.48 / +0.52). Mechanically sensible: rising VIX = falling tape + vega tailwind for puts. Because VIX and index direction are ~anti-correlated, this is NOT a clean vega effect — but it does mean a VIX spike against a live call is a legitimate "get out faster" tell. Candidate use: **exit accelerator**, not entry filter.

**2. The volatility risk premium is enormous intraday and least-bad when VIX is high (Q4/Q5).**
At every quintile, VIX (~16-20) dwarfs subsequent same-day realized vol (5-11). Caveat: comparing 30-day implied to intraday-only realized overstates VRP mechanically (overnight variance excluded) — the informative part is the SLOPE: in the top VIX quintile realized vol jumps to 11.5 (vs 5.4 in Q1), average |1h move| nearly doubles (23bps vs 12bps), and relative premium compresses (VRP 8.2 vs 10.5). Answering the study questions directly: **yes, low-VIX options are "cheaper" but deliver far smaller moves; high-VIX options carry proportionally the fairest pricing and the biggest realized moves.** For a long-premium 0DTE system, high-VIX conditions are structurally friendlier than low-VIX — the opposite of the intuitive "don't buy when vol is high."

**3. Fire quality by VIX regime (Q7): weak but consistent tilts, no filter-grade splits.**
- BULL fires improve monotonically with VIX level: win 50% → 55% → 58% (low→high terciles). Consistent with finding 2.
- BULL fires in *flat* 15m VIX: +0.31 EV vs ~+0.09 elsewhere — reverse-rugs may prefer quiet vol tape.
- BEAR fires: no clean pattern (mid-VIX is oddly worst). Nothing here approaches the size of the splits that justified the G7-PC gate (bears above prior close: −1% vs +9% EV).

**4. Intraday VIX direction barely predicts index direction (Q1/Q2/Q3).**
Best correlations are ~0.19 (VIX-level vs EOD return — a mean-reversion artifact of a bull window), and rising-vs-falling 15m VIX changes 30m forward win probability by only ~2-3pp. **VIX RoC is not a directional entry signal** at these horizons.

## Candidate features for the model (ranked)

| Rank | Feature | Proposed role | Evidence |
|---|---|---|---|
| 1 | VIX change since entry | exit accelerator (calls: exit faster into VIX spike) | −0.85 real / −0.48 proxy |
| 2 | VIX level tercile | position-size tilt (upsize bulls in high VIX) | bull win 50→58%, VRP slope |
| 3 | VIX 15m RoC ≈ flat | mild bull-entry confidence boost | +0.31 vs +0.09 EV |
| 4 | VIX RoC direction | NOT recommended as entry filter | \|ρ\| ≤ 0.08 |

## Recommendation

Per the module's charter, nothing ships as a rule from this study. Next steps in order:
1. **Log VIX features on live fires** (level, roc15, chg-from-open into `supporting_state`) — pure observation, one additive field, builds the live sample.
2. Prototype feature #1 (exit accelerator) in the replay harness and hold it to the option-EV bar that killed the flip-flop cooldown.
3. Re-test feature #2 as a sizing multiplier (not a filter) once ≥2 weeks of live gated trades exist.

## Reproducibility

`uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/vix/vix_study.py`
Machine-readable outputs: correlations.csv, vix_direction_continuation.csv, vrp.csv, trade_quality_by_vix_*.csv alongside this report.

---

# Phase 2 — decision tests (same evening): VERDICT = EXCLUDE

Both surviving candidates were prototyped against the 64-day final-system replay (G7-PC + dedupe, option-EV proxy) and REJECTED:

**Exit accelerator** (exit when VIX moves against the play ≥ THR since entry):
| Config | optEV/play |
|---|---|
| baseline (structural exits only) | **+20.6%** |
| + VIX exit ≥0.2 | +14.0% |
| + VIX exit ≥0.3 | +15.7% |
| + VIX exit ≥0.5 | +18.1% |
| + VIX exit ≥0.8 | +19.9% |

Monotone: every threshold loses EV; looser only converges back to baseline. It cuts winners short — the full-surface structural exits already capture the information a VIX spike carries, earlier and cleaner.

**Sizing tilt** (upsize bull entries by VIX tercile): every tested weighting (0.5/1/1.5, 0.75/1/1.25, 0.5/0.75/1.5) lowered both EV-per-unit-risk and total EV vs flat sizing. The tercile win% gradient (50→58%) does not survive as an EV gradient.

**Final answer to the study objective: VIX does not earn a place in the trading logic** — not as entry filter, exit input, or sizing multiplier. Retained value is contextual only (high-VIX regimes are structurally friendlier for long premium; VIX RoC is noise at intraday horizons). Module stays for reproducibility; delete to revert.
