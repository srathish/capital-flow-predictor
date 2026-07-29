#!/bin/bash
# Cron wrapper for the auto paper-trader. Runs one tick; safe to call every 5 min (RTH-gated inside).
echo "$(date '+%Y-%m-%d %H:%M:%S') alive" > /tmp/bellwether_last_tick.txt   # heartbeat (overwrites)
cd "/Users/saiyeeshrathish/the final plan/apps/gex" || exit 0
export ENV_FILE=research/stock-gex/session-b.env
export ENV_FILE_PATH=research/stock-gex/session-b.env
export DATABASE_URL=
/usr/local/bin/node research/doctrine/autotrade.mjs >> research/doctrine/autotrade_cron.log 2>&1
