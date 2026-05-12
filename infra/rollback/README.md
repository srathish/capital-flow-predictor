# Migration rollback

The forward migrations under `infra/migrations/` are append-only. This
directory holds matching `DROP` scripts for each migration so you can roll
state back when needed.

## When to roll back

- **Local dev**: nuking a polluted schema. Easier just to `docker compose down -v`.
- **Staging**: undoing a bad migration before promoting to prod.
- **Prod**: only as a step *after* a Railway PITR restore — never as your
  first response to a bad migration. Restore the snapshot, then apply forward
  migrations again. Rollback scripts here are a contingency, not a workflow.

## Order

Rollbacks must run in reverse-numeric order to honor FK dependencies:

    for f in $(ls -r infra/rollback/*.sql); do psql "$DATABASE_URL" -f "$f"; done

Each script is `IF EXISTS` so it's safe on a partially-rolled-back DB.

## RTO / RPO targets

| Tier   | RPO (data loss window) | RTO (recovery time) | Mechanism                              |
|--------|------------------------|---------------------|----------------------------------------|
| Prod   | ≤ 24h                  | ≤ 1h                | Railway daily Postgres snapshot + PITR |
| Staging| ≤ 7d                   | ≤ 4h                | Daily logical dump to GCS              |
| Dev    | None — disposable      | minutes             | `docker compose down -v` + re-seed     |

Action items to make these targets real:
- Verify Railway snapshot cadence in the dashboard (Settings → Backups).
- Add a weekly `pg_dump` cron in `.github/workflows/data-refresh.yml` that
  drops the dump in GCS with a 30-day lifecycle rule.
- Document the restore steps in a runbook (`docs/RUNBOOK_RESTORE.md`) and
  rehearse once per quarter.
