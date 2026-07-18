# Backtest-driven improvement study — 2026-07-18

**Goal:** use backtest to find what could make the 0DTE plays system better.
**Substrate:** `research/uw/studies/outputs/repriced_fires.csv` — 1,322 fires (2026-04-10
→ 07-08), real repriced option marks. Baseline = G7 gate & nflags≤1 (310 fires).
**Metric:** expectancy = mean **%-return per fire** (capital-normalized). *Not win rate.*
**Method:** temporal out-of-sample split (train < 2026-06-02 < test). A candidate must
lift in **both** halves and be **fire-time-known** to count. Clause 0 — no live change.

## Data-integrity fix (was blocking)
`pnl_*` columns are **$/contract** = `(exit−entry)*100` (policy_simulator.py:214), NOT
%-return. Earlier "−680% on a $10 option" was $/contract misread as %. Correct
capital-normalized return = `pnl / entry` (bounded ≥ −100%). All results below use it.

## Baseline (corrected)
- v2 (cap+45): **train +2.5% / test −11.3%** per fire. Roughly break-even, tail-driven.
  Median ≫ mean — a few catastrophic fires dominate; the exit, not the entry, sets P&L.

## What did NOT improve it (honest nulls)
- **Regime/trend filters = LOOK-AHEAD.** `trend_day` (+10pt "lift") is built from the
  day's *full-session* return/range (policy_simulator.py:167-171) — unknowable at fire.
  The live proxy `big_open` (first-30-min range, known by 10am) is a **null**: sign flips
  across halves (train −18% / test −4%). Confirms SYNTHESIS's "regime-conditioning = look-ahead."
- **Entry filters on node distance = non-robust.** `d_flip_bps`/`d_wall_bps` show only a
  non-monotone middle-bucket bump (d_flip Q2 test +17% at n=23; Q1/Q3/Q4 negative). Noise.
- **flow_agree5, flow_extreme, vixd15, entry_iv, hr, prem_pct, drop-pin, drop-opex** — all
  train-only or flat on test. No entry-feature filter robustly beats the baseline gate.
  ⇒ Consistent with the standing finding: **the gate + nflags already absorb the entry edge.**

## ★ The one candidate improvement: the +45% cap is too tight for BEAR_RUG
Cap sweep on the **test** half (expectancy %-ret/fire), by state:

| cap | ALL (122) | BULL_REVERSE (67) | **BEAR_RUG (51)** |
|----:|----:|----:|----:|
| +20% | −12.9 | −18.4 | −6.5 |
| **+45% (current v2)** | **−11.3** | −20.0 | **+1.9** |
| +80% | −8.9 | −20.1 | +8.5 |
| **+120%** | **−6.6** | −20.5 | **+14.5** |
| none (∞) | −8.7 | −19.1 | +7.4 |

- **BEAR_RUG expectancy climbs monotonically as the cap loosens**, peaking near **+120%**
  (+14.5% vs +1.9% at the current +45%) — the hard +45% cap discards ~12pt/fire of BEAR_RUG's
  fat right tail. The optimum is a *loose* cap (~100–120%), not *no* cap (fires that peak
  >120% then bleed back are worth capping) — i.e. **cap the tail, but far higher than 45%.**
- **BULL_REVERSE is flat-negative regardless of cap** — no tail to capture in this window.
- Corroboration: independent scale-out-ladder study found the edge is BEAR_RUG-carried;
  the live 07-15 QQQ +201% winner (peaked +267%) would have booked only +45% under v2's cap.

**Caveat:** replay generates hypotheses, does not validate them (house rule). n=51 BEAR_RUG
test fires; the cap model books exactly cap% at the crossing (assumes a clean fill). Real v2
is HOLD-aware (skips the cap on barney fuel) which already partially loosens it — this study
can't see the surface, so it measures cap-always. **Forward validation required before any change.**

## PROPOSAL → DECISIONS NEEDED (operator only, forward-validate; do NOT auto-ship)
Raise / state-scope the v2 profit cap: keep a cap on **BULL_REVERSE** (~45%, no tail to give
up) but **loosen it sharply for BEAR_RUG (~100–120%, or replace with a trail on the runner)**.
Shadow-log the looser-cap P&L alongside live v2 on forward BEAR_RUG fires; adopt only if it
beats the +45% cap on ≥ a pre-set number of forward fires. `EXIT_PROFIT_CAP_PCT` is already a
tunable env var, so the change is a threshold, not new code.
