#!/bin/bash
# Full re-validation after the daily-history fix (2026-10-03). Same frozen rules; nothing re-selected.
cd "$(dirname "$0")/.."
P="2026-01-02:2026-03-31 2026-04-01:2026-06-30 2026-07-01:2026-10-02"
for s in AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT; do
  for per in $P; do a=${per%%:*}; b=${per##*:}
    for v in current inverse_trend inverse_trend_vex confluence_trend confluence_trend_vex; do
      node shadow/stock2.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/rv_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"
    done
  done; echo "orig $s done $(date +%H:%M)"
done
echo "ORIGINAL10 DONE"
for s in NFLX CRM ADBE COST JPM PLTR MU QCOM COIN UBER; do
  for per in $P; do a=${per%%:*}; b=${per##*:}
    for v in current inverse_trend_vex confluence_trend_vex; do
      node shadow/stock2.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/rv_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"
    done
  done; echo "new $s done $(date +%H:%M)"
done
echo "NEWNAMES DONE"
rm -f live/state/replay.json && node live/runner.mjs --replay 2026-07-01 2026-10-02 > shadow/reports/rv_runner_replay.txt 2>&1 || echo "FAIL runner replay"
echo "REVALIDATE ALL DONE"
