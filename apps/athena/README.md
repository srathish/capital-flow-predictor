# Athena — advisory signal generator

Deterministic features (UW API, spec-verified whitelist) → Claude thesis (web search +
brain-vault knowledge, T1 first) → risk gatekeeper → SQLite journal → Discord alert.
**No execution code exists.** The journal is the paper track record that gates any
future autonomy step. All storage is local (`apps/athena/data/`).

## Commands

```bash
uv run --package athena athena cycle --once              # full watchlist, one pass
uv run --package athena athena cycle --ticker SPY --no-llm  # features only (free, fast)
uv run --package athena athena run                       # market-hours loop (09:31-16:00 ET)
uv run --package athena athena ui                        # 🦉 console at http://127.0.0.1:8321
uv run --package athena athena report | journal          # today / recent cycles
uv run --package athena athena kill | unkill             # kill switch
```

## Autostart (launchd)

The market-hours loop costs real money (UW calls + ~26 LLM cycles/ticker/day),
so it is NOT auto-installed. To enable:

```bash
cp apps/athena/launchd/com.bellwether.athena-loop.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.bellwether.athena-loop.plist
# logs: tail -f /tmp/athena-loop.log        disable: launchctl unload ...
```

Weekly brain sweep (Sunday 09:00, inbox-only + git push):

```bash
cp apps/brain/launchd/com.bellwether.brain-sweep.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.bellwether.brain-sweep.plist
```

## Config

`src/athena/config.py` — conviction floor 0.65, 6 alerts/day, staleness breaker 300s,
watchlist in `watchlist.yaml` (SPXW/SPY/QQQ only in v1). Env: `UNUSUAL_WHALES_API_KEY`,
`ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL` (optional), `ATHENA_MODEL` (optional).
