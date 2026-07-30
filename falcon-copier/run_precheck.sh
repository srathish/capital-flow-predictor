#!/bin/bash
# MORNING AUTH PRECHECK — every weekday morning (08:30–09:15 ET, once), verify Skylit session B is ALIVE before
# the open, so a dead/rotated Clerk cookie never silently eats a trading day. On failure: a macOS notification +
# an alert file so you re-login (cfp-jobs skylit-login) before 09:30. Scheduled every 15 min via launchd; the
# window gate + once-per-day marker make it fire just once each morning. TZ-robust (uses America/New_York).
echo "$(date '+%F %T') precheck-alive" > /tmp/bellwether_precheck_tick.txt
HHMM=$(TZ=America/New_York date +%H%M); DOW=$(TZ=America/New_York date +%u); TODAY=$(TZ=America/New_York date +%F)
if [[ "$DOW" -gt 5 || "$HHMM" < "0830" || "$HHMM" > "0915" ]]; then exit 0; fi   # weekday morning window only
[ "$(cat /tmp/bellwether_precheck_day 2>/dev/null)" = "$TODAY" ] && exit 0        # already ran today
echo "$TODAY" > /tmp/bellwether_precheck_day
cd "/Users/saiyeeshrathish/the final plan" || exit 0
export ENV_FILE="/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env"
export ENV_FILE_PATH="$ENV_FILE"; export DATABASE_URL=
LOG=/tmp/bellwether_precheck.log
if /usr/local/bin/node falcon-copier/preflight.mjs >> "$LOG" 2>&1; then
  echo "$(date '+%F %T') ✓ Skylit auth OK — cleared for the open" >> "$LOG"
  rm -f /tmp/bellwether_auth_ALERT.txt
  osascript -e 'display notification "Skylit auth healthy — agent cleared for the open." with title "🦅 Falcon precheck ✓"' 2>/dev/null
else
  echo "$(date '+%F %T') ✗ Skylit auth DOWN — re-login before 09:30" >> "$LOG"
  printf 'Skylit session B is DOWN (%s ET).\nRe-login before the open:\n  cd "apps/jobs" && uv run cfp-jobs skylit-login --env-file "apps/gex/research/stock-gex/session-b.env"\n' "$HHMM" > /tmp/bellwether_auth_ALERT.txt
  osascript -e 'display notification "Skylit auth DOWN — re-login before the open (cfp-jobs skylit-login)." with title "⚠️ Falcon precheck FAILED"' 2>/dev/null
fi
