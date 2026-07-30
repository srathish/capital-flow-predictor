#!/bin/bash
# ONE COMMAND — preflight Skylit auth, start the live agent loop + the dashboard, open the browser.
#   bash "falcon-copier/go.sh"
cd "/Users/saiyeeshrathish/the final plan" || exit 1
export ENV_FILE="/Users/saiyeeshrathish/the final plan/apps/gex/research/stock-gex/session-b.env"
export ENV_FILE_PATH="$ENV_FILE"; export DATABASE_URL=
NODE=/usr/local/bin/node
echo "══ 🦅 Falcon agent — one-command launch ══"
echo "── preflight: Skylit auth ──"
if ! $NODE falcon-copier/preflight.mjs; then
  echo ""
  echo "⚠  Skylit auth is DOWN. Re-login (a browser opens — sign in with Discord), then re-run this command:"
  echo "     cd \"apps/jobs\" && uv run cfp-jobs skylit-login --env-file \"$ENV_FILE\""
  exit 1
fi
pkill -f "agent.mjs --loop" 2>/dev/null; pkill -f "falcon-copier/dashboard.mjs" 2>/dev/null; sleep 1
echo "── dashboard → http://localhost:8790 ──"
$NODE falcon-copier/dashboard.mjs > /tmp/falcon_dashboard.log 2>&1 &
echo "── live agent loop (reasons over all data every minute during RTH) ──"
$NODE falcon-copier/agent.mjs --loop --live > /tmp/falcon_agent.log 2>&1 &
sleep 3
open "http://localhost:8790"
echo ""
echo "✓ running — dashboard open in your browser (SPX/SPY/QQQ + the agent's trades)."
echo "   watch the agent think:  tail -f /tmp/falcon_agent.log"
echo "   stop everything:        pkill -f 'agent.mjs --loop'; pkill -f falcon-copier/dashboard.mjs"
