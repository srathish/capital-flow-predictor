# Phase 3 — Universe Regression (All 48 Talon Tickers)

**Window:** 2026-04-30 → 2026-05-28.  **Universe:** 48 tickers from Phase 1 scorecard.
**Tickers with GEX data:** 48 / 48

## Gate-by-Gate Validation

| Gate | n | r / ρ | p | Pass? |
|---|---|---|---|---|
| G1 delta_buildup | 46 | 0.485 | 0.0006 | ✓ |
| G2 gamma_sign×thesis | 48 | t=1.85 | 0.0752 | ✗ |
| G3 vanna_stability | 46 | -0.510 | 0.0003 | ✓ |
| G4 call_dom_trend | 46 | 0.105 | 0.4870 | ✗ |
| G5 hedge freshness | 8 hedges | effect=+10.43% | n/a | hedge-only |

## Gate 1 — Delta Buildup (>50% threshold)
- Linear regression: slope = 0.000186/% → +100% buildup → +0.02% return
- Buildup >50%: mean 5d return = +7.50%
- Buildup ≤50%: mean 5d return = +1.98%
- **Spread: +5.52%**  (with outlier cap: r=0.380, p=0.0092)

## Gate 2 — Gamma Sign × Thesis Direction
- Bullish tickers with +gamma: **80.0%**
- Bearish tickers with -gamma: **50.0%**
- Overall match rate: 72.9%
- Matched mean ret: +4.05%; Unmatched: -1.09%

## Gate 3 — Vanna Stability (≥0.85 at t+3d)
- ≥0.85: -0.90%
- 0.70–0.85: +17.84%
- <0.70: -9.00%

## Gate 4 — Call Dom Trend (5d change)
- Rising (>+5): +5.54%
- Flat (±5): +2.18%
- Falling (<−5): +2.51%

## Gate 5 — Hedge Freshness
- Hedges with call_dom at 5d high on scan day: +2.60%
- Hedges with stale call_dom: -7.83%
- **Freshness effect: +10.43%**

## Master Regression
- Sample: 46 tickers
- **R² gates-only**: 0.277 (adj: 0.187)
- R² Grade-alone (Phase 1 reproduce): 0.244
- **Improvement from gates over Grade alone: +3.3 pp**
- R² Grade + Gates combined: 0.697

**Standardized coefficients (which gate matters most):**
- delta_buildup_pct: +0.0304
- gamma_positive: +0.0078
- vanna_stability: -0.0026
- call_dom_trend_5d: +0.0048
- theme_coherent: +0.0365

## Verdict
**2/4 gates validated.** Build scanner with passing gates only.
