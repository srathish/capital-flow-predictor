# Idea factory — results

Run 2026-10-09T08:04:13.955Z · protocol shadow/DESIGN_idea_factory.md · registry 530 hypotheses · 25 tickers
Build rows 10220 (2023-11-09 → 2025-06-30) · holdout rows 8017 (2025-07-01 → 2026-10-08)

**Stage 1 (build, BH q = 0.10): 87 of 530 survive.** **Stage 2 (holdout, BH q = 0.10 across survivors, same sign): 23 new ideas validated**.

Expected false discoveries among validated at q = 0.10: about 2.3.

**Placebo (same pipeline, feature series shifted in time so it cannot carry real information):** shift 126 → 13 pass stage 1, 6 'validated'; shift 189 → 39 pass stage 1, 0 'validated'. Real minus placebo ≈ the number of genuine discoveries.

## Validated ideas (holdout + per-idea placebo)

| idea | feature | outcome | predicted | build β (t) | holdout β (t) | beats own placebos | index ETFs β (t) | tickers same sign | beyond strongest in outcome (t) | mechanism |
|---|---|---|---|---|---|---|---|---|---|---|
| G23xR1 | G03 z-score vs its own prior 60 days | R1 | - | -0.042 (-5.76) | **-0.022 (-3.25)** | 20/20 | -0.057 (-3.86) | 72% | strongest | local regime relative to recent normal |
| G17xR1 | largest positive-gamma strike − S, / S | R1 | ? | +0.051 (+5.61) | **+0.019 (+3.15)** | 20/20 | +0.042 (+1.88) | 68% | +1.94 beyond G23 | positive magnet location |
| G02xR1 | gamma balance within ±1% of S | R1 | - | -0.036 (-5.43) | **-0.021 (-2.96)** | 20/20 | -0.047 (-2.74) | 68% | -0.85 beyond G23 | gamma nearest spot does the hedging |
| G03xR1 | gamma balance within ±2% of S | R1 | - | -0.040 (-5.66) | **-0.020 (-2.89)** | 20/20 | -0.049 (-2.72) | 64% | -0.16 beyond G23 | local gamma regime |
| G08xR1 | gamma balance of strikes above S | R1 | - | -0.050 (-4.69) | **-0.017 (-2.76)** | 20/20 | -0.025 (-1.25) | 68% | -1.18 beyond G23 | long gamma above = sellers on rips |
| G04xR1 | gamma balance within ±5% of S | R1 | - | -0.046 (-6.14) | **-0.019 (-2.70)** | 20/20 | -0.048 (-2.75) | 68% | -0.61 beyond G23 | medium-range gamma regime |
| D03xR1 | delta balance within ±2% | R1 | ? | -0.040 (-5.65) | **-0.015 (-2.61)** | 20/20 | -0.039 (-2.31) | 64% | -0.72 beyond G23 | local positioning |
| G22xR1 | G01 z-score vs its own prior 60 days | R1 | - | -0.050 (-6.02) | **-0.018 (-2.61)** | 20/20 | -0.051 (-3.48) | 72% | -0.32 beyond G23 | regime relative to recent normal |
| I02xR1 | G03 × (close above 20-day average) | R1 | ? | -0.026 (-4.03) | **-0.017 (-2.58)** | 19/20 | -0.048 (-2.74) | 64% | -0.36 beyond G23 | local gamma in an uptrend |
| N17xR1 | day d is the first trading day of the month | R1 | ? | +0.048 (+4.23) | **+0.023 (+2.52)** | 20/20 | +0.025 (+1.91) | 88% | +2.57 beyond G23 | new-month inflows |
| G10xR1 | |K − S| / S | R1 | + | +0.014 (+3.04) | **+0.012 (+2.43)** | 19/20 | +0.013 (+0.93) | 76% | +2.18 beyond G23 | king far away = no pin today |
| I05xR1 | net gamma negative and close below 20-day average (1/0) | R1 | + | +0.040 (+5.78) | **+0.012 (+2.41)** | 20/20 | +0.038 (+2.70) | 60% | +0.90 beyond G23 | short gamma in a downtrend = air pocket |
| G21xR1 | net gamma in $ per 1% move ÷ 20-day $ volume | R1 | - | -0.033 (-4.44) | **-0.022 (-2.40)** | 20/20 | -0.075 (-2.09) | 72% | -0.60 beyond G23 | hedging flow relative to normal trading |
| I06xR1 | G06 × net gamma positive | R1 | ? | -0.024 (-4.52) | **-0.012 (-2.28)** | 20/20 | -0.047 (-3.70) | 60% | -0.61 beyond G23 | supported and damped |
| Y08xR1 | D01 change over 1 day | R1 | ? | -0.017 (-2.94) | **-0.013 (-2.17)** | 20/20 | -0.012 (-0.98) | 80% | -1.25 beyond G23 | positioning shift |
| C01xR1 | charm balance Σc / Σ|c| | R1 | ? | -0.019 (-2.43) | **-0.017 (-1.97)** | 19/20 | -0.042 (-2.90) | 72% | -0.96 beyond G23 | time decay forces dealer re-hedging |
| G05xR1 | net gamma negative (1/0) | R1 | + | +0.026 (+4.77) | **+0.010 (+1.97)** | 19/20 | +0.049 (+3.70) | 60% | +0.61 beyond G23 | short gamma → dealers chase |
| N04xR1 | 5-day return | R1 | ? | -0.043 (-4.52) | **-0.017 (-1.96)** | 19/20 | -0.068 (-3.05) | 80% | -0.55 beyond G23 | weekly reversal |
| G02xR2 | gamma balance within ±1% of S | R2 | - | -0.032 (-4.47) | **-0.023 (-3.15)** | 19/20 | -0.052 (-2.36) | NaN% | strongest | gamma nearest spot does the hedging |
| I06xR2 | G06 × net gamma positive | R2 | ? | -0.023 (-3.19) | **-0.017 (-2.96)** | 19/20 | -0.022 (-1.22) | NaN% | -1.55 beyond G02 | supported and damped |
| G23xR2 | G03 z-score vs its own prior 60 days | R2 | - | -0.033 (-3.81) | **-0.018 (-2.35)** | 19/20 | -0.063 (-3.50) | NaN% | +0.01 beyond G02 | local regime relative to recent normal |
| G03xR2 | gamma balance within ±2% of S | R2 | - | -0.041 (-5.56) | **-0.016 (-2.34)** | 19/20 | -0.052 (-2.27) | NaN% | +2.52 beyond G02 | local gamma regime |
| G17xR2 | largest positive-gamma strike − S, / S | R2 | ? | +0.039 (+4.45) | **+0.019 (+2.20)** | 19/20 | +0.043 (+1.64) | NaN% | +0.80 beyond G02 | positive magnet location |

## Passed the holdout test but NOT their own placebo (likely slow-drift artifacts)

| idea | outcome | holdout t | beats own placebos | best placebo t |
|---|---|---|---|---|
| V01xR1 vanna balance Σv / Σ|v| | R1 | +2.38 | 18/20 | +2.89 |
| N10xR2 ln(VIX ÷ 20-day realized vol of SPY) | R2 | +2.65 | 18/20 | +5.31 |

## Survived stage 1 but failed the holdout

| idea | outcome | build β (t) | holdout β (t) |
|---|---|---|---|
| G01xR1 gamma balance Σg / Σ|g| (all strikes) | R1 | -0.035 (-4.75) | -0.012 (-1.70) |
| G01xR2 gamma balance Σg / Σ|g| (all strikes) | R2 | -0.028 (-2.35) | -0.003 (-0.30) |
| G01xS1 gamma balance Σg / Σ|g| (all strikes) | S1 | -0.012 (-3.29) | +0.001 (+0.15) |
| G04xR2 gamma balance within ±5% of S | R2 | -0.040 (-4.43) | -0.013 (-1.72) |
| G05xR2 net gamma negative (1/0) | R2 | +0.020 (+2.70) | +0.006 (+1.14) |
| G07xR1 gamma balance of strikes below S | R1 | -0.022 (-3.14) | -0.008 (-1.29) |
| G07xR2 gamma balance of strikes below S | R2 | -0.022 (-2.33) | -0.006 (-0.63) |
| G08xR2 gamma balance of strikes above S | R2 | -0.048 (-4.38) | -0.011 (-1.58) |
| G08xD4 gamma balance of strikes above S | D4 | -0.227 (-2.80) | -0.118 (-1.63) |
| G10xR2 |K − S| / S | R2 | +0.017 (+3.14) | +0.007 (+1.16) |
| G11xR1 king gamma positive (1/0) | R1 | -0.026 (-4.51) | -0.007 (-1.18) |
| G15xS1 distance to nearest strong node below S / S | S1 | -0.009 (-3.41) | -0.004 (-1.35) |
| G16xS1 corridor width = G14 + G15 | S1 | -0.007 (-2.74) | -0.003 (-0.93) |
| G18xR1 largest negative-gamma strike − S, / S | R1 | +0.026 (+4.23) | -0.001 (-0.10) |
| G18xR2 largest negative-gamma strike − S, / S | R2 | +0.021 (+2.87) | -0.010 (-1.68) |
| G19xR1 call gamma share Σcall_g / (Σcall_g + |Σput_g|) | R1 | -0.036 (-4.59) | -0.010 (-1.43) |
| G19xR2 call gamma share Σcall_g / (Σcall_g + |Σput_g|) | R2 | -0.030 (-2.14) | -0.000 (-0.04) |
| G19xS1 call gamma share Σcall_g / (Σcall_g + |Σput_g|) | S1 | -0.012 (-3.14) | +0.002 (+0.41) |
| G20xR1 ln(Σ|g| / its 20-day mean) | R1 | -0.017 (-2.70) | -0.006 (-1.10) |
| G20xR2 ln(Σ|g| / its 20-day mean) | R2 | -0.029 (-4.32) | -0.008 (-0.82) |
| G21xR2 net gamma in $ per 1% move ÷ 20-day $ volume | R2 | -0.026 (-3.06) | -0.016 (-1.08) |
| G22xR2 G01 z-score vs its own prior 60 days | R2 | -0.034 (-2.94) | -0.009 (-0.81) |
| V01xS1 vanna balance Σv / Σ|v| | S1 | +0.012 (+2.85) | -0.002 (-0.37) |
| V02xS1 vanna balance within ±2% | S1 | +0.011 (+2.69) | -0.001 (-0.42) |
| V04xR1 largest |vanna| strike − S, / S | R1 | +0.019 (+3.88) | +0.012 (+1.82) |
| V05xR1 net vanna positive (1/0) | R1 | +0.023 (+3.23) | +0.003 (+1.32) |
| C01xR2 charm balance Σc / Σ|c| | R2 | -0.037 (-3.00) | +0.006 (+0.37) |
| D01xR1 delta balance Σδ / Σ|δ| | R1 | -0.040 (-4.89) | -0.009 (-1.69) |
| D01xR2 delta balance Σδ / Σ|δ| | R2 | -0.034 (-2.63) | -0.003 (-0.45) |
| D01xS1 delta balance Σδ / Σ|δ| | S1 | -0.012 (-3.04) | -0.001 (-0.20) |
| D02xS1 call delta ÷ |put delta| | S1 | -0.010 (-2.66) | -0.002 (-0.51) |
| D03xR2 delta balance within ±2% | R2 | -0.035 (-3.73) | -0.005 (-0.72) |
| D03xS1 delta balance within ±2% | S1 | -0.010 (-2.77) | -0.000 (-0.03) |
| Y02xS1 G03 change over 1 day | S1 | +0.009 (+2.67) | -0.003 (-0.78) |
| Y03xR1 G01 change over 5 days | R1 | -0.027 (-3.58) | -0.016 (-1.81) |
| Y04xR1 king strike change over 1 day / S | R1 | -0.014 (-2.81) | -0.001 (-0.29) |
| Y09xD3 G17 change over 1 day | D3 | -0.020 (-3.30) | -0.002 (-0.19) |
| N01xR1 ln VIX | R1 | -0.652 (-6.49) | +16.249 (+0.74) |
| N01xR2 ln VIX | R2 | -0.286 (-4.26) | -0.862 (-0.13) |
| N02xR1 VIX 1-day change | R1 | +0.035 (+2.53) | +0.014 (+0.98) |
| N02xR2 VIX 1-day change | R2 | +0.047 (+2.89) | +0.026 (+1.58) |
| N03xR1 prior-day return | R1 | -0.025 (-2.77) | -0.013 (-1.77) |
| N04xR2 5-day return | R2 | -0.046 (-3.09) | -0.013 (-1.52) |
| N04xD4 5-day return | D4 | -0.261 (-2.55) | +0.005 (+0.03) |
| N05xR1 20-day return | R1 | -0.031 (-3.63) | +0.002 (+0.23) |
| N05xR2 20-day return | R2 | -0.030 (-2.85) | +0.013 (+1.31) |
| N06xR1 close ÷ 20-day average − 1 | R1 | -0.053 (-6.14) | -0.009 (-1.08) |
| N06xR2 close ÷ 20-day average − 1 | R2 | -0.050 (-4.37) | -0.003 (-0.34) |
| N06xD4 close ÷ 20-day average − 1 | D4 | -0.220 (-2.49) | -0.024 (-0.26) |
| N10xR1 ln(VIX ÷ 20-day realized vol of SPY) | R1 | +0.067 (+3.89) | +0.032 (+1.84) |
| N10xS1 ln(VIX ÷ 20-day realized vol of SPY) | S1 | +0.014 (+2.36) | +0.001 (+0.15) |
| N10xP1 ln(VIX ÷ 20-day realized vol of SPY) | P1 | -0.023 (-2.44) | -0.008 (-0.65) |
| N11xR2 day d is Monday | R2 | -0.053 (-3.54) | -0.004 (-0.19) |
| N11xP1 day d is Monday | P1 | +0.024 (+2.51) | +0.007 (+0.93) |
| N13xR2 day d is monthly OPEX (3rd Friday) | R2 | -0.023 (-2.52) | +0.025 (+2.36) |
| N18xR1 day d is the day before a market holiday | R1 | -0.034 (-5.76) | -0.022 (-1.65) |
| I01xR1 G01 × (VIX > 20) | R1 | -0.042 (-3.94) | -0.005 (-0.90) |
| I02xR2 G03 × (close above 20-day average) | R2 | -0.024 (-2.76) | -0.009 (-1.21) |
| I03xR1 king above S and positive (1/0) | R1 | -0.013 (-2.82) | -0.003 (-0.63) |
| I04xR1 king below S and positive (1/0) | R1 | -0.015 (-2.86) | -0.007 (-1.39) |
| I04xP1 king below S and positive (1/0) | P1 | -0.023 (-3.46) | -0.008 (-1.31) |
| I05xR2 net gamma negative and close below 20-day average (1/0) | R2 | +0.026 (+3.42) | +0.007 (+1.71) |

Outcome units: R1/R2 = log range (β ≈ % change in range per 1 s.d. of the feature); S1 = trendiness share; D1–D4 and P1 = fractions of the 20-day average daily range per 1 s.d. of the feature.

Full per-hypothesis table: results_idea_factory/all.json.
