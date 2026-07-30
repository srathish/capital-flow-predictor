#!/bin/bash
# Capture flow + dark-pool + tide every 60s during RTH — UW only (no Skylit / no session B), so it runs safely
# ALONGSIDE autotrade (different data source, no Clerk cookie to clobber). Feeds velocity-capture/flowdp_<day>.jsonl,
# which a future backtest joins with the GEX replay by timestamp to make the flow/dp confluence layers testable.
echo "$(date '+%F %T') flowdp-alive" > /tmp/bellwether_flowdp_tick.txt
HHMM=$(TZ=America/New_York date +%H%M); DOW=$(TZ=America/New_York date +%u)
# RTH gate: Mon–Fri, 09:30–16:00 ET (matches the GEX replay capture window). No-op otherwise.
if [[ "$DOW" -gt 5 || "$HHMM" < "0930" || "$HHMM" > "1600" ]]; then exit 0; fi
cd "/Users/saiyeeshrathish/the final plan" || exit 0
export ENV_FILE="/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env"
export ENV_FILE_PATH="$ENV_FILE"
export DATABASE_URL=
/usr/local/bin/node falcon-copier/capture_flowdp.mjs >> falcon-copier/flowdp_capture.log 2>&1
