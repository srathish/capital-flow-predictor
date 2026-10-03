#!/bin/bash
cd "$(dirname "$0")/.."
for v in current vix std confluence calf calfnovix; do
  for pair in 2026-09-21:2026-09-25 2026-09-28:2026-10-02; do a=${pair%%:*}; b=${pair##*:}
    node shadow/week.mjs --from $a --to $b --criteria $v > shadow/reports/week_${a}_${v}.txt 2>&1 || echo "FAIL $v $a"
  done
  echo "variant $v done"
done
echo "ALL VARIANTS DONE"
