# Capital Flow Predictor — Project Status

A multi-agent sector-rotation prediction system that combines a quantitative XGBoost ranker over sector ETFs with a 21-agent LLM ensemble (analysts + famous-investor personas + synthesis layer) over individual stocks. Includes Unusual Whales options-flow integration, a live agent dashboard, and a streaming chat interface to talk to either the ensemble or any single persona.

---

## 1. Repository layout

Monorepo (uv Python workspaces + pnpm Turborepo).

```
apps/
  api/                       # FastAPI read API + chat + run endpoints
    Dockerfile               # uv-based multi-package install
    src/cfp_api/
      main.py                # CORS, lifespan, route registration
      routes/
        agents.py            # /v1/agents/* — full ensemble + run + status
        chat.py              # /v1/agents/{ticker}/chat/{ensemble|persona/X} (SSE)
        rankings.py          # /v1/rankings — XGB sector predictions
        sectors.py           # /v1/sectors — heatmap data
        watchlist.py         # /v1/watchlist — top sector × top names
      schemas.py             # Pydantic API contracts
      settings.py
  jobs/                      # CLI: ingestion, training, agent runs
    src/cfp_jobs/
      cli.py                 # `cfp-jobs <subcommand>`
      agents_runner.py       # ensemble orchestration + lazy data loading
      ingestion/
        prices.py            # yfinance (OHLCV)
        macro.py             # FRED (rates, spreads)
        fundamentals.py      # FMP (income/balance/cashflow/key/ratios)
        holdings.py          # yfinance ETF top-10 constituents
        fmp.py               # FMP HTTP client (incl. /profile)
        unusualwhales.py     # NEW — UW client + 7-table ingestion
      features.py            # cross-asset + sector feature pipeline
      train.py               # XGBoost rank baseline, walk-forward
      watchlist.py           # top-N sector × top-K constituent orchestrator
      migrate.py             # idempotent SQL migration runner
      settings.py            # env-derived config (incl. UW key)
  web/                       # Next.js 15 dashboard
    app/
      globals.css            # Robinhood-dark palette
      layout.tsx
      page.tsx               # / — sector heatmap
      watchlist/page.tsx
      agents/[ticker]/page.tsx
    components/
      ensemble-view.tsx      # /agents/[T] — Run button, live grid, chat sidebar
      chat-panel.tsx         # SSE streaming chat (ensemble or any persona)
      agent-card.tsx         # individual agent verdict card
      sector-heatmap.tsx
      watchlist-grid.tsx
      nav.tsx
      ui/                    # in-tree shadcn primitives (Card, Badge, etc.)
    lib/
      api.ts                 # fetch wrappers for every endpoint
      sse.ts                 # POST + SSE async generator (EventSource is GET-only)
      types.ts               # mirrors apps/api/.../schemas.py

packages/
  shared/                    # universe definitions (PREDICTION_TARGETS, FRED_SERIES)
  features/                  # pure functions: cross-asset, sector, panel, granger
  models/                    # XGBoost ranker + walk-forward + metrics
  agents/                    # the 21-agent ensemble
    src/cfp_agents/
      state.py               # AnalysisState (TypedDict, has flow_context)
      base.py                # BaseAnalyst, score_to_signal, clamp
      llm.py                 # LlmClient (Moonshot / Anthropic / no-op)
      graph.py               # LangGraph wiring (build_full_graph, etc.)
      analysts/
        technicals.py        # MA50/200, RSI, momentum, vol z-score
        fundamentals.py      # ROE/FCF/P/E rule-based
        sentiment.py         # STUB (no Reddit/StockTwits feed yet)
        news.py              # rule-based news scoring
        flow.py              # NEW — Unusual Whales flow rollup
      personas/
        base.py              # shared LLM-call plumbing
        buffett.py           # + insider-buy lens
        munger.py
        burry.py             # + short fee + LEAP froth lens
        druckenmiller.py     # + tape + dark pool + ETF flow lens
        cathie_wood.py
        taleb.py             # + tail strikes + dealer GEX lens
        damodaran.py
        graham.py
        ackman.py
        lynch.py
        fisher.py
        pabrai.py
        jhunjhunwala.py
        examples.py          # few-shot examples per persona
      synthesis/
        trader.py            # signal merge → direction + confidence
        risk_manager.py      # stop loss, sizing, veto (signed-stop coercion)
        portfolio_manager.py # final long/short/avoid decision

infra/
  migrations/
    0001_init.sql            # prices_daily, macro_daily, etf_flows_weekly, gex_daily, features_daily, predictions
    0002_lead_lag_matrix.sql # Granger lead-lag pairs
    0003_stock_universe.sql  # sector_holdings, fundamentals, agent_signals, watchlists
    0004_unusual_whales.sql  # NEW — uw_flow_alerts, uw_dark_pool_prints,
                             #       uw_net_prem_daily, uw_short_data,
                             #       uw_greek_exposure, uw_etf_flow,
                             #       uw_insider_transactions, uw_congress_trades
```

---

## 2. Data layer

### Postgres tables (Railway, vanilla — TimescaleDB extension is conditional)

| Table | Source | Cadence | Notes |
|---|---|---|---|
| `prices_daily` | yfinance | daily | OHLCV for ~150 tickers (sector ETFs + constituents) |
| `macro_daily` | FRED | daily | DGS10, DGS2, T10Y2Y, BAMLH0A0HYM2, DXY, etc. |
| `etf_flows_weekly` | yfinance | weekly | placeholder; UW flow lives in `uw_etf_flow` now |
| `gex_daily` | (placeholder) | — | superseded by `uw_greek_exposure` |
| `features_daily` | computed | daily | cross-asset + per-sector features as jsonb |
| `predictions` | XGB ranker | daily | (run_ts, symbol, horizon_d, model, score, rank, target_ts) |
| `lead_lag_matrix` | features pipeline | monthly | Granger pairs |
| `sector_holdings` | yfinance | quarterly | top-10 constituent per sector ETF |
| `fundamentals` | FMP | as-filed | long-format (ticker, fiscal_period, period_type, metric, value) |
| `agent_signals` | ensemble | per-run | per-(run_ts, ticker, agent) verdict + jsonb payload |
| `watchlists` | watchlist orchestrator | per-run | top sector × top names with PM rationale |
| `uw_flow_alerts` | UW `/stock/{T}/flow-alerts` | lazy + nightly | sweeps, blocks, repeated hits with full payload |
| `uw_dark_pool_prints` | UW `/darkpool/{T}` | lazy + nightly | tracking_id PK; deduped on upsert |
| `uw_net_prem_daily` | UW `/stock/{T}/net-prem-ticks` | lazy + nightly | aggregated minute tape → daily |
| `uw_short_data` | UW `/shorts/{T}/data` | lazy + nightly | shares available, fee rate, rebate |
| `uw_greek_exposure` | UW `/stock/{T}/greek-exposure` | lazy + nightly | call/put delta+gamma+charm+vanna |
| `uw_etf_flow` | UW `/etfs/{ETF}/in-outflow` | nightly | creation/redemption shares + premium |
| `uw_insider_transactions` | UW `/insider/transactions` | nightly | Form 4 with code (P/S/A/M/...) |
| `uw_congress_trades` | UW `/congress/recent-trades` | nightly | composite UNIQUE INDEX (politician + date + ticker + type + amounts) |

### External dependencies + env

| Env var | Source | Used by |
|---|---|---|
| `DATABASE_URL` | Railway Postgres | API + jobs |
| `FRED_API_KEY` | FRED (free) | macro ingestion |
| `FMP_API_KEY` | FMP (free 250/day) | fundamentals + ad-hoc `/profile` for sector lookup |
| `MOONSHOT_API_KEY` | api.moonshot.ai | LLM client (the 13 personas + chat synthesizer) |
| `LLM_PROVIDER` | env | `moonshot` (default) or `anthropic` |
| `UNUSUAL_WHALES_API_KEY` | UW $200/mo plan | UW client (must be set on Railway for live flow data) |
| `CORS_ORIGINS` | csv | Vercel domain for the dashboard |

---

## 3. The 21-agent ensemble

### Layer 1 — 5 analysts (rule-based, no LLM)

Run in parallel. Each emits a tri-state signal + confidence + structured payload.

| Analyst | Inputs | Signal logic |
|---|---|---|
| `technicals` | `prices_daily` | trend (close vs MA50/200), 20d momentum, RSI(14), volume z-score |
| `fundamentals` | `fundamentals` | ROE > 15%, FCF positive, debt/equity, valuation P/E + P/B |
| `sentiment` | — | STUB (no Reddit/StockTwits feed yet) — emits neutral with explicit "no data" rationale |
| `news` | — | rule-based news heuristic |
| `flow` (NEW) | UW tables via `flow_context` | net premium imbalance, LEAP-bucket positioning, ask-side aggression, dark-pool tone, insider net + squeeze flag |

The **flow analyst** is rule-based (no LLM). Reads a structured `flow_context` dict the runner builds per ticker via SQL aggregations:

```python
flow_context = {
  "options_flow": {alert_count_5d, net_call_premium_5d, net_put_premium_5d,
                   leap_call_premium_5d, leap_put_premium_5d,
                   call_at_ask_pct, put_at_ask_pct, top_trades: [...]},
  "dark_pool":    {prints_5d, premium_5d, above_vwap_pct},
  "positioning":  {short_shares_available, fee_rate, rebate_rate,
                   call_delta, put_delta, call_gamma, put_gamma, gex_total},
  "smart_money":  {insider_buys_30d, insider_sells_30d, insider_net_amount_30d,
                   congress_trades: [...]},
  "etf_context":  {sector_etf, in_flow_5d, n_days},
}
```

Score components (each ≈ -1..+1):
- `0.30 ·` LEAP-bucket call-vs-put premium imbalance (institutional positioning)
- `0.25 ·` total net call-vs-put premium imbalance (5d)
- `0.15 ·` ask-side aggressiveness (call_at_ask% − put_at_ask%)
- `0.15 ·` dark-pool above-VWAP fraction (institutional accumulation tone)
- `0.15 ·` insider net dollar amount, normalized

Confidence rises with magnitude AND number of corroborating sub-signals. If `fee_rate > 5%` AND `call_at_ask_pct > 0.6` AND `net_call_premium > 0`, sets `squeeze_flag=true` and bumps confidence by 0.15.

### Layer 2 — 13 famous-investor personas (LLM)

Run in parallel after analysts complete. Each is an LLM call (Moonshot v1-32k by default) with a persona-specific system prompt + a structured-output schema (`PersonaOutput`: signal, confidence, thesis, key_evidence, concerns).

| Persona | Lens | UW context surfaced (if available) |
|---|---|---|
| Buffett | quality + moats + owner earnings | **insider buys/sells 30d + net $** |
| Munger | mental models + great businesses | base context only |
| Burry | deep value + contrarian + hard catalysts | **short fee + insider sells + LEAP call premium (froth flag)** |
| Druckenmiller | top-down macro + tape | tape (technicals payload) + **dark pool + sector ETF flow + net option premium** |
| Cathie Wood | exponential growth + R&D | base context only |
| Taleb | tail risk + antifragility | volume z + **recent put strikes + dealer GEX regime** |
| Damodaran | valuation narrative + risk premia | base context only |
| Graham | margin of safety + quant rules | base context only |
| Ackman | concentrated activist + cash flow | base context only |
| Lynch | bucket classification (stalwart, fast grower, etc.) | base context only |
| Fisher | qualitative 15-point checklist | base context only |
| Pabrai | dhandho asymmetric payoffs | base context only |
| Jhunjhunwala | India-bias structural growth | base context only |

Personas marked **bold** above have custom `extra_context()` hooks that pull persona-specific UW slices into their user prompt. Other personas inherit the base prompt + see the analyst signals (which now include the `flow` analyst's structured rationale).

### Layer 3 — 3 synthesis nodes (LLM, sequential)

| Agent | Reads | Output |
|---|---|---|
| `trader` | all 21 prior signals | direction + confidence + thesis (`TraderDecision`) |
| `risk_manager` | trader + signals | target_weight, max_stop_loss, veto, regime_concern (`RiskAssessment`) |
| `portfolio_manager` | trader + risk | final long/short/avoid + target weight (`PortfolioDecision`) |

`max_stop_loss` field has a Pydantic `field_validator` that coerces signed deltas (`-0.10`) to magnitude (`0.10`) and clamps to `(0.005, 1.0]` — fixes a real LLM-output bug we saw on IREN.

### LangGraph topology (`build_full_graph`)

```
START
 ├──> technicals      ─┐
 ├──> fundamentals    ─┤
 ├──> sentiment       ─┼──> _analysts_done
 ├──> news            ─┤
 └──> flow            ─┘
                         ├──> buffett        ─┐
                         ├──> munger         ─┤
                         ├──> burry          ─┤
                         ├──> druckenmiller  ─┤
                         ├──> cathie_wood    ─┤
                         ├──> taleb          ─┤
                         ├──> damodaran      ─┼──> _personas_done
                         ├──> graham         ─┤
                         ├──> ackman         ─┤
                         ├──> lynch          ─┤
                         ├──> fisher         ─┤
                         ├──> pabrai         ─┤
                         └──> jhunjhunwala   ─┘
                                                 └──> trader → risk_manager → portfolio_manager → END
```

Total: **5 + 13 + 3 = 21 agents**. `EXPECTED_AGENT_COUNT_FULL = 21`.

---

## 4. The runner: `agents_runner.py`

### `run_analysts(database_url, ticker, sector="", *, include_personas=True)`
One-shot ensemble run. Writes 21 rows to `agent_signals` keyed by `run_ts`. Returns a summary dict.

### `run_analysts_streaming(database_url, ticker, sector="", *, run_ts, include_personas=True)`
Same logic but uses `graph.stream()` and writes each signal **as it lands**. The frontend polls per `run_ts` to render cards filling in live (~30-40s for the full ensemble).

### Lazy data loading (handles any ticker, not just universe constituents)
Three helpers run before `graph.invoke()`:

1. **`_ensure_prices(database_url, ticker)`** — if `prices_daily` is empty for this ticker, pull 1y from yfinance and upsert.
2. **`_ensure_fundamentals_and_sector(database_url, ticker, sector)`** — if `fundamentals` is empty AND `FMP_API_KEY` is set, fetch via `cfp_jobs.ingestion.fundamentals.ingest`. If `sector` was not provided, look it up via `FmpClient.profile(ticker)`. Returns `(fundamentals_df, resolved_sector)`.
3. **`_build_flow_context(database_url, ticker, sector)`** — if `UNUSUAL_WHALES_API_KEY` is set AND no UW data in last 24h, refresh via `cfp_jobs.ingestion.unusualwhales.ingest_ticker`. Then runs SQL aggregations to build the `flow_context` dict above.

This makes `/agents/IREN`-style runs work end-to-end even though IREN is not in the predictor universe.

---

## 5. API surface (FastAPI, prefix `/v1/`)

### Read

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/rankings?horizon=10&model=xgb_v1&limit=10` | XGB sector ranks |
| GET | `/v1/sectors?horizon=10&model=xgb_v1` | sector heatmap data |
| GET | `/v1/watchlist` | top sector × top constituents with PM rationale |
| GET | `/v1/agents/{ticker}` | latest ensemble run for a ticker (full 21 signals) |
| GET | `/v1/agents/{ticker}?run_ts=<ISO>` | specific run (used during live polling) |
| GET | `/v1/agents/{ticker}/timeline?agent=X&limit=30` | history of one agent on one ticker |
| GET | `/v1/agents/{ticker}/runs/{run_ts}` | run status: `{completed, expected_total, is_complete, signals[]}` |

### Write / Long-running

| Method | Path | Behavior |
|---|---|---|
| POST | `/v1/agents/{ticker}/run?sector=X` | Fire-and-forget ensemble. Returns `{run_ts, status, expected_total: 21}` immediately. Run continues in a thread; poll the `runs/{run_ts}` endpoint. |
| POST | `/v1/agents/{ticker}/chat/ensemble` | Streaming chat with the synthesizer (knows all 21 verdicts). SSE: `data: {type:"token"|"done"|"error", ...}\n\n`. |
| POST | `/v1/agents/{ticker}/chat/persona/{name}` | Streaming chat in-character with one of the 13 personas. Same SSE shape. |

### CORS

`allow_methods=["GET", "POST", "OPTIONS"]` (was GET-only — chat/run worked once this was fixed).

---

## 6. CLI: `cfp-jobs` (Typer)

```
cfp-jobs migrate                       # apply infra/migrations/*.sql idempotently
cfp-jobs backfill --years 5            # yfinance + FRED full backfill
cfp-jobs daily                         # last 7 days incremental
cfp-jobs holdings                      # ETF top-10 constituents (yfinance)
cfp-jobs fundamentals                  # FMP fundamentals for universe
cfp-jobs features-build                # cross-asset + sector feature pipeline
cfp-jobs features-daily                # incremental
cfp-jobs train-baseline                # XGBoost rank, walk-forward, persists predictions
cfp-jobs evaluate --horizon 10         # recompute metrics from latest predictions
cfp-jobs watchlist-build               # top sectors × top names → ensemble × PM
cfp-jobs watchlist                     # show latest watchlist
cfp-jobs analysts NVDA --personas      # run ensemble locally + print table
cfp-jobs lead-lag-build                # Granger pairs (monthly cadence)
cfp-jobs status                        # row counts + freshness per table

# Unusual Whales
cfp-jobs flow NVDA                     # all per-ticker UW endpoints (~6 calls)
cfp-jobs flow-etfs                     # in/out flow for all sector ETFs
cfp-jobs flow-congress --limit 500     # recent congressional trades
```

---

## 7. Frontend (Next.js 15 + React 19, deployed on Vercel)

### Pages

- `/` — sector heatmap, ranks 1..n with green→red gradient
- `/watchlist` — top sectors × top names with PM rationale
- `/agents/[ticker]` — full ensemble snapshot + Run button + sticky chat sidebar

### `/agents/[ticker]` — `EnsembleView` two-column layout

**Left column:**
- Header with **Run ensemble** pill button (kicks off `POST /run`), bullish/neutral/bearish counts
- Portfolio Manager headline card (final verdict, weight, thesis)
- Three sections of cards:
  - **Synthesis** — Trader, Risk Manager, Portfolio Manager (sequential outputs)
  - **Famous-investor personas** — 13 cards, populated as LLM calls return
  - **Quantitative analysts** — 5 cards (Technicals, Fundamentals, Sentiment, News, **Options Flow**)
- Pending agents (during a live run) render as dashed-border placeholders that say "thinking…" with a pulsing dot. As signals land via the 1.5s poll, cards swap to the populated `AgentCard` with a fade-in.

**Right column (sticky):**
- `ChatPanel`: dropdown to switch between **Ensemble synthesis** (default) and any of the 13 personas. Personas not present in the current run are disabled in the dropdown. Streams tokens via `parseSseStream` over `fetch + ReadableStream` (EventSource is GET-only). AbortController for the **Stop** button.

### Theme — Robinhood dark

- Pure-black background (`#000`)
- Card surface `~#141417` with hairline `~#222226` borders, no shadows, `rounded-2xl`
- Primary green `#00C805` (RH signature) for CTAs and bullish badges
- Bearish red `#FF5000` (RH orange-red, not crimson)
- Neutral grey `~#9c9ca5` (no neon yellow)
- Pill-shaped badges (`rounded-full`, uppercase, semibold)
- Pill CTAs and pill text inputs throughout (Run, Send, Open, ticker search)
- Tabular monospace numerics

### Lib

- `lib/api.ts` — typed fetch wrappers + `runEnsemble`, `getRunStatus`, `chatEnsemble`, `chatPersona`
- `lib/sse.ts` — async generator that splits a `Response` body on `\n\n`, parses `data:` lines, yields `ChatStreamEvent`s
- `lib/types.ts` — mirrors `apps/api/.../schemas.py`

---

## 8. Sector ranking model (XGBoost)

`packages/models/src/cfp_models/xgb_baseline.py`

- **Target**: forward-N-day relative strength vs SPY, where N ∈ {5, 10, 20}.
  `target = (etf[t+N]/etf[t] - 1) - (SPY[t+N]/SPY[t] - 1)`
- **Features**: per-ETF technicals (returns 1/5/10/20d, RSI(14), realized vol, volume z) + cross-asset macro (DXY, DGS10, 2s10s slope, HY credit spread, oil, BTC).
- **Model**: `xgb.XGBRanker` with `objective="rank:pairwise"`, `group=date`. Within each historical day, learns to ORDER sectors by predicted relative strength.
- **Validation**: walk-forward, evaluated with NDCG@5, IC, Sharpe, hit-rate.
- **Output**: `predictions(run_ts, symbol, horizon_d, model, score, rank, target_ts)`. `rank=1` = predicted strongest sector.

The agents run per-ticker — they do **not** reason at the sector level today. Sector reasoning is currently the XGB rank only (potential next step: feed UW ETF flow + LEAP-bucket aggregates as additional XGB features, or write a sector-narrative LLM call over the ranked list).

---

## 9. Deployment

| Service | Host | Build | Notes |
|---|---|---|---|
| Postgres | Railway | n/a | vanilla, TimescaleDB extension is optional (`DO $$` blocks) |
| API (FastAPI) | Railway | `apps/api/Dockerfile` (uv) | Auto-deploys from `main`. Bigger image now (~3-5 min) since it pulls cfp-agents + cfp-jobs for ensemble runs. |
| Web (Next.js) | Vercel | `pnpm --filter @cfp/web...` | Auto-deploys from `main`. |
| Repo | GitHub: `srathish/capital-flow-predictor` |

**Required Railway env vars:**
```
DATABASE_URL=postgresql://...railway.proxy/railway
FRED_API_KEY=...
FMP_API_KEY=...
MOONSHOT_API_KEY=...
LLM_PROVIDER=moonshot
UNUSUAL_WHALES_API_KEY=...     # rotate the one you've shared
CORS_ORIGINS=https://your-vercel-domain.vercel.app
```

**Required Vercel env vars:**
```
NEXT_PUBLIC_API_BASE_URL=https://capital-flow-predictor-production.up.railway.app
```

---

## 10. Recent commits (newest first)

```
19ce930  Wire Unusual Whales into the agent ensemble
5351add  Make ensemble work for any ticker, not just universe constituents
adf75ad  Fix CORS for chat/run + Robinhood dark theme
6d38dbb  Add live ensemble runs + persona/ensemble chat
4542bc0  Capital Flow Predictor — Phases 0 through 10
```

### What each fixed / added

**4542bc0 — Phases 0–10 baseline.** Monorepo scaffold, ingestion, features, XGB ranker, agent ensemble (4 analysts + 13 personas + 3 synthesis = 20), watchlist orchestrator, FastAPI read endpoints, Next.js dashboard. Initial Railway + Vercel deploys.

**6d38dbb — Live runs + chat.**
- `run_analysts_streaming` writes signals incrementally as each graph node finishes.
- `POST /v1/agents/{ticker}/run` fire-and-forget endpoint with task tracking.
- `GET /v1/agents/{ticker}/runs/{run_ts}` polling endpoint.
- `LlmClient.stream_chat` (async) for Moonshot + Anthropic.
- `POST /v1/agents/{ticker}/chat/{ensemble|persona/X}` SSE chat routes.
- Frontend Run button + live-polling card grid + sticky `ChatPanel`.
- Migrations: TimescaleDB extension calls wrapped in `DO $$` blocks for vanilla Railway Postgres compatibility.
- Dockerfile rewritten to install full uv workspace.

**adf75ad — CORS + Robinhood theme.**
- API CORS `allow_methods` was `["GET"]`, blocked POST preflight on chat/run. Now `["GET", "POST", "OPTIONS"]`.
- Repaint to Robinhood dark: pure-black bg, `#00C805` primary, `#FF5000` bearish, hairline borders, pill badges + CTAs.

**5351add — Any-ticker universe + persona prompt + Risk Manager fix.**
- Auto-fetch fundamentals from FMP when the ticker has no rows (`_ensure_fundamentals_and_sector`).
- Auto-resolve sector via FMP `/profile` when the API caller didn't pass one.
- Persona user prompt: dropped misleading "(sector ETF: X)" phrasing that was making personas hallucinate any unknown ticker as an ETF.
- When fundamentals are still missing, prompt now states **"this is a publicly traded operating company, do NOT assume it is an ETF"**.
- Risk Manager `max_stop_loss` field gets a `field_validator` that coerces signed deltas to magnitude — fixes a Pydantic 400 we saw on IREN where the LLM emitted `-0.5`.

**19ce930 — Unusual Whales deep wire.**
- New migration `0004_unusual_whales.sql`: 7 tables + indexes.
- `cfp_jobs.ingestion.unusualwhales.UwClient`: 8 endpoint wrappers, per-table upserts, raw payload preserved as jsonb.
- New CLI commands: `flow`, `flow-etfs`, `flow-congress`.
- New `flow` analyst node (5th analyst), rule-based score with squeeze flag.
- `_build_flow_context` runs SQL aggregations once per ensemble run, threads `flow_context` through `AnalysisState`.
- Lazy UW refresh: if no flow data in last 24h for a ticker, hit UW first.
- Persona `extra_context()` hooks updated:
  - **Burry**: short fee + insider sells + LEAP call froth
  - **Druckenmiller**: tape + dark pool + ETF flow + net premium
  - **Taleb**: recent put strikes + dealer GEX regime
  - **Buffett**: insider purchases (Buffett's lone non-fundamental signal)
- Frontend `EXPECTED` 20 → 21, `ANALYSTS` includes `"flow"`, `PRETTY_NAMES["flow"] = "Options Flow"`.
- API `ANALYST_NAMES` and `EXPECTED_TOTAL` updated.

---

## 11. Known issues / pending

- **`sentiment` analyst is still a stub.** Reddit / StockTwits / Trends ingestion has not landed. Currently emits neutral with `{"stub": true}`. Personas should treat it as no-data, not as a real neutral vote.
- **`news` analyst is rule-based**, not yet integrated with a real news feed.
- **No assistant chat (yet).** The user requested a top-level Vercel chat that uses tool-calling to orchestrate runs, navigate, fetch data. Not yet built. Plan: `POST /v1/assistant/chat` with Moonshot tool-use and an `assistant-dock.tsx` floating dock. (Decision: stay on Moonshot for the assistant, per user.)
- **No sector-narrative LLM** yet. The sector page shows ranks from XGB but no "why" narrative. Could feed UW ETF flow + LEAP-bucket aggregates as cross-asset XGB features OR add a 3-sentence narrative LLM call over the ranked list.
- **`gex_daily` table is unused** — superseded by `uw_greek_exposure`. Could be dropped.
- **`etf_flows_weekly` table is unused** — superseded by `uw_etf_flow`. Could be dropped.
- **Migration 0004 must be applied on Railway** before the UW tables exist:
  ```bash
  uv run cfp-jobs migrate
  ```
- **`UNUSUAL_WHALES_API_KEY` must be set on Railway** before the flow analyst gets real data. Without it the analyst emits `neutral` with rationale `"no Unusual Whales data ingested yet"`.
- **No tests for the UW client or flow analyst yet.** Existing tests cover prices/macro/holdings/fundamentals/watchlist + analysts/personas/synthesis.

---

## 12. Cost notes

- **Moonshot** (`moonshot-v1-32k` via OpenAI-compatible at `api.moonshot.ai`): ~$0.012-0.015 per 1k input tokens. A full 21-agent run is ~13 persona LLM calls + 3 synthesis LLM calls = 16 calls × ~3-5k tokens each ≈ **$0.18-0.30 per ticker**. The 5 analysts + flow scoring are deterministic Python, no LLM cost.
- **FMP**: free tier is 250 calls/day. Each fundamentals fetch is 5 calls (income/balance/cashflow/key/ratios). Plus 1 `/profile` per new ticker.
- **UW**: $200/month for 120 req/min, 80K req/day, 90-day history. We use ~6-7 calls per per-ticker `flow` command + 1 per ETF in `flow-etfs`.
- **Railway**: Postgres + the API service, ~$5-15/mo combined.
- **Vercel**: free tier covers the dashboard.

---

## 13. Quick test plan after deploy

1. Visit Vercel domain → `/agents/NVDA`.
2. Click **Run ensemble**. Watch the 21 cards fill in over ~30-40s. Verify:
   - All 5 analysts emit (technicals, fundamentals, sentiment-stub, news, flow).
   - `flow` card has real evidence (e.g. "$X LEAP call buying", "insiders 30d") if UW data is loaded; otherwise rationale says "no Unusual Whales data ingested yet".
   - All 13 personas land. Burry, Druck, Taleb, Buffett cite UW data points in `key_evidence` if `flow_context` is populated.
   - Trader → Risk Manager → Portfolio Manager all complete (no Pydantic validation errors on `max_stop_loss`).
3. Open the chat panel. Default = "Ensemble synthesis." Ask "what does the flow say about NVDA?" — synthesizer should cite the flow analyst's verdict + key trades.
4. Switch dropdown to "Michael Burry." Ask "would you short this?" — Burry should reason from his lens, citing short fee + LEAP froth if present.
5. Try a non-universe ticker like `IREN`. Verify that fundamentals auto-fetch from FMP, sector resolves from FMP `/profile`, and personas DO NOT call IREN an ETF.
