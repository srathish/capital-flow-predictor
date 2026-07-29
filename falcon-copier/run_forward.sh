#!/bin/bash
# FORWARD SHADOW-LOG — validate the Falcon-replica on REAL 0DTE marks, one day, AFTER CLOSE.
# This is the only honest test of realized capture (UW keeps intraday option marks for the
# current day only; historical intraday isn't available, and modeling 0DTE P/L is unreliable).
# Run this each trading day after 16:00 ET to accumulate a real sample (~2 weeks -> n>=20-30).
#
# Usage: ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env \
#        DATABASE_URL= bash research/doctrine/run_forward.sh 2026-07-29
set -e
DAY="${1:?usage: run_forward.sh YYYY-MM-DD}"
cd "$(dirname "$0")/../.."   # -> apps/gex
NODE=/usr/local/bin/node
echo "=== FORWARD SHADOW-LOG $DAY ==="
# 1) pull the day's SPXW surface (Skylit) + SPY/VIXY aux (UW) — resumable, skips if present
$NODE research/doctrine/pull_range.mjs "$DAY" "$DAY"
# 2) score just this day (discipline gate) and emit its signals
$NODE research/doctrine/score.mjs "$DAY" --discipline --emit | grep -E "DISCIPLINE|emitted"
# 3) price those signals on REAL 0DTE marks with the fixed management rule (+30% / -40% / EOD)
#    and append a dated block to the running forward log
{
  echo ""
  echo "### $DAY  (logged $(date -u +%Y-%m-%dT%H:%MZ))"
  $NODE research/doctrine/option_bt.mjs 30 40 | grep -vE "^\[|Warning|bootstrap"
} >> research/doctrine/forward_log.txt
echo "appended $DAY -> research/doctrine/forward_log.txt"
tail -6 research/doctrine/forward_log.txt
