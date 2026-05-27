# Base-Breakout Screener (UW flow-confirmed)

Two-stage equity screener that finds tight-base breakouts on adequate volume,
then overlays Unusual Whales flow confirmation. Optimized for the
"NVTS-style" mid-cap pennant breakout where options are still cheap.

## Stages
1. **Technical (from `/api/stock/{t}/ohlc/1d`)** — multi-week tight base,
   recent breakout, close near 21EMA, ATR squeeze, volume expansion,
   liquidity gate.
2. **Flow (UW)** — IV rank (cheap options), 5d net call premium, recent
   bullish flow alerts, dark-pool prints above close, OI tilt call-side.

## Run
```
cd apps/screener
# Source the repo's .env so UW_API_KEY / UNUSUAL_WHALES_API_KEY is set
set -a && source ../../.env && set +a
../../.venv/bin/python -m screener.cli
```

Output: `output/candidates_YYYYMMDD.csv` + top-15 printed to stdout.

## Tuning
All thresholds live in `config.yaml`. Key knobs:
- `universe.{min_marketcap,max_marketcap,min_avg_dollar_vol}` — universe size
- `stage1_technical.base_min_length` — shorter = catch pennants, longer = catch multi-year bases
- `stage1_technical.base_max_range_pct` — tightness of the base
- `stage2_flow.iv_rank_max` — "cheap options" cutoff (50 = cheaper half of year)
- `scoring.{technical_weight,flow_weight}` — 60/40 default

## Notes & substitutions
- UW's `/api/stock/{t}/ohlc/1d` returns ~250 regular sessions max even with
  `limit=2500`. The spec asks for 3 years of history; we adapt by computing
  the base over what's available (up to ~220 sessions). For true multi-year
  bases, bump `base_min_length` toward 200+ and re-run — the logic carries.
- The "sector relative strength via ETF data" sub-signal isn't yet wired in
  this v0; the equivalent is the cheap-IV + flow stack on the ticker itself.
  Add via `/api/market/{sector}/sector-tide` if you want the explicit sector
  cross-check.
