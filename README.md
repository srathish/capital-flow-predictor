# Capital Flow Predictor

Sector & thematic ETF rotation prediction with causal interpretability.
Full design: [docs/DESIGN.md](docs/DESIGN.md).

## Status

**Phase 1 — data ingestion live.** yfinance OHLCV + FRED macro backfill (5y) and
daily incremental updates wired through a CLI. Subsequent phases (features,
models, dashboard) tracked in `docs/DESIGN.md §12`.

## Prereqs

- [uv](https://docs.astral.sh/uv/) — Python toolchain
- [pnpm](https://pnpm.io/) 9.x — JS workspaces
- Docker — local Postgres+TimescaleDB

## Local dev

```bash
# 1. Bring up Postgres + TimescaleDB (applies infra/migrations/*.sql on first run)
make up

# 2. Install Python workspace (all members, dev extras)
uv sync --all-packages --all-extras

# 3. Install JS workspace
pnpm install

# 4. Run the API
cp .env.example .env
make dev

# 5. Smoke test
curl http://localhost:8000/         # service banner
curl http://localhost:8000/health   # {"status":"ok"}
curl http://localhost:8000/healthz/db  # {"status":"ok"} when DB is up
```

## Data ingestion (Phase 1)

```bash
# Apply migrations (idempotent; safe to re-run)
make migrate

# Full 5y backfill — yfinance OHLCV (~44 symbols) + FRED macro (~8 series)
make backfill

# Daily incremental refresh (last 7 days, idempotent)
make daily

# Row counts + freshness per table
make status
```

Requires `FRED_API_KEY` set in `.env`. The yfinance pull is unauthenticated.

To schedule daily refresh as a cron job:

```cron
30 22 * * 1-5  cd /path/to/repo && /usr/bin/make daily >> /tmp/cfp-daily.log 2>&1
```
(5:30pm ET on weekdays = 22:30 UTC.)

## Skylit (Heatseeker) login refresh

skylit.ai sits behind Clerk auth with Discord OAuth. Discord blocks
programmatic password login (captcha + ToS), so we drive a real Chromium
window via Playwright; you sign in once, the script captures the long-lived
`__client` cookie + Clerk session id, and writes them to the gexester-vexster
`.env`. After that, gexester-vexster's Clerk auto-refresh keeps JWTs fresh
for months without further intervention.

```bash
# One-time: install the bundled Chromium
uv run playwright install chromium

# Refresh cookies (default target: ~/gexester vexster/.env)
uv run cfp-jobs skylit-login

# Or point at a different .env
uv run cfp-jobs skylit-login --env-file /path/to/.env
```

## Tests

```bash
make test
```

CI runs the same commands plus a Postgres service container — see
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## Layout

```
apps/
  api/        # FastAPI inference service (Phase 0+)
  jobs/       # Prefect / cron jobs (Phase 1+)
  web/        # Next.js dashboard (Phase 10)
packages/
  shared/     # Pydantic schemas
  features/   # Feature engineering library
  models/     # Model training & inference
  skills/     # Claude skill bundles
infra/
  migrations/ # SQL migrations applied on Postgres init
  railway.toml
docs/
  DESIGN.md   # source of truth for architecture and roadmap
```

## Deploy

Railway, single service for the API in Phase 0:
[infra/railway.toml](infra/railway.toml).

## License

Private.
