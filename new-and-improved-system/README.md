# New & Improved System

A fresh build. **Inputs: the Skylit doctrine only** (`DOCTRINE.md`) and **the APIs we verified** (`API_INVENTORY.md`). No conclusions from earlier studies are carried in; the design is derived from what Skylit teaches and what the data feeds can actually deliver.

## What it is
A **decision-support trading agent for SPX / SPY / QQQ** that runs the Academy's real-time 9-step loop continuously on live Skylit data, and hands the operator a card at the moment the doctrine says a trade exists — at the **direct tap of a major node**, inside a recognized setup, with Trinity alignment and a ≥3:1 node-to-node plan. The operator confirms the chart thesis and pulls the trigger; the agent runs the discipline (stop = one node beyond on hold, target = next node, take-profit behavior by regime, flat at the close for 0DTE).

Why decision-support and not autopilot: the doctrine is explicit — *Heatseeker confirms a chart thesis, it does not generate signals*, and *the edge is execution at the deflection.* The agent's job is to never miss the deflection, never skip a step, and never trade a midpoint, a 3rd tap, a Rainbow Road, or a divergent Trinity.

## The main loop (Chapter 11, verbatim as code stages)
```
every 5–15 s (or on /v1/stream frame):
  1 PRICE      Atlas 1-min bars → trend/range state, VWAP, EMA5/20, session range
  2 STRUCTURE  swing highs/lows, prior-day H/L, range high/low/midpoint, S/R flips, double bottoms/tops
  3 MAP        heat_heatmap (gamma, 0DTE column + aggregate) → king, floor, ceiling, gatekeepers, air pockets, flip
  4 NODE       strength (|value| share), lifecycle (fresh/tested/delivered), tap count, growing vs decaying
  5 REACTION   expected: direct tap (pika/large) vs overshoot-then-stall (barney)
  6 REGIME     signed exposure near spot → +gamma / −gamma / mixed; tempest_market context
  7 PATH       between spot and target: air pockets vs gatekeepers vs pika clouds
  8 TRINITY    SPXW + SPY + QQQ in one call → full / partial / divergent
  9 DECIDE     pattern recognized + fresh strong node + chart agrees + Trinity ≥2/3 + R:R ≥3:1 → CARD
                anything off → WAIT / PASS (and say which step failed)
```
Plus two always-on background reads from `DOCTRINE.md` §4 and §6:
- **Day-type classifier** at the open and on every reshuffle (range / trend / whipsaw / rainbow) — it gates whether the loop may fire at all.
- **Living-map tracker** — diff consecutive boards: rolling floors/ceilings, velocity (`velocityPct`), node growth/decay, delivered nodes. *Rolling ceiling down while you're bullish = your thesis is being taken away.*

## The card (what the operator sees)
```
SPY  10:42:15   DAY: Trend (−gamma)   TRINITY: 3/3 bearish   REGIME: −0.41
SETUP: RUG — pika ceiling 765 (king, 142M, fresh) | barney 762/760 below | spot 764.9 at the tap
CHART: lower high vs 9:50 swing, below VWAP, EMA5<EMA20           ✓ agrees
REACTION: direct tap (positive node) — enter on deflection, not before
PLAN: puts off 765 → stop break+hold 766 → T1 762 (gatekeeper) · T2 760 (floor)   R:R 3.4
PATH: air pocket 764→762, pika cloud? no        LIFECYCLE: 1st tap
CONTRACT: SPY 10/01 762P  last 1.41  spread 0.03  (option_chain)   size: full (1st tap)
INVALIDATION: 765 fails to hold / floor 760 rolls up / Trinity breaks
```

## Build plan (small, verifiable steps)
1. **`feeds/`** — thin clients: `skylit-mcp.js` (JSON-RPC wrapper with rate-limit/backoff, credit logging), `atlas.js`, `uw.js`. Every call returns raw JSON + `meta`.
2. **`map/`** — `board.js` (normalize a heat_heatmap symbol → nodes with |value| share, sign, distance), `hierarchy.js` (king/floor/ceiling/gatekeepers/air pockets/midpoint), `regime.js`, `patterns.js` (rug, reverse rug, pika cloud, beach ball, whipsaw, rainbow road — straight from DOCTRINE §5), `living.js` (frame diffing: rolling, velocity, lifecycle, growth/decay), `trinity.js`.
3. **`chart/`** — `structure.js` from Atlas bars: trend/range, swing points, range edges, VWAP/EMA, double-bottom/top, S/R flip.
4. **`loop/`** — `nine-steps.js` implementing the stage list above with an explicit `stepFailed` reason; `daytype.js`.
5. **`execution/`** — `plan.js` (node-to-node targets, one-node-beyond stop, R:R, size by tap count and regime), `contract.js` (`expirations` → `option_chain` → pick strike, read real price/spread).
6. **`card/`** — render the card (terminal + JSON) and log every card and every PASS with its failing step.
7. **Replay harness** — the same loop over `heat_historical_heatmap` + Atlas history for any past day, so the operator can watch the agent read a known day (e.g. a rug day) before trusting it live. Credits: ~5/board.

## Rules the code must enforce (non-negotiable, from the doctrine)
- Charts first: no card without an agreeing chart-structure read.
- No midpoints. No 3rd-tap aggression. No Rainbow Road. No divergent Trinity.
- In −gamma: assume overshoot, never fade velocity, never fade a reverse rug.
- Stop = one node beyond, on **hold** (not a wick). Target = next node. R:R ≥ 3:1.
- 0DTE indices: flat by the close. +gamma pocket: take profits fast.
- Never chase. If price never reaches the node, there is no trade.

## Operating constraints
- One Skylit key, 120 req/min, batch Trinity into single calls, cache boards per frame, read `meta.creditsRemaining`.
- LLM steps (narrative on the card, optional vision tally of TradingView) run on `claude -p` headless — never the Anthropic API.
- No changes to any live loop during RTH; build/replay only, then switch after the close.
