#!/bin/bash
cd "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/pipeline"
python3 system_v0.py > out_system_v0.txt 2>&1
python3 pnl_v0.py > out_pnl_v0.txt 2>&1
echo "DONE. system_v0 -> out_system_v0.txt ; pnl_v0 -> out_pnl_v0.txt"
grep -c "" out_system_v0.txt out_pnl_v0.txt
