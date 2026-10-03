#!/bin/bash
cd "$(dirname "$0")/.."
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT; do
  for per in 2026-04-01:2026-06-30 2026-07-01:2026-10-02; do a=${per%%:*}; b=${per##*:}
    for v in inverse inverse_trend; do node shadow/stock.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/inv_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"; done
  done; echo "$s done $(date +%H:%M)"
done
echo "INVERSE ALL DONE"
