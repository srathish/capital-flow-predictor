# Volatility program 2 — where and when selling premium pays (locked 2026-10-15, before any engine or outcome)

**Why.** Across ~2,130 tested ideas the only survivors are about move SIZE: dealer gamma predicts the day's range (also
beyond implied vol), gamma-filtered SPY/QQQ straddle / iron-fly selling makes money, and some stocks predictably move
big — while every direction idea failed and buying options on predicted movers lost (the options price the move).
This program asks where else and when the premium seller is paid: published option-pricing effects (weekends, term
structure, variance premium, macro events, the upside 0DTE premium, expiration days, intraday momentum × gamma) and
direct extensions of our own results (implied vs our range forecast, 0DTE entry time, IWM/DIA, quiet stocks).

29 hypotheses, one Benjamini–Hochberg family (q = 0.10, one-sided, holdout, predicted sign). Research only.
Event dates: shadow/data/macro_events.json (FOMC statement days from federalreserve.gov; CPI release days from bls.gov).

## Common definitions
- **T1** = the 1-day SPY/QQQ straddle of DESIGN_real_straddle.md (sold at the d−1 closing bid, expiry d, intrinsic at d's
  close); return = P&L ÷ premium, winsorized 1/99 over the full sample for tests. **T2** = the 0DTE straddle sold at 09:35
  (same file). **F2** = ±1% gamma balance (A01, d−1) in its build top third (per symbol, build days).
- T1 split: build 2024-01-08 → 2025-03-31, holdout 2025-04-01 → 2026-10-02 (**caveat: the T1 holdout has been looked at
  for the straddle, fly and post-breach tests — never for these features**). Intraday-option splits (T2, entry times):
  build 2025-04-01 → 2025-12-31, holdout 2026-01-02 → 2026-10-02.
- Pooled regressions: ticker effect, Driscoll–Kraay lag 5 (code from real_straddle.mjs); dummies tested as coefficients.

## Part A — published timing effects on SPY/QQQ (7)
| id | statement | source |
|---|---|---|
| A1 | T1 return is higher when the trade spans a non-trading day (d−1 is the last session before a weekend or holiday) | Jones & Shemesh 2018; OptionMetrics 2025 |
| A2 | T1 return rises with term-structure contango: regressor −ln(VIX ÷ VIX3M) at d−1 | Johnson 2017 |
| A3 | T1 return rises with the variance premium: ln(VIX1D) − ln(5-day close-to-close realized vol of the symbol, annualized), d−1 | VRP timing |
| A4 | T1 return is higher when d is a CPI release day | event premium studies |
| A5 | T1 return is LOWER when d is an FOMC statement day (predicted negative) | Nasdaq-100 FOMC straddle study |
| A6 | T1 return is higher when d is the monthly options expiration (third-Friday session, or the prior session if a holiday) | Stivers & Sun 2013 |
| A7 | T2: the short call leg's P&L ÷ its own premium exceeds the short put leg's, same day (paired, day-clustered) | Almeida, Freire & Hizmeri |

## Part B — our range forecast vs the implied move (2)
Forecast model fit on BUILD days only, per symbol: OLS of ln(range_d ÷ close_{d−1}) on ln(VIX_{d−1}) (VXN for QQQ),
A01_{d−1}, ln(5-day mean range ÷ close)_{d−1}. Edge ratio = ln(implied move ÷ forecast range), implied move = straddle
premium ÷ price at entry.
| id | statement |
|---|---|
| B1 | T1 return rises with the edge ratio (regression) |
| B2 | T2 return rises with the edge ratio (T2 split; the T2 forecast uses the same build-fit daily model) |

## Part C — 0DTE entry time (6), SPY/QQQ, intraday split
Sell the ATM 0DTE straddle (strike nearest the price at the entry time) at the first one-minute close in [t, t+5]
minus $0.01 per leg; settle at intrinsic on d's close. t ∈ {10:30, 12:00, 14:00}.
| id | statement |
|---|---|
| C1–C3 | on F2 days, mean return (P&L ÷ premium) > 0 at 10:30 / 12:00 / 14:00 |
| C4–C6 | F2 days beat other days at 10:30 / 12:00 / 14:00 (dummy coefficient) |

## Part D — IWM and DIA (4)
Same T1 trades and ±1% fly on IWM and DIA (prices collected 2026-10-15; same collectors), F2 thresholds from their
own build days. D1/D2: IWM / DIA straddle, F2 days beat other days. D3/D4: IWM / DIA ±1% fly (return on max risk), F2
days beat other days.

## Part E — selling premium on predicted-quiet stocks (8), real UW prices
Weekly panel of the short stock factory (as Ideas200 part B). Picks = the **bottom 10** each week by the validated
big-mover signals S17 (vanna balance), S55, S41 (realized volatility), S53, and their combined rank (QCOMBO); control =
the same 10 random stocks per week as Ideas200 B (fixed seed; verified identical). Trade: SELL the ATM call + put on the
first standard monthly expiry ≥ 28 days out at the closing NBBO **bid**, buy back at the closing NBBO **ask** after 20
(or 10) trading days (intrinsic if expired). Return = P&L ÷ premium received. Build: exits ≤ 2025-06-30; holdout:
rebalances ≥ 2025-07-01; week-clustered differences.
| id | statement |
|---|---|
| E1–E5 | Q17 / Q55 / Q41 / Q53 / QCOMBO, 20 days: picks' seller return > control's |
| E6 | QCOMBO, 10 days: picks > control |
| E7 | control seller return (20 days) > 0 — does selling random single-stock straddles pay after the spread? |
| E8 | QCOMBO seller return (20 days) > 0 |
Also reported: mid-to-mid returns, worst week, share of trades losing > 100% of premium.

## Part F — intraday momentum × dealer gamma (2), SPY/QQQ/IWM/DIA 1-minute bars, 2023-11-09 → (build/holdout as T1 dates)
r_late = 15:30 → 15:59 close return; r_early = prior close → 15:30 return.
| id | statement |
|---|---|
| F1 | pooled slope of r_late on r_early > 0 (Gao, Han, Li & Zhou 2018) |
| F2 | the slope is larger when dealer gamma is short: interaction r_early × 1[A01_{d−1} < 0] > 0 (Baltussen et al. 2021) |
Ticker effect, day-clustered.

## Not included (reasons)
Pre-FOMC drift and overnight drift (documented dead after 2015 / 2021); closing-auction imbalance (no data);
leveraged-ETF rebalancing (needs AUM history); turn of the month (equity drift, not premium; low power here).

## Run discipline
Engines vp2_A.mjs … vp2_F.mjs (shared T1/T2 loader), a combiner applying BH across the 29, smoke tests that print
counts only, an independent audit against this file, then one run each.

## Amendments
