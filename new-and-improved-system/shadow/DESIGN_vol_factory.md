# Volatility-premium factory — when to sell or buy straddles (locked 2026-10-10, before any engine)

**Why.** The one family that validated across 25 tickers is "dealer gamma predicts the SIZE of the next day's move"
(idea factory). Size only becomes money if it beats what option prices already expect. This factory asks, ~180 times:
does a feature known before the trade predict how a short straddle priced off the implied move does?
Registry: `vol_registry.json` (from `vol_registry.mjs`), committed with this file before any results.

## Data
- Daily OHLC (regular session, UW) for SPY / QQQ / IWM / DIA (`.cache/uwgreeks/{T}_ohlc.json`).
- Cboe implied-vol index history (free CSVs, `.cache/cboe/{X}.json`): VIX (SPX 30-day) ↔ SPY, VXN ↔ QQQ, RVX ↔ IWM,
  VXD ↔ DIA; VIX1D (1-day SPX), VIX9D, VIX3M for SPY-specific / market-wide term-structure features.
- UW daily greek exposure by strike (`.cache/uwgreeks/{T}.jsonl`, priced at each close; from 2023-11-08).
- Period: 2023-11-09 → 2026-10-02. **Build** to 2025-03-31, **holdout** 2025-04-01 → (untouched).

## Implied move and outcomes (day d)
σ = index level / 100 / √252 (implied one-day move as a fraction). Straddle premium ≈ 0.8 × σ × price (at-the-money
straddle ≈ 0.8 σ√T S). Everything a trade uses is known when it is opened.
| id | outcome | opened at | premium uses |
|---|---|---|---|
| V1 | short 1-day straddle P&L ÷ premium: 1 − \|C_d − C_{d−1}\| ÷ premium | d−1 close | index close d−1, C_{d−1} |
| V2 | short 0DTE straddle P&L ÷ premium: 1 − \|C_d − O_d\| ÷ premium | d open | index OPEN on d, O_d |
| V3 | ln(day range ÷ implied move): ln((H_d − L_d) ÷ (σ C_{d−1})) | d−1 close | index close d−1 |
| V4 | short 5-day straddle P&L ÷ premium (non-overlapping dates): 1 − \|C_{d+4} − C_{d−1}\| ÷ (0.8 σ √5 C_{d−1}) | d−1 close | index close d−1 |
| V5 | 1-σ breach (1/0): \|C_d − C_{d−1}\| > σ C_{d−1} (what hurts a short strangle at ±1σ) | d−1 close | index close d−1 |
| V6 | SPY only, VIX1D 0DTE straddle: 1 − \|C_d − O_d\| ÷ (0.8 × VIX1D_open/100/√252 × O_d) | d open | VIX1D open |
These are proxies (no skew, no bid-ask, constant 0.8 factor); the average level is not interpreted, only whether a
feature moves the outcome. Positive feature effect on V1/V2/V4/V6 = better for premium SELLERS.

## Model per hypothesis
`outcome = a_ticker + β · feature + c · ln(σ) + e`, pooled over the 4 ETFs (V6: SPY only). Feature winsorized and
standardized per ticker with build-period numbers; Driscoll–Kraay standard errors (lag 5); V4 on every 5th trading day.

## Validation (same as the idea factory)
Build: one-sided p in the predicted direction (`?` two-sided), Benjamini–Hochberg q = 0.10 across all hypotheses.
Holdout: survivors re-estimated once, BH q = 0.10 across survivors, same sign. **Own placebo:** holdout t must beat
≥ 19 of 20 fits with the feature series circularly shifted within the holdout (K = 13, 29, 43, … 293 trading days as in
the idea factory). Reported for validated ideas: holdout P&L of the short straddle in the top vs bottom third of the
feature (in premium units), per ticker, per half-year.

## Run discipline
Engine `vol_factory.mjs` audited independently before its single run; amendments logged below. Output
`shadow/results_vol_factory/`. Research only — nothing live changes.

## Amendments
(none yet)
