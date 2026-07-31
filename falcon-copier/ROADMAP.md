# Falcon-copier — build roadmap (after-close builds; agentic SENSES, never rules)

> SHIPPED 2026-07-31: a first-pass **intraday `dominant_trend`** read + hold-to-plan exits (see BUGS.md "FIXED — 7/31"). The FULL higher-timeframe senses below (weekly/aggregate GEX walls, prior-day/week levels, VWAP) are still the next build and would deepen that trend read.


The agent reasons well, but its senses are narrow: today it sees only 0DTE gamma + 30-min price path + dark-pool + tide. Two blind spots to close — both delivered as **new senses the agent reasons over**, never as if/then gates.

## A. Higher-timeframe structure (the map beyond 0DTE)
*Why:* a 0DTE node that looks like a floor can be meaningless against the weekly wall / prior-day level / VWAP — and vice versa.
- **Weekly + aggregate GEX map** — Skylit-native (col0 = 0DTE, aggregate = swing structure; surface-json.js bridge). The real king/walls beyond today.
- **Prior-day & prior-week high/low; overnight/globex range.**
- **Session VWAP.**
- *(optional)* daily 20/50/200 MAs, floor-trader pivots.
- Plugs in as `state.instruments[sym].higher_timeframe`.

## B. Macro / catalysts (why the tape might move)
*Why:* FOMC/CPI/Fed-speakers routinely override structure intraday; a 0DTE system blind to the calendar is blind to the biggest movers.
- **Economic calendar** (UW `get_market_events`): today's events w/ time + importance (FOMC, CPI, PPI, NFP, PCE, retail sales, Fed speakers, auctions); **countdown to next high-impact**; **in-event-window flag**.
- **VIX + vol regime** (fills the known VIX=null gap).
- *(optional)* live breaking headlines each loop (web_search); yield curve / Fed rates; mega-cap earnings after close.
- Plugs in as `state.macro` (shared across instruments).

## Dashboard
- A **macro clock** (next event + countdown) at the top.
- HTF levels (weekly king/walls, PDH/PDL, VWAP) on each instrument card.

## Sourcing
Skylit-first for HTF GEX (keeps "all from Skylit"); UW for macro calendar / VIX / rates (UW = flow/tide/price/macro per doctrine).

## Scope — PENDING user pick (asked 2026-07-30)
- HTF depth: weekly-GEX+levels | +TA indicators | GEX-walls-only
- Macro depth: calendar+VIX | +live headlines | full stack

Build in the after-close pass. Loop untouched now.
