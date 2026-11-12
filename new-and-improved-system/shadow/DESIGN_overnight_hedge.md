# Overnight hedge: skip low-gamma nights in a buy-and-hold index position (locked 2026-11-11, before any result)

Why: DESIGN_overnight_gap Stage A passed (low gamma balance → bigger overnight gap, no direction). Stage B showed options already
price it. The remaining expression is not an option trade: a holder of SPY/QQQ who is flat overnight on low-gamma nights gives up
those nights' return but also their excess variance. If the mean overnight return does not depend on B (as the null-direction result
implies), the Sharpe ratio of the overnight exposure must improve. This tests that directly. No options, no slippage beyond the
close/open auction (assumed fillable at the daily close and next open; a 1 bp per-side cost is applied per switch).

## Data

Same panel as DESIGN_overnight_gap: UW daily regular-session OHLC and UW greek-exposure/strike (`.cache/uw/gex_strike`) for SPY and
QQQ, 2023-12-13 → 2026-10-16; VIX close from Cboe.

## Definitions

- Overnight return `r_d = open_{d+1} / close_d − 1`, one per symbol-night.
- Signal `B_d` (EOD file of day d; exists the same evening per the gamma_range audit). Low-gamma night: `B_d ≤ −0.2915`, the frozen
  build-tercile cut from `results_overnight_gap/terciles_build.json`.
- **A (baseline):** hold every night. **S (strategy):** hold every night except low-gamma nights (flat, 0%); each switch out and
  back costs 1 bp (2 bp round trip, charged on the skipped night).
- **V (VIX rule control):** skip the same number of nights as S, choosing those with the highest VIX close on day d.
- **R (random control):** skip the same number of random nights, 1,000 draws.

## Metrics (per symbol, overnight series only)

Annualized Sharpe (mean/sd × √252), annualized vol, mean overnight return (bp), max drawdown of the cumulative overnight curve,
nights skipped. Direction control: mean `r_d` on skipped vs kept nights, Welch t — must be |t| < 2 (if skipped nights have
significantly lower mean return, B is predicting direction, which contradicts everything else and makes the result suspect).

## Pass criteria

Build (2023-12-13 → 2025-04-30): for BOTH SPY and QQQ, Sharpe(S) > Sharpe(A), Sharpe(S) ≥ Sharpe(V), Sharpe(S) above the 97.5th
percentile of the R distribution, vol(S) ≤ 0.90 × vol(A), direction control clean.
Holdout (2025-05-01 → 2026-10-16, one run): both symbols Sharpe(S) > Sharpe(A), Sharpe(S) above the R 95th percentile, vol(S) ≤
0.92 × vol(A). Note: this holdout window was already opened once today for Stage A of the gap design on the same panel; this is
a second, derived question on the same data and is recorded as such.

## What a pass or fail means

Pass: a holder can cut overnight variance with the gamma regime without paying for it in options; worth a paper ledger. Fail with
Sharpe(S) ≈ Sharpe(R): the extra gap size is too small relative to overnight noise to matter at the portfolio level. Fail with
mean return on skipped nights significantly higher: low-gamma nights carry a risk premium a holder is paid to bear; skipping them
costs money.

## Amendments

(none)

## Result — build (2023-12-13 → 2025-04-30): **FAIL** (run 2026-11-11)

`python shadow/overnight_hedge.py build` → `results_overnight_hedge/build.json`.

| sym | nights | skipped | Sharpe A | Sharpe S | Sharpe V (VIX rule) | random-skip 50 / 95 / 97.5 | vol A → S | mean bp A → S | maxDD A → S | skipped vs kept bp (t) |
|---|---|---|---|---|---|---|---|---|---|---|
| SPY | 345 | 124 | 0.86 | 0.87 | 0.88 | 0.48 / 1.38 / 1.58 | 11.0% → 5.7% | 3.75 → 1.95 | −16.2% → −5.5% | +3.0 vs +4.2 (−0.12) |
| QQQ | 345 | 106 | 1.14 | 1.11 | 1.87 | 0.82 / 1.72 / 1.93 | 14.0% → 8.7% | 6.35 → 3.85 | −17.7% → −6.3% | +6.1 vs +6.4 (−0.03) |

Fails S ≥ V and S > random 97.5th on both symbols; S > A only on SPY by 0.01. Holdout not opened.

Reading: low-gamma nights are more volatile (Stage A of the gap design) but earn the same mean return as other nights, so skipping
them lowers variance and return in proportion — Sharpe unchanged. The drawdown reduction is real but is what any 1/3 reduction in
exposure buys. A VIX-based skip does as well. The gamma regime has no portfolio-level overnight use for a holder.
