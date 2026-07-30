# Skylit-native data endpoints (discovered 2026-07-30)

All on `https://app.skylit.ai`, authed with the Clerk JWT (`getFreshToken()` from `apps/gex/src/heatseeker/auth.js`,
same as `/api/data`). Present browser-matching headers (Origin/Referer/User-Agent) — requests look like the app on your session.
The `/fs/api/` prefix is **Flowseeker**; plain `/api/` is **Heatseeker/projectgex-api**. Blind path-guessing hits a
catch-all health page — these were found by capturing the app's real network traffic (`capture_endpoints.py`).

## REST (what the per-minute agent uses)
| Data | Endpoint | Notes |
|---|---|---|
| GEX / VEX | `/api/data?symbol=SPXW&max_strikes=200&max_expirations=10` | per-strike `GammaValues`/`VannaValues`, `CurrentSpot`, `PreviousClose`. GEX heatmap. |
| Dark-pool prints | `/fs/api/dark-pool/trades?min_notional=1000000&limit=500&order=desc` | array of `{ts_event,ticker,price,size,total_value,venue,sector,industry,pct_avg_vol}` — real prints (filter to SPY/QQQ/IWM/DIA for index levels). |
| Dark-pool sectors | `/fs/api/dark-pool/sector-summary` | `{sector,total_notional,total_size,prints,share,top}` |
| Market tide (flow lean) | `/fs/api/market/tide?interval=1D&bucket=1min` | `data.bars[]` with `ncp`/`npp` (net call/put premium) + `_cumulative`. Lean = `ncp_cumulative − npp_cumulative`. |
| Market overview | `/fs/api/market/overview` | `{date,total_premium,total_volume,...}` market-wide. |
| Glitch feed | `/api/glitch/feed` | Glitch's Discord posts w/ `signalScore,setupType,sentiment,summary`. |

## Streams (real-time; not polled by the agent yet)
| Data | URL | Auth |
|---|---|---|
| GEX live | `/api/stream?symbol=SPXW&ticket=<T>&max_strikes=500` | ticket from `POST /api/sse/ticket` |
| Dark-pool live | `wss://fs-ws.skylit.ai/ws/dark-feed?token=<JWT>` | Clerk JWT |
| **Flow tape (multiplexed)** | `wss://fs-ws.skylit.ai/ws/feed/multiplexed?token=<JWT>` | Clerk JWT — the granular options-flow tape lives here |
| Notifications | `/siren/notifications/stream?token=<JWT>` | |

## Not yet found
- **VIX** — no `/fs/api/*vix*` route (all 404). Likely inside the multiplexed WS or `market/overview`. Bonus, not one of the 7 criteria.
- Granular per-ticker options flow — the multiplexed WS (tide REST gives the net lean synchronously, which covers the "flow" criterion).

## Auth / re-login
Clerk cookie expires (~overnight). Re-login (headed Discord OAuth):
`cd apps/jobs && uv run cfp-jobs skylit-login --env-file "apps/gex/research/stock-gex/session-b.env"`
Morning precheck (`run_precheck.sh`) verifies it before the open.
