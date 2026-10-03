#!/bin/bash
# OUT-OF-UNIVERSE test: the frozen v1 rules on 10 symbols never used in any design or selection step.
cd "$(dirname "$0")/.."
for s in NFLX CRM ADBE COST JPM PLTR MU QCOM COIN UBER; do
  for per in 2026-01-02:2026-03-31 2026-04-01:2026-06-30 2026-07-01:2026-10-02; do a=${per%%:*}; b=${per##*:}
    for v in inverse_trend_vex confluence_trend_vex current; do
      node shadow/stock2.mjs --symbol $s --from $a --to $b --criteria $v > shadow/reports/nn_${s}_${a}_${v}.txt 2>&1 || echo "FAIL $s $a $v"
    done
  done; echo "$s done $(date +%H:%M)"
done
echo "NEWNAMES ALL DONE"
