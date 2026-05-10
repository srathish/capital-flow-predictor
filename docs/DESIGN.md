# Bellwether — Engineering Design Doc

(Project codebase / package slugs remain `cfp_*` and `capital-flow-predictor`
for stability; "Bellwether" is the user-facing product name.)

**Status:** Draft v0.1
**Owner:** Sai
**Last updated:** 2026-05-07
**Implementer:** Claude Code

---

## 1. Overview

A system that predicts where capital is rotating across equity sectors and themes over a 1–20 day horizon, with causal explanations for *why* the rotation is happening. The output is a ranked sector/theme leaderboard plus a daily narrative an analyst (or Claude) can reason on top of.

This is not a price predictor. It is a **relative-strength predictor with causal interpretability**, treating the universe of sector and thematic ETFs as the unit of analysis and using cross-asset, options-derived, and flow-based features as inputs.

**Core question the system answers:** *Given today's market structure, which sectors and themes are most likely to outperform over the next N days, and which observable inputs are driving that prediction?*

## 2. Goals / Non-Goals

### Goals
- Daily-refreshed ranking of ~25 sector/thematic ETFs by predicted N-day relative strength
- Multi-horizon predictions: 5d, 10d, 20d
- Causal trace per prediction: "this rank is driven 40% by X, 25% by Y, 15% by Z"
- Backtest framework producing walk-forward AUC, IC, and long-short Sharpe
- Daily narrative output consumable in Claude (skill) and a web dashboard
- Scenario tool: "if DXY breaks 105 and 10Y yield climbs 25 bps, what rotates?"
- Production deployment on Railway with a single-command redeploy

### Non-Goals
- Intraday or 0DTE prediction (that's OpenClaw's domain — keep them separate)
- Single-name alpha generation (sector/theme level only; downstream watchlists are out of scope for v1)
- Automated execution / live order routing
- Crypto-only or rates-only modeling (cross-asset features yes, but equity sectors are the prediction target)
- Replacing OpenClaw or any existing system (this is greenfield, not an extension)

## 3. Background & Prior Art

The literature on sector rotation prediction with deep learning is small but real. Two reference points worth reading before implementation:

- **Temporal Fusion Transformer (TFT)** — Lim et al. 2021. Multi-horizon forecasting with attention-based variable selection. Works well when you have mixed static, known-future, and observed-past features. Good fit here because attention weights are interpretable per prediction.
- **Microsoft Qlib** — production quant ML platform with TFT, GATs, and walk-forward validation built in. Use as a reference for pipeline structure even if we don't adopt it wholesale.
- **DoWhy / EconML** — Microsoft's causal inference libraries. Granger causality and do-calculus are the right tools for "did X actually cause Y" rather than "are X and Y correlated."
- **Dynamic Sector Fusion Transformer (TISFM, 2025)** — academic paper on sector-aware transformer for index prediction. Useful architectural reference for the multi-sector attention mechanism.

Conventional wisdom that should be respected: market data has signal-to-noise ratios near 1:1000. Any model claiming high accuracy on raw price prediction is overfit. Relative strength on weekly horizons is more tractable than absolute returns and is the right framing.

## 4. System Architecture

```
+----------------------------------------------------------------+
|                       DATA SOURCES                             |
|  Polygon | FRED | Heatseeker | ICI | Yahoo | Coinbase          |
+----------------------------+-----------------------------------+
                             |
                  +----------v---------+
                  |  Ingestion Jobs    |  (cron / Prefect)
                  |  Python ETL        |
                  +----------+---------+
                             |
                  +----------v---------+
                  |  TimescaleDB       |  (Postgres + TS extension)
                  |  Raw + Features    |
                  +----------+---------+
                             |
              +--------------+--------------+
              |              |              |
         +----v----+    +----v----+    +----v----+
         | Feature |    | Causal  |    | Model   |
         | Pipeline|    | Engine  |    | Training|
         | (poly,  |    | (DoWhy, |    | (TFT,   |
         |  feast) |    | Granger)|    |  XGB)   |
         +----+----+    +----+----+    +----+----+
              |              |              |
              +--------------+--------------+
                             |
                  +----------v----------+
                  |  Inference API      |  (FastAPI)
                  |  Predictions DB     |
                  +----------+----------+
                             |
              +--------------+----------------+
              |              |                |
         +----v----+    +----v-----+    +-----v-------+
         | Web UI  |    | Claude   |    |  MCP Server |
         | (Next)  |    | Skills   |    |  (optional) |
         +---------+    +----------+    +-------------+
```

### Components

| Component | Responsibility | Tech |
|-----------|---------------|------|
| Ingestion | Pull raw data from sources on schedule | Python, httpx, Prefect |
| Storage | Time-series storage for raw + derived data | Postgres + TimescaleDB |
| Feature Pipeline | Compute features, point-in-time correctness | Python, pandas, polars |
| Causal Engine | Granger causality, intervention testing | DoWhy, EconML, statsmodels |
| Model Training | TFT, XGBoost, GAT training and validation | pytorch-forecasting, xgboost, pytorch-geometric |
| Inference API | Serve predictions and explanations | FastAPI, pydantic |
| Web Dashboard | Visualize rankings, lead-lag, causal traces | Next.js, TradingView Lightweight Charts, shadcn/ui |
| Claude Skills | Daily narrative, scenario tool, causal-trace | Claude skills (markdown + Python helpers) |
| MCP Server (opt.) | Expose model predictions as MCP tools | Python `mcp` SDK |

## 5. Data Layer

### 5.1 Sources

| Source | Data | Cost | Notes |
|--------|------|------|-------|
| Polygon | OHLCV, options chains, intraday | $$ | Primary equity/options data. Sai has access pattern from OpenClaw. |
| FRED | Macro series (DGS10, DTWEXBGS, T10Y2Y, etc.) | Free | Daily, lagged 1d. Use `fredapi` Python lib. |
| Heatseeker (internal) | GEX, dealer positioning, gamma flip | $$ | Wraps existing scraper from OpenClaw. Need clean export schema. |
| ICI | Weekly fund flows by category | Free | Released Wednesdays for prior week. Lag matters. |
| Yahoo Finance | Backup OHLCV, simple options | Free | Fallback / sanity check only. |
| Coinbase | BTC/ETH spot, perp funding | Free | For crypto cross-asset features. |
| Twitter/X (optional) | Sentiment signals | $$$ | Skip in v1; revisit if model lacks behavioral signal. |

### 5.2 Universe

**Prediction targets (sector & thematic ETFs, ~25 names):**

```
Sectors: XLK, XLF, XLE, XLV, XLI, XLU, XLC, XLY, XLP, XLB, XLRE
Themes:  SMH (semis), SOXX, ARKK (innovation), IBB (biotech),
         KRE (regional banks), ITA (defense), JETS (airlines),
         XBI, XOP (E&P), URA (uranium), URNM, REMX (rare earths),
         WCLD (cloud), TAN (solar), LIT (lithium)
```

**Cross-asset features (input only, not predicted):**

```
DXY, GLD, SLV, USO, UNG, HG=F (copper futures via continuous),
TLT, IEF, SHY, HYG, LQD, ^VIX, BTC, ETH
```

### 5.3 Schema

Use TimescaleDB hypertables for all time-series.

```sql
-- Raw OHLCV (hypertable on `ts`)
CREATE TABLE prices_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    open        DOUBLE PRECISION,
    high        DOUBLE PRECISION,
    low         DOUBLE PRECISION,
    close       DOUBLE PRECISION,
    volume      BIGINT,
    source      TEXT NOT NULL,
    PRIMARY KEY (ts, symbol, source)
);

-- Macro series
CREATE TABLE macro_daily (
    ts          TIMESTAMPTZ NOT NULL,
    series_id   TEXT NOT NULL,   -- e.g., 'DGS10'
    value       DOUBLE PRECISION,
    PRIMARY KEY (ts, series_id)
);

-- ETF flows (weekly)
CREATE TABLE etf_flows_weekly (
    week_end    DATE NOT NULL,
    symbol      TEXT NOT NULL,
    net_flow    DOUBLE PRECISION,
    aum         DOUBLE PRECISION,
    PRIMARY KEY (week_end, symbol)
);

-- GEX features (Heatseeker-derived)
CREATE TABLE gex_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    total_gex   DOUBLE PRECISION,
    flip_level  DOUBLE PRECISION,
    call_wall   DOUBLE PRECISION,
    put_wall    DOUBLE PRECISION,
    PRIMARY KEY (ts, symbol)
);

-- Computed features (point-in-time)
CREATE TABLE features_daily (
    ts          TIMESTAMPTZ NOT NULL,
    symbol      TEXT NOT NULL,
    feature_set TEXT NOT NULL,   -- e.g., 'cross_asset_v1'
    payload     JSONB NOT NULL,  -- feature dict
    PRIMARY KEY (ts, symbol, feature_set)
);

-- Predictions
CREATE TABLE predictions (
    run_ts      TIMESTAMPTZ NOT NULL,
    target_ts   TIMESTAMPTZ NOT NULL,   -- ts being predicted FOR
    symbol      TEXT NOT NULL,
    horizon_d   INT NOT NULL,           -- 5, 10, 20
    model       TEXT NOT NULL,          -- 'tft_v1', 'xgb_v1', etc.
    rank        INT,
    score       DOUBLE PRECISION,
    confidence  DOUBLE PRECISION,
    explanation JSONB,                  -- top-k feature contributions
    PRIMARY KEY (run_ts, target_ts, symbol, horizon_d, model)
);
```

### 5.4 Ingestion Jobs

- **Daily 5pm ET:** prices, macro (FRED), GEX from Heatseeker
- **Wednesday 10am ET:** ICI flows for prior week
- **On startup / backfill:** historical 5-year backfill across all sources

Use Prefect for orchestration. Each job is idempotent and writes a `data_quality_check` row on completion (row counts, freshness, null pct).

## 6. Feature Engineering

All features are computed point-in-time — no look-ahead bias. Validation: for every feature, the value at time `t` must be derivable from data with `published_ts <= t`.

### 6.1 Cross-asset features (per day)

- DXY: 1d, 5d, 20d return; z-score of 20d return
- 10Y yield: level, 1d delta, 20d delta
- Copper/Gold ratio: level, 1d change
- Oil: 5d return
- HYG/LQD spread: level, 5d change
- VIX: level, 5d change, term structure (VIX vs VIX3M)
- BTC: 5d return, 20d return, BTC/SPX correlation rolling 20d

### 6.2 Sector-target features (per ETF, per day)

- Returns: 1d, 5d, 10d, 20d, 60d
- Relative strength vs SPY: 5d, 20d
- Distance from 50d, 200d MAs
- 14d RSI, 20d realized vol
- Volume z-score (20d)
- 52w distance from high

### 6.3 Options-derived features (GEX-based, from Heatseeker)

For SPX, QQQ, IWM, and each sector ETF where data exists:

- Total dealer GEX (level, 5d change)
- Distance from gamma flip
- Call wall / put wall levels
- Skew (25d put IV - 25d call IV)
- IV term structure slope

### 6.4 Flow features

- ETF weekly net flow (current week, 4w sum)
- Net flow / AUM ratio
- Flow direction divergence (sector flow vs SPY flow)

### 6.5 Lead-lag features (the "causal" prior)

Compute Granger causality matrix monthly across the full universe + cross-asset basket, store in `lead_lag_matrix` table. For each ETF, expose top-3 leading indicators as features.

```python
# Pseudocode
for target in sectors:
    for candidate in cross_assets + sectors:
        if granger_causality(candidate, target, max_lag=10) < 0.05:
            mark candidate as leader of target
```

## 7. Models

### 7.1 Baseline: XGBoost on flat feature panel

Match the existing OpenClaw pattern. One model per horizon (5d, 10d, 20d).

- Target: rank percentile of next-N-day relative strength vs SPY
- Loss: pairwise ranking (`rank:pairwise`)
- Walk-forward CV: 6-month train, 1-month val, 1-month test, rolling
- Success: walk-forward AUC > 0.65 on out-of-sample test

This is the baseline every future model has to beat.

### 7.2 Predictive: Temporal Fusion Transformer

Use `pytorch-forecasting`. TFT is appropriate because:

1. Multi-horizon native — predicts 5/10/20d in one model
2. Variable selection networks identify which features matter per prediction
3. Attention weights are inspectable — gives the "causal trace" output
4. Handles mixed static (ETF metadata), known-future (calendar), and observed-past (price/feature) inputs

```python
# Reference architecture
from pytorch_forecasting import TemporalFusionTransformer, TimeSeriesDataSet

dataset = TimeSeriesDataSet(
    df,
    time_idx="time_idx",
    target=["return_5d_relative", "return_10d_relative", "return_20d_relative"],
    group_ids=["symbol"],
    static_categoricals=["sector", "theme"],
    time_varying_known_reals=["day_of_week", "month"],
    time_varying_unknown_reals=[
        "dxy_5d_return", "ten_y_delta", "vix_level",
        "spx_gex", "sector_flow_z", "rsi_14",
        # ... all features from §6
    ],
    max_encoder_length=60,    # 60 days of history
    max_prediction_length=20, # predict 20 days ahead
)

tft = TemporalFusionTransformer.from_dataset(
    dataset,
    learning_rate=0.001,
    hidden_size=64,
    attention_head_size=4,
    dropout=0.2,
    loss=QuantileLoss(quantiles=[0.1, 0.5, 0.9]),  # probabilistic
)
```

Train on 5y of data, validate walk-forward, target out-of-sample IC ≥ 0.05 and beat XGBoost baseline AUC.

### 7.3 Causal layer: DoWhy + Granger

For each top-ranked prediction, run a causal trace to attribute the prediction to upstream features.

Two passes:

1. **Granger pre-screen** — use the precomputed lead-lag matrix to filter candidates that have any causal claim
2. **DoWhy intervention** — for the surviving candidates, do a counterfactual: "if `dxy_5d_return` had been at its 20d median instead of its current value, what would the prediction be?" The delta is the causal contribution

This produces the "explanation" payload stored in `predictions.explanation`:

```json
{
  "horizon_d": 10,
  "rank": 1,
  "symbol": "URNM",
  "score": 0.87,
  "drivers": [
    {"feature": "uranium_spot_5d", "contribution": 0.34, "direction": "positive"},
    {"feature": "dxy_20d_return", "contribution": -0.18, "direction": "positive"},
    {"feature": "kre_relative_strength", "contribution": 0.12, "direction": "positive"}
  ],
  "narrative_seed": "URNM ranked #1 (10d) driven primarily by uranium spot momentum (+34%) and dollar weakness (-18%)."
}
```

### 7.4 Validation framework

```
walk_forward/
  train_window: 18 months
  validation_window: 1 month
  test_window: 1 month
  step: 1 month
  metrics:
    - ranking AUC (per horizon)
    - Information Coefficient (Spearman corr of pred vs realized)
    - Long-short portfolio Sharpe (top-3 long, bottom-3 short, daily rebalance)
    - Hit rate (% of correct top-1 picks per horizon)
```

Required to advance from staging to production:
- IC ≥ 0.05 across all 3 horizons
- AUC > XGBoost baseline by ≥ 2 percentage points
- Long-short Sharpe ≥ 1.0 over 24 months out-of-sample

## 8. Inference & Serving

### 8.1 Daily batch

5:30 pm ET daily job:
1. Refresh features for today
2. Run TFT forward pass for full universe
3. Run causal trace for top-5 / bottom-5 per horizon
4. Write to `predictions` table
5. Trigger Claude narrative generation (§9)

### 8.2 Inference API

FastAPI service exposing:

```
GET  /v1/rankings?horizon=10&date=2026-05-07
GET  /v1/explain?symbol=URNM&horizon=10&date=2026-05-07
POST /v1/scenario  { "overrides": { "dxy_5d_return": 0.03 } }
GET  /v1/lead_lag?target=XLE
GET  /v1/health
```

The scenario endpoint runs the TFT forward pass with feature overrides — this enables the "if X happens, what rotates?" workflow.

## 9. Claude Integration Layer

### 9.1 Custom skills (`.claude/skills/`)

Three skills, each a folder with `SKILL.md` + helper scripts.

**`sector-rotation`** — `/sector-rotation [horizon]`
Fetches today's rankings via the API, renders a daily note: top movers, key drivers, regime call. Output is markdown suitable for trading journal.

**`causal-trace`** — `/causal-trace <symbol> [horizon]`
For a given ticker, shows the causal driver breakdown and the lead-lag chain. Useful for "why is XLE ranked 3 today?"

**`scenario`** — `/scenario <feature>=<value>...`
Calls the `/v1/scenario` endpoint and renders the delta vs baseline rankings. Used for "what if 10Y rallies 25 bps?"

### 9.2 MCP server (optional, Phase 7)

Wrap the inference API as a remote MCP server so Claude.ai web (and Claude Code) can call it directly without skills:

```
get_rankings(horizon: int, date: str) -> List[Ranking]
get_explanation(symbol: str, horizon: int, date: str) -> Explanation
run_scenario(overrides: Dict[str, float]) -> RankingDelta
```

Deploy on Railway, register as a custom connector in Claude.ai. This makes the system queryable from any Claude surface.

### 9.3 Daily narrative agent

A scheduled task that:
1. Reads today's predictions
2. Calls Claude API with a narrative-generation prompt
3. Stores narrative in `daily_notes` table
4. Optionally posts to Slack/Discord

## 10. Frontend / Dashboard

Single-page Next.js app with:

- **Heatmap view** — sectors x horizons, colored by predicted rank delta
- **Detail view** — per-ETF page with prediction history, driver breakdown, causal chain visualization
- **Lead-lag explorer** — interactive Granger causality matrix
- **Scenario builder** — sliders for cross-asset inputs, see live ranking delta
- **TradingView chart embed** — for any selected ETF

Use shadcn/ui + Tailwind, TradingView Lightweight Charts for the chart component, recharts for the heatmap and bar charts.

## 11. Deployment

- **Repo:** monorepo, Turborepo
  - `apps/api` — FastAPI inference service
  - `apps/web` — Next.js dashboard
  - `apps/jobs` — Prefect ingestion + training jobs
  - `packages/skills` — Claude skill bundles (publishable as `.skill` archives)
  - `packages/shared` — Pydantic schemas, shared types
- **Hosting:** Railway (matches existing OpenClaw / Jira-bot pattern)
- **Database:** Railway-managed Postgres with TimescaleDB extension
- **Secrets:** Railway env vars; never commit
- **CI:** GitHub Actions — lint, test, type-check on PR; auto-deploy main to Railway
- **Monitoring:** Railway logs + a `/health` endpoint pinged by Better Stack

## 12. Phased Build Plan

Each phase ends with a runnable, demonstrable artifact. No phase blocks indefinitely on a later phase.

| Phase | Scope | Exit criteria | Est. effort |
|-------|-------|--------------|-------------|
| **0. Scaffold** | Monorepo, Postgres+TS up on Railway, CI green, env vars wired | Empty FastAPI returns 200, Postgres reachable | 1 day |
| **1. Data ingestion** | Polygon prices, FRED macro, Yahoo backup. 5y backfill complete. Daily cron. | `prices_daily` and `macro_daily` populated, last 5y, daily-fresh | 2 days |
| **2. Feature pipeline** | Cross-asset, sector-target, basic Granger lead-lag. No GEX yet. | `features_daily` populated for full universe, point-in-time validated | 2 days |
| **3. XGBoost baseline** | Rank model, walk-forward validation framework | Baseline AUC reported, framework reusable | 2 days |
| **4. Heatseeker integration** | Wrap existing OpenClaw scraper, populate `gex_daily` | GEX features available in feature pipeline | 1–2 days (depends on existing scraper cleanliness) |
| **5. ETF flows** | ICI weekly ingest, flow features | Flow features in pipeline, weekly cron stable | 1 day |
| **6. TFT model** | pytorch-forecasting setup, train & validate, beat XGBoost | TFT IC ≥ 0.05, AUC > XGBoost baseline | 4–5 days |
| **7. Causal layer** | DoWhy integration, explanation payload | Explanations populated for top-5 / bot-5 per run | 2–3 days |
| **8. Inference API** | FastAPI endpoints from §8.2 | All endpoints documented in OpenAPI, curl-testable | 1–2 days |
| **9. Claude skills** | Three skills from §9.1 | Skills installable, slash commands working in Claude Code | 1–2 days |
| **10. Dashboard** | Next.js app from §10 | Deployed, all 5 views functional | 3–4 days |
| **11. MCP server (opt)** | Remote MCP server, Claude.ai connector registered | `get_rankings` callable from claude.ai web | 1 day |
| **12. Live monitoring** | 30-day shadow mode, daily Slack note, drift detection | 30 days of clean predictions logged, drift alerts wired | passive |

**Total active effort:** ~22–28 days of focused work.

## 13. Open Questions / Decisions Needed

1. **Polygon vs alternative.** Polygon is paid but matches OpenClaw's existing usage. Alternative: Alpaca + Tiingo + Theta Data for options. **Recommendation:** Polygon if subscription is current; otherwise evaluate cost vs Theta Data for options chain.
2. **Heatseeker export schema.** What does the existing scraper output? Need a clean adapter. **Action:** spend 30 min documenting current Heatseeker scraper outputs before Phase 4.
3. **Prefect vs cron.** Prefect adds ops surface but gives observability. **Recommendation:** start with cron; migrate to Prefect when job count > 5.
4. **DuckDB vs TimescaleDB.** DuckDB is simpler but TimescaleDB is the better fit for the always-on ingestion pattern. **Recommendation:** TimescaleDB.
5. **GAT (graph attention network) — phase 13?** Modeling sector relationships as a graph is theoretically clean but adds complexity. **Recommendation:** defer until TFT is shipped and validated; only add if TFT plateaus.
6. **Sentiment / Twitter.** Excluded from v1. Revisit in Phase 13+ only if model lacks behavioral signal.

## 14. Risks & Failure Modes

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Look-ahead bias in feature pipeline | High | Critical | Strict point-in-time enforcement; unit tests that fail on any feature derivable from future data |
| Overfit on small universe | High | High | Walk-forward CV, restrict hyperparameter search, prefer simpler models |
| TFT fails to beat XGBoost | Medium | Medium | XGBoost stays in production; TFT is upgrade, not replacement |
| Heatseeker scraper breaks | Medium | Medium | Graceful degradation: GEX features become null, model trained with missing-feature support |
| Regime shift invalidates training distribution | Persistent | High | Continuous retraining (monthly cadence); drift detection |
| Polygon API quota | Low | Medium | Cache aggressively; nightly batch is efficient |
| Causal claims are spurious | High | Medium | Frame as "attribution" not "causation" in UI; always show confidence |

## 15. Success Metrics

**Technical**
- Walk-forward IC ≥ 0.05 across 5d/10d/20d horizons
- TFT AUC > XGBoost baseline by ≥ 2 pp
- Long-short Sharpe ≥ 1.0 over 24-month out-of-sample
- Daily inference job runs < 5 minutes wall clock
- API p95 latency < 500ms

**Product**
- Daily narrative generated and reviewable by 6pm ET
- Causal traces are intelligible to a human reader (judged subjectively over 30-day period)
- Scenario tool produces directionally sensible deltas (validated against known historical episodes — e.g., overriding inputs to mid-2022 levels should rotate toward XLE / energy)

**Outcome**
- 90 days of paper-traded long-short returns positive and risk-adjusted competitive with sector-rotation benchmarks (e.g., relative strength rules)
- System surfaces at least one sector rotation call per quarter that the operator (Sai) would not have identified independently

---

## Appendix A — Repo Layout

```
capital-flow-predictor/
├── apps/
│   ├── api/                  # FastAPI inference service
│   │   ├── src/
│   │   ├── tests/
│   │   └── pyproject.toml
│   ├── web/                  # Next.js dashboard
│   │   ├── app/
│   │   ├── components/
│   │   └── package.json
│   └── jobs/                 # Prefect / cron jobs
│       ├── ingestion/
│       ├── training/
│       └── inference/
├── packages/
│   ├── shared/               # Pydantic schemas, shared types
│   ├── features/             # Feature engineering library
│   ├── models/               # Model training & inference
│   └── skills/               # Claude skill bundles
│       ├── sector-rotation/
│       │   ├── SKILL.md
│       │   └── scripts/
│       ├── causal-trace/
│       └── scenario/
├── infra/
│   ├── railway.toml
│   └── migrations/           # SQL migrations
├── docs/
│   └── DESIGN.md             # this file
├── .github/workflows/
├── pyproject.toml            # workspace root
├── turbo.json
└── README.md
```

## Appendix B — Initial Library Pins

```python
# Python
python = "^3.11"
fastapi = "^0.115"
pydantic = "^2.9"
sqlalchemy = "^2.0"
asyncpg = "^0.30"
polars = "^1.10"
pandas = "^2.2"
torch = "^2.5"
pytorch-forecasting = "^1.1"
xgboost = "^2.1"
dowhy = "^0.12"
econml = "^0.15"
statsmodels = "^0.14"
fredapi = "^0.5"
httpx = "^0.27"
prefect = "^3.0"
mcp = "^1.0"
```

```json
// JS
"next": "^15.0",
"react": "^19.0",
"tailwindcss": "^3.4",
"@radix-ui/react-*": "latest",
"lightweight-charts": "^4.2",
"recharts": "^2.13",
"swr": "^2.2"
```

## Appendix C — Skill Template (`sector-rotation/SKILL.md`)

```markdown
---
name: sector-rotation
description: Generate today's sector rotation note from the Capital Flow Predictor. Pulls rankings, identifies movers, surfaces causal drivers, and produces a markdown brief suitable for a trading journal.
argument-hint: [horizon=10]
allowed-tools: [Bash, Read]
---

# Sector Rotation Daily Note

When invoked, run scripts/generate_note.py with the supplied horizon argument
(default 10). The script:

1. Calls the Capital Flow Predictor API at $CFP_API_URL/v1/rankings
2. Calls /v1/explain for the top 3 and bottom 3 by predicted score
3. Formats output as the standard daily-note markdown template in
   assets/note_template.md

Output should be a complete markdown document ready to paste into the
trading journal — no preamble, no commentary outside the template.
```

---

**End of design doc.** Hand to Claude Code with: *"Implement Phase 0 from `docs/DESIGN.md`. Stop and ask before starting Phase 1."*
