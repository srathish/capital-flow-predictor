# Bellwether

Who's leading, who's lagging, and why.

Bellwether is a sector-rotation forecasting stack with a 25-agent investor
ensemble layered on top. The XGBoost predictor ranks 26 sector & thematic
ETFs by expected forward relative strength; the agent ensemble (5 quant
analysts + 13 named investor personas + adversarial researchers + trader +
risk manager + portfolio manager) turns that signal into a per-ticker
verdict you can actually act on, with rationale in plain English.

Full design and roadmap: [docs/DESIGN.md](docs/DESIGN.md).

![Sector heatmap](docs/screenshots/01-sector-heatmap.png)

---

## What's in the app

The web app is a Next.js 15 dashboard with seven tabs, each backed by its
own FastAPI route and (where applicable) a background ingestion job.

### Sectors — XGB rotation board

The home page ranks all 26 sector & thematic ETFs by the latest XGB
prediction, color-coded by theme (secular growth, cyclical, defensive,
rate-sensitive, …) and annotated with rank deltas, sparklines, and a plain-
English market read explaining *why* the ranking looks the way it does.

Click any tile to drill into the sector's constituents:

![Sector holdings](docs/screenshots/02-sector-holdings.png)

Sortable on weight, model score, 1d / 5d / 20d / 60d returns, and percent
off the 52-week high. Inline price chart at the top.

### Agents — the 25-agent ensemble

Click any ticker to run (or fetch the cached run of) the full ensemble:

![Agents ensemble](docs/screenshots/03-agents-nvda.png)

Five rule-based analysts feed thirteen LLM-driven investor personas
(Buffett, Burry, Druckenmiller, Taleb, Soros, Simons, Klarman, Greenblatt,
Minervini, Cathie Wood, Damodaran, Lynch, Ackman). Each persona writes a
5-step persona-shaped chain of thought and emits a tri-state signal with
confidence and rationale. The top bull and top bear are then forced into a
structured cross-examination (target claim → flip condition → rebuttal →
confidence after). A bull researcher and bear researcher each write the
strongest case for their side; a Trader reconciles them; a Risk Manager
sizes the position; a Portfolio Manager makes the final long / short /
avoid call.

You can talk to the synthesizer or any individual persona in their voice
via SSE-streamed chat at the bottom of the page.

### Watchlist — final PM verdicts by sector

![Watchlist](docs/screenshots/04-watchlist.png)

Top constituents per top-ranked sector with the Portfolio Manager's
verdict, confidence, allocation %, and expandable reasoning chain. Built by
the `cfp-jobs build-watchlist` job.

### Network — correlation + lead-lag

![Network graph](docs/screenshots/05-network.png)

Force-directed graph over the 26 sector ETFs with two modes:

- **Correlation** — pairwise Pearson r over a rolling window (60d default),
  with an optional MST overlay to surface the backbone of the market.
- **Lead-lag** — directed Granger-causality DAG showing which sectors lead
  which on a chosen horizon. Surfaces *"leader moved → watch follower"*
  triggers.

Hover to isolate a node, click to drill into the sector, shift-click to
expand its top constituents (with their pairwise correlations), drag to pin.

### Catalysts — Reddit posts that matter

Catalyst-keyword feed pulled from r/stocks, r/investing, r/wallstreetbets,
and r/options. Posts are classified (partnership / FDA / earnings beat /
insider / acquisition / …), aggregated by ticker, clustered by composite
score, and persisted. Filter by hour window (6h–7d), confidence threshold,
sort by newest / top score / cluster size / engagement / biggest mover.

### Reddit chatter — Apewisdom + enrichment

Top-mentioned tickers from the latest Apewisdom snapshot, enriched with:

- sentiment bull share (from catalyst-keyword posts, last 7d)
- price change 1d / 5d
- momentum score (slope of last-7d mention count)
- audience skew (WSB vs. r/investing)
- catalyst post count + freshness tone
- sparkline + per-subreddit breakdown
- contrarian + stealth-setup flags

A drawer opens the underlying Reddit thread; a backtest tab aggregates
"do mention spikes lead price moves?" by spike-bucket.

> **Heads-up:** the Reddit tab depends on migrations `0009_reddit_mentions.sql`
> + `0010_reddit_posts.sql` plus the `apewisdom` and `reddit_rss` ingestion
> jobs. If you see "failed to fetch", run `make migrate` then `make daily`.

### Top-level assistant

A floating chat dock is mounted on every page. SSE-streamed Moonshot
tool-calling loop with six tools (`get_rankings`, `get_sectors_heatmap`,
`get_agents_for_ticker`, `get_catalysts`, `run_ensemble`, `navigate`) so you
can ask "what's flagged in tech today?" or "run the ensemble on RKLB" from
anywhere.

---

## Architecture

```
apps/
  api/        # FastAPI inference + chat service
  jobs/       # Ingestion, training, ensemble runner, watchlist builder
  web/        # Next.js 15 + React 19 + Tailwind + lightweight-charts
packages/
  shared/     # Pydantic schemas
  features/   # Feature engineering (Alpha158, Granger, sector flows)
  models/     # XGBoost training + inference
  agents/     # 25-agent ensemble (LangGraph state machine)
  skills/     # Claude skill bundles
infra/
  migrations/ # SQL migrations (0001..0010)
  railway.toml
docs/
  DESIGN.md
  screenshots/
```

**Data layer:** Postgres + TimescaleDB (`prices_daily`, `macro_daily`,
`features_daily`, `predictions`, `lead_lag_matrix`, `sector_holdings`,
`fundamentals`, `agent_signals`, `watchlists`, `uw_*` for Unusual Whales,
`reddit_mentions`, `reddit_posts`).

**Agent ensemble:** LangGraph DAG —
`analysts → personas → debate → researchers → trader → risk_manager → portfolio_manager`.
Provider-agnostic (Anthropic or Moonshot), with Langfuse cost tracking.

---

## Local dev

### Prereqs

- [uv](https://docs.astral.sh/uv/) — Python toolchain
- [pnpm](https://pnpm.io/) 9.x — JS workspaces
- Docker — local Postgres + TimescaleDB

### Bring it up

```bash
# 1. Postgres + TimescaleDB (auto-applies infra/migrations/*.sql on first run)
make up

# 2. Install Python workspace
uv sync --all-packages --all-extras

# 3. Install JS workspace
pnpm install

# 4. Apply any new migrations against an existing DB (idempotent)
make migrate

# 5. Run the API
cp .env.example .env
make dev   # http://localhost:8000

# 6. Run the web app (in a second terminal)
cd apps/web && pnpm dev   # http://localhost:3000

# 7. Smoke tests
curl http://localhost:8000/health        # {"status":"ok"}
curl http://localhost:8000/healthz/db    # {"status":"ok"} when DB is up
```

### Data ingestion

```bash
make backfill   # 5y yfinance OHLCV (~50 symbols) + FRED macro (~8 series)
make daily      # 7-day incremental, idempotent — schedule on cron
make status     # row counts + freshness per table
```

Requires `FRED_API_KEY` in `.env`. yfinance is unauthenticated. Optional
data sources (set in `.env` to enable):

- `FMP_API_KEY` — fundamentals + ETF holdings
- `UNUSUAL_WHALES_API_KEY` — options flow, dark pool, insider
- `LANGFUSE_*` — prompt + cost tracing
- `MOONSHOT_API_KEY` or `ANTHROPIC_API_KEY` — agent ensemble

### Running the ensemble for a ticker

```bash
uv run --package cfp-jobs cfp-jobs run-agents NVDA
uv run --package cfp-jobs cfp-jobs build-watchlist
```

### Skylit (Heatseeker) login refresh

skylit.ai sits behind Clerk + Discord OAuth. Discord blocks programmatic
login (captcha + ToS), so we drive a real Chromium window once via
Playwright; the script captures the long-lived `__client` cookie + Clerk
session id and writes them to the consumer `.env`. Clerk auto-refresh
keeps JWTs fresh for months after that.

```bash
uv run playwright install chromium
uv run cfp-jobs skylit-login
```

### Capturing fresh README screenshots

```bash
# With API on :8000 and web on :3000
uv run python scripts/capture_screenshots.py
```

Writes 7 PNGs into `docs/screenshots/`.

---

## Tests + CI

```bash
make test
```

CI runs the same commands plus a Postgres service container — see
[.github/workflows/ci.yml](.github/workflows/ci.yml).

---

## Daily refresh

```cron
30 22 * * 1-5  cd /path/to/repo && /usr/bin/make daily >> /tmp/cfp-daily.log 2>&1
```

(5:30pm ET on weekdays = 22:30 UTC.)

---

## Deploy

API: Railway, Dockerfile-based — [infra/railway.toml](infra/railway.toml).
Web: Vercel — [apps/web/vercel.json](apps/web/vercel.json), set
`NEXT_PUBLIC_API_BASE_URL` to your deployed API URL.

**On every prod deploy: run `make migrate` against the prod DB.** Migrations
are not auto-applied at boot. (Symptom of skipping this: tabs that depend on
new tables — most recently the Reddit tab — return 500 with `relation "X"
does not exist`.)

---

## License

Private.
