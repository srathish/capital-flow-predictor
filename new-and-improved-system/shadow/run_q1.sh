#!/bin/bash
# Fresh holdout Jan–Mar 2026 — never touched by any rule design. Judges inverse_trend (designed on Apr–Sep) and confluence_trend.
cd "$(dirname "$0")/.."
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT; do
  for v in inverse_trend confluence_trend current; do
    node shadow/stock.mjs --symbol $s --from 2026-01-02 --to 2026-03-31 --criteria $v > shadow/reports/q1_${s}_${v}.txt 2>&1 || echo "FAIL $s $v"
  done; echo "$s done $(date +%H:%M)"
done
echo "Q1 ALL DONE"
