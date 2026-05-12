# Dev seeds

Tiny fixture data so a fresh local DB has *something* to render. Run after
`make migrate`:

    psql "$DATABASE_URL" -f infra/seeds/0001_prices.sql
    psql "$DATABASE_URL" -f infra/seeds/0002_watchlist.sql
    psql "$DATABASE_URL" -f infra/seeds/0003_agent_signals.sql

Or, all at once:

    for f in infra/seeds/*.sql; do psql "$DATABASE_URL" -f "$f"; done

All seeds are idempotent (`ON CONFLICT DO NOTHING`) — safe to re-run.

Seeds are **not** intended for prod and the values are not predictive — they
exist so the dashboard renders without "no data" cards on a brand-new DB.
