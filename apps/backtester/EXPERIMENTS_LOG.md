# Experiments Log — Strategy Research Session

All experiments run in `apps/backtester/`. Each row is one variant tested. Goal: find the highest-Sharpe trend-following strategy that's robust across time and tickers, and consolidate into ONE Pine strategy.

## Status as of current iteration

**Winning architecture so far: PORTFOLIO MODE pure trend.**

- Single $100k account, max 5 concurrent positions across 43-ticker universe
- Entry: EMAs stacked + EMA50 rising + close > prior bar high
- Stop: max(close - 2×ATR, EMA50)
- Trail: highSinceEntry - 10×ATR
- Risk per trade: 1% of equity
- Walk-forward TRAIN 2014-2020: CAGR 11.1% / Sharpe 0.71 / DD 19.7%
- Walk-forward TEST  2020-2026: CAGR 22.8% / Sharpe 1.21 / DD 14.9%
- Full 10y portfolio: **CAGR 31.1% / Sharpe 1.29 / DD 20.1%**

## Hypothesis backlog (to test)

| # | Hypothesis | Status | Result |
|---|---|---|---|
| H1 | Wider Bollinger Band breakouts add edge | pending | |
| H2 | Donchian channel breakouts (turtle-style 20/55) work better than EMA breakouts | pending | |
| H3 | Williams %R or Stochastic for entry timing on existing trend | pending | |
| H4 | Anchored VWAP from major lows as dynamic support | pending | |
| H5 | Earnings drift — long after positive earnings surprise + volume | pending | |
| H6 | Pure momentum: enter top 5 names by 6-mo return monthly | pending | |
| H7 | Relative strength rotation: rank universe, hold top N by RS | pending | |
| H8 | Multi-timeframe: daily trend + weekly trend confirmation | pending | |
| H9 | Use ADX > 25 to filter into trending regimes | pending | |
| H10 | Profit-target scale-out: take 1/3 at +2R, 1/3 at +5R, run rest | pending | |
| H11 | Re-entry after stopped-out: re-arm immediately on next signal | pending (probably yes) | |
| H12 | Higher minimum trade size: trade more capital per signal (5%-10% risk in portfolio) | pending | |

## Completed experiments — chronological log

### E1: Pine v3.1 MASTER baseline (single-ticker)
- 10-ticker mean: net 8.3% / CAGR 0.79% / Sharpe 0.28 — baseline established as bad

### E2: MASTER ablation — exit module tweaks
- Time stop, BE-after-T1, danger exit all had ~0 effect — trail catches everything first

### E3: Trail-width ablation
- 5×ATR vs default 3×ATR: net 21% vs 8% — 2.5× improvement
- 10×ATR even better: net 118% / Sharpe 0.74

### E4: MASTER v2 — added trend/macro/sector/pyramid/continuation
- Pyramid (max 3): +3% — only helpful add
- Trend filter: -12%, Macro filter: -3%, Sector filter: -4% — all hurt
- Loose filter variants: still hurt
- Exit-side filters (panic, sector death): still hurt

### E5: Pure trend follower (no base/handle)
- Mean net 54.9% — MORE than 2× the elaborate strategy
- Confirms base/handle scoring was active dead weight

### E6: VIX-aware position sizing
- Fixed 2% baseline: Sharpe 0.76
- VIX-sized variants: all worse Sharpe (0.49 to 0.78)
- Inverted (bigger when VIX high): Sharpe 0.78 — marginal positive
- NOT a meaningful improvement — keep fixed sizing

### E7: Walk-forward 2010-2018 train / 2018-2026 test (single-ticker)
- All variants: TEST outperforms TRAIN
- Sharpe stable ±0.06 → NOT overfit

### E8: Robustness 59 tickers, 10y
- 81% profitable / 88% positive Sharpe
- NVDA: +1,459% (Sharpe 1.26) with 10×ATR/2% variant

### E9: Portfolio mode (THE BREAKTHROUGH)
- Same logic, single capital pool, max 5 concurrent
- CAGR 31% / Sharpe 1.29 / DD 20%
- vs single-ticker mean CAGR 7% / Sharpe 0.5
- ~5× CAGR improvement from cross-ticker compounding alone

### E10: Walk-forward portfolio
- All windows positive
- TEST (2020-2026) outperforms TRAIN (2014-2020)
- Confirms portfolio edge is real, not period-specific

## Next experiments planned

[Updated as we go]
