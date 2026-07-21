#!/usr/bin/env bash
# Clean SINGLE-INSTANCE launcher for the plays tracker.
# Prevents the double-run cookie-clobber that zeroed 7/21 (two trackers on one
# Skylit session rotate each other's cookie to death), and preflights auth first.
#
# Usage (tomorrow morning, before 9:30 ET):
#   ./scripts/start-tracker.sh
# If auth is dead it tells you to re-auth; re-run after that.
set -euo pipefail
cd "$(dirname "$0")/.."          # -> apps/gex
NODE=/usr/local/bin/node

# 1. guard: never double-launch
if pgrep -f "plays-tracker.js" >/dev/null 2>&1; then
  echo "⛔ a plays-tracker is ALREADY running (pid $(pgrep -f plays-tracker.js | head -1))."
  echo "   Running a second one clobbers the Skylit cookie (this zeroed 7/21)."
  echo "   To restart clean:  pkill -9 -f plays-tracker.js  &&  ./scripts/start-tracker.sh"
  exit 1
fi

# 2. preflight auth (same path the tracker uses)
echo "→ auth preflight…"
if ! "$NODE" scripts/auth-preflight.js; then
  echo "⛔ Skylit auth is dead. Re-auth, then re-run this script:"
  echo "     cd ../jobs && uv run cfp-jobs skylit-login"
  exit 1
fi

# 3. launch ONE tracker with the live v2 stack
echo "→ launching tracker: v2 exit + UW observation logging + bull-tape gate"
exec env EXIT_LOGIC_VERSION=v2 ENABLE_UW_OBSERVATION_LOGGING=true ENABLE_BULL_TAPE_GATE=true \
  "$NODE" scripts/plays-tracker.js
