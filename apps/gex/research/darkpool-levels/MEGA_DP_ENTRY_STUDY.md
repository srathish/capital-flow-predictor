# MEGA Dark-Pool Levels — Mirror Re-Test + Entry-Timing Study

**Program:** Bellwether 0DTE / GEX-VEX structure program
**Scope:** SPXW (SPX index) 0-DTE, 1-minute backfill. **RESEARCH ONLY (Clause 0 — no live-code changes.)**
**Sample:** 20 backfill days, **2026-06-16 → 2026-07-15** (every backfill day where SPX ranged near a mega level).
**Levels:** the verified persistent mega SPY dark-pool prints in `mega_levels.json`, mapped to SPX.
**Author:** research subagent · **Date:** 2026-07-15

> **Why re-test.** The prior study (`DARKPOOL_LEVELS_STUDY.md`) clustered only the **2026-06-29→07-15**
> prints and so **missed the four pre-6/29 mega prints Skylit actually tracks** — including the **$8.7B 6/16
> print at SPX 7526.3**, the level behind the operator's 7/15 V-bounce. This re-test uses the correct persistent
> mega levels and asks two questions:
> **(1) MIRROR** — do MEGA levels reverse price more than an equidistant phantom (no print)?
> **(2) ENTRY-TIMING** (operator's real interest) — when price approaches a mega level and it **holds**, is
> entering **AT** the level a better-timed, higher-win entry than the current **confirmation-chase** (wait for
> 2 candles to reclaim)? And — honestly — is the **unconditional** "enter every approach" rule tradeable?

---

## TL;DR — VERDICT

1. **MIRROR: MEGA levels FAIL, even the $8.7B one.** Hold-rate is **identical** at real, phantom, and random
   levels (~0.68 — it is a property of a 0.05% touch, not of the print). Directional drift is **negative** at real
   levels (−1.6 bps) and **below** the phantom (+0.1 bps) and random (+6.6 bps). Bootstrap real−mirror reversal
   diff **−0.078, CI90 (−0.167, +0.021)**. No notional tier bounces (mega-mega −2.2 bps). **Mega dark-pool levels
   are magnets, not signed triggers** — confirming and *strengthening* the prior null on the corrected levels.

2. **ENTRY-TIMING (conditional): entering AT a level that holds beats the confirmation-chase — decisively.**
   On holds: level-entry **eq 0.71 vs 0.43**, **MAE 4.8 vs 7.9 bps**, **win 0.61 vs 0.43**, **expectancy +36.6% vs
   +5.5%/trade** (modeled). Paired day-block bootstrap of the edge: **+31.2%/trade, CI90 (+18.3, +46.6)** — real.
   The confirmation-chase demonstrably buys *after* the bounce (worse fill, more theta).

3. **…but it is NOT a dark-pool edge, and NOT tradeable standalone.** Two killers:
   - The **same** level-vs-chase edge appears — **stronger** — at **phantom** levels (eq 0.72 vs 0.46, win 0.70 vs
     0.47, exp +51.9% vs +24.0%). So it is a **generic touch-execution effect** ("enter at the touch extreme, don't
     chase the reclaim"), not a property of mega dark-pool levels.
   - You can only enter "a level that holds" if you **know** it will hold — you don't. The **unconditional** rule
     (enter every approach, structural stop on break) is **+1.5%/trade** but **breaks cost −52.7%**, its bootstrap
     is **CI90 (−9.2, +15.7) straddling zero**, it is **indistinguishable from random-timing (+0.8%)**, and it
     **flips sign out-of-sample** (H1 +28.8% → H2 −13.6%). Not tradeable.

**Bottom line:** even **$8.7B** levels are magnets, not defended signed levels. The operator's entry-timing
instinct is correct as an **execution rule** — enter at the touch, don't chase the confirmation — but that rule is
generic to reversals anywhere and does **not** make "price hit a mega dark-pool level" a tradeable entry signal.
The missing piece is an independent **hold-vs-break predictor**; the level itself provides none (its hold-rate
equals a phantom's).

---

## 1. Pre-registration (design frozen before any outcome was computed)

Data-prep before outcomes: (a) per-day SPX/SPY ratio from real daily OHLC; (b) IV = SPX `volatility_30` per day;
(c) an option-tape feasibility probe. None looked at touch/reversal outcomes.

**Levels.** The 12 rows of `mega_levels.json`. The two coincident 07-01/07-02 prints at SPY 745.55/745.58
(0.004% apart) are one level → **merged** to SPX 7481.5 (notional summed). Net **11 levels**. A level is **active on
day d if its date ≤ d** (persists forward; task definition). *Robustness:* look-ahead-safe variant uses date < d.

**Notional tiers.** **mega-mega > $4B** (7399.6/$4.1B, 7504.4/$5.2B, 7526.3/$8.7B), **mega $1.3–4B**
(7407.5, 7447.5, 7481.5, 7536.8, 7543.3, 7573.3), **sub < $1.3B** (7495.1/$1.0B, 7515.7/$0.97B).

**Mapping SPY→SPX.** *Primary:* the **fixed SPX prices in `mega_levels.json` (ratio 10.035)** — how Skylit draws
the persistent line. *Sensitivity:* per-day empirical ratio = median(OHLC SPX)/median(OHLC SPY). **The ratio drifts
10.008 (6/16) → 10.036 (7/15)** from SPY dividend accrual (see §7) — a real confound the prior study flagged; both
mappings are run.

**Approach.** Band **±0.05%** of the level. An approach fires when 1-min spot enters the band while "armed"; then
disarms until spot moves **>0.10%** away and re-arms (dedupes lingering touches). Approach side = sign of the last
clearly-outside spot within 15 min: from **above → support** test (implied **up**, buy call); from **below →
resistance** test (implied **down**, buy put).

**HOLD vs BREAK.** **BREAK** = within the next 30 min, 2 consecutive samples close **>0.10% beyond** the level on
the far side. Else **HOLD**.

**Forward drift.** `fwd30 = (spot₊₃₀ − spot₀)/spot₀`. **Bounce-drift** = `+fwd` for support, `−fwd` for resistance
(**positive = level defended**). **Reversal rate** = P(bounce-drift₃₀ > 0).

**Mirror (headline control).** For every real level active on day d, a **phantom P = 2·open_d − L** (reflected
across the day open; equidistant, no print). **Random** control: L·(1 ± U(0.3%, 0.8%)), rejecting placements within
0.15% of any real level. Identical touch/hold/drift pipeline on all three.

**Entry-timing (Test B).**
- **Level-entry:** buy ATM 0DTE at the **approach minute** (support→call, resistance→put).
- **Confirmation-entry:** wait for **2 consecutive minutes reclaiming** the band (support→spot>level+band;
  resistance→spot<level−band); enter at that minute.
- **eq** (entry quality, 0–1, model-free): fraction of the event window's favorable range captured — 1 = entered at
  the favorable extreme (the low for a call), 0 = at the adverse extreme. **MAE** = max adverse excursion after
  entry (model-free). **P&L** = modeled (below).
- **Conditional** = holds only. **Unconditional** = **every** approach (holds and breaks) with a structural stop —
  *the tradeable rule*. Exits (both arms, identical): +0.25% favorable spot target, structural stop (2 consec min
  >0.10% beyond against the trade), 30-min time stop, or EOD.

**Option P&L — MODELED, and stated as such.** Real intraday 0DTE prints *are* retrievable via `get_option_trades`
(unlike the prior study's finding — verified for 7/14), but the tape is **too sparse** to quote an exact ATM strike
at an arbitrary entry/exit minute (narrow ATM windows return empty under the size/premium floors). So all arms are
priced with **one identical Black-Scholes ATM-0DTE engine** on the **real 1-min spot path**: IV = day `volatility_30`,
time-to-expiry to 16:00 ET, **entry at modeled ask / exit at modeled bid** with an **index-point-floored** half-spread
`max(0.20 pt, 0.5%·premium)` (calibrated to the ~0.4-pt ATM NBBO seen in real 7/13–7/14 prints; **not** a flat 3%).
BS-on-vol30 **under**prices same-day 0DTE (0DTE ATM IV runs above the 30-day), so **absolute** P&L magnitudes are
inflated in percent terms; the **cross-arm ranking is robust** because every arm uses the same pricer. Model-free
**eq / MAE / directional-drift** corroborate every P&L ranking.

**Controls.** Mirror (mandatory), random-timing (30-seed avg), random-level, notional tiers, support/resistance,
walk-forward halves, 2000× day-block bootstrap, per-day-ratio sensitivity, look-ahead-safe. **n = 20 days / 11
levels → read everything as a LEAN.**

---

## 2. Sanity — the motivating fact reproduces (L7526, fixed 7526.3)

| Day | SPX low | low − 7526.3 | minutes below level |
|:--|--:|--:|--:|
| **2026-07-15** | 7528.5 | **+2.2** | **0** (held as floor → V-recovery) |
| **2026-07-14** | 7515.3 | **−11.0** | 6 (traded through) |

Same level, opposite outcome — the bounce-vs-break problem the study exists to generalize. The rest of §3–§6 shows
7/15 was **not** representative: across all approaches the level neither holds nor bounces more than a phantom.

---

## 3. Test 1 — THE MIRROR (real vs phantom vs random), fixed ratio (primary)

| Level set | touches (all / full-H) | **HOLD-rate** | **reversal rate** | **bounce-drift₃₀** |
|:--|--:|--:|--:|--:|
| **Real MEGA** | 197 / 180 | **0.680** | **0.456** | **−1.64 bps** |
| **Mirror phantom** (2·open − L) | 118 / 108 | 0.678 | 0.537 | +0.09 bps |
| **Random level** (±0.3–0.8%) | 63 / 59 | 0.778 | 0.678 | +6.61 bps |

**Day-block bootstrap (2000×), real − mirror:** reversal diff **mean −0.078, CI90 (−0.167, +0.021)**;
bounce-drift diff **mean −1.50 bps, CI90 (−5.46, +2.84)**. Both **straddle zero, leaning against real.**

**Read — decisive.**
1. **HOLD-rate does not discriminate.** ~0.68 at real, phantom, *and* random. "The level held 68% of touches" is a
   property of a 0.05% touch under 30-min mean reversion — a **phantom holds just as often.** Hold-rate is **not** a
   dark-pool signal.
2. **Direction goes the wrong way.** Real reversal 0.456 (**below 0.5**) and bounce-drift **negative**; the phantom is
   ~0 and the random level is *positive*. A touched real mega level is slightly **more** likely to be passed through
   than a phantom. GEX nodes failed the mirror; **mega dark-pool levels fail it too.**

### By notional tier (real) — bigger ≠ bouncier
| Tier | touches / full | HOLD | reversal | bounce-drift₃₀ |
|:--|--:|--:|--:|--:|
| **mega-mega > $4B** (incl. $8.7B) | 78 / 74 | 0.628 | 0.486 | **−2.18 bps** |
| mega $1.3–4B | 96 / 86 | 0.719 | 0.442 | −0.57 bps |
| sub < $1.3B | 23 / 20 | 0.696 | 0.400 | −4.22 bps |

The **$4–8.7B** tier has the *most negative* drift. There is **no** "the whale defends its size" gradient.

### By side (real) — no rejection edge either
| Role | touches / full | HOLD | reversal | bounce-drift₃₀ |
|:--|--:|--:|--:|--:|
| support (from above) | 97 / 88 | 0.619 | 0.432 | **−5.31 bps** |
| resistance (from below) | 100 / 92 | 0.740 | 0.478 | +1.88 bps |

**Mega+ support vs its own mirror:** real **−5.49 bps** vs mirror **+3.72 bps** — real supports do *worse* than their
phantoms. The prior study's lone glimmer ("mega-support dip-bounce, +2.6 bps over mirror") **does not replicate on
the corrected levels; it inverts.** Resistances hold a bit more but drift is ~flat, not a tradeable rejection.

---

## 4. Test 2 — Entry-timing: level-entry vs confirmation-chase

### 4a. Conditional (holds only) — the operator's hypothesis, isolated
| Arm (paired holds, n=114) | eq | MAE | win | expectancy/trade (modeled) |
|:--|--:|--:|--:|--:|
| **Level-entry** (buy at the touch) | **0.706** | **4.8 bps** | **0.605** | **+36.6%** |
| **Confirmation-entry** (2-candle reclaim) | 0.425 | 7.9 bps | 0.430 | +5.5% |

Paired day-block bootstrap of the difference: **+31.2%/trade, CI90 (+18.3, +46.6)** — does not straddle zero.
Model-free **eq (0.71 vs 0.43)** and **MAE (4.8 vs 7.9 bps)** confirm it without any option model. **When a level
holds and you were going to take the trade, entering AT the level is a materially better-timed entry than chasing the
confirmation** — the chase buys after the bounce has started and pays extra theta. (Mega-mega+mega only: level +32.8%
vs confirm +10.9%; same direction.)

### 4b. The edge is generic execution, NOT a dark-pool property
Repeating 4a on **phantom** holds (fake levels, no print):
| Arm (phantom holds, n=70) | eq | MAE | win | expectancy/trade |
|:--|--:|--:|--:|--:|
| Level-entry | 0.724 | 4.8 bps | 0.700 | **+51.9%** |
| Confirmation-entry | 0.461 | 7.9 bps | 0.471 | +24.0% |

The level-vs-chase gap is **just as large — larger — at phantom levels.** So "enter at the touch, don't chase the
reclaim" is a **general property of touch-reversals**, not something mega dark-pool levels confer. The DP level is
**not a privileged place** to apply the execution rule.

### 4c. Unconditional — the only actually-tradeable rule (you don't know holds in advance)
| Arm (every approach, structural stop) | n | eq | MAE | win | expectancy/trade |
|:--|--:|--:|--:|--:|--:|
| **Level-all** | 197 | 0.479 | 12.4 bps | 0.381 | **+1.5%** |
| Confirmation-all | 136 | 0.368 | 12.5 bps | 0.382 | −3.9% |
| Random-timing (30-seed avg) | ≈197 | — | — | 0.357 | +0.8% (range −9 … +14) |
| — Level-all, **HOLD** subset | 134 | — | — | 0.545 | **+27.0%** |
| — Level-all, **BREAK** subset | 63 | — | — | **0.032** | **−52.7%** |

**Read.** Unconditional level-entry (+1.5%) edges the confirmation-chase (−3.9%) but is **indistinguishable from
random-timing (+0.8%)**. Its fate is entirely the **hold/break mix**: holds pay +27%, **breaks lose −52.7%** (win 3%).
Because the level cannot tell you hold-vs-break (its hold-rate = a phantom's, §3), the −52.7% breaks swamp the timing
edge. **Unconditional bootstrap expectancy: +1.74%, CI90 (−9.15, +15.67) — straddles zero.**

Tiers (unconditional): mega-mega +10.6% (win 0.41), mega +1.7%, sub −30.5%. Sides: support/call +0.9%, resistance/put
+2.0%. Nothing survives the bootstrap.

---

## 5. Walk-forward halves (fixed) — the unconditional rule flips sign

| Half | real reversal | mirror reversal | **uncond expectancy** | uncond win |
|:--|--:|--:|--:|--:|
| **H1** 06-16 → 06-30 | 0.562 | 0.464 | **+28.8%** | 0.457 |
| **H2** 07-01 → 07-15 | 0.397 | 0.562 | **−13.6%** | 0.339 |

All of the unconditional "edge" is **H1** (June: choppy, mean-reverting, the mega-mega 7526/7504 levels fresh). In
**H2** (July bull trend) it **loses** — and the mirror *out-reverses* the real level (0.562 vs 0.397). No
out-of-sample stability. This is the single clearest reason the unconditional rule is not tradeable.

---

## 6. Controls & robustness

**Per-day-ratio sensitivity (the ratio drift, §7).** Real reversal 0.437 / drift −2.28 bps vs mirror 0.537 / +3.46
bps vs random 0.531 / +2.91 bps — **same null, if anything cleaner** (real loses to both controls). Mega+ support:
real −7.02 bps vs mirror +5.59 bps.

**Look-ahead-safe (prior-day levels only, first_seen < d).** Real 0.442 reversal / −2.09 bps vs mirror 0.538 /
+0.11 bps. Same picture — not a same-day-print-timing artifact.

**Random-timing** is a 30-seed average (single draws swing −9…+14%), so the "≈ random" comparison in §4c is on a
stable mean, not one lucky seed.

**Mirror gets fewer touches (118 vs 197)** — expected (real levels sit where price traded). All comparisons are
rate-conditional-on-touch, so this does not bias reversal rate; it does make phantom stats noisier (smaller n).

---

## 7. The SPX/SPY ratio drift (handled, not hidden)

Per-day median-OHLC ratios: **10.008 (6/16), 10.015 (6/17) … 10.036 (7/15)** — a steady climb from SPY dividend
accrual. The fixed 10.035 in `mega_levels.json` is right for mid-July but places mid-June levels **~0.24% (~18 SPX
pts) too high** — larger than the 0.05% approach band. This is exactly the confound that turned the prior study's
7/15 "V-bottom on the level" into a pass-through under the corrected ratio. **Both mappings are run (§3, §6) and the
null is the same under each**, so the mirror verdict is not a ratio artifact this time. (The 7/15 motivating fact
itself is clean: on 7/15 the true ratio *is* 10.035, so 7526.3 is correctly placed and price genuinely held above it —
it is simply **one day**, not the population.)

---

## 8. Honest verdict

**Q1 — Do MEGA levels mirror-beat phantoms?** **No.** Hold-rate is identical to phantom and random (~0.68, a touch
property). Directional drift at real levels is **negative** and **below** the phantom; the bootstrap difference
straddles/leans-against zero; no notional tier (incl. **$8.7B**) and neither side shows a defended bounce; robust to
ratio choice and look-ahead. **Even $8.7B levels are magnets, not signed triggers** — same category as GEX nodes.

**Q2 — Does entering AT a level beat the confirmation-chase?** **Yes, as an execution rule — but it is not a
dark-pool edge and not tradeable standalone.**
- Conditional on a hold, level-entry beats confirmation on eq, MAE, win, and expectancy (+31%/trade, CI excludes
  zero, model-free metrics agree). The confirmation-chase provably buys after the move.
- **But** the identical edge — bigger — appears at **phantom** levels: it is generic "enter at the touch extreme, do
  not chase the reclaim," not something the print confers.
- **And** you can't know holds in advance; the **unconditional** rule is break-even vs random-timing (+1.5% vs +0.8%,
  bootstrap CI (−9, +16)), pays **−52.7%** on breaks, and **flips negative out-of-sample**.

**What to do with this.**
- **Do not** use "price approached a mega dark-pool level" as a standalone 0DTE entry signal — it is a magnet, no
  better than a random equidistant level.
- **Do** keep the execution lesson: when an *independent* gate (the bull-tape gate / structural read that predicts a
  hold) puts you into a touch, **enter at the level, don't wait for the 2-candle reclaim** — better fill, ~half the
  MAE, materially higher win. Apply it wherever you're already deciding to enter; mega DP levels are not a special
  place for it.
- **The missing piece** is a hold-vs-break predictor. The level alone gives none (its hold-rate = a phantom's). Any
  future work must hold the tape gate fixed, keep the mirror as the bar, and test whether some *other* feature
  (tape, GEX flip, VEX) predicts hold — because that, not the print, is where a tradeable edge would live.

*Caveats: 20 days, single bull-drift-with-a-June-chop regime; option P&L modeled (BS-on-vol30, ranking-robust,
absolute % inflated); levels dominated by a few mega clusters; n small → all magnitudes are LEANS. Re-run on a
larger, regime-mixed sample before any decision.*

---

### Artifacts
- `mega_dp_events.jsonl` — 197 unconditional level-approach fills: `day, ticker, minute (UTC HH:MM),
  strike:spot@entry, kind:"mdp", implied:up|down, exit_minute, outcome:win|loss, pnl_pct`.
- Analysis: `mega_dp_study.py` (pure-python, deterministic controls; run `PYTHONHASHSEED=0 python3 mega_dp_study.py`),
  inputs `mega_levels.json` + `mega_dp_daily.json` (per-day OHLC/IV from UW `get_ticker_ohlc_latest_or_date`) +
  1-min SPXW backfill under `research/velocity-capture/backfill/<date>/`.
