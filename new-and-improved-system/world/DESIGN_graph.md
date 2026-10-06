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

## Amendment 1 (2026-10-06) — industry nodes instead of company pairs (before any 2019+ result was computed)

**Why:** the smoke test on 2018 (training years only, `--smoke`) learned connections like MU ← Capital One and NVDA ← Republic
Services. With ~28 quarters per company and ~1,300 candidate connections each, chance correlations pass the stability check.

**Change:**
- **Hub nodes are replaced by industry nodes:** 3-digit SIC groups with ≥ 5 companies (153 groups; `world/sic_collect.mjs`).
  An industry node's value for a quarter = the median revenue YoY growth of its members whose numbers were public by that date
  (at least 3 members).
- **Connections are learned per target industry, not per company:** target = the industry's median revenue acceleration;
  candidates = the root node, the outside nodes, and every other industry node (lags 1–4).
- **Stricter evidence:** keep a connection only if |t| ≥ 4 over the full window (n = quarters), the same sign in the first
  two-thirds and the last third, and the last third at least half as strong. At most 5 per industry. Weight = r × n / (n + 12).
- **Own-company nodes** (capex, inventory, backlog growth): learned per target industry from pooled company-quarters, with the
  t-statistic deflated by √3 for overlap between companies; same keep rules.
- A company's forecast = its industry's connections + its own-node connections. Everything else (walk-forward, portfolio,
  benchmarks, pass criteria) is unchanged.

## Amendment 2 (2026-10-06) — economic links only, overlap-robust stats, placebo, harder baselines, more free data
(before any 2019+ result; motivated by the prior-art scan in world/PRIOR_ART.md)

1. **Links must exist in the economy.** Each industry node (SIC 3-digit group) maps to one or more BEA summary industries (71;
   `world/sic_bea.mjs`, mapping fixed by hand from SIC/NAICS definitions). A driver industry D may connect to a target industry
   T only if they share a BEA industry, or, in the BEA Use table (before redefinitions, producer prices) for year
   (cut-off year − 2): T sells ≥ 2% of its output to D (D is a customer), or D supplies ≥ 2% of T's intermediate inputs.
   Outside nodes get a fixed BEA mapping (listed in code; macro-wide series — 10-year yield, dollar, retail sales — may connect
   to any industry) and the same link rule.
2. **Overlap-robust evidence.** Replace the plain t-stat with a Newey-West t-stat (4 lags) and keep a connection only if
   |t_NW| ≥ 3.0, same sign in both time splits, last third ≥ half as strong. Max 5 per industry.
3. **Placebo.** At the 2019 cut-off, re-learn 20 times with every driver series circularly shifted by a random 2–6 years
   (keeps each series' own pattern, breaks timing). Criterion 1 now also requires: real connections ≥ 2× the placebo average.
4. **Harder baselines for criterion 1:** the graph's IC must beat (a) persistence and (b) the company's own industry's latest
   median acceleration.
5. **Size split** reported: portfolio excess for stocks with 50-day dollar volume ≥ $100M vs the rest.
6. **More outside nodes (all free, point-in-time by release lag):** the six extra FRED series (10-year yield, dollar, WTI,
   bitcoin, freight, retail sales); Taiwan monthly revenue by industry (`.cache/tw`, available the 10th of the next month);
   further FRED series from the free-data scan if added before the run. Census trade by HS code is deferred (API now needs a
   key).

### Amendment 2b (2026-10-06, before any 2019+ result) — added free outside nodes and the first-release rule

- **First-release values.** Revised monthly FRED series use ALFRED vintages (`output_type=1`): each month's YoY growth is
  computed inside the vintage in which that month was first published (so index re-basings cannot corrupt growth), available
  on that first-release date. Months before a series' vintage history begins use the earliest vintage, available month-end +
  60 days. Daily market prices (oil, gas, yields, dollar, bitcoin) are not revised: available the next day.
- **Added nodes** (from the free-data scan; BEA mapping fixed in `world/sic_bea.mjs`):
  - Census M3 new/unfilled orders and inventories: A34SNO, A34SUO, A34STI, A34ANO, A35SNO, A35SUO, A33SNO, A36SNO, NEWORDER
    (core capital goods), ADEFNO (defense capital goods), ANAPNO (nondefense aircraft);
  - construction: TLMFGCONS (manufacturing); Census C30 "data center" construction (from 2014, current vintage, +35 days);
  - production: IPG3341S (computers), CAPUTLG3344S (semis capacity use), IPG2211S (electric power generation);
  - PPI data processing/hosting PCU518210518210; employment CES6054150001 (computer systems design), CES5051800001 (data
    processing/hosting);
  - commodities: PURANUSDM (uranium), PNICKUSDM, PIORECRUSDM, PCOALAUUSDM;
  - exports: XTEXVA01KRM667S (Korea), XTEXVA01JPM667S (Japan), XTEXVA01CNM667S (China);
  - freight: RAILFRTCARLOADSD11, TRUCKD11; regional surveys NOFDFSA066MSFRBPHI (Philly Fed future new orders); CFNAI;
  - WSTS global semiconductor billings (monthly, +45 days); NY Fed GSCPI (supply-chain pressure, +5 days); bitcoin hash rate
    and miner revenue (blockchain.info, daily).
- Deferred (need a key or scraping): Korea customs 10/20-day exports, Japan e-Stat HS 8486, Census trade by HS, EIA, SEAJ.

## Amendment 3 (2026-10-06, before any 2019+ result) — a second, ridge version, run alongside

**Why:** the smoke test on 2018 (training years only) found the placebo (timing scrambled) selects as many connections as the
real data (503 vs 492), so link *selection* on ~30 quarters is not distinguishable from chance. The prior-art scan found plain
ridge regression beat graph models out of sample. Amendment-2 rules stay as they are and are judged as written (`graph`).

**Second version (`graph_ridge`, `--ridge`):** no link selection.
- Per target industry: ridge regression of the industry's median revenue acceleration on **all** economically allowed drivers
  (amendment 2 BEA rule) × lags 1–4, z-scored. The penalty is picked from {1, 3, 10, 30, 100, 300} by fitting on the first
  two-thirds of the training quarters and scoring the last third, then refit on all training quarters.
- Own-company nodes (capex, inventory, backlog × lags): one pooled ridge over all companies, same penalty rule.
- Forecast = industry prediction + own-node prediction. Same walk-forward, portfolio, benchmarks and size split.
- **Criterion 1 (forecasting) for this version:** mean IC beats persistence and the industry baseline (2019–2026 and
  2019–2022), positive in ≥ 60% of months, **and** the 2019–2022 mean IC beats the 95th percentile of 20 placebo models (every
  driver series circularly shifted 2–6 years, re-learned each January exactly like the real one).
- Criteria 2–4 unchanged (beat momentum, v5, and random 95th percentile).

### Amendment 2c (2026-10-06, before any 2019+ result) — US trade by product (Census, key now available)

- Census international trade, imports and exports by HS code, monthly from 2010 (`world/trade_collect.mjs` →
  `.cache/trade/trade.json`). Current vintage (annual revisions are small), available month end + 40 days. Each series' YoY
  enters as an outside node `trade:<flow>:<HS>[:<country>]` with a fixed BEA mapping by HS code (`tradeBea()` in
  `world/sic_bea.mjs`): computers/parts/chips/storage/monitors/telecom/optics → 334 (computers also 514/5415); chip equipment
  8486 → 333/334; transformers, switchgear, cable, batteries, generators → 335 (+22/23/331 as listed); turbines → 333/3364OT/22;
  cooling/AC → 333/23; copper → 331/212; silicon/wafers → 325/334; cars/parts → 3361MV/441; medicines → 325; petroleum →
  324/211; total imports/exports → all industries.
