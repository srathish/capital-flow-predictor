#!/bin/zsh
# waits on PIDs (not names), then runs the queued pulls
cd "/Users/saiyeeshrathish/the final plan/new-and-improved-system"
if [ "$1" = sec ]; then while kill -0 7845 2>/dev/null; do sleep 20; done; node world/exposure_all.mjs 2> world/exposure_all.log; node world/collect.mjs meta 2> world/meta.log; node world/collect.mjs links 2> world/links.log; echo SEC-CHAIN-DONE >> world/links.log; fi
if [ "$1" = uw ]; then while kill -0 8934 2>/dev/null; do sleep 20; done; SKYLIT_BUDGET=0 node world/collect.mjs fundamentals 2> world/fundamentals.log; echo UW-CHAIN-DONE >> world/fundamentals.log; fi
