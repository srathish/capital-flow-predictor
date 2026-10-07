# Money list v6 — risk layer, valuation, speed, guidance, frictions (locked 2026-10-07, before any run)

## Base (what is being improved)

The live money list: v5 core bottleneck score, losing-less rule, version C filters (12-1 momentum > 0, above 200-day average),
top 20, run as a 20-slot portfolio. **Selling rule C1:** hold while the stock stays in the top 60 at month-ends; sell if it
is still below its entry price 63 trading days after buying; 24-month cap. Next-session-close execution, 0.05% per side, clean
price layer (point-in-time quarantine + gap rule). Same simulator as `exits_theme.mjs`.

## Add-ons tested (each alone on top of the base, then the adopted ones together)

| | Add-on | Rule |
|---|---|---|
| R1 | **Industry cap** | at most {3, 4} holdings per 3-digit SIC industry; skip to the next-ranked name |
| R2 | **Volatility sizing** | new position size ∝ 1 / (60-day daily volatility), normalized so the average is 1/20 of equity, capped at 2× and floored at 0.5× equal weight |
| R3 | **Market brake** | when SPY closes a month-end below its 200-day average: (a) no new buys that month, or (b) also sell the weakest half (lowest score) of holdings |
| V1 | **Run-up cap** | skip new buys whose 6-month price change is > {+150%, +300%} |
| V2 | **Price-to-sales cap** | skip new buys in the top decile of price-to-sales (market cap from SEC shares outstanding × price, over trailing-4-quarter revenue) among that month's scored stocks |
| S1 | **Speed** | re-rank and fill/sell weekly (every Friday close, filings known by then) instead of month-ends; the C1 time stop and 24-month cap unchanged |
| G1 | **Guidance** | among candidates, prefer names with a guidance raise in an 8-K filed in the last 120 days (rank them first), and skip names with a guidance cut in that window. Needs the 2014–2026 guidance history (`guidance_hist.json`); if it isn't complete, G1 is reported as not tested. |

## Choosing (2012–2018, data truncated at 2018-12-31)

An add-on is **adopted** if, versus the base, over 2012–2018: Sharpe is higher, annualized excess is no more than 1.0 point
lower, and the worst drawdown is no worse — **and** it also holds on the check period 2019–2022 (Sharpe ≥ base's and excess no
more than 1.0 point lower). For two-setting add-ons, the better setting on 2012–2018 is the one checked.
The adopted add-ons are then run together and reported for 2012–18, 2019–22 and 2023–2026-09 (partly seen).

## Frictions (reported for the final combination, not used to choose)

- **Slippage:** an extra 0.20% per side for names with 50-day dollar volume < $100M.
- **Taxes:** realized gains taxed at 37% if held < 1 year, 20% if ≥ 1 year, with losses offsetting gains within the
  calendar year; reported as after-tax annual return.
- **Survivorship:** not fixable with current data (delisted names missing); noted as an upper bound.

## Theme-engine cleanup (radar)

E1 and E2b concept membership excludes words that are ambiguous in ordinary filing text: deposition, server, foundry,
accelerator, oil, natural gas, digital assets, subscription, grid, wind, solar, construction, interest rate, advertising,
travel, restaurant, housing, consumer spending, credit card, mortgage, steel, copper, automotive, tariff, freight, shipping,
wafer, rack, inference, transformer. (Words chosen by meaning, before looking at any result.) The engines run is repeated with
this list; 2025–26 is no longer blind for the engines, so it is reported as a seen check.

## Judgment layer (live only, not backtested)

The thesis engine reads today's money list and radar with their reasons and labels each theme "durable bottleneck",
"one-off spike" or "unclear", with a one-line reason. It is commentary for the human; it does not change the lists.
