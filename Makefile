.PHONY: up down logs dev test lint typecheck migrate backfill daily status features features-daily lead-lag train evaluate holdings fundamentals analysts ensemble watchlist-build watchlist clean

# --- infra ---

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f db

clean:
	docker compose down -v

# --- api ---

dev:
	uv run --package cfp-api uvicorn cfp_api.main:app --reload --host 0.0.0.0 --port 8000

# --- jobs ---

migrate:
	uv run --package cfp-jobs cfp-jobs migrate

backfill:
	uv run --package cfp-jobs cfp-jobs backfill

daily:
	uv run --package cfp-jobs cfp-jobs daily

status:
	uv run --package cfp-jobs cfp-jobs status

features:
	uv run --package cfp-jobs cfp-jobs features-build

features-daily:
	uv run --package cfp-jobs cfp-jobs features-daily

lead-lag:
	uv run --package cfp-jobs cfp-jobs lead-lag-build

train:
	uv run --package cfp-jobs cfp-jobs train-baseline

evaluate:
	uv run --package cfp-jobs cfp-jobs evaluate

holdings:
	uv run --package cfp-jobs cfp-jobs holdings

fundamentals:
	uv run --package cfp-jobs cfp-jobs fundamentals

# usage: make analysts TICKER=NVDA
analysts:
	uv run --package cfp-jobs cfp-jobs analysts $(TICKER)

# usage: make ensemble TICKER=NVDA  (full agent ensemble for one ticker)
ensemble:
	uv run --package cfp-jobs cfp-jobs analysts $(TICKER) --personas

# Build the long-side watchlist: top sectors -> constituents -> ensemble -> watchlists table
watchlist-build:
	uv run --package cfp-jobs cfp-jobs watchlist-build

# View the latest watchlist
watchlist:
	uv run --package cfp-jobs cfp-jobs watchlist

# --- quality ---

test:
	uv run pytest -q

lint:
	uv run ruff check .

typecheck:
	pnpm run typecheck
