#!/bin/bash
# launchd wrapper for the auto paper-trader — homed in falcon-copier/, runs from repo root.
echo "$(date '+%Y-%m-%d %H:%M:%S') alive" > /tmp/bellwether_last_tick.txt
cd "/Users/saiyeeshrathish/the final plan" || exit 0
export ENV_FILE="/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env"
export ENV_FILE_PATH="$ENV_FILE"
export DATABASE_URL=
/usr/local/bin/node falcon-copier/autotrade.mjs >> falcon-copier/autotrade_cron.log 2>&1
