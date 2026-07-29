#!/bin/bash
# FORWARD-TEST HARNESS (falcon-copier) — runs the validated multi-instrument scanner (scan_multi.mjs) every 60s
# during RTH and appends a clean, DEDUPED blotter of WOULD-FIRE events to falcon-copier/forward_<date>.log.
# Observer only — no real orders. This is the honest out-of-sample gate: the engine was fit to 07-29's known
# Falcon plays; this records what it fires on days it has never seen, so we can compare vs Falcon each day.
echo "$(date '+%F %T') fwd-alive" > /tmp/bellwether_forward_tick.txt
HHMM=$(TZ=America/New_York date +%H%M); DOW=$(TZ=America/New_York date +%u)
# RTH gate: Mon–Fri, 09:30–16:00 ET (lexical HHMM compare in [[ ]]). No-op otherwise so the log stays clean.
if [[ "$DOW" -gt 5 || "$HHMM" < "0930" || "$HHMM" > "1600" ]]; then exit 0; fi
cd "/Users/saiyeeshrathish/the final plan" || exit 0
export ENV_FILE="/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env"
export ENV_FILE_PATH="$ENV_FILE"
export DATABASE_URL=
LOG="falcon-copier/forward_$(TZ=America/New_York date +%F).log"
OUT=$(/usr/local/bin/node falcon-copier/scan_multi.mjs 2>/dev/null)
FIRE=$(echo "$OUT" | grep ">>> BEST")
if [ -n "$FIRE" ]; then
  SIG=$(echo "$FIRE" | sed 's/(confluence.*//')                          # dedupe key: same instrument/kind/dir/anchor = one entry
  LAST=$(cat /tmp/bellwether_forward_last.txt 2>/dev/null)
  if [ "$SIG" != "$LAST" ]; then
    echo "$SIG" > /tmp/bellwether_forward_last.txt
    { echo "─── $(TZ=America/New_York date '+%F %H:%M') ET ───"; echo "$OUT" | grep -E 'SPXW|SPY |QQQ |>>> BEST'; echo ""; } >> "$LOG"
  fi
fi
