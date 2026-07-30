#!/bin/bash
# ONE command to run the whole Falcon-copier system. Ensures the live launchd jobs are loaded (idempotent —
# safe to re-run), then streams the system's live output. The trader + flow/DP capture fire every 60s during
# RTH (09:30–16:00 ET) on their own; Ctrl-C just stops watching, the jobs keep running. Usage: bash falcon-copier/run.sh
cd "/Users/saiyeeshrathish/the final plan" || exit 1
export ENV_FILE="/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env"
export ENV_FILE_PATH="$ENV_FILE"; export DATABASE_URL=
echo "══ Falcon-copier LIVE ══"
echo "── preflight: checking Skylit + UW access ──"
SK_OK=1; /usr/local/bin/node falcon-copier/preflight.mjs || SK_OK=0
for j in autotrade flowdp; do launchctl load ~/Library/LaunchAgents/com.bellwether.$j.plist 2>/dev/null; done
DAY=$(date +%F)
echo "$(launchctl list | grep -c bellwether) bellwether jobs loaded:"; launchctl list | grep bellwether
if [ "$SK_OK" = 0 ]; then
  echo ""
  echo "⚠⚠ SKYLIT ACCESS IS DOWN — the trader will STAND ASIDE every tick until you re-login:"
  echo "     cfp-jobs skylit-login --env-file apps/gex/research/stock-gex/session-b.env"
  echo "   then re-run this command. (flow/DP capture is UW-only and runs regardless.)"
fi
echo "trader + flow/DP capture fire every 60s during RTH (09:30–16:00 ET). Ctrl-C stops watching; jobs keep running."
echo "── streaming status (per-tick thinking) + trades (fires + %P/L) ──"
touch "falcon-copier/status_$DAY.txt" "falcon-copier/trades_$DAY.txt"
tail -F "falcon-copier/status_$DAY.txt" "falcon-copier/trades_$DAY.txt"
