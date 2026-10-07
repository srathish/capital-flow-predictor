# Bottleneck model, version D — designed blind to 2025–2026 (locked 2026-10-06, before running)

## Why

Version C was designed by looking at 2023–2026 winners vs losers, so its 2025–26 results are in-sample. Version D is chosen
**mechanically, using only data up to 2024-12-31**, then frozen and run once on 2025–2026.

The designer (Claude) has already seen 2025–26 results, so D's filters are not hand-picked. A fixed menu is written below (it
deliberately includes filters that did *not* help in 2023–26), and a fixed rule picks from it on pre-2025 data only.

## Base

Same as v5 Model A, wide universe (SEC operating companies with XBRL revenue and UW prices; price ≥ $5, 50-day dollar volume
≥ $20M, no stale price), first-filed point-in-time XBRL. Score = mean percentile rank of revenue YoY growth, growth
acceleration and gross-margin change YoY. Each month the **candidate pool** = the top 60 by score.

## Filter menu (fixed; each is a yes/no known at the month-end)

| # | Filter |
|---|---|
| F1 | 12-1 month price momentum > 0 |
| F2 | price above its 200-day average |
| F3 | price within 25% of its 52-week high |
| F4 | gross margin a year earlier ≥ 0 |
| F5 | gross margin (latest quarter) ≥ 30% |
| F6 | revenue growth accelerating two quarters in a row (g0 > g1 > g2) |
| F7 | latest quarterly revenue ≥ $250M |
| F8 | revenue growth ≤ 100% YoY (not hyper-growth) |
| F9 | 1-month price change > 0 |
| F10 | 50-day dollar volume ≥ $100M |

## Selection rule (build period only)

- **Build period:** signals 2012-01 → 2024-06, so every 6-month return ends by 2024-12-31. During selection, prices are cut at
  2024-12-31 and filings at filed ≤ 2024-12-31 (enforced in code: the data is truncated before selection runs).
- Portfolio for a filter set S = the top 20 by score among pool stocks passing every filter in S (fewer if fewer pass; a month
  with < 5 names counts as missing).
- Metric = mean over months of the portfolio's 6-month return minus the eligible-universe median.
- **Greedy:** start with no filters. At each step add the filter that most raises the metric, but only if it raises the mean in
  **both** halves (2012-01 → 2017-12 and 2018-01 → 2024-06). Stop when none does, or at 3 filters.

## Test (run once)

- Freeze the chosen filters. Signals 2025-01 → 2026-03 (graded, 6-month returns to 2026-09), with full data.
- **Pass** = all three: mean > momentum top 20's; mean > the 95th percentile of 200 random 20-stock draws; ≥ 60% of months
  positive. Also reported: Model A and C on the same months (C's are in-sample, flagged).
- Report every month's picks 2025-01 → 2026-09 and each graded pick's 6-month return (year-by-year style).

## Known limits

- Delisted companies are missing (survivorship), so results are a best case.
- The menu was written by someone who has seen 2025–26. Mitigated by the breadth of the menu and mechanical selection, not
  eliminated.
- 15 graded months ≈ 2.5 independent 6-month periods.
