# World model v5 — "the bottleneck shows up in the numbers first" (locked 2026-10-05, before any data is pulled)

## Idea

Owning a scarce input (memory, power, optics, compute) shows up in a company's own reported numbers: **revenue growth speeds up
and gross margin expands** (pricing power). Those numbers are public on the 10-Q/10-K filing date, often before the stock has
fully re-rated. v1–v4 used text, links, 13F holdings and insiders. None used the reported numbers themselves.

## Data (point-in-time)

SEC XBRL `companyfacts` for every company in the world universe (0 Skylit credits). Each value carries its `filed` date.

- **Revenue**, in priority order per period: RevenueFromContractWithCustomerExcludingAssessedTax · Revenues · SalesRevenueNet ·
  RevenueFromContractWithCustomerIncludingAssessedTax.
- **Gross profit**: GrossProfit; otherwise revenue − (CostOfRevenue · CostOfGoodsAndServicesSold · CostOfGoodsSold ·
  CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization).
- **Quarters** = durations of 80–100 days. A missing fiscal Q4 = annual (350–380 days) − the three quarters inside it; it is known
  on the 10-K filing date.
- Every period uses its **first-filed** value (restatements ignored). A value is usable at month-end M only if filed ≤ M.

## Signal at month-end M

For each eligible stock (same rule as v1–v4: price ≥ $5, 50-day dollar volume ≥ $20M at M), with q0 = the latest known quarter:

- q0 must end within 200 days of M; q0 revenue ≥ $25M; the same quarter a year earlier (q−4, end 345–385 days before q0) and
  q−1 / q−5 must exist with revenue > 0.
- **g0** = revenue YoY growth of q0. **accel** = g0 − (YoY growth of q−1). **dGM** = gross margin of q0 − gross margin of q−4.
- **Score** = mean of the cross-sectional percentile ranks of g0, accel and dGM (all three required).

**Model A (primary):** top 20 by score.
**Model B (pre-registered secondary):** top 20 by score among stocks with positive 12-1 momentum.

## Outcome and benchmarks

- Equal-weight 6-month forward return (entry next session's close), minus the eligible-universe median. Same code as v3/v4.
- Benchmarks each month: momentum 12-1 top 20; 200 random draws of 20 eligible stocks.

## Periods

- Development: month-ends 2023-03 → 2024-12.
- Holdout: month-ends 2025-01 → 2026-03 (6-month returns to 2026-09-30). **Run once.**

## Pass (holdout), per model

1. Mean monthly excess > momentum top 20's.
2. Mean > the 95th percentile of the random-draw means.
3. Positive excess in ≥ 60% of months.

## Also reported (not part of pass/fail)

- **Early flags:** first month each of MU, SNDK, WDC, STX, IREN, LITE, CLS, VRT, NVDA, APP, PLTR, CORZ, COHR enters the top 20 / top 50.
- **Live list:** top 20 for the latest month-end.

## Known biases and gaps

- Survivorship: universe = today's ~1,165 largest companies + watchlists. Benchmarks share it.
- Foreign filers (20-F: TSM, ASML; IREN until it switched to 10-K/10-Q) have no quarterly US XBRL and are invisible.
- Banks/insurers have no gross profit, so they are excluded.

## Addendum 2026-10-06 — wide-universe retest (locked before the wide data is pulled)

The original passed on the holdout, but its universe was today's ~1,165 largest companies, which can flatter a growth sort.
Retest with **identical rules** on a wide universe:

- **Universe:** every operating company in SEC `company_tickers.json` (~8,000; same ticker filter as v2) that has XBRL revenue
  facts and UW daily prices. Eligibility at each month-end is the same price ≥ $5 and 50-day dollar volume ≥ $20M filter
  (the SIC check is replaced by "has XBRL revenue", so funds/ETFs stay out).
- The median benchmark, momentum and random draws all use the wide eligible set.
- Dev 2023-03 → 2024-12 and holdout 2025-01 → 2026-03, each run once, same three pass criteria.
- **PASS = the holdout passes again on the wide universe.** If it fails, v5 is logged as a survivorship artifact.
- Remaining bias: companies delisted before today are still missing (no ticker in today's SEC list).

## Addendum 2026-10-06 (2) — 2012–2022 out-of-sample test (locked before the older prices are pulled)

v5 has only been seen in 2023–2026, a bull market led by its own theme. This tests the **frozen rules** on years never looked at.

- **Signals:** month-ends 2012-01 → 2022-12 (132 months; 6-month returns run to 2023-06). XBRL is mandatory for all filers
  from mid-2011, so 2012 is the first year with five quarters of history.
- **Universe:** the wide rule (SEC operating companies with XBRL revenue + UW prices), prices from UW back to 2009-10
  (`.cache/wdaily_hist`).
- **Rules:** unchanged (score, top 20, eligibility, 6-month hold, benchmarks, 200 random draws).
- **Pass:** the same three criteria over the full 2012–2022 run (mean > momentum's; mean > random 95th percentile; ≥ 60% of
  months positive).
- **Reported, not part of pass/fail:** results per calendar year, with 2018, 2020 and 2022 called out; concentration (median
  pick, top-5 names' share).
- **Bias, larger than in 2023–26:** companies delisted or acquired before today (e.g., the old SanDisk, bought in 2016) have no
  current ticker, so they are missing. This mostly removes failures, so read a pass as an upper bound.

## Addendum 2026-10-06 (3) — Model C, from the winners-vs-losers study (locked before the 2012–2022 run)

`world/v5_winners.mjs` (2023-03 → 2026-03 picks, seen data) found three pick-time traits that separated winners from losers:
the stock was already in an uptrend (losers below the 200-day average: median −9%, 39% beat the typical stock), and the margin
"expansion" was not a recovery from losses (gross margin negative a year earlier: median −14%, 25% beat). Growth speed and
margin-change size did not separate them.

**Model C** = Model A's score, top 20 among stocks that also have, at the month-end:
1. positive 12-1 momentum;
2. price above its 200-day average;
3. gross margin a year earlier (q−4) ≥ 0.

Tested once on 2012–2022 with the same three pass criteria, **plus: C must beat A** there. C was designed on 2023–26 data, so
only the 2012–2022 result counts.
