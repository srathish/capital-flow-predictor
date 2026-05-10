# Capital Flow Predictor — Project Status

A multi-agent sector-rotation prediction system. XGBoost ranker over sector ETFs + **23-agent** LLM ensemble over individual stocks (5 analysts + 13 famous-investor personas + 2 adversarial researchers + 3 synthesis nodes). Wired to Unusual Whales options flow, FMP fundamentals, FRED macro, yfinance prices, and Reddit chatter via Apewisdom. Live web dashboard with sector heatmap, force-directed correlation network, per-ticker price chart with flow markers, sortable holdings table per sector, **two ensemble views (grid v1 + Smallville office v2)**, chat panel.

Last updated: 2026-05-10 after commit `fd5fc9d` (Office v2 — agents render as little people; following the bull/bear researcher pair, 8 legacy persona prompt rewrites, and examples.py few-shot audit).

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
        agents.py            # /v1/agents/* — full ensemble + run + chart-data
        chat.py              # /v1/agents/{T}/chat/{ensemble|persona/X} (SSE)
        rankings.py          # /v1/rankings — XGB sector predictions
        sectors.py           # /v1/sectors heatmap + /v1/sectors/{etf}/holdings
        scorecard.py         # /v1/agents/scorecard + /scorecard/agreement
        network.py           # /v1/network/correlation — force-directed graph data
        reddit.py            # NEW — /v1/reddit/mentions + /v1/reddit/catalysts
        watchlist.py         # /v1/watchlist
      schemas.py
      db.py                  # asyncpg pool
      settings.py
  jobs/                      # CLI + ingestion + training
    src/cfp_jobs/
      cli.py                 # `cfp-jobs <subcommand>`
      agents_runner.py       # ensemble orchestration + EvidenceBundle assembly
      eval_agents.py         # daily forward-return evaluation
      ingestion/
        prices.py            # yfinance OHLCV
        macro.py             # FRED rates + spreads
        fundamentals.py      # FMP /stable/* (income/balance/cashflow/key/ratios)
        fmp.py               # shared FMP client incl. /profile
        holdings.py          # legacy yfinance ETF top-10
        unusualwhales.py     # 12 UW endpoints + per-table upserts + yfinance fallback
        reddit_apewisdom.py  # Apewisdom mentions per subreddit
        reddit_rss.py        # NEW — Reddit RSS catalyst-keyword ingester
      train.py               # XGBoost rank baseline (currently degenerate; see Known Issues)
      watchlist.py           # top-sector × top-name orchestrator
      migrate.py
  web/                       # Next.js 15 + React 19 + Tailwind 3
    app/
      globals.css            # Robinhood dark palette
      layout.tsx
      page.tsx               # / — sector heatmap
      sectors/[etf]/page.tsx # NEW — full constituent table sortable by 1d/5d/20d/60d return
      agents/[ticker]/page.tsx
      network/page.tsx       # NEW — force-directed sector correlation graph
      reddit/page.tsx        # NEW — Reddit mention browser (Apewisdom)
      catalysts/page.tsx     # NEW — Reddit catalyst-keyword post feed
      watchlist/page.tsx
    components/
      ensemble-view.tsx      # Run button, live grid, RH price header, chat sidebar
      price-chart.tsx        # NEW — TradingView lightweight-charts + flow markers
      sector-holdings-view.tsx # NEW — sortable constituent table
      sector-heatmap.tsx
      network-view.tsx       # NEW — react-force-graph-2d wrapper
      reddit-mentions-view.tsx # NEW — sortable mentions table
      catalysts-view.tsx       # NEW — keyword-filtered post feed
      chat-panel.tsx
      agent-card.tsx
      watchlist-grid.tsx
      nav.tsx                # Sectors / Network / Watchlist
      ui/
        card.tsx             # Borderless RH-style
        badge.tsx            # Pill SignalBadge
        confidence-bar.tsx
        skeleton.tsx
        time-range-tabs.tsx  # NEW — 1W/1M/3M/6M/1Y/ALL
        trend-pill.tsx       # NEW — ▲ +$X (+Y%) RH-style
        sparkline.tsx        # NEW — pure SVG sparkline for table rows
    lib/
      api.ts                 # typed fetch wrappers for every endpoint
      sse.ts                 # POST + SSE async generator for chat
      types.ts
      utils.ts

packages/
  shared/                    # Universe + EvidenceBundle Pydantic models
    src/cfp_shared/
      universe.py            # PREDICTION_TARGETS, FRED_SERIES, all_yfinance_symbols
      evidence.py            # NEW — EvidenceBundle + 12 sub-models
  features/                  # cross-asset + sector + Granger pairwise
  models/                    # XGBoost ranker + walk-forward + metrics
  agents/                    # The 21-agent ensemble
    src/cfp_agents/
      state.py               # AnalysisState (TypedDict) — now has `evidence`
      base.py                # BaseAnalyst, score_to_signal, clamp
      bundle_compute.py      # NEW — pure-function PriceContext / FundamentalsCtx
      llm.py                 # LlmClient (Moonshot/Anthropic) + PersonaOutput w/ hedge_justification
      graph.py               # LangGraph wiring (5 + 13 + 3 = 21 nodes)
      analysts/
        flow.py              # NEW — Unusual Whales options + dark pool + insider rollup
        technicals.py        # Reads bundle.price_context now
        fundamentals.py
        sentiment.py         # NEW — Reddit chatter via Apewisdom
        news.py              # NEW — UW news headlines with sentiment tags
      personas/
        base.py              # Renders raw bundle fields, NO analyst conclusions in prompt
        buffett.py           # + insider-buy lens
        burry.py             # + short fee + LEAP froth + Reddit froth lens
        druckenmiller.py     # + tape + dark pool + ETF flow lens
        taleb.py             # + tail strikes + GEX regime lens
        soros.py             # NEW — reflexivity, with Reddit stage indicator
        simons.py            # NEW — pure quant
        klarman.py           # NEW — special situations + DCF margin-of-safety floor
        greenblatt.py        # NEW — Magic Formula score + spinoff/event keyword scan
        minervini.py         # NEW — VCP / Stage 2 momentum
        cathie_wood.py
        damodaran.py         # + computed DCF intrinsic value via tools.dcf
        lynch.py
        ackman.py
        examples.py
      synthesis/
        trader.py
        risk_manager.py      # max_stop_loss validator coerces signed -> abs
        portfolio_manager.py
      tools/                 # NEW — pure-function tools personas can call
        dcf.py               # Two-stage DCF
        magic_formula.py     # earnings-yield x ROIC joint score

infra/
  migrations/
    0001_init.sql            # prices_daily, macro_daily, etf_flows_weekly, gex_daily, features_daily, predictions
    0002_lead_lag_matrix.sql # Granger lead-lag pairs
    0003_stock_universe.sql  # sector_holdings, fundamentals, agent_signals, watchlists
    0004_unusual_whales.sql  # 7 UW tables (flow_alerts, dark_pool, net_prem, short, greek_exposure, etf_flow, insider, congress)
    0005_unusual_whales_v2.sql # uw_stock_info, uw_oi_change, uw_news, uw_earnings
    0006_run_evidence.sql    # Bundle persistence per (run_ts, ticker)
    0007_agent_eval.sql      # Forward-return tracking for per-persona scorecard
    0008_uw_etf_holdings.sql # Full constituent list (UW with yfinance fallback)
    0009_reddit_mentions.sql # Apewisdom snapshots per subreddit
    0010_reddit_posts.sql    # Reddit RSS catalyst-keyword posts (GIN tickers/keywords)
```

---

## 2. Data layer

### Postgres tables on Railway (vanilla — TimescaleDB optional)

| Table | Source | Cadence | Notes |
|---|---|---|---|
| `prices_daily` | yfinance | daily | OHLCV for ~150 tickers |
| `macro_daily` | FRED | daily | DGS10, DGS2, T10Y2Y, BAMLH0A0HYM2, DXY, etc. |
| `features_daily` | computed | daily | cross-asset + per-sector features as jsonb |
| `predictions` | XGB ranker | daily | rank column currently degenerate (training bug — see Known Issues) |
| `lead_lag_matrix` | features pipeline | monthly | Granger pairs |
| `sector_holdings` | yfinance (legacy) | quarterly | superseded by uw_etf_holdings |
| `fundamentals` | FMP | as-filed | long-format (ticker, fiscal_period, period_type, metric, value) |
| `agent_signals` | ensemble | per-run | per-(run_ts, ticker, agent) verdict + jsonb payload |
| `watchlists` | watchlist orchestrator | per-run | top sector × top names |
| `run_evidence` | ensemble | per-run | full bundle JSON + denormalized type/sector/earnings cols |
| `agent_eval` | eval-agents job | nightly | forward returns + hits per agent per (run_ts, ticker) |
| `uw_flow_alerts` | UW `/stock/{T}/flow-alerts` | lazy + nightly | sweeps, blocks, repeated hits |
| `uw_dark_pool_prints` | UW `/darkpool/{T}` | lazy + nightly | tracking_id PK |
| `uw_net_prem_daily` | UW `/stock/{T}/net-prem-ticks` | lazy + nightly | aggregated minute tape → daily |
| `uw_short_data` | UW `/shorts/{T}/data` | lazy + nightly | shares available + fee + rebate |
| `uw_greek_exposure` | UW `/stock/{T}/greek-exposure` | lazy + nightly | daily call/put delta+gamma+charm+vanna |
| `uw_etf_flow` | UW `/etfs/{ETF}/in-outflow` | nightly | creation/redemption shares + premium |
| `uw_insider_transactions` | UW `/insider/transactions` | nightly | Form 4 with code (P/S/A/M/...) |
| `uw_congress_trades` | UW `/congress/recent-trades` | nightly | composite UNIQUE INDEX |
| `uw_stock_info` | UW `/stock/{T}/info` | lazy 7d TTL | sector + industry + name + next earnings |
| `uw_oi_change` | UW `/stock/{T}/oi-change` | lazy + nightly | OI delta per option chain — joins to flow alerts for stickiness |
| `uw_news` | UW `/news/headlines` | lazy + nightly | sentiment-tagged headlines with multi-ticker GIN index |
| `uw_earnings` | UW `/earnings/{T}` | lazy + nightly | calendar + expected_move + post-earnings reactions |
| `uw_etf_holdings` | UW `/etfs/{ETF}/holdings` (yfinance fallback) | nightly | full constituent list with per-name pricing + options sentiment |
| `reddit_mentions` | Apewisdom | daily snapshot | per-ticker per-subreddit mention counts + upvotes + 24h-ago rank |
| `reddit_posts` | Reddit RSS | every 30 min | catalyst-keyword posts (GIN tickers + keywords); 7d retention; powers /catalysts |

### External keys + env vars

| Env var | Source | Used by |
|---|---|---|
| `DATABASE_URL` | Railway Postgres | API + jobs |
| `FRED_API_KEY` | FRED (free) | macro |
| `FMP_API_KEY` | FMP free 250/day (paid for full coverage) | fundamentals + /profile |
| `MOONSHOT_API_KEY` | api.moonshot.ai | LLM personas + chat synthesizer |
| `LLM_PROVIDER` | env | `moonshot` (default) or `anthropic` |
| `UNUSUAL_WHALES_API_KEY` | UW $200/mo | UW client |
| `CORS_ORIGINS` | csv | Vercel domain |

---

## 3. The 23-agent ensemble

### EvidenceBundle architecture (Phase A)

Built once per run by `agents_runner.build_evidence_bundle`, persisted to `run_evidence`, threaded through `AnalysisState["evidence"]`. Every agent reads from the same canonical source — personas no longer have ad-hoc DB queries. Personas read RAW bundle fields, NOT analyst conclusions (de-anchoring fix).

```python
EvidenceBundle:
  schema_version: "1.0"
  run_ts: datetime
  instrument: Instrument               # ticker, type, company_name, sector, industry, marketcap_size, next_earnings_date
  price_context: PriceContext          # last_close, MA50/200 dist, RSI(14), 5/20/60d returns, RV20, vol z
  fundamentals: FundamentalsCtx        # revenue, market_cap, ROE, ROIC, FCF, D/E, P/E, P/B, gross/net margin
  options_flow: OptionsFlowCtx         # 5d net premium, LEAP imbalance, ask-side %, sticky_pct, top_trades
  dark_pool: DarkPoolCtx               # prints_5d, premium_5d, above_vwap_pct
  positioning: PositioningCtx          # short fee, GEX (call/put delta+gamma+charm+vanna)
  smart_money: SmartMoneyCtx           # insider 30d net + buys/sells, congress trades
  catalysts: CatalystCtx               # next earnings + days_to_earnings + earnings_proximity, news_5d
  etf_context: EtfContextCtx           # parent sector ETF flow
  reddit: RedditCtx                    # mentions_today, 7d_avg, spike_ratio, rank_today, is_contrarian_warning, is_stealth, by_subreddit
  market_regime: MarketRegimeCtx       # reserved for Tier 2 — VIX, breadth, FOMC proximity
  vol_surface: VolSurfaceCtx           # reserved for Tier 2 — IV skew, gamma flip
  sector_context: SectorContextCtx     # reserved for Tier 2 — XGB rank, peer relative strength
```

### Layer 1 — 5 analysts (rule-based, no LLM)

| Analyst | Reads | Logic |
|---|---|---|
| `technicals` | bundle.price_context | trend (MA dist), 20d momentum, RSI, vol z |
| `fundamentals` | state.fundamentals (long DataFrame) | rev CAGR, ROE, FCF growth, D/E, P/E |
| `sentiment` | bundle.reddit | mention spike, asymmetry flags (capped conf 0.4 — confluence layer) |
| `news` | bundle.catalysts.news_5d | weighted sentiment (is_major 2x), top headline cited |
| `flow` | bundle.options_flow + dark_pool + positioning + smart_money + catalysts | LEAP imbalance, OI stickiness, earnings-proximity dampening |

### Layer 2 — 13 famous-investor personas (LLM)

Roster designed for orthogonal signal (Phase B). Dropped from prior roster: Munger, Pabrai, Fisher, Graham, Jhunjhunwala (overlap or wrong region).

**Phase B+ prompt audit (2026-05-09 → 2026-05-10):** all 13 personas now follow the same template — voice quote, `Hard exclusions — you would NEVER` block, explicit `Your bar` line, persona-specific REQUIRED output field in the thesis, and an `Output-distribution expectation` replacing the weak "Be decisive" closer. The 5 newer personas (Soros/Simons/Klarman/Greenblatt/Minervini) were the original template; the 8 legacy personas (Buffett/Burry/Druck/Taleb/Cathie/Damodaran/Lynch/Ackman) were rewritten in `47a6113` + `a48afa5`. `examples.py` few-shots also re-tuned: removed two 0.55-conf hedged-middle anchors (Buffett, Damodaran), added two low-conviction "pass" anchors (Buffett 0.25, Burry 0.20) so personas learn that pass IS an output mode.

| Persona | Lens highlights | Tools | Required thesis field |
|---|---|---|---|
| Buffett | quality + moats + insider purchases | — | owner-earnings yield + moat assessment |
| Burry | deep value short / froth flag (LEAP calls + WSB top-20 + short fee) | — | discount-to-tangible + named catalyst window |
| Druckenmiller | macro + tape + dark pool + sector ETF flow | — | macro regime + tape confirms/denies |
| Taleb | tail strikes + dealer GEX regime | — | fragile / robust / antifragile + tail driver |
| Soros | reflexivity stage from Reddit rank + spike | — | reflexive cycle stage (1-5) |
| Simons | pure quant — feature vector ONLY (refuses narrative) | — | probability statement + ≥2 measurable features |
| Klarman | special situations + insider buys + conservative DCF | tools.dcf (11% WACC) | mispricing in $ + specific catalyst |
| Greenblatt | Magic Formula joint score + event-driven keywords | tools.magic_formula | earnings yield + ROIC vs universe OR event |
| Minervini | VCP / Stage 2 / momentum leadership | — | stage assessment + tape setup name |
| Cathie Wood | secular growth + R&D | — | disruption curve + technology platform + TAM |
| Damodaran | DCF intrinsic value | tools.dcf (9% WACC) | implied story behind current price + credibility |
| Lynch | bucket classification + PEG | — | which of 6 buckets + bucket-appropriate math |
| Ackman | concentrated activist + cash flow + dark pool | — | specific catalyst + sizing decision |

### Layer 2.5 — 2 adversarial researchers (LLM, parallel) — NEW

After all 18 analyst+persona signals land, two researchers run in parallel and are each FORCED to take an assigned side:

| Researcher | Job |
|---|---|
| `bull_researcher` | Construct the strongest LONG case from the bundle + 18 signals, even if consensus is bearish. Cite specific evidence, name supporting personas, pre-empt the bear's strongest objection. Returns `ResearcherOutput { thesis, key_evidence[3-5], supporting_personas[], counter_argument, conviction }`. |
| `bear_researcher` | Same shape, opposite side. |

The Trader then ADJUDICATES between the two briefs instead of consuming all 18 raw votes. Pattern from TradingAgents 2024 — forces structural disagreement into the pipeline so a 14-bull / 7-bear split doesn't collapse into a confident long without anyone seriously articulating the short. `Trader.build_user_prompt` consumes the briefs as primary input and provides the raw signals only for citation verification.

### Layer 3 — 3 synthesis nodes (LLM, sequential)

`trader → risk_manager → portfolio_manager`. Risk Manager has a Pydantic `field_validator` that coerces signed `max_stop_loss` to magnitude (fixes a real LLM-output bug seen on IREN).

### Conviction enforcement (Phase C)

`PersonaOutput` has a new `hedge_justification: str` field + `model_validator` that rejects `confidence ∈ [0.40, 0.60]` without ≥30-char justification naming the specific bull-side AND bear-side evidence that would flip the call. Lazy 0.5-confidence answers are now expensive — most LLMs find it easier to just pick a side.

---

## 4. The runner: `agents_runner.py`

### Lazy data loading (handles any ticker)

Before `graph.invoke()`:

1. **`_ensure_prices`** — yfinance fallback if `prices_daily` empty.
2. **`_ensure_fundamentals_and_sector`** — FMP fallback if `fundamentals` empty + sector lookup via FMP `/profile`. Falls back further to **`_yfinance_fundamentals_fallback`** (yfinance `.info`) when FMP returns 402 (small-mid caps and ADRs on FMP's paid tier). Maps fields like `totalRevenue`, `marketCap`, `returnOnEquity`, `debtToEquity`, `profitMargins` to our long-format metric names with percent-form normalization.
3. **`_resolve_instrument`** — UW `/stock/{T}/info` primary, FMP `/profile` fallback. 7-day TTL.
4. **`build_evidence_bundle`** — assembles all sub-contexts from DB. Lazy refreshes UW data when stale (>24h).
5. **`persist_evidence`** — writes `run_evidence(run_ts, ticker, bundle_json)`.

### Run modes

| Function | Use |
|---|---|
| `run_analysts(...)` | One-shot full run (LangGraph `.invoke()`) |
| `run_analysts_streaming(...)` | Streams signals as each node lands (for live UI polling) |

`EXPECTED_AGENT_COUNT_FULL = 5 + 13 + 2 + 3 = 23`. The streaming runner persists `bull_research`, `bear_research`, `trader_decision`, `risk_assessment`, and `portfolio_decision` keys to `agent_signals` as each node completes — frontend polls every ~1.5s and watches the row count climb to 23.

---

## 5. API surface (FastAPI, prefix `/v1/`)

### Read

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/rankings?horizon=10` | XGB sector ranks |
| GET | `/v1/sectors?horizon=10` | sector heatmap |
| GET | `/v1/sectors/{etf}/holdings?sort=return_5d` | full constituent table sortable by 1d/5d/20d/60d/weight/call_put_ratio/bullish_pct/vol_z |
| GET | `/v1/watchlist` | top sector × top names |
| GET | `/v1/agents/{ticker}` | latest run with PM-complete (auto-skip incomplete runs) |
| GET | `/v1/agents/{ticker}?run_ts=<ISO>` | specific run |
| GET | `/v1/agents/{ticker}/timeline?agent=X` | one-agent history |
| GET | `/v1/agents/{ticker}/runs/{run_ts}` | live polling status |
| GET | `/v1/agents/{ticker}/chart-data?days=180` | OHLCV bars + flow/insider/earnings markers |
| GET | `/v1/agents/scorecard?horizon=20` | per-agent hit rate, IC, regime breakdown |
| GET | `/v1/agents/scorecard/agreement?horizon=20` | pairwise agreement matrix |
| GET | `/v1/network/correlation?window=60&min_correlation=0.7&horizon=10` | force-directed graph nodes + edges |
| GET | `/v1/reddit/mentions?sort=mentions&limit=50` | top tickers by chatter, with 7d sparkline + per-subreddit + asymmetry flags |
| GET | `/v1/reddit/catalysts?hours=48&min_score=0.05&ticker=INTC` | ranked Reddit posts mentioning ticker + catalyst keyword |

### Write / Long-running

| Method | Path | Behavior |
|---|---|---|
| POST | `/v1/agents/{ticker}/run` | Fire-and-forget ensemble. Returns `{run_ts, status, expected_total: 21}`. |
| POST | `/v1/agents/{ticker}/chat/ensemble` | SSE chat with synthesizer. |
| POST | `/v1/agents/{ticker}/chat/persona/{name}` | SSE chat with one of 13 personas. |

CORS: `["GET", "POST", "OPTIONS"]`.

---

## 6. CLI: `cfp-jobs` (Typer)

```
cfp-jobs migrate                       # apply infra/migrations/*.sql idempotently
cfp-jobs backfill --years 5            # yfinance + FRED full history
cfp-jobs daily                         # last 7 days incremental
cfp-jobs holdings                      # legacy yfinance ETF top-10
cfp-jobs fundamentals                  # FMP fundamentals for universe
cfp-jobs features-build                # cross-asset + sector features
cfp-jobs train-baseline                # XGBoost rank, walk-forward
cfp-jobs evaluate --horizon 10
cfp-jobs watchlist-build               # top sectors × top names → ensemble × PM
cfp-jobs analysts NVDA --personas      # local ensemble run
cfp-jobs lead-lag-build                # Granger pairs (monthly)
cfp-jobs status                        # per-table row counts + freshness

# Unusual Whales
cfp-jobs flow NVDA                     # all per-ticker UW endpoints (~8 calls)
cfp-jobs flow-etfs                     # ETF in/out flow (legacy)
cfp-jobs flow-holdings                 # full holdings via UW (yfinance fallback for ETFs UW doesn't index)
cfp-jobs flow-congress                 # recent congress trades

# Reddit
cfp-jobs reddit                        # Apewisdom mention snapshot (all subreddits, top 150)
cfp-jobs reddit-catalysts              # RSS catalyst-keyword post ingest (run every 30 min)

# Eval
cfp-jobs eval-agents [--lookback 90]   # forward returns -> agent_eval (run daily)
```

---

## 7. Frontend (Next.js 15 + React 19)

### Pages

| Path | What |
|---|---|
| `/` | Sector heatmap (XGB ranks → green→red gradient). Tiles link to /sectors/{etf}. |
| `/sectors/[etf]` | Full constituent table — 73 NVDA/AAPL/MSFT-style holdings for XLK, sortable by 1d/5d/20d/60d return, weight, call/put ratio, bullish %, etc. Click ticker → /agents/{T}. |
| `/agents/[ticker]` | (v1, default) Two-column ensemble view: chart + 23-agent grid + sticky chat sidebar. v1↔v2 toggle pill in header. |
| `/agents/[ticker]/v2` | (v2, NEW) Smallville office view — top-down 16:9 floor plan with 5 named rooms (Analyst Pit, Persona Hall, Bull Office, Bear Office, Synthesis Desk). 23 agents render as little people (emoji head + signal-colored shirt + stubby legs + initials nameplate), wandering inside their rooms via random target updates every ~3s with smooth CSS transitions. Shirt color = signal (green/red/gray/pulsing-blue for thinking). Hover = speech bubble; click = full-detail panel below. |
| `/network` | Force-directed sector correlation graph. Min-corr slider, window/horizon dropdowns. |
| `/reddit` | Top tickers from Apewisdom: sortable by mentions / spike / climbing fastest, per-row sparkline + per-subreddit + asymmetry chips. |
| `/catalysts` | Reddit posts mentioning a known ticker AND a catalyst keyword. Window + score + ticker filters. |
| `/watchlist` | Top sectors × top names with PM rationale. |

### `/agents/[ticker]` layout

- **Header**: big bold price (e.g. `$215.24`), ▲ change pill below, RH-style. Bullish/neutral/bearish counts. Run-ensemble pill button.
- **Left**: TradingView lightweight-charts (OHLCV + MA50/MA200 + volume + arrow markers for >$1M flow alerts, insider buys/sells, earnings dates). Time-range tabs 1W/1M/3M/6M/1Y/ALL refetch the chart-data endpoint. Then PM headline card. Then 3 sections of agent cards (synthesis, personas, analysts) with dashed-border placeholders during a live run.
- **Right** (sticky): `ChatPanel` — dropdown to pick ensemble or any of 13 personas, SSE token streaming with stop button.

### `/network` layout

- Min-correlation slider (floor 0.50, default 0.70 — sectors are highly intercorrelated, anything lower reads as noise).
- Window dropdown (30/60/90/180d), Horizon dropdown (5/10/20d).
- Force-directed graph (`react-force-graph-2d`):
  - Node color: green leaders / orange laggards / gray mid (from realized return until XGB rank bug is fixed)
  - Node size ∝ rank (top biggest)
  - Edge width ∝ |correlation|, white for positive r, orange for negative
  - Stronger d3 charge force (-380), shorter link distance (80), zoomToFit on engine-stop
  - Labels render at fixed 11px screen size regardless of zoom (was ballooning at low globalScale)
- Hover → sector detail tooltip; click → `/sectors/{etf}`; drag → reposition.

### Theme — Robinhood dark

- Pure-black background (`#000`)
- Card surface `~#141417`, **borderless** (separation by bg contrast, not strokes)
- Primary green `#00C805`, bearish red `#FF5000`, neutral grey `~#9c9ca5`
- Pill badges (`rounded-full`, uppercase, semibold)
- Pill CTAs + pill text inputs throughout
- Tabular monospace numerics

### UI primitives (in-tree, `components/ui/`)

`Card`, `Badge`, `SignalBadge`, `ConfidenceBar`, `Skeleton`, `TrendPill` (▲ +$X (+Y%)), `TrendInline`, `TimeRangeTabs`, `Sparkline` (pure SVG).

---

## 8. Sector ranking model (XGBoost)

`packages/models/src/cfp_models/xgb_baseline.py`

- **Target**: forward-N-day relative strength vs SPY, N ∈ {5, 10, 20}
- **Features**: per-ETF technicals + cross-asset macro (DXY, DGS10, 2s10s, HY spread, oil, BTC)
- **Model**: `xgb.XGBRanker`, `objective="rank:pairwise"`, group=date
- **Output**: `predictions(run_ts, symbol, horizon_d, model, score, rank, target_ts)`

**Known issue (open):** `predictions.rank` column is currently degenerate — every row is rank=1 across the universe. Network endpoint works around this by re-ranking by `score` server-side, then falling back to realized return when scores are also degenerate. Real fix is in the training loop.

---

## 9. Eval scaffolding (Phase D)

`agent_eval` table tracks forward returns (5/10/20/60d vs SPY) for every `agent_signals` row ≥5d old. Daily `cfp-jobs eval-agents` job. After 60+ days of data, the scorecard endpoint surfaces:

- Per-agent hit rate, IC (signed-confidence vs forward-return correlation), avg forward return
- Bull/bear/chop regime breakdown
- Pairwise agreement matrix → flag persona pairs with agreement >0.85 (one is redundant)

Eventual feedback loop: synthesizer's prompt receives per-persona historical hit rate by regime so it can weight personas by track record.

---

## 10. Deployment

| Service | Host | Build |
|---|---|---|
| Postgres | Railway | vanilla, TimescaleDB optional |
| API (FastAPI) | Railway | `apps/api/Dockerfile` (uv) — auto-deploys from `main` |
| Web (Next.js) | Vercel | `pnpm --filter @cfp/web...` — auto-deploys from `main` |
| Repo | GitHub: `srathish/capital-flow-predictor` |

**Required Railway env vars:**
```
DATABASE_URL=postgresql://...
FRED_API_KEY=...
FMP_API_KEY=...
MOONSHOT_API_KEY=...
LLM_PROVIDER=moonshot
UNUSUAL_WHALES_API_KEY=...     # rotate the chat-shared one
CORS_ORIGINS=https://your-vercel-domain.vercel.app
```

**Required Vercel env vars:**
```
NEXT_PUBLIC_API_BASE_URL=https://capital-flow-predictor-production.up.railway.app
```

---

## 11. Recent commits (newest first, current session)

```
fd5fc9d Office v2: render agents as little people (head + torso + legs)
89545a6 Fix CI: drop unused noqa: ARG002 in trader.to_signal
a48afa5 Rewrite 7 legacy personas to new template (Burry/Druck/Taleb/Cathie/Damodaran/Lynch/Ackman)
47a6113 Persona prompts audit: rewrite Buffett to template, fix examples.py anchors
3de35cc Office v2.0: Smallville-style top-down agent visualization
339c8f3 Bull/bear researcher pair before trader + UI scaffolding
f7a220d Flow analyst: clearer rationale + tighter scoring
c1deed3 yfinance fundamentals fallback + /reddit page + /catalysts page
db865cf Network: fix label-balloon + tighter zoom
720634e Reddit sentiment via Apewisdom + network busy-fix
b7202bd Network: fix horizon=20 422 — Literal[int] doesn't coerce string query params
f85aae2 Network: size nodes by rank (matches spec) + caption tweaks
fb32be9 Network: silence SIM108
275567b Network: sector correlation graph (force-directed)
8c738b2 Fix sector-holdings weight display: don't double-multiply by 100
89601cf yfinance fallback for ETFs UW doesn't index
02acfb6 Phase 5: Price chart + sector detail page + DCF tools
a513678 Phase D: Eval scaffolding — agent_eval + scorecard endpoint
9b81fe2 Phase C: Conviction enforcement via hedge_justification validator
1e8f686 Phase B: Roster swap for orthogonal signals
a62cec4 Phase A: EvidenceBundle architecture + lens-based personas
b3b89b1 Tier 1A: instrument frame + UW info/oi-change/news/earnings + status doc
adf75ad Fix CORS for chat/run + Robinhood dark theme
6d38dbb Add live ensemble runs + persona/ensemble chat
4542bc0 Capital Flow Predictor — Phases 0 through 10
```

Highlights (reverse chronological):

- **Office v2 — agents as little people (`fd5fc9d`)** — replaced colored-disc agents with character composites: emoji head + signal-colored torso "shirt" + stubby legs + initials nameplate. Persona emojis swapped from objects (drum/globe/abacus) to face emojis (👴 Buffett, 🥸 Burry, 🤵 Druck, 🧔 Taleb, 🤓 Greenblatt, 👩‍💻 Cathie, 👨‍⚖️ Ackman, etc.).
- **Office v2.0 — Smallville-style ensemble visualization (`3de35cc`)** — new `/agents/[T]/v2` route. Top-down 16:9 floor plan with 5 named rooms. 23 agents wander inside their assigned room via random target updates. v1↔v2 toggle pill in both views. Same data layer as v1 so live runs stream into either interchangeably.
- **Bull/bear researcher pair (Phase 1, `339c8f3`)** — two adversarial researchers run in parallel after personas. Each forced to take its assigned side and produce a structured brief (thesis + key_evidence + supporting_personas + counter_argument + conviction). Trader then ADJUDICATES between the two briefs instead of consuming all 18 raw votes. Pattern from TradingAgents 2024. Total ensemble: 21 → 23 agents.
- **Persona prompts audit (`47a6113` + `a48afa5`)** — rewrote all 8 legacy persona system prompts (Buffett/Burry/Druck/Taleb/Cathie/Damodaran/Lynch/Ackman) to the structural template established by the 5 newer personas: real voice quote, hard-exclusions block, explicit "Your bar" line, persona-specific REQUIRED output field, output-distribution prior replacing "Be decisive." `examples.py` few-shots also re-tuned — removed two 0.55-conf hedged-middle anchors (Buffett, Damodaran were directly contradicting the conviction-rule validator) and added two low-conviction "pass" anchors (Buffett 0.25, Burry 0.20) so personas learn pass IS an output mode.
- **Flow analyst tightening (`f7a220d`)** — added `_fmt_signed_dollars` so puts -$2.6M (selling, bullish) is visually distinct from puts +$2.6M (buying, bearish). Tightened stickiness multiplier to [0.3, 1.7]; tightened neutral_band to 0.08; bumped confidence multiplier so meaningful scores produce meaningful confidence floors.
- **`/reddit` + `/catalysts` pages + yfinance fundamentals fallback** — `/reddit` browses Apewisdom mention rankings with sortable spike/rank-change/per-subreddit. `/catalysts` is the Reddit RSS catalyst-keyword feed (Phase B) — picks up posts mentioning a known ticker AND a catalyst keyword (partnership, leak, FDA, acquisition, beat, guidance, insider…). Verified live with the INTC/MBLY partnership chatter as the top hit. yfinance `.info` fallback fills the FMP gap so IREN-style names get real fundamentals (revenue, ROE, margins, P/E, etc.).
- **Reddit sentiment via Apewisdom** — replaces stub. RedditCtx in bundle. Asymmetry flags (`is_contrarian_warning` for late chatter, `is_stealth` for institutional setups nobody's noticed). Burry's froth lens + Soros's reflexive-stage indicator both surface it.
- **Network correlation graph** — `/v1/network/correlation` runs `numpy.corrcoef` over universe log returns, joins to predictions for node coloring. `/network` page with force-directed graph + slider/dropdown controls.
- **Phase 5 — Chart + sector page + DCF tools** — TradingView lightweight-charts on `/agents/[T]` with flow/insider/earnings markers; full sortable holdings table at `/sectors/[etf]` (UW + yfinance fallback for ETFs UW doesn't index); Damodaran/Klarman/Greenblatt now call computed `tools.dcf` and `tools.magic_formula` to ground reasoning in real numbers.
- **Phase D — Eval scaffolding** — `agent_eval` table + nightly `cfp-jobs eval-agents` + `/v1/agents/scorecard` endpoint with pairwise agreement matrix.
- **Phase C — Conviction enforcement** — `PersonaOutput.hedge_justification` field rejected by Pydantic validator unless confidence is outside [0.40, 0.60] OR justification is ≥30 chars. Forces personas off the lazy 0.5-confidence default.
- **Phase B — Roster swap** — dropped 5 redundant personas, added 5 orthogonal voices (Soros/Simons-quant/Klarman/Greenblatt/Minervini).
- **Phase A — EvidenceBundle architecture** — typed Pydantic bundle, every agent reads same canonical evidence, personas read RAW fields (not analyst conclusions) — kills groupthink.

---

## 12. Known issues / pending

- **Reddit + catalyst data needs scheduled refresh.** `cfp-jobs reddit` daily for mention snapshots (asymmetry flags become meaningful from day 3 of snapshots). `cfp-jobs reddit-catalysts` every 30 min for the live `/catalysts` feed. Both currently one-shot; need Railway cron or GitHub Actions schedule.
- **Flow analyst rationale display can mislead** — the "calls dominate" / "puts dominate" text is derived from a signed imbalance ratio, but the displayed `$X call vs $Y put` numbers are absolute values. When net_put_premium is negative (aggressive put SELLING, bullish), the rationale says "calls dominate" but the displayed numbers look like puts dominate. Tightening the rationale.
- **Top-level assistant chat** — floating chat dock that uses tool-calling to drive runs/navigation/lookups across the app. Designed (Moonshot tool-use), not built.
- **Langfuse instrumentation on `LlmClient`** — wrap every LLM call with trace/span metadata so per-persona cost, latency, hit-rate (once eval data accrues) is visible. Was always Phase 2; now also unlocks measuring whether the persona prompt rewrites moved signal quality.
- **Persona-conditional instrument framing in `personas/base.py`** — branch on `instrument.type == "etf"` so Cathie/Druck/Lynch don't pitch sector ETFs as single businesses. ~30 min surgical fix; called out by the prompt audit.
- **Persona-shaped Chain-of-Thought** — biggest single quality lift available, but ~2× input cost; deferred until Langfuse shows the lift from the prompt-template rewrites first.
- **Office v2 polish** — agent-to-agent meetup animations when two personas agree, sprite walking animation, room desk graphics, sound effects.
- **Lead-lag DAG view** — second tab on `/network` reading from `lead_lag_matrix` (Granger pipeline already produces the data).
- **Cluster-stability over time** per ticker — flags decoupling early.
- **UW flow overlay on network edges** — color edges by correlation × combined call premium for cluster-level setup detection.
- **XGB `predictions.rank` is degenerate** (carried over from prior). Network endpoint works around with score re-rank + return fallback. Real fix needed in `xgb_baseline.py`.

---

## 13. Cost notes

- **Moonshot v1-32k** at api.moonshot.ai — ~$0.012-0.015 per 1k input tokens. Full 21-agent run ≈ 16 LLM calls × 3-5k tokens ≈ **$0.18-0.30 per ticker**.
- **FMP**: free 250 calls/day. ~6 calls per fundamentals fetch + 1 per `/profile`.
- **UW $200/month** — 120 req/min, 80K req/day, 90-day history. ~8 calls per `cfp-jobs flow TICKER`.
- **Apewisdom** — free, no key. ~12-15 calls per `cfp-jobs reddit` snapshot.
- **Railway** Postgres + API ≈ $5-15/mo combined.
- **Vercel** free tier covers the dashboard.

---

## 14. Quick test plan after deploy

1. `/` — sector heatmap loads with current XGB ranks. Click XLK → `/sectors/XLK` shows all 73 holdings sortable.
2. `/network` — 26 nodes, ~50-100 edges at default 0.70 threshold, top-3 green / bottom-3 orange. Drag a node, slider changes refilter.
3. `/agents/IREN` — fresh Run completes ~30-40s. Personas no longer call IREN an ETF. Burry/Druck/Taleb/Buffett/Soros/Klarman/Greenblatt/Damodaran/Minervini all reason from raw bundle data. Risk Manager + PM no longer crash on signed stop loss.
4. `/agents/INTC` — Reddit chatter (currently #4 trending, 124 mentions) surfaces in the sentiment analyst rationale and in Burry's lens (potential froth flag once 7d-avg accrues).
5. Chat panel — switch to "Burry" or "Soros", ask "should I short this?" — streamed response cites actual evidence from the bundle.
6. `/v1/agents/scorecard?horizon=20` — JSON response, mostly empty until `cfp-jobs eval-agents` has run for ≥5 trading days against accumulated agent_signals.
7. `/agents/IREN/v2` — Smallville office view loads with 23 little people in 5 rooms. Click a persona disc → speech bubble with thesis. Trigger Run → discs pulse blue ("thinking"), then transition to green/red/gray as signals land. Toggle pill swaps back to v1 grid.
8. Bull/bear researchers visible in `/agents/IREN` v1 ensemble grid under "Researchers (adversarial)" section. Trader's `bull_summary` / `bear_summary` payloads should now read like distilled briefs from the researchers, not flat aggregations of all 21 votes.
