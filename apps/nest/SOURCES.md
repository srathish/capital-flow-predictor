# Nest source audit — UW surface vs. what we ingest

The UW public API is ~190 endpoints. The Nest doesn't need all of them — many are
drill-downs, single-ticker variants, or non-signal utilities. This maps the surface to
what's ingested, what's planned toward the ~50-source target, and what's deliberately out.

Legend: ✅ ingested · 🔜 planned · ➖ context/regime (not a per-ticker conviction source) · ❌ excluded

## Flow family
- ✅ `option-trades/flow-alerts` (market-wide) → `uw_flow` — ask-side opening premium
- ✅ `darkpool/recent` (market-wide) → `uw_darkpool` — block accumulation
- 🔜 `option-trades/full-tape` sweeps → `uw_sweep` — aggressive sweep detection
- 🔜 `stock/{t}/lit-flow` → `uw_lit_flow`
- 🔜 `net-prem-ticks` → `uw_netprem` — intraday net premium slope

## Levels family (options structure)
- ✅ `stock/{t}/greek-exposure/strike` → `uw_gex` — dominant gamma wall
- 🔜 vanna from same payload (`call_vanna`+`put_vanna`) → `uw_vex`
- 🔜 charm → `uw_charm`; 🔜 `stock/{t}/max-pain` → `uw_maxpain`
- 🔜 `gex/greeks/gex-levels` (0DTE flip) → `uw_gexflip`

## Positioning family
- ✅ `insider/transactions` (market-wide) → `uw_insider`
- ✅ `congress/recent-trades` → `uw_congress`
- 🔜 `market/oi-change` (market-wide) → `uw_oi` — net call vs put OI (PACK 3)
- 🔜 `shorts/{t}/interest-float` + `shorts/{t}/data` → `uw_short` — squeeze fuel (PACK 3)
- 🔜 `institution/{t}/ownership` / 13F deltas → `uw_13f`

## Filings / news family
- ✅ `news/headlines` (market-wide) → `uw_news` — per-ticker sentiment
- 🔜 `screener/analysts` (market-wide) → `uw_analyst` — up/downgrade + PT (PACK 3)
- 🔜 EDGAR 8-K/S-1/424B poller → `edgar_*` (free, Tier 2)

## Chart family
- ✅ `stock/{t}/ohlc/1d` → `uw_chart` — SMA trend + momentum (self-computed)
- 🔜 `stock/{t}/ohlc/1d` RSI/breakout/volume-surge → `uw_breakout`, `uw_volsurge`
- 🔜 `stock/{t}/volatility/*` IV rank/skew/term → `uw_ivrank` (6-criteria gate)

## Fundamental family
- ✅ `stock/{t}/financials` → `uw_fundamentals` — revenue growth + profitability
- 🔜 margin/FCF/valuation decomposition → `uw_margins`, `uw_valuation`

## Catalyst layer (PACK 1) — ➖ why-now + risk gating, not directional score
- 🔜 `stock/{t}/info` `next_earnings_date` + `earnings/*` implied move → earnings proximity
- 🔜 `market/fda-calendar` → biotech binary events
- Feeds the Call thesis ("why now") and gates alerting *into* a binary event.

## Macro / regime (PACK 2) — ➖ scales the alert floor, not per-ticker
- ✅ `news/headlines` Fed/FOMC/Warsh + `market/economic-calendar` → regime dial
- 🔜 `market/market-tide` + sector tides → risk-on/off breadth
- 🔜 prediction markets (Kalshi/Polymarket) Fed odds → regime (Tier 2)

## Social family (later — needs infra) — currently EMPTY
- 🔜 Bellwether `discord_messages` (Postgres) → `discord:<caller>` per-caller scored
- 🔜 Reddit/Stocktwits mention velocity → `reddit_velocity`

## Excluded (per brief §4)
- ❌ crypto funding/liquidation (crypto-only), forex, futures — not equity signals
- ❌ anything that can't be timestamped against a price for grading
- ❌ per-ticker drill-down variants already covered by a market-wide feed

## Count
Wired today: 8 (`uw_flow`, `uw_darkpool`, `uw_gex`, `uw_insider`, `uw_congress`,
`uw_news`, `uw_chart`, `uw_fundamentals`) + regime dial. Packs 1–3 + vanna/charm/sweep
decomposition + social + EDGAR reach the ~50 target. Each earns its weight via the
tracker — a source that doesn't pay decays to zero, so breadth is safe (brief §12).
