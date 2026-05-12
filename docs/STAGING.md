# Staging environment

Today: `main` → Railway prod + Vercel prod. No pre-prod gate.

## Target setup

| Tier    | Branch  | API host                 | Web host                       | DB                       |
|---------|---------|--------------------------|--------------------------------|--------------------------|
| Prod    | `main`  | `api.bellwether.app`     | `bellwether.app`               | Railway prod Postgres    |
| Staging | `stage` | `api-stage.bellwether.app` | Vercel preview (stage branch) | Railway stage Postgres   |
| Preview | PRs     | n/a (web hits prod API)  | Vercel per-PR preview          | shared prod (read-only)  |

## Implementation steps

1. **Railway** — duplicate the prod service into a new `staging` environment.
   - Same Dockerfile, half the resources.
   - New DB instance; restore from yesterday's prod snapshot once.
   - Set `LOG_LEVEL=DEBUG` and `API_KEYS=stage-<random>`.
2. **Vercel** — link the `stage` branch to a separate production deployment
   (not preview). Add `NEXT_PUBLIC_API_BASE_URL=https://api-stage.bellwether.app`.
3. **GitHub Actions** — add a manual-approval `deploy-staging.yml` that runs
   on push to `stage`. Promote to prod by `git merge stage` into `main`.
4. **Smoke tests** — after staging deploy, hit:
   - `GET /v1/health/detailed` (must be `status: ok`)
   - `GET /v1/rankings?horizon=10` (must return ≥ 1 ranking)
   - `GET /v1/agents/NVDA` (must return signals)
   If any fails, block the merge to `main`.

## Cost

Two Railway services + Postgres ≈ +$10/mo. Vercel staging branch is free under
the hobby plan. Worth it the first time staging catches a bad migration.
