#!/usr/bin/env bash
# Atlas beginning-of-day scan. Refreshes the day's data then re-runs the funnel
# and writes plays_latest.json (which the always-on server serves all day).
# Each step is non-fatal so a partial refresh still updates what it can.
# Research/observation only — no orders, never touches the 0DTE tracker.
#
# Run by cron ~9:20 ET weekdays, or manually:  bash research/campaign/server/morning_scan.sh
set -u
# make node + uv resolvable under launchd/cron (minimal env)
export PATH="/usr/local/bin:/Users/saiyeeshrathish/.local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/../../.." || exit 1   # -> apps/gex
LOG="research/campaign/server/morning_scan.log"
echo "=== morning scan $(date '+%Y-%m-%d %H:%M:%S %Z') ===" >> "$LOG"

step() { echo "[$(date '+%H:%M:%S')] $1" >> "$LOG"; }

# 1. Freshen the universe surface (last 2 days only — fast vs the 64d backfill).
#    --max-expirations=20 archives the further-out 2026 monthlies (8/21, 9/18…)
#    so the swing scan finds the King node regardless of expiry, not truncated at 5wk.
step "surface refresh (last 2 days, full monthly chain)"
node scripts/archive-skylit.js --mode=universe-daily --days-back=2 --max-expirations=20 >> "$LOG" 2>&1 || step "surface refresh failed (using existing archive)"

# 2. Re-pull the 90d flow for the universe (overwrites cache -> new completed day)
step "flow refresh (force)"
FLOW_FORCE=1 node research/campaign/backtest/fetch_flow.js >> "$LOG" 2>&1 || step "flow refresh failed (using existing cache)"

# 3. Funnel -> candidates (validated intersection rule)
step "gen_plays"
uv run --with numpy python research/campaign/gen_plays.py >> "$LOG" 2>&1 || step "gen_plays failed"

# 4. Live option prices for the candidates
step "fetch_prices"
node research/campaign/fetch_prices.js >> "$LOG" 2>&1 || step "fetch_prices failed"

# 5. Finalize (rules + spread gate) -> plays_latest.json
step "finalize"
uv run python research/campaign/finalize_plays.py >> "$LOG" 2>&1 && step "DONE — plays_latest.json updated" || step "finalize failed"
