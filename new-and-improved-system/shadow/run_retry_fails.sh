#!/bin/bash
# After the Q1 holdout AND the v2 run both finish, re-run every combination that FAILed (one job at a time = within the rate limit).
cd "$(dirname "$0")/.."
until grep -q "Q1 ALL DONE" shadow/reports/run_q1.log 2>/dev/null && grep -q "V2 ALL DONE" shadow/reports/run_v2.log 2>/dev/null; do sleep 30; done
grep '^FAIL' shadow/reports/run_q1.log | while read -r _ s v; do
  echo "retry q1 $s $v"; node shadow/stock.mjs --symbol $s --from 2026-01-02 --to 2026-03-31 --criteria $v > shadow/reports/q1_${s}_${v}.txt 2>&1 || echo "STILL FAIL q1 $s $v"
done
grep '^FAIL' shadow/reports/run_v2.log | while read -r _ s a v; do
  b=$([ "$a" = "2026-04-01" ] && echo 2026-06-30 || echo 2026-10-02)
  echo "retry v2 $s $a $v"; node shadow/stock2.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/v2_${s}_${a}_${v}.txt 2>&1 || echo "STILL FAIL v2 $s $a $v"
done
echo "RETRY ALL DONE"
