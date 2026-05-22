# cfp-uw-socket

Long-running Python service that subscribes to Unusual Whales WebSocket
channels and writes events into Postgres for the Pulse tape and the
Explosive Board.

## Channels

| Channel | Table | Volume | Purpose |
|---|---|---|---|
| `flow_alerts` | `uw_flow_alerts` | medium | Per-ticker unusual options flow alerts |
| `option_trades` | `uw_option_trades_stream` | **high** (batched) | The live option tape |
| `gex` | `uw_greek_exposure_intraday` | medium | Tick-level GEX updates |
| `market_tide` | `uw_market_tide` | low | Net call/put premium pressure |
| `trading_halts` | `uw_trading_halts` | rare | LULD pauses, news pending, regulatory halts |

Plus a periodic HTTP poll of `/news/headlines` → `uw_news_global`
(WebSocket doesn't expose news).

## Run locally

```bash
cd apps/uw_socket
pip install -e .
export DATABASE_URL=postgres://...
export UNUSUAL_WHALES_API_KEY=...
python -m cfp_uw_socket.main
```

## Deploy to Railway

See `railway.toml` — one-time dashboard setup steps are documented at
the top of that file. Recap: new service from this repo, Dockerfile
path `apps/uw_socket/Dockerfile`, 4 env vars, ON_FAILURE restart.

## Architecture

Each channel runs in its own asyncio task with an independent reconnect
loop (exponential backoff capped at 60s; 5-minute hold on HTTP 403/404
since that usually means the channel isn't on the current UW tier).

High-volume channels (`option_trades`) batch up to 200 rows or 2 seconds,
whichever comes first, before flushing through a single pool acquisition.
Low-volume channels write per-event.

Handlers are pure: each takes a raw WebSocket message and returns
`(SQL, params)` or `None`. Main owns the pool and the loop, so handlers
are unit-testable without infrastructure.

## Tier note

If a channel handshake returns 403/404, the loop logs `handshake rejected`
and waits 5 minutes before retrying. Other channels keep running. You can
disable a channel without redeploying by editing the `UW_SOCKET_CHANNELS`
env var in Railway and restarting.
