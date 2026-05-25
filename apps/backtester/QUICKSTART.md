# FINAL TREND v5 — Quick Start

## What you got after 460+ experiments

**`FINAL_STRATEGY_v5.pine`** — backtestable strategy
**`FINAL_INDICATOR_v5.pine`** — signal-only indicator (for charts you don't auto-trade)

Both implement the same logic. Strategy version produces TradingView Strategy Tester stats. Indicator version is for visual confirmation + alerts.

## TradingView setup (5 minutes)

1. **Open TradingView** → any stock chart
2. **Bottom panel → Pine Editor**
3. Paste **`FINAL_STRATEGY_v5.pine`** (or `FINAL_INDICATOR_v5.pine`)
4. Click **Save** → name it "TREND v5"
5. Click **Add to chart**

Repeat on every chart in your watchlist (recommend 10-20 tickers).

## Operational rules (the part that matters)

The portfolio backtest (CAGR 27% / Sharpe 1.28) assumed:
- **Single $100k account** shared across all charts
- **Max 10 concurrent positions** — if more signals fire, take the highest-quality 10
- **1.5% risk per trade** of TOTAL account equity (not per chart)
- **No filters** — if signal fires, take it

To replicate this manually:
1. Set up watchlist of 10-20 trending names (mega-cap tech, sector ETFs, your UW screener picks)
2. Add the indicator to all of them
3. Set TradingView alerts on "Entry Long" for each
4. When alert fires:
   - Check if already at 10 open positions → skip if so
   - Calculate position size: `qty = (equity × 0.015) / (entry - stop)`
   - Enter long
5. Let the trail stop handle exits (don't manually override)
6. If "Danger entered" alert → exit any positions in that name

## What MAKES this work

**Trail width** is the secret sauce. The trail is so wide (15× ATR) that it rarely triggers on normal pullbacks. Most exits come from:
- Stage 4 (close < EMA200 and EMA200 falling) → trend reversal
- Bear stack (EMAs cross down) → momentum lost
- 250 bars elapsed → time stop

This lets winners run for months. NVDA in 2023: held 53 bars, +8.5R.

## What WILL try to ruin this

After 460+ experiments, every "smart" filter HURT performance:
- ❌ Trend HH/HL pattern filter
- ❌ VIX / macro regime filter
- ❌ Sector rotation filter
- ❌ Pocket pivot volume filter
- ❌ Adaptive trail by regime
- ❌ Multi-horizon composite
- ❌ KAMA instead of EMA
- ❌ Mean-reversion variant
- ❌ Partial scale-out
- ❌ Volume confirmation filter
- ❌ Short side
- ❌ All filters combined (worst variant)

**Do not add these.** The instinct is wrong because filters reject marginal-but-positive-expectancy trades and the strategy's edge comes from rare 5R+ winners.

## When the strategy WILL underperform

1. **Year-long sideways markets** (rare since 2008). 2015-2016 was close.
2. **V-shape crashes** (COVID 2020). Strategy got chopped on the fast reversal.
3. **You hold positions during danger phase**. The "Danger" exit is critical — don't override.

## Honest expectations

Per the walk-forward + stress tests:
- **27% CAGR is the median** across windows. Realistic range: 15-35%.
- **20% max drawdown is typical**. Worst case ~30% in bad regime sequences.
- **40% win rate**. Most trades lose small. Few winners pay for everything.
- **Sharpe ~1.0** over 10y. Sharpe 1.3 in good multi-year stretches.

Don't expect:
- 100%+ returns every year (those years exist but are 2017, 2020, 2023)
- 90%+ win rate (this is trend following, not scalping)
- Smooth equity curve (you'll have 6-month drawdowns)

## When to RE-VALIDATE

Markets evolve. Re-run these annually:
- `walkforward.py` → confirm Sharpe still > 1.0 in latest 5y window
- `oos_universe.py` → confirm strategy still works on small caps + ETFs
- `stress_regimes.py` → confirm worst-regime Sharpe still positive

If any drops below 0.5 Sharpe, the strategy may be losing edge. Time to re-test ideas.

## What to do if you want to make it BETTER

The honest answer: probably nothing in the current Pine codebase. The structural improvements left to try:

1. **More tickers** — universe larger than 43 may give better diversification
2. **Multi-asset** — add bonds (TLT), commodities (GLD), currencies via futures ETFs
3. **Options sizing** — convert long-call EV based on IV rank
4. **Sector rotation as universe selection** (NOT signal filter) — use UW screener to pick the 20 trending names this month, run TREND v5 on those

Anything that changes the per-ticker entry/exit logic has been tested. The simple version wins.

## Files

- `FINAL_STRATEGY_v5.pine` — backtestable strategy
- `FINAL_INDICATOR_v5.pine` — signal indicator
- `FINAL_REPORT.md` — comprehensive findings
- `EXPERIMENTS_LOG.md` — every test, chronological
- `scan_v5.py` — daily entry-signal scanner
- `plots/FINAL_v5_equity_curve.png` — visual proof
- `results_*.csv` — raw backtest data
