#!/bin/bash
# Pre-registered Glitch/Giul validation, 0-credit (cached maps). Tripwire: abort if >1000 Skylit credits spent.
cd "$(dirname "$0")/.."
cred() { node -e 'import("./feeds/skylit.js").then(async m=>console.log((await m.account()).creditsBalance))' 2>/dev/null; }
START=$(cred); echo "start credits $START"
P="2026-01-02:2026-03-31 2026-04-01:2026-06-30 2026-07-01:2026-10-02"
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT NFLX CRM ADBE COST; do
  for per in $P; do a=${per%%:*}; b=${per##*:}
    for v in current inverse_trend_vex; do node shadow/stock2.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/gl_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"; done
    for v in r1g r3 r3t g1; do node shadow/stock3.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/gl_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"; done
  done
  NOW=$(cred); echo "$s done $(date +%H:%M) credits $NOW"
  if [ -n "$START" ] && [ -n "$NOW" ] && [ $((START - NOW)) -gt 1000 ]; then echo "TRIPWIRE: spent $((START - NOW)) credits — stopping"; break; fi
done
echo "GLITCH ALL DONE"
