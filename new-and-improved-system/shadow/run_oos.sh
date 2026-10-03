#!/bin/bash
# Pre-registered rule (confluence_trend) + baselines: OUT-OF-SAMPLE Apr–Jun 2026, and IN-SAMPLE Jul–Sep re-run with the rule enforced at entry.
cd "$(dirname "$0")/.."
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT; do
  for v in confluence_trend confluence current; do
    node shadow/stock.mjs --symbol $s --from 2026-04-01 --to 2026-06-30 --criteria $v > shadow/reports/oos_${s}_${v}.txt 2>&1 || echo "FAIL oos $s $v"
  done
  node shadow/stock.mjs --symbol $s --from 2026-07-01 --to 2026-10-02 --criteria confluence_trend > shadow/reports/stock_${s}_confluence_trend.txt 2>&1 || echo "FAIL is $s"
  echo "$s done $(date +%H:%M)"
done
echo "OOS ALL DONE"
