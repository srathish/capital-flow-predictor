# Post-deploy verification runbook

Run after every prod deploy. Takes ~60 seconds.

## TL;DR

```bash
API_BASE=https://api.bellwether.app API_KEY=$BELLWETHER_API_KEY \
  ./scripts/smoke_test.sh
```

Exit code 0 = all green. Anything else = roll back or investigate before
moving on.

## What the smoke test covers

| Step | Endpoint                      | Expectation                                          |
|------|-------------------------------|------------------------------------------------------|
| 1    | `GET /health`                 | 200, `{"status":"ok"}`                               |
| 2    | `GET /`                       | 200, version string                                  |
| 3    | `GET /metrics`                | 200, contains `cfp_http_requests_total`              |
| 4    | `GET /v1/health/detailed`     | 200, contains `tables[]` and `status`                |
| 5    | `GET /v1/rankings` (no key)   | 401 when `API_KEYS` is set                           |
| 6    | `GET /v1/rankings` (with key) | 200 or 404 (404 = no data yet, still proves auth ok) |

## Manual deeper checks (do these the first time after enabling auth)

```bash
# Rate limiter should kick in after 30 run calls/hour from the same key.
for i in $(seq 1 35); do
    curl -s -o /dev/null -w '%{http_code} ' \
         -H "Authorization: Bearer $API_KEY" \
         -X POST "$API_BASE/v1/agents/NVDA/run"
done; echo
# Expect: 30 × 202, then 5 × 429 with Retry-After in the response headers.
```

```bash
# Detailed health should flag stale tables if any.
curl -s -H "Authorization: Bearer $API_KEY" "$API_BASE/v1/health/detailed" \
    | jq '.stale_tables'
```

```bash
# Custom watchlist — session-keyed, doesn't need API_KEY when auth is disabled.
SID="$(uuidgen | tr -d - | cut -c1-16)"
curl -s -H "X-Session-Id: $SID" -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -X POST "$API_BASE/v1/watchlist/custom/add" \
     -d '{"ticker":"NVDA","note":"smoke test"}' | jq
```

## When something fails

| Symptom                                | Likely cause                                          | Fix                                              |
|----------------------------------------|-------------------------------------------------------|--------------------------------------------------|
| `/health` returns 503                  | DB pool unhealthy                                     | Check Railway Postgres status; restart API svc   |
| `/v1/health/detailed.stale_tables[]` non-empty | A cron in `.github/workflows/data-refresh.yml` is failing | Check GH Actions runs; rerun the failing job     |
| `/v1/rankings` returns 200 without a key when `API_KEYS` is set | Env var not picked up by the running container | Restart Railway service; verify in Settings → Variables  |
| `/metrics` returns 404                 | Old code still serving                                | Force redeploy; check `__version__` from `/`     |
| 401 with a key that *should* work      | Key has whitespace or wrong prefix                    | `echo -n "$API_KEY" \| wc -c` should match what you set in Railway |

## RPO / RTO targets

See `infra/rollback/README.md`. In short: prod RPO ≤ 24h, RTO ≤ 1h, mechanism
is Railway daily snapshot + PITR. If you have to restore, the steps are:

1. Railway dashboard → Postgres → Backups → select snapshot → Restore
2. Re-apply forward migrations (`apply_pending_migrations` runs on boot)
3. Re-run today's data-refresh jobs manually from GH Actions
4. Run this runbook
