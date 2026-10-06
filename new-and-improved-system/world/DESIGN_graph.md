# Node graph — learn how growth flows between companies, forecast it, buy and hold (locked 2026-10-06, before the new data is read)

## Goal

Every company and every number is a node. Learn, from history only, which nodes' increases come **before** other nodes'
increases, and by how many quarters. Each month, push the latest changes along those learned connections, forecast each
company's next-quarter revenue growth, and buy and hold the companies whose growth is about to speed up.

## Nodes

- **Company numbers** (quarterly, point-in-time by SEC filed date; same first-filed / Q4-derivation rules as v5): revenue YoY
  growth, gross margin, capex YoY growth, inventory YoY growth, order backlog (RPO) YoY growth, operating margin.
- **Root node:** hyperscaler capex = the summed quarterly capex of MSFT, GOOGL, AMZN, META, ORCL, YoY growth.
- **Hub nodes:** the 300 companies with the largest trailing revenue at each training cut-off (they are most of the economy's
  demand).
- **Outside nodes:** the FRED series already used by the thesis digest (semiconductor and electronic-component PPIs, IP semis,
  transformer/switchgear/transmission PPIs, electricity, Henry Hub, copper, aluminum, power and commercial construction),
  monthly, YoY growth, using values as first published where FRED vintages allow (otherwise lagged one extra month).

## Connections (learned, never hand-drawn)

For each target company i, a candidate connection is "node j's YoY growth L quarters ago" for L = 1, 2, 3, 4, with j in: the
root node, the hub nodes (excluding i), the outside nodes, and i's own capex, inventory and backlog.

- **Learn** on the training window: correlation between j at t−L and the *change* in i's revenue growth at t (acceleration).
- **Keep** a connection only if it is in the top 10 for i in the first two-thirds of the window **and** has the same sign and
  at least half the strength in the last third (stability check — kills most chance correlations).
- **Weight** = its correlation over the full window, shrunk by n / (n + 12) (n = overlapping quarters).
- At most 10 connections per company. Companies with < 16 quarters of history get none.

## Forecast

Predicted acceleration of i next quarter = sum over kept connections of weight × (latest z-scored value of j at the right lag).
Baseline to beat: **persistence** — next quarter's acceleration = this quarter's acceleration (and zero-forecast).

## Walk-forward

- Learn on 2011–2018. Test 2019 onward. Re-learn every January using only data filed before it.
- Months 2019-01 → 2026-03 (6-month returns to 2026-09). **2019–2022 is clean; 2023–26 overlaps years already studied** (v5
  picks were looked at), so both are reported separately.

## Portfolio (buy and hold)

Each month-end, among eligible stocks (v5 wide rule: price ≥ $5, 50-day $ volume ≥ $20M) that also pass the hard rule
(gross margin a year ago ≥ 0):

- **Buy** the top 20 by predicted acceleration.
- **Hold** while the stock stays in the top 60 by predicted acceleration; **sell** when it drops out. Equal weight across
  holdings, rebalanced monthly; 0.10% cost per trade.
- Report: annual returns per year, holding periods, every buy and sell (year-by-year report like v5).

## Pass — all four, on the test years

1. **Forecast:** rank correlation (predicted vs actual next-quarter acceleration) beats persistence, with the monthly IC
   positive in ≥ 60% of quarters (2019–2026 combined and 2019–2022 alone).
2. Portfolio return vs the eligible-universe median beats **momentum top 20** (same hold rule).
3. Beats **v5 Model A**.
4. Beats the 95th percentile of 200 random portfolios with the same turnover.

If 1 fails, the connections are not real and 2–4 are not judged.

## Known limits

- Survivorship: delisted companies are missing (worse in 2012–2018).
- Quarterly filings limit how fast company nodes move; monthly updates come from outside nodes and new filings.
- A brand-new theme with no history has no learned connections. That stays the thesis engine's job.
