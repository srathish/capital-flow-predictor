# Real-price confirmation of the gamma → premium-selling finding (locked 2026-10-11, before any option price is pulled)

**Why.** The volatility factory (DESIGN_vol_factory.md) validated, on PROXY straddle prices, that high local dealer gamma
(±1–2% balance, its 60-day z-score) predicts a better result for a short one-day straddle. Proxies ignore skew, bid-ask
and real 0DTE pricing. This test uses UW's real contract prices. It is a small, pre-registered confirmation family.

## Trades (SPY and QQQ — both have daily expiries throughout 2024–2026)
- **T1 — one-day straddle:** at the close of day d−1, sell the at-the-money call and put that expire on day d (strike =
  the listed strike nearest the d−1 close). Entry price = the day's closing NBBO **bid** of each leg from UW
  `/option-contract/{id}/historic` (selling at the bid = conservative). Exit = intrinsic value at d's close (held to
  expiry). P&L per share and as a fraction of the premium collected.
- **T2 — 0DTE straddle:** on day d, sell the at-the-money call and put expiring d (strike nearest the 09:35 price) at the
  09:35 one-minute close of each leg (UW `/option-contract/{id}/intraday?date=d`) minus $0.01 per leg (spread), held to
  the close (intrinsic at d's close).
- Days missing either leg's price are skipped (reported). Period 2024-01-08 → 2026-10-02 (the vol-factory sample).

## Hypotheses (all one-sided; build 2024-01-08 → 2025-03-31, holdout 2025-04-01 → 2026-10-02)
| id | statement | test |
|---|---|---|
| H1 | T1 P&L ÷ premium is higher when ±1% gamma balance (d−1) is higher | pooled regression with a ticker effect + ln(premium ÷ price) control, Newey–West lag 5 |
| H2 | same for the ±2% gamma balance z-score vs its prior 60 days (G23) | as H1 |
| H3 | T2 P&L ÷ premium is higher when ±1% gamma balance (d−1) is higher | as H1 |
| H4 | T2, G23 | as H1 |
| H5 | the **filter** "±1% gamma balance in its top third (thresholds from build days) AND d−1 close above its 20-day average AND VIX1D ÷ VIX9D at d−1 below its build median" gives a higher mean T1 P&L ÷ premium than the other days | difference in means, day-clustered t |
| H6 | the same filter for T2 | as H5 |
**Confirmed** if, on the **holdout**, Benjamini–Hochberg q = 0.10 across H1–H6 passes with the predicted sign. Build
results are reported but the verdict is the holdout. Also reported: mean P&L in dollars per straddle, win rate, worst
day, and the filtered strategy's cumulative P&L per $1 of premium (no sizing, no compounding).

## Known limits
Bid at the close may be stale for a few minutes; 09:35 bar closes are trades, not quotes; no assignment / pin risk
modelled beyond intrinsic at the close; taxes and commissions ignored.

## Run discipline
Collector `real_straddle_collect.mjs` (prices only) then `real_straddle.mjs` (single run). Research only.

## Amendments
**Amendment 1 (2026-10-11, while collecting, before any P&L is computed).** UW's intraday option history starts
2025-04-01, so T2 (0DTE) prices exist only in the holdout. H3, H4 and H6 are judged on the holdout alone (their build
rows are empty); the H6 filter thresholds still come from build-period FEATURE values (no option prices needed).
**Amendment 2 (2026-10-11, before any P&L is computed).** P&L ÷ premium has a long left tail (a big move against a
small premium), so for H1–H6 it is winsorized at the 1st / 99th percentiles of each trade type's full sample; unwinsorized
dollar results are reported alongside. H5/H6 are tested as the filter-dummy coefficient in the same pooled regression
(ticker effect, Driscoll–Kraay lag 5).
