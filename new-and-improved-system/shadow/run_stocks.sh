#!/bin/bash
# 10 liquid names × 4 variants, 3 months, weekly options. Boards cached per symbol after the first variant.
cd "$(dirname "$0")/.."
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT; do
  for v in current calf calfnovix confluence; do
    f=shadow/reports/stock_${s}_${v}.txt
    node shadow/stock.mjs --symbol $s --from 2026-07-01 --to 2026-10-02 --criteria $v > $f 2>&1 || echo "FAIL $s $v"
  done; echo "$s done $(date +%H:%M)"
done
echo "STOCKS ALL DONE"
