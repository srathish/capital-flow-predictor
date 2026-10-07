# Multi-engine mover catcher — locked 2026-10-06, before building or running any engine

## Goal

Catch most of each year's biggest US stock movers early, and understand why each was flagged. The bottleneck screen alone
caught 22–23 of the top 50 movers in 2025 and 2026 (see `results_v5/recall_2025_26.md`). Each new engine targets a kind of
mover the screen can't see. Rules are written here before any engine is built or run, and settings are chosen only on
2015–2022. (The 2025–26 miss list has been seen, so every engine below is defined generically, not around specific names.)

## Shared harness (every engine judged the same way)

- **Universe:** eligible US stocks at each month-end (price ≥ $5, 50-day dollar volume ≥ $20M, no stale price), the same as v5.
- **Movers of year Y:** the top 50 by price return from the last trading day of Y−1 to the last of Y, among stocks eligible at
  the start. For 2026, the end is 2026-09-30.
- **Caught early:** the engine flags the stock at some month-end from July of Y−1 through December of Y, while no more than
  half of that year's move has happened yet (price at the flag vs start, relative to the full-year move; flags before the
  start count as 0%).
- **Precision:** the average 6-month return of everything the engine flags, minus the typical stock's, over the same months.
  A big list that flags losers is penalized here.
- **List size:** average names flagged per month.
- **Every flag records why:** the engine plus the numbers that triggered it.

## Engines

| | Engine | Catches | Rule (parameters in braces are chosen on 2015–2022) |
|---|---|---|---|
| E0 | **Bottleneck** (existing) | Companies whose numbers prove a shortage | v5 core score + losing-less rule, top {20, 40, 60} |
| E1 | **Theme spread** | Pre-revenue and second-wave names in a hot theme | An industry (3-digit SIC; from 2022 also concept co-mention groups) is *lit* when ≥ {2, 3} of its companies are in E0's top 60. Flag the other members with the strongest 3-month price momentum: top {3, 5} per lit theme. Also lit: industries linked to a lit industry by a ≥ 2% input-output flow (BEA) |
| E2a | **Foreign filers** | IFRS filers (20-F) invisible to the US-GAAP screen | The same bottleneck score from IFRS revenue and gross profit (annual or semi-annual), top {10, 20} |
| E2b | **Commodity / crypto** | Miners and producers riding a price move | When a commodity or bitcoin's 6-month price change is ≥ {+15%, +25%}, flag its producer group (SIC map), ranked by 3-month momentum, top {5, 10} |
| E3 | **Backlog / re-rating** | Steady growers whose order book accelerates (software, defense, equipment) | Backlog (RPO) or deferred-revenue YoY growth ≥ {20%, 40%} **and** accelerating vs the prior quarter, with revenue growth ≥ 10%; top {10, 20} by backlog growth |
| E4 | **Turnaround exception** | Real turnarounds wrongly blocked by the losing-less rule | Gross margin negative a year earlier but now ≥ {10%, 20%}, with revenue growth ≥ {50%, 100%} |
| E5 | **Insider cluster** | Insiders buying ahead of good news | ≥ {2, 3} insiders buying on the open market, ≥ $100k in total, within 30 days (SEC Form 4) |
| E6 | **Node-graph acceleration** | Companies the network says are about to accelerate | Top {20, 40} by the ridge node-graph revenue forecast. It needs 2010–2018 to learn, so it is built on 2019–2022 only and labeled weaker |
| E7 | **Relative-strength highs** (late but sure) | Anything already moving | At a 52-week high and in the top {2%, 5%} of 6-month price performance |

**Deferred** (no clean historical data yet): biotech catalysts (FDA calendar history), government contracts (USASpending
mapped to tickers), Korea 10-day exports.

## Choosing settings (2015–2022 only)

- For each engine, every setting combination is scored on 2015–2022.
- **Allowed:** average 6-month excess of flagged names > 0, and average list size ≤ its budget (E0 60; E1 40; E2a 20; E2b 20;
  E3 20; E4 10; E5 20; E6 40; E7 40).
- **Chosen:** the allowed setting with the most movers caught early. Ties go to the higher excess.
- **Combined watchlist:** the union of the chosen engines, capped at 150 names a month. If over the cap, E0 is kept first, then
  engines in order of their 2015–2022 precision.

## Blind test (run once)

2025 and 2026-YTD. Reported:
- each engine's movers caught early / caught at all, its precision and list size;
- the combined watchlist vs E0 alone;
- the 2023–2024 numbers too, flagged because those years were partly seen.

**Success** = the combined watchlist catches ≥ 50% of the top-50 movers early in both 2025 and 2026, with positive precision.

A per-stock table shows which engine caught each mover, when, and why.

## Data to collect first

- **SEC Form 4 bulk data 2014–2020** (we have 2021+) for E5.
- **IFRS companyfacts** for foreign filers, for E2a.
- **Concept co-mention history 2014–2021** via EDGAR full-text search, for E1. Until it exists, E1 uses SIC + input-output
  links only, and concepts enter from 2022.
- **Commodity and crypto prices** (UW: GLD, SLV, CPER, URA, USO, UNG, LIT, REMX; FRED bitcoin).

## Amendment 1 (2026-10-06, before any engine is built or run) — five more engines

| | Engine | Catches | Rule (settings in braces chosen on 2015–2022) |
|---|---|---|---|
| E8 | **Profitability turn** | First real operating profit while growing | Operating income positive in the latest quarter after ≥ {2, 4} negative quarters in the prior four, with revenue growth ≥ {15%, 30%}. Budget 20 |
| E9 | **Index-inclusion candidate** | Forced index buying | Not yet large: market cap (shares outstanding × price) crosses {≈$15B, ≈$20B} from below within the last 3 months, with the sum of the last 4 quarters' net income > 0 and the latest quarter's > 0. The bar is inflation-adjusted to the S&P 500 rule of each year, as published. Budget 20 |
| E10 | **Spin-off / new listing, year 2** | Spin-offs after forced selling | Company first traded {3–6, 6–12} months ago and filed a Form 10 (spin-off registration), or (variant) any new listing; flag if its 3-month momentum is in the top half. Budget 20 |
| E11 | **Quiet accumulation** | Volume footprints before a breakout | On-balance volume at a 6-month high while price is still ≥ {10%, 20%} below its 52-week high, and 50-day up-day volume / down-day volume ≥ {1.3, 1.6}. Budget 40 |
| E12 | **Attention surge** | Retail story stocks | Wikipedia page views over the last 30 days ≥ {3×, 5×} the prior 180-day average (from 2015-07), price above its 50-day average. Budget 30 |

Data: XBRL net income + shares outstanding (E8/E9 from companyfacts), EDGAR full-index Form 10-12B/10-12G list (E10), UW
daily volume (E11, have), Wikipedia pageviews API with Wikidata ticker → article mapping (E12).

Deferred: options flow and analyst revisions (both failed earlier tests), short squeeze (no free short-interest history),
government contracts, FDA catalysts, Korea exports, job postings (from 2020 only).
