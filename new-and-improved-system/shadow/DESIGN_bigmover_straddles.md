# Long straddles on predicted big movers — real option prices (locked 2026-10-11, before any option price is pulled)

**Why.** The weekly stock factory validated that some features predict a top-10% 4-week move in EITHER direction
(vanna balance S17, net vanna ÷ market cap S55, realized volatility S41, options footprint S53). Big moves only pay a
straddle BUYER if they beat what the options already charge. This test buys real straddles.

## Trades
- Universe / weeks: the short-factory panel (300 stocks chosen as of 2023-10-31; week-end rebalances 2023-11 → 2026-08).
- Each week: rank stocks by each signal; **picks = top 10** by that signal; **control = 10 stocks drawn at random** (fixed
  seed per week) from the same week's cross-section.
- Straddle: buy the call + put at the listed strike nearest the week-end close (rounded to the stock's strike grid: $1
  under $200, $5 above — the nearest strike that exists in UW's chain), expiring on the **standard monthly expiry 4–7
  weeks out** (third Friday). Entry = closing NBBO **ask** of each leg on the rebalance day (buying at the ask =
  conservative). Exit = closing NBBO **bid** 20 trading days later (or intrinsic at expiry if earlier).
  Prices from UW `/option-contract/{id}/historic`. Outcome = P&L ÷ premium paid.
- Signals tested (4): S17, S55, S41, S53, each top-10 vs the random control.

## Hypotheses (one-sided: picks' mean P&L ÷ premium > control's)
H1 S17 · H2 S55 · H3 S41 · H4 S53. Difference in means with week-clustered standard errors.
**Build:** rebalances with exit ≤ 2025-06-30; **holdout:** rebalances ≥ 2025-07-01. Confirmed if the holdout passes
Benjamini–Hochberg q = 0.10 across H1–H4. Also reported: picks' absolute mean P&L ÷ premium (does buying them make money
at all?), win rate, per-signal median premium (picks' options are likely pricier), and the overlap between signals.

## Run discipline
`bigmover_collect.mjs` (prices only; picks are computed from features known at each rebalance), then
`bigmover_straddles.mjs` (single run). Research only.

## Amendments
(none yet)
