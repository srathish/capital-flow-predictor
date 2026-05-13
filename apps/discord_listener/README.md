# Discord Listener

Read-only self-bot that mirrors plays from your joined Discord channels into
Postgres so the `Discord Alerts` tab in the Bellwether dashboard shows every
play in one place.

## How it works

1. Logs into Discord using a **user token** (your account, not a bot account).
2. Subscribes to the global message gateway — receives every message your
   account would see in any guild/channel/thread.
3. Filters each message against the `discord_sources` allowlist (configured
   via the `/discord/sources` page in the dashboard).
4. Inserts the survivors into `discord_messages`.

It never sends, edits, reacts, joins, or leaves anything. Single connection,
default reconnect/backoff.

## Getting your user token

> ⚠️ Anyone with this token has full access to your Discord account.
> Treat it like a password. If it leaks, reset your Discord password —
> that rotates the token.

1. Open Discord in a browser (not the desktop app).
2. DevTools → Network tab.
3. Click any channel to trigger a request.
4. Click the request → Headers → look for `Authorization: <long string>`.
5. Copy the value (without quotes).

## Local run

```bash
cd apps/discord_listener
uv pip install -e .  # or: pip install -e .
DATABASE_URL=postgresql://cfp:cfp@localhost:5432/cfp \
DISCORD_USER_TOKEN=your_token_here \
USE_SOURCE_ALLOWLIST=true \
python -m discord_listener.main
```

The listener exits cleanly on `SIGTERM` / `SIGINT`. Watch for
`discord_listener ready as <you>` in the logs; after that, every captured
message logs a one-line `captured <guild>/#<channel> ...` info line.

## Railway deploy

See `railway.toml` in this directory for the one-time setup.

Required env vars on the Railway service:

| Variable | Value |
|---|---|
| `DATABASE_URL` | linked from the shared Postgres plugin |
| `DISCORD_USER_TOKEN` | your token (secret) |
| `USE_SOURCE_ALLOWLIST` | `true` |
| `LOG_LEVEL` | `INFO` |

The service has no public networking — it only initiates an outbound
connection to Discord's gateway.

## Risk note

Using a user token to read messages technically violates Discord's Terms of
Service. Read-only, single-connection use is rarely enforced against in
practice, but the account *can* be banned. Two mitigations worth considering:

- Use a **secondary Discord account** that's only a member of the alert
  servers. If it gets flagged, you lose nothing important.
- Keep `USE_SOURCE_ALLOWLIST=true` and tighten the allowlist to the channels
  you actually care about — less captured data = less exposure.
