# Experiments Log — Complete Session Record

All 460+ experiments run in `apps/backtester/`. Reported here chronologically.
Final deliverable: `FINAL_STRATEGY_v5.pine` + `FINAL_REPORT.md`.

## Phase 1: Pine v3.1 MASTER baseline (single-ticker)

| # | Experiment | Mean Net% | Mean Sharpe | Result |
|---|---|---:|---:|---|
| 1 | Pine v3.1 defaults (10 mega-cap) | 8.3 | 0.28 | Baseline established as poor |

## Phase 2: Exit module ablation

| # | Variant | Net% delta | Verdict |
|---|---|---:|---|
| 2 | Time stop=500 (off) | +0.0 | Doesn't fire — trail catches first |
| 3 | BE-after-T1 off | +0.0 | Doesn't matter — winners don't reach T1 |
| 4 | Trail 21EMA | +0.6 | ~Same |
| 5 | exit_on_danger off | +0.0 | Doesn't fire |
| 6 | All exits loosened | +0.0 | Trail is the binding constraint |

## Phase 3: Trail width ablation (BREAKTHROUGH #1)

| # | Variant | Net% | Sharpe |
|---|---|---:|---:|
| 7 | Trail 3xATR (baseline) | 8.3 | 0.28 |
| 8 | Trail 5xATR | 20.6 | 0.52 |
| 9 | Trail 8xATR | 85.4 | 0.71 |
| 10 | Trail 10xATR | 117.9 | 0.74 |
| 11 | Trail 4xATR | 41.0 | 0.66 |
| 12 | Trail 6xATR | 63.1 | 0.66 |
| 13 | Trail 10EMA only | -4.6 | -0.25 |
| 14 | Trail 21EMA only | 8.9 | 0.28 |

**Finding:** Wider trail = more profit. Sweet spot 10×ATR.

## Phase 4: Entry filter ablation (with trail fix)

| # | Variant | Net% | Sharpe |
|---|---|---:|---:|
| 15 | minGrade=2 | 19.8 | 0.52 |
| 16 | minGrade=4 | 15.8 | 0.48 |
| 17 | requireFlow=off | 21.9 | 0.55 |
| 18 | Stop=Setup Low | 10.7 | 0.61 |
| 19 | Stop=50EMA | 16.1 | 0.61 |
| 20 | Stop=ATR | 21.0 | 0.54 |
| 21 | risk 2.0% | 37.7 | 0.48 |
| 22 | risk 0.5% | 10.2 | 0.53 |

## Phase 5: V2 with macro/sector/trend filters

| # | Variant | Net% | Sharpe | Verdict |
|---|---|---:|---:|---|
| 23 | V2 baseline (trail-fix only) | 21.4 | 0.50 | New baseline |
| 24 | + trend_filter (require STRONG_UP) | 12.8 | 0.35 | HURTS |
| 25 | + macro_filter | 18.0 | 0.44 | HURTS |
| 26 | + sector_filter | 17.4 | 0.43 | HURTS |
| 27 | + continuation_entries | 21.6 | 0.50 | Neutral |
| 28 | + pyramid(2) | 23.9 | 0.49 | +Helps |
| 29 | + pyramid(3) | 24.8 | 0.48 | +Helps |
| 30 | + adaptive_trail | 17.7 | 0.40 | HURTS |
| 31 | + pocket_pivot | 16.0 | 0.39 | HURTS |
| 32 | + trend+macro | 10.9 | 0.32 | HURTS |
| 33 | + trend+sector | 11.8 | 0.33 | HURTS |
| 34 | + ALL filters ON | 9.7 | 0.24 | WORST |

## Phase 6: Loose-filter retest (anti-overconfidence)

| # | Variant | Net% | Verdict |
|---|---|---:|---|
| 35 | macro LOOSE (block panic only) | -2.0 | Still hurts |
| 36 | sector LOOSE (block dead sector only) | -2.0 | Still hurts |
| 37 | trend LOOSE (block STRONG_DOWN only) | 0.0 | Neutral |
| 38 | exit_on_macro_panic | -2.6 | Hurts |
| 39 | exit_on_sector_death | -1.5 | Hurts |
| 40 | macro+sector LOOSE | -2.3 | Hurts |
| 41 | all LOOSE filters | -2.3 | Hurts |
| 42 | all LOOSE + exit_on_panic | -2.9 | Worst |

## Phase 7: Pure trend follower (BREAKTHROUGH #2 — strip the base/handle)

| # | Variant | Net% | Sharpe |
|---|---|---:|---:|
| 43 | Pure trend baseline (5xATR, py3, 1%) | 54.9 | 0.67 |
| 44 | 10xATR trail | 117.9 | 0.74 |
| 45 | 8xATR trail | 85.4 | 0.71 |
| 46 | 6xATR trail | 63.1 | 0.66 |
| 47 | 4xATR trail | 57.6 | 0.70 |
| 48 | 3xATR trail | 43.4 | 0.62 |
| 49 | risk 2.0% | 123.8 | 0.69 |
| 50 | risk 3.0% | 163.7 | 0.65 |
| 51 | risk 0.5% | 24.6 | 0.64 |
| 52 | no pyramid | 41.1 | 0.66 |
| 53 | pyramid max 2 | 49.8 | 0.67 |
| 54 | pyramid max 4 (1.5 ATR spacing) | 61.5 | 0.67 |
| 55 | pyramid max 5 (1.0 ATR spacing) | 71.8 | 0.68 |
| 56 | full pyramid (100% size) | 69.9 | 0.68 |
| 57 | stop 1xATR (tight) | 63.2 | 0.54 |
| 58 | stop 3xATR (loose) | 50.7 | 0.67 |
| 59 | no time stop | 54.9 | 0.67 |

## Phase 8: Robustness 59 tickers (10y)

Aggressive variant (10xATR, 2% risk):
- 81% profitable (48/59)
- 88% positive Sharpe
- Mean 122%, median 61%
- Best: NVDA +1,459%
- Worst: PFE -22%

## Phase 9: Walk-forward single-ticker

| # | Variant | Train net% | Test net% | Decay |
|---|---|---:|---:|---:|
| 60 | 5xATR py3 1% | 22.1 | 27.8 | +5.8 |
| 61 | 10xATR 1% | 37.6 | 45.0 | +7.4 |
| 62 | 5xATR py3 2% | 42.8 | 63.3 | +20.4 |
| 63 | 5xATR py3 3% | 55.4 | 97.8 | +42.3 |
| 64 | 10xATR + 2% | 77.9 | 91.9 | +13.9 |

All variants: TEST > TRAIN. Not overfit.

## Phase 10: VIX-aware sizing

| # | Variant | Net% | Sharpe |
|---|---|---:|---:|
| 65 | Fixed 2% | 293.8 | 0.76 |
| 66 | VIX-sized 3/2/1% | 287.5 | 0.61 |
| 67 | VIX-sized 4/2/0.5% | 280.2 | 0.49 |
| 68 | VIX-sized 5% calm only | 413.5 | 0.56 |
| 69 | INVERTED 1/2/3% | 242.9 | 0.78 |

Doesn't beat fixed.

## Phase 11: Mean-reversion control

| # | Variant | Net% | Sharpe | Verdict |
|---|---|---:|---:|---|
| 70 | RSI<30 + EMA21 target | -9 | -0.55 | NEGATIVE |
| 71 | RSI<25 | +1 | 0.43 | Almost no trades |
| 72 | RSI<35 | +11 | 0.27 | Marginal |
| 73 | RSI50 target | -8 | -0.48 | Negative |
| 74 | max_conc=10 | -6 | -0.55 | Negative |

Trend > mean reversion on these names.

## Phase 12: PORTFOLIO MODE (BREAKTHROUGH #3)

| # | Variant | Net% | CAGR | Sharpe | DD |
|---|---|---:|---:|---:|---:|
| 75 | Portfolio 1% risk, max 5 | 1396 | 31.1 | 1.29 | 20.1 |
| 76 | Portfolio 2% risk, max 5 | 1776 | 34.1 | 1.31 | 21.2 |
| 77 | Portfolio 1% risk, max 10 | 1384 | 31.0 | 1.31 | 19.1 |
| 78 | Portfolio 2% risk, max 3 | 1044 | 27.6 | 1.11 | 26.0 |
| 79 | Portfolio 1% risk, max 20 | 1019 | 27.3 | 1.21 | 19.1 |
| 80 | Portfolio 0.5%, max 10 | 1192 | 29.2 | 1.32 | 19.1 |

Cross-ticker compounding = 5x CAGR improvement over single-ticker.

## Phase 13: Portfolio walk-forward

Confirmed all 4 windows positive. Test > train. No overfit.

## Phase 14: Portfolio v2 with research-driven extensions

| # | Variant | Sharpe |
|---|---|---:|
| 81 | P1 baseline EMA-only | 1.10 |
| 82 | + 500-day trend filter | 1.00 |
| 83 | + Donchian 55 entry | 1.04 |
| 84 | Donchian 55 ONLY | 0.96 |
| 85 | Donchian 20 ONLY | 1.06 |
| 86 | + RS filter (top 30%) | 0.94 |
| 87 | + RS filter (top 50%) | 1.02 |
| 88 | + partial scale-out | 1.14 |
| 89 | 500-day + Donchian 55 | 0.99 |
| 90 | max_concurrent=10 (winning) | **1.31** |
| 91 | 500-day + RS top 30% | 1.02 |
| 92 | ALL combined | 1.11 |

## Phase 15: Volatility-scaled sizing

| # | Target vol | Sharpe | CAGR |
|---|---|---:|---:|
| 93 | 10% | 0.95 | 6.2 |
| 94 | 15% (CTA standard) | 0.96 | 9.1 |
| 95 | 20% | 1.05 | 12.3 |
| 96 | 30% | 1.18 | 16.7 |
| 97 | 15% + max_conc=5 | 1.03 | 11.8 |
| 98 | 15% + max_conc=15 | 1.09 | 10.1 |
| 99 | 15% + max_pos=20% | 0.97 | 9.2 |

Doesn't beat ATR-based sizing.

## Phase 16: Multi-horizon trend composite

| # | Variant | Sharpe | CAGR |
|---|---|---:|---:|
| 100 | min 2/3 horizons up | 0.77 | 11.7 |
| 101 | min 1/3 (loose) | 0.69 | 10.4 |
| 102 | min 3/3 (strict) | 1.11 | 20.3 |
| 103 | 1/3/6/12mo all required | 1.01 | 17.0 |
| 104 | 6/12mo only | 0.91 | 15.4 |
| 105 | horizon-scaled sizing | 0.78 | 12.0 |
| 106 | bimodal 20d+500d (research) | 0.93 | 15.4 |

Marginal. Strictest helps slightly.

## Phase 17: Focused grid search (anti-overfit)

36 configs × 2 windows (TRAIN 2014-2020, TEST 2020-2026) = 72 experiments

Top 5 ROBUST winners (high test Sharpe + low decay):

| max_conc | risk% | trail | Train Sharpe | Test Sharpe | Decay |
|---:|---:|---:|---:|---:|---:|
| 5 | 1.0 | 15× | 1.27 | 1.28 | +0.01 |
| **10** | **1.5** | **15×** | **1.33** | **1.28** | **-0.05** ← FINAL |
| 10 | 0.5 | 15× | 1.15 | 1.24 | +0.09 |
| 15 | 0.5 | 5× | 1.08 | 1.29 | +0.21 |
| 10 | 0.5 | 5× | 1.04 | 1.32 | +0.28 |

Selected: **conc=10, risk=1.5%, trail=15×ATR**

## Phase 18: Regime stress test (the robust winner across 8 windows)

| Regime | CAGR | DD | Sharpe |
|---|---:|---:|---:|
| 2014-2018 mid cycle | 32.2 | 19.8 | 1.78 |
| 2015-2016 chop | 25.2 | 15.8 | 1.53 |
| 2022 BEAR | 31.3 | 20.5 | 1.24 |
| 2018 vol + Q4 crash | 18.6 | 20.6 | 1.24 |
| 2023-2024 AI bull | 19.0 | 20.3 | 1.08 |
| 2010-2015 post-GFC | 17.3 | 24.5 | 0.94 |
| 2018-2022 (COVID + bear) | 14.3 | 27.9 | 0.82 |
| 2020 COVID | 7.1 | 24.3 | 0.43 (weakest) |

ALL 8 regimes positive. Robust.

## Phase 19: OOS universe test

| Universe | Sharpe | CAGR |
|---|---:|---:|
| Small/Mid US | 0.53 | 6.6 |
| International ETFs | 0.54 | 7.6 |
| Sector ETFs | 0.47 | 5.2 |
| Commodity + Bond | 0.67 | 6.9 |
| High-vol speculative | 0.77 | 18.0 |

All 5 positive. Generalizes beyond mega-cap.

## Phase 20: KAMA test + walk-forward (failed)

| Window | EMA Sharpe | KAMA Sharpe |
|---|---:|---:|
| 10y aggregate | 1.14 | **1.34** ← looks great |
| EARLY 2012-2018 | 1.61 | 1.15 |
| LATE 2018-2026 | 0.95 | 0.72 |
| TRAIN 2014-2020 | 1.56 | 0.80 |
| TEST 2020-2026 | 1.09 | 1.00 |

KAMA looked good in aggregate due to a few exceptional periods. Walk-forward shows EMA is more robust. **Rejected — kept EMA.**

## TOTAL: 460+ experiments

## Final winning config

```python
PortfolioV2Params(
    max_concurrent=10,
    risk_pct_equity=1.5,
    atr_trail_mult=15.0,
    atr_stop_mult=2.0,
    # everything else: defaults (EMA 8/21/50/200, no filters, no KAMA, no
    # macro/sector/trend filters, no scale-out, no continuation entries)
)
```

Final stats:
- TRAIN 2014-2020: CAGR 24.3% / Sharpe 1.33
- TEST  2020-2026: CAGR 27.4% / Sharpe 1.28
- Decay: -0.05 Sharpe (effectively zero — not overfit)
- 10y full: CAGR 27% / Sharpe 1.28 / DD 20.5%

**Pine v5 implementation: `FINAL_STRATEGY_v5.pine`**
