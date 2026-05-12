# Bellwether API

Auto-generated from FastAPI OpenAPI. Regenerate via `python scripts/export_openapi.py`.


## Authentication

All `/v1/*` endpoints require an API key when `API_KEYS` env is set. Send via either:

    Authorization: Bearer <key>
    X-API-Key: <key>

When `API_KEYS` is empty, auth is disabled (local dev only).

## Rate limits

Per identity (api key or IP):
- Default: `RATE_LIMIT_DEFAULT_PER_MIN` (default 120) per minute
- Expensive runs (`/v1/agents/*/run`, `/v1/agents/*/chat`): `RATE_LIMIT_RUN_PER_HOUR` (default 30) per hour

Rejections return `429 Too Many Requests` with a `Retry-After` header.

## Endpoints

### `/`
- **GET** — 

### `/health`
- **GET** — 

### `/healthz/db`
- **GET** — 

### `/metrics`
- **GET** — 

### `/v1/agents/scorecard`
- **GET** — Get Scorecard

### `/v1/agents/scorecard/agreement`
- **GET** — Get Agreement Matrix

### `/v1/agents/{ticker}`
- **GET** — Get Agents For Ticker

### `/v1/agents/{ticker}/chart-data`
- **GET** — Get Chart Data

### `/v1/agents/{ticker}/chat/ensemble`
- **POST** — 

### `/v1/agents/{ticker}/chat/persona/{persona}`
- **POST** — 

### `/v1/agents/{ticker}/comparison`
- **GET** — Get Persona Comparison

### `/v1/agents/{ticker}/run`
- **POST** — Run Ensemble

### `/v1/agents/{ticker}/runs/{run_ts}`
- **GET** — Get Run Status

### `/v1/agents/{ticker}/timeline`
- **GET** — Get Agent Timeline

### `/v1/assistant/chat`
- **POST** — Assistant Chat

### `/v1/backtest/monte-carlo`
- **GET** — Monte Carlo

### `/v1/flow/unusual`
- **GET** — 

### `/v1/flow/whales`
- **GET** — Get Whale Bets

### `/v1/health/detailed`
- **GET** — Detailed Health

### `/v1/network/correlation`
- **GET** — 

### `/v1/network/lead-lag`
- **GET** — Get Lead Lag

### `/v1/network/lead-lag/triggers`
- **GET** — Get Lead Lag Triggers

### `/v1/network/sector/{etf}/expand`
- **GET** — Expand Sector

### `/v1/rankings`
- **GET** — Get Rankings

### `/v1/reddit/backtest`
- **GET** — Get Backtest

### `/v1/reddit/catalyst-track-record`
- **GET** — Get Catalyst Track Record

### `/v1/reddit/catalysts`
- **GET** — Get Catalysts

### `/v1/reddit/mentions`
- **GET** — 

### `/v1/reddit/predict`
- **GET** — Get Predictions

### `/v1/reddit/rules`
- **GET** — Get Rule Stats

### `/v1/reddit/scorecard`
- **GET** — Get Scorecard

### `/v1/sectors`
- **GET** — Get Sectors

### `/v1/sectors/forward-call`
- **GET** — Get Forward Call

### `/v1/sectors/rrg`
- **GET** — Get Rrg

### `/v1/sectors/scorecard`
- **GET** — Get Scorecard

### `/v1/sectors/{etf}/holdings`
- **GET** — Get Etf Holdings

### `/v1/stocks/finviz-presets`
- **GET** — List Finviz Presets

### `/v1/stocks/screen`
- **GET** — Screen Stocks

### `/v1/watchlist`
- **GET** — Get Watchlist

### `/v1/watchlist/custom/add`
- **POST** — 

### `/v1/watchlist/custom/list`
- **GET** — 

### `/v1/watchlist/custom/{ticker}`
- **DELETE** — 

### `/v1/watchlist/{sector}`
- **GET** — Get Watchlist Sector
