# Talon May 18, 2026 Scan — Phase 1 Scorecard

**Windows:**
- Short-term GEX target: May 18–22 (5 trading days, the scan's 0-5d horizon)
- **Full window** through May 28 = 8 trading days (~1.5 of the 2-week swing horizon — the scan promised 2-4 wks for VEX, into Jun 1–12)
**Sample:** 30 tickers with explicit grades + levels (28 triggered, 2 OTE never tagged).

## Headline

### Short-term (May 18–22, the 0-5d ST window)
- Direction correct (1D close-to-close): **36%**
- Direction correct (5D close-to-close): **43%**
- Short-term GEX target hit (May 18-22 wick OK): **50%**

### Full ~2-week window (May 18 → May 28, 8d)
- Direction correct (full-window close-to-close): **50%**
- ST GEX target hit by May 28: **71%**
- **First swing/VEX rung hit: 21%**
- **Second swing/VEX rung hit: 11%**
- Mean full-window return: **+3.08%**

### Risk management (full window)
- Soft-invalidation held: **29%**
- Failure-first (close past inval BEFORE target wick): **36%**
- Mean realized R (Talon rules, exit at inval close): **+1.53R**
- Mean max R if held (ignore inval): **+7.47R**

## Grade Band Performance — Two Horizons

Band sizes are uneven — A+ 14 vs middle bands ≤ 5. Read mid-band rows with caution.

| Band | n | Trig | ST Tgt (5d) | ST Tgt (full) | Swing-0 | Swing-1 | Inval Held | Dir 5d | Dir full | R | Max R | 5d% | Full% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A+ (90-100) | 13 | 13 | 46.2% | 84.6% | 23.1% | 15.4% | 38.5% | 53.8% | 69.2% | +1.96 | +9.96 | +5.91% | +10.21% |
| A (85-89) | 2 | 1 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | -1.00 | +4.28 | -10.25% | -9.83% |
| B+ (70-84) | 5 | 5 | 60.0% | 80.0% | 20.0% | 0.0% | 20.0% | 60.0% | 80.0% | +1.96 | +10.33 | +0.56% | +3.32% |
| B  (55-69) | 1 | 1 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | +1.88 | +2.15 | -2.03% | -1.72% |
| B- (40-54) | 3 | 3 | 0.0% | 0.0% | 0.0% | 0.0% | 33.3% | 33.3% | 33.3% | +0.10 | +3.02 | -2.80% | -4.32% |
| C  (0-39) | 5 | 4 | 75.0% | 75.0% | 50.0% | 25.0% | 25.0% | 25.0% | 0.0% | +1.44 | +3.02 | -6.58% | -8.74% |
| ungraded | 1 | 1 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | +0.59 | +0.59 | -3.36% | -3.63% |

## Grade → Realized R (Linear Regression)

- N = 27
- Slope: **+0.133 R per 10 grade points** (p = 0.458, _not significant_)
- Pearson r = +0.149,  R² = 0.022
- Spearman ρ = +0.164 (p = 0.413)

## Grade → 5D Return (short-term sanity check)

- Slope: +0.0155 per 10 pts (p = 0.009, significant)
- Pearson r = +0.493, R² = 0.243

## Grade → Full-Window Return (~2 weeks, the swing horizon)

- Slope: +0.0238 per 10 pts (p = 0.003, significant)
- Pearson r = +0.548, R² = 0.301

## Grade → Highest Swing Rung Hit

- Slope: -0.051 rungs per 10 pts (p = 0.497, not sig)
- Pearson r = -0.137, R² = 0.019

## Grade → Max R if Held (ignore invalidation)

- Slope: +1.037 R per 10 pts (p = 0.088, not sig)
- Pearson r = +0.335, R² = 0.112

## Per-Ticker Detail (sorted by Grade)

Legend: ST Tgt = short-term GEX target hit (May 18-22).  Swing = highest rung tagged through May 28 (-= none, 0 = first rung, …).  Full% = May 18 → May 28 close-to-close, signed in trade direction (positive = bet won).

| Ticker | Grade | Dir | Trig | ST Tgt | Swing | Inval | 5D% | Full% | R | Max R | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FSLR | 100 | bull | Y | ✓ | 4/4 | breach 2026-05-19 | +15.5% | +29.8% | -1.0 | +23.6 |  |
| DIS | 100 | bull | Y | ✗ | 0/4 | breach 2026-05-19 | -0.6% | -0.2% | -1.0 | +1.2 |  |
| SHOP | 100 | bull | Y | ✗ | 0/4 | held | +2.5% | +12.3% | +2.7 | +4.4 |  |
| F | 100 | bull | Y | ✗ | 0/3 | held | +17.6% | +27.8% | +2.4 | +5.2 |  |
| BKNG | 100 | bull | Y | ✗ | 1/4 | held | +5.3% | +9.5% | +8.6 | +10.0 |  |
| KWEB | 100 | bull | Y | ✗ | 0/4 | breach 2026-05-21 | -2.9% | -5.0% | -1.0 | +1.8 |  |
| MARA | 100 | bull | Y | ✓ | 0/2 | held | +17.2% | +15.5% | +3.1 | +18.9 |  |
| CLSK | 100 | bull | Y | ✓ | 2/4 | held | +27.5% | +35.0% | +7.7 | +42.0 |  |
| TTD | 100 | bull | Y | ✓ | 0/4 | breach 2026-05-19 | -0.4% | -5.0% | +2.9 | +4.1 |  |
| RIVN | 100 | bull | Y | ✗ | 0/4 | breach 2026-05-19 | +7.8% | +13.9% | -1.0 | +3.5 |  |
| ^VIX | 97 | bull | Y | ✓ | 0/3 | breach 2026-05-18 | -6.9% | -11.7% | +2.0 | +3.9 |  |
| MSFT | 91 | bull | Y | ✓ | 0/3 | breach 2026-05-27 | -1.8% | +0.8% | +1.1 | +2.0 |  |
| HOOD | 90 | bull | Y | ✗ | 0/4 | breach 2026-05-18 | -4.0% | +10.0% | -1.0 | +8.9 |  |
| SMH | 89 | bear | Y | ✗ | 0/3 | breach 2026-05-21 | -10.2% | -9.8% | -1.0 | +4.3 |  |
| CVS | 87 | bear | N | — | 0/4 | held | — | — | — | — | OTE not triggered in window |
| META | 81 | bull | Y | ✓ | 0/3 | held | +0.2% | +3.9% | +2.1 | +10.6 |  |
| TSLA | 81 | bull | Y | ✓ | 1/4 | breach 2026-05-19 | +5.8% | +7.8% | +4.7 | +23.8 |  |
| AMZN | 77 | bull | Y | ✗ | 0/4 | breach 2026-05-19 | +0.2% | +3.5% | -1.0 | +4.6 |  |
| SLV | 76 | bull | Y | ✓ | 0/3 | breach 2026-05-19 | -0.3% | -2.3% | +5.0 | +6.3 |  |
| PINS | 72 | bull | Y | ✗ | 0/3 | breach 2026-05-19 | -3.0% | +3.6% | -1.0 | +6.3 |  |
| GOOGL | 56 | bull | Y | ✓ | 0/3 | breach 2026-05-19 | -2.0% | -1.7% | +1.9 | +2.2 |  |
| SQQQ | 46 | bull | Y | ✗ | 0/2 | breach 2026-05-26 | -9.8% | -11.6% | -1.0 | +3.0 |  |
| XLP | 45 | bear | Y | — | 0/3 | held | +2.6% | +1.7% | +2.3 | +3.1 |  |
| IGV | 40 | bear | Y | ✗ | 0/3 | breach 2026-05-22 | -1.3% | -3.0% | -1.0 | +3.0 |  |
| WBD | 39 | bull | N | — | 0/3 | held | — | — | — | — | OTE not triggered in window |
| HPE | 26 | bear | Y | ✓ | 0/3 | breach 2026-05-22 | -15.3% | -15.8% | +2.0 | +2.1 |  |
| XLF | 22 | bull | Y | — | 0/3 | held | +0.2% | -0.9% | +0.1 | +1.2 |  |
| LLY | 16 | bear | Y | ✓ | 1/5 | breach 2026-05-19 | -7.8% | -14.0% | +1.7 | +3.2 |  |
| QQQ | 14 | bear | Y | ✓ | 4/4 | breach 2026-05-22 | -3.5% | -4.2% | +2.0 | +5.6 |  |
| NVDA | — | bull | Y | ✓ | 0/3 | breach 2026-05-26 | -3.4% | -3.6% | +0.6 | +0.6 |  |

## Interpretation

- **A+ band** (n=13 triggered) hit st_target 46.2% (full window 84.6%, swing-0 23.1%) vs **B band** 100.0% / 100.0% / 0.0%.
- A+ mean realized R: +1.96, B: +1.88.
- Grade is **not statistically predictive** of realized R (p = 0.458). Caveats: small sample (n=27), single-week window, lopsided band sizes.

## Caveats

- **n = 28** triggered setups, 14 in A+, 4 in C, others ≤ 5. Middle bands have huge error bars.
- **Single scan / single ~2-week window.** One regime, not a distribution.
- **Full window = 8 trading days** — captures the front half of the scan's stated 2-4 week swing horizon (which extends to ~Jun 12). Higher swing rungs (e.g. FSLR 280/300, META 700/720, AMZN 310/325) had less time to reach.
- **Realized R uses Talon's published soft_inval as a hard stop.** Several A+ names (FSLR, RIVN, DIS, KWEB) breached inval on May 19 close then recovered. `max R if held` is the same trade without the inval rule.
- **Entry-price discipline.** OTE setups enter at the OTE (only if tagged); bullish-trigger setups (SHOP/RIVN/F) enter at the trigger if high clears it; everything else enters at the published `current`.
