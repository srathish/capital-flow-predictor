# earnings-mcp — Unusual Whales research connector

MCP server exposing the **entire Unusual Whales public API** (197 read-only endpoint
tools, generated from their OpenAPI spec) plus **5 composite research tools** that fan
out across endpoints and return distilled evidence blocks — built for finding
earnings-potential names (the CRWD/CRM "destroyed earnings" scan) and single-name
workups from claude.ai or Claude Code.

Standalone app: **not** in the pnpm workspace; it has its own `node_modules`
(`npm install` here) and its own Dockerfile, so it never touches the gex build.

## Composite tools (start here)

| tool | what it does |
|---|---|
| `upcoming_earnings_calendar` | who reports over the next N days, with implied move |
| `earnings_setup` | one ticker: implied move vs last-8 reaction history, IV crush risk, flow lean |
| `post_earnings_movers` | who reported on a date and how far they actually moved vs implied |
| `research_ticker` | the full uw-research battery in one call (price/catalyst/IV/flow/dark pool/γ/max pain/analysts/insiders) |
| `flow_conviction_check` | ask-side %, sweeps, vol>OI, OI growth — is the flow real conviction or a capped spread? |

The workflow the tools are designed around:
`upcoming_earnings_calendar` → `earnings_setup` on interesting names →
`flow_conviction_check` before any strike talk → raw endpoint tools for drill-downs.
The connected Claude does the synthesis — no LLM calls inside the server.

## Raw endpoint tools

Everything in the UW public API as `{tag}_{action}` tools: `stock_*` (38),
`market_*` (12), `gex_greeks_*` (11), `screener_*`, `darkpool_*`, `earnings_*`,
`insiders_*`, `congress_*`, `institution_*`, `short_*`, `option_trade_*`,
`volatility_*`, `seasonality_*`, `news_feed`, etc. GET-only (the API's lone POST —
alert save — is excluded on purpose), websocket channels excluded.

Regenerate after a UW spec update:

```bash
UNUSUAL_WHALES_API_KEY=... node generate.mjs --fetch   # refresh uw-openapi.json + tools.json
node smoke.mjs CRWD                                     # end-to-end check
```

Review the `tools.json` diff before committing — the manifest is the contract.

## Run locally (Claude Code / Claude Desktop — stdio)

```bash
claude mcp add uw-research -- node "/Users/saiyeeshrathish/the final plan/apps/earnings-mcp/server.mjs"
```

Key resolution: `UNUSUAL_WHALES_API_KEY` env var, falling back to the repo-root `.env`.

## Deploy as a claude.ai custom connector (Streamable HTTP)

claude.ai custom connectors need a public HTTPS endpoint. See `railway.toml` for the
Railway service setup. In short:

1. New Railway service on this repo, Dockerfile path `apps/earnings-mcp/Dockerfile`.
2. Set `UNUSUAL_WHALES_API_KEY` and `MCP_PATH_TOKEN` (long random secret).
3. Generate a domain, then in claude.ai → Settings → Connectors → **Add custom connector**:
   `https://<domain>/mcp/<MCP_PATH_TOKEN>`

The token-in-path is the auth (claude.ai can't send custom headers without OAuth).
Treat the full URL as a secret; rotate `MCP_PATH_TOKEN` to revoke.

Local HTTP test: `PORT=8787 node server.mjs` → endpoint at `http://localhost:8787/mcp`.

## Notes

- Responses are truncated at 45k chars — narrow with `limit`/`date`/`page` params.
- `earnings_setup` has no EPS beat-rate: UW `actual_eps` is GAAP vs adjusted
  `street_mean_est` — not comparable. Price reaction history is the signal.
- Doctrine caveats are embedded in tool output: flow is a lean not proof; UW dealer
  gamma is context, not the Skylit GEX/VEX doctrine.
