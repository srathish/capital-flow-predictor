---
title: Phase 0 — Endpoint History Inventory (2026-07-11)
source_url: repo://apps/gex/research/forecast-ensemble/phase0_inventory.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:22:07Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
summary: 'Probed live via UW MCP, ≥550ms pacing, 5 probe calls total. Verdict per endpoint: **BACKTESTABLE** (≥~250 sessions reachable) or **FORWARD-ONLY** (snapshot/recent-only → daily capture list, excluded from initial'
url_sha1: 5bd3a0c8de584e7fb90c690cd25cb49bf77c19a3
simhash: '15846599241918562107'
status: vault
ingested_by: seed
---

# Phase 0 — Endpoint History Inventory (2026-07-11)

Probed live via UW MCP, ≥550ms pacing, 5 probe calls total. Verdict per
endpoint: **BACKTESTABLE** (≥~250 sessions reachable) or **FORWARD-ONLY**
(snapshot/recent-only → daily capture list, excluded from initial backtest).

## Backtestable now (frozen feature list — 10 families)

| # | Family | Endpoint | Depth | Backfill cost | Probe evidence |
|---|--------|----------|-------|---------------|----------------|
| 1 | Market tide | `get_market_tide` | ≥1Y, full 5m intraday per date | 1 call/session ≈ 250 calls | 2025-07-11 returned full day |
| 2 | Greek exposure (GEX/VEX/charm/vanna) | `get_greek_exposure_by_ticker` | 1Y via `timeframe=1Y` | **1 call/ticker** | ⚠ `date` back-anchor BROKEN (empty at 2025-07-18 AND 2026-01-16); no-date + timeframe works. Cannot paginate past 1Y. |
| 3 | Short volume ratio | `get_short_volume_ratio_by_ticker` | latest 500 records ≈ 2Y | 1 call/ticker | per docs |
| 4 | Insider sector flow | `get_insider_sector_flow` | deep (paginated, ~25 sessions/page) | ~10 pages/sector·yr | page 4 reached 2026-01-09, has_more=true |
| 5 | Congress trades | `get_congress_trades` | deep (txn date filters) | date-windowed pages | per schema |
| 6 | Seasonality | `get_seasonality_month` | static historical stats | 12 calls | per schema |
| 7 | Candles/momentum (also label source) | `get_ticker_close_prices` / `get_ticker_candles_by_range` | 1Y-10Y daily | 1 call/ticker | per schema; index access caveat — verify SPX, else SPY/QQQ only |
| 8 | VIX | `get_ticker_close_prices` on VIX | 1Y+ | 1 call | same endpoint family; verify symbol access in backfill |
| 9 | Lit flow (whale prints) | `get_ticker_lit_flow` | ≥1Y, trade-level | 1 call/session/ticker, MUST use `min_premium` filter (limit 500 truncates raw tape) | 2025-07-11 returned prints |
| 10 | Dark pool | `get_dark_pool_trades` | ≥1Y via `older_than` pagination | expensive; filter `min_premium`, ~250+ calls/ticker | older_than 2025-07-15 returned prints |

Backfill budget estimate: families 2,3,6,7,8 ≈ 20 calls total. Family 1 ≈
250. Families 4,5 ≈ 50. Families 9,10 ≈ 250-750/ticker → **run as detached
background job per charter rule 3** (exceeds 30 min paced if all three
tickers). Option: start with SPY-only for 9/10.

## Forward-collection list (excluded from initial backtest — no look-ahead reconstruction)

| Family | Endpoint | Why excluded |
|--------|----------|--------------|
| Sector ETF tides | `get_market_sector_etfs` | current-day snapshot only, no date param |
| Yield curve | `get_yield_curve` | latest snapshot only |
| Crypto whale flow | `get_crypto_whale_transactions` | recent-only, no date filter |
| OI changes | `get_open_interest_changes` | screener over current state only |

Action: a daily capture job (research-side, writes CSV under
`research/forecast-ensemble/data/forward/`) starts these accruing; they
join the ensemble after ≥60 captured sessions.

## Frozen decisions

- Initial backtest = the 10 families above, SPY primary / QQQ + SPX
  stability cuts (SPX contingent on index data access; if denied, cuts are
  QQQ + odd/even days only — named in REPORT).
- Feature normalization: trailing 60-session z-score, as pre-registered.
- No family added or removed after this point without a journal note; the
  four forward-only families are NOT in scope for the Phase 1 verdict.
