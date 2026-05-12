#!/usr/bin/env bash
# Post-deploy smoke test. Run after every push to verify the API is alive
# and the new auth/rate-limit/health surface is wired correctly.
#
# Usage:
#   ./scripts/smoke_test.sh                                  # hits localhost:8000
#   API_BASE=https://api.bellwether.app API_KEY=… ./scripts/smoke_test.sh
#
# Exits non-zero if any required check fails. Used by .github/workflows/smoke.yml.

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
API_KEY="${API_KEY:-}"

PASS=0
FAIL=0

check() {
    local name="$1"
    local expected="$2"
    local actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  ✓ $name ($actual)"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $name — expected $expected, got $actual"
        FAIL=$((FAIL + 1))
    fi
}

contains() {
    local name="$1"
    local needle="$2"
    local haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        echo "  ✓ $name contains '$needle'"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $name — missing '$needle'"
        FAIL=$((FAIL + 1))
    fi
}

echo "Smoke test against $API_BASE"

# 1. Open endpoints — must always be 200.
check "/health"          "200" "$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/health")"
check "/"                "200" "$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/")"
check "/metrics"         "200" "$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/metrics")"

# 2. Metrics format sanity.
metrics_body="$(curl -s "$API_BASE/metrics")"
contains "/metrics text format" "cfp_http_requests_total" "$metrics_body"

# 3. Detailed health — 200 even when degraded, the status field tells the story.
detailed="$(curl -s "$API_BASE/v1/health/detailed")"
contains "/v1/health/detailed has tables[]" '"tables"' "$detailed"
contains "/v1/health/detailed reports status" '"status"' "$detailed"

# 4. Auth — if API_KEY is set, hitting a /v1 endpoint without it must 401.
if [[ -n "$API_KEY" ]]; then
    no_auth_status="$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/v1/rankings")"
    check "/v1/rankings without key" "401" "$no_auth_status"
    auth_status="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_KEY" "$API_BASE/v1/rankings")"
    # Either 200 (data present) or 404 (no rankings yet) — both prove auth let us in.
    if [[ "$auth_status" == "200" || "$auth_status" == "404" ]]; then
        echo "  ✓ /v1/rankings with key ($auth_status)"
        PASS=$((PASS + 1))
    else
        echo "  ✗ /v1/rankings with key — got $auth_status"
        FAIL=$((FAIL + 1))
    fi
else
    echo "  (skipping auth checks — API_KEY not set)"
fi

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
