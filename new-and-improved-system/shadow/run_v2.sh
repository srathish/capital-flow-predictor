#!/bin/bash
# v2 = extra Skylit layers (VEX, rolling map, earnings blackout, flow). Waits for the OOS run, then runs
# attribution variants on BOTH periods so each layer must hold up in-sample AND out-of-sample.
cd "$(dirname "$0")/.."
until grep -q "OOS ALL DONE" shadow/reports/run_oos.log 2>/dev/null; do sleep 20; done
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT; do
  for per in 2026-04-01:2026-06-30 2026-07-01:2026-10-02; do a=${per%%:*}; b=${per##*:}
    for v in trend trend_vex trend_rolling trend_earn v2 v2_full; do
      node shadow/stock2.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/v2_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"
    done
  done; echo "$s done $(date +%H:%M)"
done
echo "V2 ALL DONE"
