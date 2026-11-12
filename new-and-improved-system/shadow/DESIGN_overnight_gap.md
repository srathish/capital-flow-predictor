# Overnight gap size from the gamma regime (locked 2026-11-11, before any result)

Why: the validated finding is that prior-day dealer gamma balance predicts the next session's intraday *range* (DESIGN_gamma_range,
PASS 2026-10-09). Last week's big SPY/QQQ moves were mostly overnight gaps (Oct 30, Nov 4, Nov 6, Nov 11), which that model never
scores. Question: does the same regime variable predict the size of the overnight gap? Size only. Direction is a control, expected null.

## Data

- UW `greek-exposure/strike?date=d` for SPY and QQQ, every trading day 2023-12-13 → 2026-10-16 (earliest the token allows), cached
  at `.cache/uw/gex_strike/<SYM>_<d>.json`. The file for day d is end-of-day d (confirmed point-in-time by the gamma_range audit).
- UW daily regular-session OHLC for SPY and QQQ (`.cache/uw/daily_<SYM>.json`).
- VIX close from Cboe's `VIX_History.csv` (`.cache/vix_cboe.json`).
- Half days stay in. Days with a missing gamma file are dropped, never imputed.

## Variables (all known at the close of day d)

- `B` = Σ(call_gex + put_gex) / Σ|call_gex + put_gex| over all strikes (−1 … +1).
- `Bloc` = same over strikes within ±2% of the close.
- `ln VIX`, `prev` = ln(day-d high/low range as % of close), `m20` = ln(20-day mean range), `absret` = |day-d close-to-close return|.

## Targets (day d+1)

- Primary: `gap = ln(|open_{d+1} / close_d − 1| + 0.0005)` (the floor keeps zero gaps finite; 0.05% ≈ one SPY tick).
- Secondary: `c2c = ln(|close_{d+1} / close_d − 1| + 0.0005)`.
- Control: `sign(open_{d+1} − close_d)` — B must NOT predict this (if it does, something is leaking or the map is a forecast, which
  everything else says it is not).

## Model and metrics

Pooled SPY+QQQ OLS with a symbol dummy: `target ~ sym + lnVIX + prev + m20 + absret + B`. Standard errors clustered by date.
Also reported: the same without B (baseline), Spearman ρ(B, |gap|), and the tercile ratio = mean |gap| in the lowest-B tercile ÷
mean |gap| in the highest-B tercile (terciles set on the build period and frozen). `Bloc` replaces `B` in a second fit.

## Pass criteria

Build (2023-12-13 → 2025-04-30): B's coefficient negative (more negative B → bigger gap) with clustered |t| ≥ 2.5; tercile ratio
≥ 1.15; incremental R² over the baseline ≥ 0.01. Holdout (2025-05-01 → 2026-10-16, one run): same sign, clustered |t| ≥ 2.0,
tercile ratio ≥ 1.10. The direction control must show |t| < 2 in both periods; if it does not, the result is reported as suspect.

## Stage B (only if Stage A passes build AND holdout) — pre-declared, not yet specified in detail

1DTE ATM straddle bought at 15:55 on day d, sold at 09:35 on d+1, real UW minute prices, $0.02/side slippage, $0.65/contract/side,
on lowest-B-tercile days vs all days vs highest-tercile days. Judged on mean return and profit factor after costs, with a
random-day control. Data would be fetched only after Stage A passes; the design is fixed before that fetch in an amendment.

## What a fail means

If B does not predict gap size, the gamma regime is an intraday-only phenomenon and overnight moves are outside the system; the
range forecast stays as it is and we do not extend it to close-to-close.

## Amendments

**A1 (2026-11-11, after the build result, before the holdout; from the independent audit).** Criteria unchanged. The holdout
report must also print, as descriptive slices with no verdict weight: per-symbol fits (SPY, QQQ), the fit excluding the 10
highest-VIX dates, and n in the low/high terciles. Reason: on build the effect is concentrated in April 2025 (ex-April t −2.47)
and carried by QQQ (SPY alone t −1.72, QQQ −4.01). If the holdout passes pooled but SPY alone does not, the result is recorded
as "QQQ-carried", not as a general finding. Audit also noted a lead-2 placebo at t −2.76 (B predicts the gap two nights ahead
nearly as well), so this is a multi-day volatility-regime effect, not a one-night hedging mechanism; Stage B's structure choice
must take that into account.
