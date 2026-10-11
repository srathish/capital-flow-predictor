# Stock event factory — what happens after specific events (locked 2026-10-11, before any engine)

**Question each study answers:** after a specific, datable event, does the stock beat the market over the next 5 / 20 /
60 trading days, and is it more likely to become a big mover? Registry: `event_registry.json` (from
`event_registry.mjs`), committed with this file before any results. Complements the monthly stock factory (same data,
same point-in-time fixes: earliest-filed fundamentals, split-adjusted shares, market-cap eligibility).

## Universe, timing, outcomes
- Stocks: SEC operating companies (`universeV2`), eligible on the event day: market cap ≥ $500M (split-adjusted shares
  filed ≤ day × price), ≥ 252 prior bars, clean price layer (no quarantine window), not a fund.
- Event day e = the day the information is public (filing date for SEC items; Form 4 filing date for insider buys; 8-K
  date for guidance; the bar's date for price events, known at its close).
- Entry: close of the first trading day AFTER e. Outcomes: A5 / A20 / A60 = return over 5 / 20 / 60 trading days minus
  the equal-weight return of all eligible stocks over the same window; MV60 = 1 if the 60-day return is in the top 10%
  of all eligible stocks' 60-day returns from the same entry day. Windows crossing a quarantine window are dropped.
- A stock contributes at most one event of a given type per 60 trading days (the first), so windows don't overlap.

## Statistics
Mean outcome across events with a day-clustered t (events on the same entry day form one cluster; A20/A60 also
cluster by calendar month to absorb overlap across days). For MV60 the outcome is minus the base rate (10%).
Predicted sign per event (`?` = two-sided). ≥ 50 events required.
**Build:** event dates 2012-01-01 → 2019-12-31 (windows must end by 2019-12-31). **Holdout:** 2020-01-01 → windows ending
by 2026-10-02. Benjamini–Hochberg q = 0.10 across all studies on the build; BH q = 0.10 across survivors on the holdout,
same sign.
**Own placebo:** each validated study is re-run 20 times on the holdout with the same number of events per month
assigned to random eligible stocks on the same dates (fixed seeds); validated only if the real mean beats ≥ 19 of 20.
Insider and guidance events start 2014-03 (their files start 2014).

## Run discipline
Engine `event_factory.mjs` audited independently before its single run; amendments below. Output
`shadow/results_event_factory/`. Research only.

## Amendments
(none yet)
