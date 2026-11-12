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
