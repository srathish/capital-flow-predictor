# API INVENTORY — everything we can call, verified live 2026-10-01

One key for all of Skylit: `SKYLIT_API_KEY` in repo `.env` (gitignored). Standard plan: **120 req/min**, 10 symbols per heatmap/stream call, ~104K credits ($0.001/credit). Every response's `meta` carries `creditsRemaining` + `rateLimitRemaining` — read them and back off at 429.

Legend: ✅ = called successfully this session · 📄 = documented, not yet called

---

## A. Skylit MCP — `https://mcp.skylit.ai/mcp` (63 tools, JSON-RPC) ✅
`POST` body `{jsonrpc:"2.0", id, method:"tools/call", params:{name, arguments}}` · headers `Authorization: Bearer`, `Content-Type: application/json`, `Accept: application/json, text/event-stream` · response is an SSE `data:` line → `result.content[0].text` is a JSON string.

### Heatseeker (the map) — doctrine §1–§6
| Tool | Returns | Notes / cost |
|---|---|---|
| `heat_heatmap` ✅ | per strike `{strike, value, nodeType, velocityPct}` + `spot, previousClose, priceChange, expirations[]`; `nodeType ∈ normal/pika/barney/gatekeeper/king/significant` | **`metric: "gamma"` (default) or `"vanna"`** — one call per metric. `expirations:"YYYY-MM-DD"` isolates the **0DTE column** (indices). ≤10 symbols (Trinity in one call). `resolution: 1s`, `mode: live`. **This is the live-map + velocity feed.** |
| `heat_levels` ✅ | only classified nodes, strongest first, `distancePct`; `summary{flip{level,distancePct}, positiveWall, negativeWall, netExposure, highStrike, lowStrike}` | gamma only (no vanna). Fast "where are the walls / flip" read. ≤10 sym. |
| `heat_historical_heatmap` ✅ (via REST twin) | replay the per-strike board at `at=` (RFC3339), up to 365 d back | 5 cr; `expirations=` for 0DTE replay |
| `heat_stats_daily` 📄 | daily board OHLC + largest ± strike exposure + concentration, ≤50 sym × 31 d in one call | cheap bulk history |
| `heat_symbols` 📄 | every covered symbol + index flag + history range | free-ish |

### Tempest (volatility / regime context) — doctrine §3–§4
| Tool | Returns |
|---|---|
| `tempest_market` ✅ | VIX1D/9D/VIX/3M/6M, VVIX, SKEW, curve state + roll, **regime word**, crowded-calm flag, Mag-7 dispersion, **Fear & Greed** |
| `tempest_sigma` ✅ | today's move in σ of the priced 1-day move, move budget left, 1σ/2σ odds, last 60 sessions |
| `tempest_cones` ✅ | 1σ expected-move bands for close / 1d / week / opex / 30d (pct + price) |
| `tempest_iv` ✅ | SVX 1d/9d/30d/3m/6m (whole vol-points), IV rank/percentile, term slope, mean-reversion odds |
| `tempest_events` 📄 | next earnings + implied vs realized event move + VRP |
| `tempest_tilt` / `tempest_surface` / `tempest_term` / `tempest_snapshot` / `tempest_screener` 📄 | OTM call/put tilt · RR/butterfly/skew · term structure · all modules in one · screen the whole universe on vol readings |
Keying: S&P on **SPXW**, Nasdaq on **NDXP**.

### Flowseeker (direction/conviction confirmation) — supports doctrine §0 "charts first" with flow context
| Tool | Returns |
|---|---|
| `aggregate_score` ✅ | **Composite** directional score + VWF/SDF/FIR, `direction` (bullish/neutral/bearish), confidence, sweep alignment, per timeframe `1h,4h,1d,7d,30d,90d`; `date=` for history. 3 cr / 30 days summed |
| `chain_bull_bear` ✅ | bull/bear/neutral % with **call-buying vs put-selling split** (`callBullPct`, `putBullPct`) — tells real conviction from premium selling |
| `flow_momentum` ✅ | live 5m/30m/1h flow vs per-time-of-day baseline, z-scores, trend label |
| `market_tide` ✅ / `market_breadth` 📄 / `market_overview` 📄 | market-wide net call/put premium series · SPY/QQQ/IWM sentiment + A/D + sector rotation · day overview |
| `sweeps`, `flow_feed`, `flow_strikes`, `flow_tide`, `flow_aggregate`, `flow_baseline`, `flow_historical_compare` 📄 | sweeps w/ Flow Score · raw scored tape · strike concentration · per-ticker tide · window rollup · baseline · today vs 20-day |
| `vol_oi`, `unusual_oi`, `unusual_volume`, `moneyness`, `by_strike`, `chain_ratio`, `contract_ratio`, `contract_bull_bear` 📄 | accumulation · OI change · RVOL · moneyness buckets · strike distribution · bid/ask aggression (chain / contract) |
| `top_underlyings_daily/weekly`, `top_contracts_daily/weekly`, `list_active_underlyings`, `sector_flow` 📄 | universe screeners |
| `dark_pool_trades`, `dark_pool_top_prints` 📄 | off-exchange prints (levels, **directionless** — doctrine Section 1) |

### Options chain & real contract pricing (execution) — doctrine §8
| Tool | Returns |
|---|---|
| `expirations` ✅ | `{expiration, dte, contractCount, call/put premium+volume}` per expiry for a ticker + `date=` |
| `option_chain` ✅ | per strike call/put `lastPrice, iv, oi, volume, premium` + `underlyingPrice, maxPain`; `expiration` required; `date=` historical. 3 cr |
| `contract_history` ✅ | per trading day: `vwap, lastPrice, iv, underlyingPrice, totalVolume, openInterest, oiChange, askPct/bidPct/midPct, sweepPct, multiLegPct`. **Symbol format `TICKER__YYMMDDCSTRIKE`** (double underscore), needs `start_date` + `end_date` |
| `contract_chart` 📄 | **intraday** OHLC bars for one contract over a lookback |
| `contract_stats`, `contract_bulk_stats` (≤50), `contract_rvol` 📄 | daily contract stats, bulk, RVOL |
| `account_usage` ✅ | credits / $ balance |

---

## B. Skylit REST — same key
### Heatseeker `https://api.skylit.ai/v1/…`
| Endpoint | Cost | Notes |
|---|---|---|
| `GET /v1/heatmap?symbols=A,B&metric=gamma|vanna&expirations=` ✅ | 1 cr | REST twin of `heat_heatmap` |
| `GET /v1/gex/levels?symbols=` ✅ | 1 cr | REST twin of `heat_levels` |
| `GET /v1/historical?symbols=&at=<ISO>&metric=&maxStrikes=all&expirations=` ✅ | 5 cr | replay to 2023-03-28; `layout=matrix` option; `at=` must be a trading-day instant (weekend → `expiration_not_found`) |
| `GET /v1/historical/range` 📄 | 25 cr | ≤15 min window, ≤5 symbols |
| `GET /v1/stream?symbols=` 📄 | 1 cr/sym open + 1/sym/min | SSE live push, ≤10 sym |
| `GET /v1/stats/daily` 📄 | 5 cr | ≤50 sym × 31 d |
| `GET /v1/symbols`, `GET /v1/account` ✅ | free | coverage · balance |

### Tempest `https://api.skylit.ai/v1/vol/…` ✅ `sigma`, `iv`, `cones`, `derived`, `market` (same payloads as the MCP tools)

### Atlas (price) `https://atlas-api.skylit.ai/v1/history` ✅
`?symbol=SPY&resolution=1|60|D&from=<unix s>&to=<unix s>` → `{s:"ok", t[], o[], h[], l[], c[], v[], bv[], sv[], uv[]}`. Caps per request: 1-min = 90 trading days, 1-hour = 720, daily = 2600. Covers indices (SPX, SPY, QQQ) **and stocks** (AAPL, NVDA, MSFT, META, AMD, MU, GOOGL … verified). Shares the 120/min limit — 429 returns non-`ok`.

### Flowseeker REST `https://api.skylit.ai/v1/…` 📄 (alias `flow-api.skylit.ai`): `/flow/{t}`, `/flow/{t}/{aggregate,tide,baseline,momentum,strikes,historical-compare}`, `/sweeps/{t}`, `/aggregate/{t}`, `/vol-oi/{t}`, `/moneyness/{t}`, `/chain-bull-bear/{t}`, `/chain-ratio`, `/contract-ratio`, `/underlying/{top/daily,top/weekly,bulk/stats,{t}/stats,{t}/chart,{t}/trades,{t}/by-strike}`, `/market/{overview,tide}`, `/flow/market-breadth`.

---

## C. Unusual Whales REST — `https://api.unusualwhales.com/api/…` ✅ (new key `UNUSUAL_WHALES_API_KEY` in `.env`; 40K req/day)
Status: direct REST works with the rotated key. The claude.ai UW connector still holds the OLD token → 401; re-authorize it or ignore it.
| Endpoint | Returns |
|---|---|
| `/option-contract/{OCC}/intraday?date=` ✅ | **1-minute option OHLC** + premium/volume by side (bid/ask/mid), `iv_low/high`. OCC = `SPY260925C00768000` (no underscore). The real minute-level fill source for 0DTE. |
| `/option-contract/{OCC}/history` 📄 | daily OHLC per contract |
| `/stock/{t}/option-chains?date=` ✅ | all OCC symbols live on a date (3.5K for AAPL) |
| everything else in the UW public API (flow alerts, GEX by strike/expiry, spot exposures, dark pool, market tide, OHLC …) 📄 | optional — Skylit now covers flow; keep UW for **minute-level contract fills** and as a GEX fallback |

---

## D. Other inputs we already have wired
| Source | What | Status |
|---|---|---|
| **TradingView "Startup" indicators** (paid confluence suite) via CDP → real Chrome → `claude -p` vision tally (`scratchpad/tv_shots.py`, `tv_tally.py`) | the chart-side **direction trigger** (blue/green = buy, pink/purple = sell; Beginner ≥1/1 · Intermediate ≥2/3 · Master ≥5/9), recency-weighted | works; manual-ish; **charts-first candidate** |
| **Talon** (Skylit AI) via `app.skylit.ai` SSE (`/api/sse/ticket`, `talon_run`) + watchlists `POST/PUT /api/watchlists` | covered-universe structured setups (archetype / OTE / invalidation / R:R / AOI ladders) | works but needs a Clerk session (fragile, one consumer per session) — **second opinion only** |
| **FRED** (`FRED_API_KEY`) | macro series | available |
| `claude -p` headless | any LLM step (vision, ranking, narrative) on the subscription — **never the Anthropic API** | standing rule |

---

## E. Which API feeds which doctrine layer (the wiring map)
| Doctrine layer | Primary feed | Confirmation |
|---|---|---|
| §0 Charts first (price structure, S/R, trend/range, swing points, range edges, VWAP/EMA) | **Atlas `/v1/history`** (1-min + daily) | TradingView Startup tally |
| §1–§2 Map: king, floor, ceiling, gatekeepers, air pockets, midpoint | `heat_heatmap` (gamma, per expiry) + `heat_levels` summary (flip, walls) | — |
| §3 Regime (pos/neg/mixed) | `heat_heatmap` signed sum near spot; `heat_levels.summary.netExposure` | `tempest_market` regime word, VIX complex |
| §4 Day type (range / trend / whipsaw / rainbow) | regime + velocity (`velocityPct`) + Trinity alignment + air pockets | `tempest_sigma` (move budget), `tempest_cones` |
| §5 Patterns (rug / reverse rug / pika cloud / beach ball) | gamma board arrangement around spot (`heat_heatmap`) | vanna board (`metric: vanna`) for the vanna-flavored variants |
| §6 Living map: rolling floors/ceilings, velocity, lifecycle, delivery, growth-vs-decay | `heat_heatmap` sampled every N s (`velocityPct` + diffing frames) | `heat_historical_heatmap` for replay |
| §7 Trinity | one `heat_heatmap` / `heat_levels` call with `SPXW,SPY,QQQ` | `market_breadth` |
| §8 Execution: contract, real price, spread, stop/target in premium | `expirations` → `option_chain` (live) · UW `/intraday` (minute fills) · `contract_history` (daily fills) | `contract_ratio` aggression |
| Flow/conviction overlay (not a doctrine layer, a sanity check) | `aggregate_score`, `chain_bull_bear`, `flow_momentum`, `sweeps` | — |
