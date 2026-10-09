# Stock-finding factory — LONG horizon results

Run 2026-10-09T16:24:34.954Z · design shadow/DESIGN_stock_factory.md · 276 studies · 178 month-ends · median 1481 eligible stocks per month

**Build 2012–2019 (BH q = 0.10): 85 of 276 pass. Holdout 2020–2026 (BH across survivors, same sign, beat ≥ 19/20 own placebos): 46 validated** (5 of them use a feature from an earlier design).

| outcome | studies | pass build | validated |
|---|---|---|---|
| M1 | 69 | 18 | 8 |
| M3 | 69 | 19 | 6 |
| M6 | 69 | 21 | 6 |
| MV | 69 | 27 | 26 |

## Validated studies (holdout)

| study | feature | outcome | predicted | build IC (t) | holdout IC (t) | top − bottom fifth (holdout) | own placebos beaten | industry-neutral t | small / large t | beyond strongest (t) | mechanism |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L24xM1 | share count change over 1 year (split-adjusted) | M1 | - | -0.026 (-3.11) | **-0.046 (-3.68)** | +7.10% | 20/20 | -3.02 | -3.35 / -3.41 | strongest | dilution |
| L25xM1 | buyback: share count down > 2% in a year (1/0) | M1 | + | +0.014 (+2.23) | **+0.023 (+3.29)** | +6.01% | 20/20 | +2.77 | +2.47 / +3.03 | -2.18 beyond L24 | capital return |
| L21xM1 | deferred revenue growth YoY | M1 | + | +0.026 (+3.65) | **+0.018 (+2.38)** | +0.26% | 20/20 | +2.25 | +2.32 / +1.43 | +3.06 beyond L24 | prepaid demand |
| L35xM1 | 200-day average slope (3 months) | M1 | + | +0.028 (+2.13) | **+0.029 (+2.05)** | +4.39% | 19/20 | +1.89 | +2.82 / +1.32 | +1.96 beyond L24 | trend strength |
| L18xM1 | capex ÷ revenue (TTM) | M1 | - | -0.017 (-2.07) | **-0.015 (-1.86)** | -0.32% | 20/20 | -1.98 | -2.18 / -1.59 | -1.52 beyond L24 | capital intensity |
| L43xM1 | 12-1 momentum minus industry 12-1 momentum | M1 | + | +0.021 (+2.52) | **+0.018 (+1.82)** | +2.50% | 19/20 | +1.85 | +2.33 / +1.07 | +1.98 beyond L24 | stock-specific momentum |
| L37xM1 | max daily return last month | M1 | - | -0.035 (-2.69) | **-0.036 (-1.78)** | +7.44% | 19/20 | -2.00 | -2.29 / -0.94 | -1.27 beyond L24 | lottery stocks underperform |
| L30xM1 (seen) | 12-1 month momentum | M1 | + | +0.026 (+1.97) | **+0.023 (+1.66)** | +2.47% | 19/20 | +1.66 | +2.30 / +1.04 | +1.59 beyond L24 | momentum (seen) |
| L25xM3 | buyback: share count down > 2% in a year (1/0) | M3 | + | +0.027 (+3.30) | **+0.039 (+4.17)** | +14.65% | 20/20 | +3.66 | +2.65 / +4.05 | strongest | capital return |
| L24xM3 | share count change over 1 year (split-adjusted) | M3 | - | -0.041 (-3.88) | **-0.070 (-4.06)** | +15.20% | 20/20 | -3.11 | -3.34 / -3.94 | -3.63 beyond L25 | dilution |
| L58xM3 | days since latest 10-Q/10-K | M3 | ? | +0.011 (+2.61) | **+0.017 (+2.73)** | -0.23% | 20/20 | +2.61 | +2.88 / +2.02 | +2.57 beyond L25 | news staleness |
| L33xM3 | price ÷ 52-week high | M3 | + | +0.057 (+2.92) | **+0.058 (+2.12)** | -6.39% | 19/20 | +2.12 | +2.76 / +1.41 | +1.94 beyond L25 | 52-week-high effect |
| L39xM3 | dollar volume 3 months ÷ 12 months | M3 | + | +0.019 (+2.06) | **+0.021 (+1.69)** | +6.56% | 19/20 | +2.20 | +2.37 / +0.75 | +1.78 beyond L25 | rising attention |
| L18xM3 | capex ÷ revenue (TTM) | M3 | - | -0.029 (-2.36) | **-0.025 (-1.67)** | -1.16% | 19/20 | -2.04 | -1.80 / -1.61 | -1.53 beyond L25 | capital intensity |
| L25xM6 | buyback: share count down > 2% in a year (1/0) | M6 | + | +0.038 (+4.90) | **+0.055 (+4.75)** | +20.88% | 20/20 | +4.30 | +3.52 / +4.61 | strongest | capital return |
| L24xM6 | share count change over 1 year (split-adjusted) | M6 | - | -0.056 (-6.15) | **-0.096 (-4.13)** | +23.56% | 20/20 | -3.17 | -3.74 / -3.71 | -3.76 beyond L25 | dilution |
| L58xM6 | days since latest 10-Q/10-K | M6 | ? | +0.013 (+2.18) | **+0.017 (+3.52)** | -0.86% | 20/20 | +3.44 | +4.80 / +1.33 | +3.64 beyond L25 | news staleness |
| L34xM6 (seen) | above 200-day average (1/0) | M6 | + | +0.036 (+2.02) | **+0.051 (+2.39)** | -0.81% | 19/20 | +1.66 | +3.63 / +1.82 | +2.40 beyond L25 | trend (seen) |
| L55xM6 | guidance raise in last 120 days (1/0) | M6 | + | +0.019 (+3.36) | **+0.017 (+2.34)** | +15.21% | 19/20 | +3.32 | +2.84 / +1.56 | +2.18 beyond L25 | management confidence |
| L33xM6 | price ÷ 52-week high | M6 | + | +0.069 (+2.77) | **+0.071 (+1.73)** | -26.47% | 19/20 | +1.66 | +2.08 / +1.41 | +1.60 beyond L25 | 52-week-high effect |
| L65xMV | low volatility and positive 12-1 momentum (1/0) | MV | - | -0.114 (-8.51) | **-0.107 (-11.43)** | -8.3 pts | 20/20 | -8.97 | -9.60 / -8.64 | strongest | quality momentum |
| L27xMV | earnings yield (TTM net income ÷ market cap) | MV | - | -0.091 (-7.28) | **-0.103 (-10.88)** | -8.9 pts | 20/20 | -10.24 | -10.21 / -6.76 | -9.72 beyond L65 | value |
| L36xMV | realized volatility (3 months) | MV | + | +0.173 (+11.16) | **+0.194 (+9.97)** | +16.4 pts | 20/20 | +8.42 | +9.12 / +8.97 | +8.53 beyond L65 | low-volatility anomaly |
| L41xMV | size (ln market cap) | MV | - | -0.106 (-9.99) | **-0.099 (-9.08)** | -8.6 pts | 20/20 | -7.55 | -10.05 / -3.90 | -6.69 beyond L65 | small-cap effect |
| L37xMV | max daily return last month | MV | + | +0.132 (+10.56) | **+0.155 (+8.97)** | +13.0 pts | 20/20 | +7.84 | +8.93 / +7.41 | +7.10 beyond L65 | lottery stocks underperform |
| L12xMV | net income positive (1/0) | MV | - | -0.086 (-8.74) | **-0.104 (-7.91)** | -8.7 pts | 20/20 | -6.66 | -6.26 / -6.33 | -7.25 beyond L65 | profitable |
| L68xMV | price ÷ 52-week low | MV | ? | +0.082 (+6.60) | **+0.106 (+7.76)** | +9.2 pts | 20/20 | +6.80 | +7.55 / +6.38 | +8.14 beyond L65 | distance from lows |
| L40xMV | turnover (dollar volume ÷ market cap) | MV | + | +0.078 (+7.56) | **+0.105 (+7.36)** | +8.5 pts | 20/20 | +6.46 | +5.42 / +5.76 | +6.33 beyond L65 | over-trading |
| L09xMV | operating margin | MV | ? | -0.095 (-8.53) | **-0.104 (-6.82)** | -8.9 pts | 20/20 | -6.09 | -4.88 / -6.72 | -5.76 beyond L65 | profitability |
| L33xMV | price ÷ 52-week high | MV | ? | -0.077 (-5.37) | **-0.094 (-6.66)** | -8.1 pts | 20/20 | -5.35 | -5.66 / -4.79 | -3.39 beyond L65 | 52-week-high effect |
| L67xMV | gross margin stability (−s.d. over 6 quarters) | MV | - | -0.049 (-3.61) | **-0.067 (-6.46)** | -5.7 pts | 20/20 | -6.13 | -5.25 / -5.06 | -5.22 beyond L65 | durable economics |
| L70xMV | operating margin positive (1/0) | MV | - | -0.090 (-7.96) | **-0.107 (-6.37)** | -9.3 pts | 20/20 | -5.68 | -4.80 / -6.34 | -5.61 beyond L65 | operating profit |
| L08xMV | stability of YoY growth (−s.d. over last 6 quarters) | MV | - | -0.043 (-2.94) | **-0.072 (-5.92)** | -6.2 pts | 20/20 | -7.09 | -4.37 / -5.30 | -4.75 beyond L65 | quality growth |
| L24xMV | share count change over 1 year (split-adjusted) | MV | ? | +0.051 (+5.76) | **+0.072 (+5.89)** | +5.5 pts | 20/20 | +5.80 | +4.52 / +4.08 | +4.17 beyond L65 | dilution |
| L38xMV | beta to SPY (1 year) | MV | + | +0.083 (+5.88) | **+0.129 (+5.86)** | +11.0 pts | 20/20 | +6.20 | +5.27 / +4.64 | +4.58 beyond L65 | betting-against-beta |
| L22xMV | R&D ÷ revenue | MV | + | +0.108 (+7.32) | **+0.091 (+5.24)** | +8.2 pts | 20/20 | +7.48 | +4.18 / +5.63 | +5.13 beyond L65 | innovation |
| L62xMV (seen) | v5 Model C conditions met (bottleneck top 20% + momentum + above 200-day) | MV | + | +0.049 (+4.21) | **+0.035 (+3.76)** | +0.6 pts | 20/20 | +3.55 | +3.39 / +3.23 | +6.48 beyond L65 | growth + trend (seen) |
| L05xMV (seen) | v5 bottleneck score (mean pct-rank of L01, L02, L04) | MV | + | +0.042 (+3.34) | **+0.050 (+3.59)** | +4.1 pts | 20/20 | +3.60 | +3.08 / +4.69 | +5.24 beyond L65 | bottleneck (seen) |
| L25xMV | buyback: share count down > 2% in a year (1/0) | MV | - | -0.026 (-3.36) | **-0.026 (-3.41)** | -1.0 pts | 20/20 | -3.24 | -2.25 / -2.22 | -2.33 beyond L65 | capital return |
| L01xMV | revenue growth YoY (latest quarter) | MV | + | +0.050 (+3.40) | **+0.047 (+3.18)** | +4.3 pts | 20/20 | +3.86 | +2.28 / +4.84 | +4.03 beyond L65 | demand |
| L07xMV | 2-year revenue growth (latest vs 8 quarters earlier) | MV | + | +0.064 (+3.94) | **+0.048 (+3.14)** | +4.2 pts | 20/20 | +4.06 | +2.08 / +4.85 | +3.50 beyond L65 | durable growth |
| L06xMV | revenue growth QoQ | MV | + | +0.028 (+3.62) | **+0.032 (+3.12)** | +2.4 pts | 20/20 | +4.07 | +2.23 / +3.88 | +3.86 beyond L65 | near-term demand |
| L45xMV | industry (SIC3) 6-month return | MV | + | +0.032 (+1.97) | **+0.034 (+3.07)** | +3.3 pts | 20/20 | +3.13 | +3.81 / +1.86 | +3.18 beyond L65 | industry momentum |
| L49xMV | number of filing concepts with 6-month return in the top quartile | MV | + | +0.035 (+3.76) | **+0.055 (+2.60)** | +3.4 pts | 19/20 | +3.05 | +2.43 / +2.83 | +2.69 beyond L65 | theme exposure |
| L48xMV (seen) | best 6-month return among the stock's filing concepts | MV | + | +0.026 (+2.70) | **+0.058 (+2.49)** | +5.9 pts | 20/20 | +2.45 | +1.99 / +2.79 | +2.08 beyond L65 | theme momentum (E1, seen) |
| L23xMV | R&D growth YoY | MV | + | +0.056 (+2.98) | **+0.029 (+1.85)** | +3.0 pts | 20/20 | +2.37 | +0.73 / +2.75 | +2.06 beyond L65 | innovation push |

## Passed the holdout test but not their own placebo

| study | holdout t | placebos beaten | best placebo t |
|---|---|---|---|
| L36xM1 realized volatility (3 months) | -1.78 | 18/20 | +2.49 |

## Passed build, failed holdout

| study | build IC (t) | holdout IC (t) |
|---|---|---|
| L02xM1 revenue growth acceleration (YoY now − YoY last quarter) | +0.013 (+2.24) | +0.003 (+0.44) |
| L02xM3 revenue growth acceleration (YoY now − YoY last quarter) | +0.020 (+2.08) | -0.002 (-0.21) |
| L02xM6 revenue growth acceleration (YoY now − YoY last quarter) | +0.026 (+2.39) | +0.001 (+0.05) |
| L05xM1 v5 bottleneck score (mean pct-rank of L01, L02, L04) | +0.021 (+2.15) | +0.015 (+1.51) |
| L05xM3 v5 bottleneck score (mean pct-rank of L01, L02, L04) | +0.029 (+2.06) | +0.013 (+0.97) |
| L06xM3 revenue growth QoQ | +0.033 (+3.54) | -0.000 (-0.01) |
| L06xM6 revenue growth QoQ | +0.031 (+3.51) | -0.001 (-0.06) |
| L08xM1 stability of YoY growth (−s.d. over last 6 quarters) | +0.020 (+1.99) | +0.000 (+0.01) |
| L08xM3 stability of YoY growth (−s.d. over last 6 quarters) | +0.034 (+2.14) | -0.005 (-0.27) |
| L08xM6 stability of YoY growth (−s.d. over last 6 quarters) | +0.043 (+1.91) | -0.009 (-0.40) |
| L14xM1 growth surprise vs own trend (YoY now − mean YoY of prior 4 quarters) | +0.017 (+2.40) | +0.005 (+0.51) |
| L17xMV capex growth YoY | +0.018 (+3.71) | -0.002 (-0.28) |
| L18xM6 capex ÷ revenue (TTM) | -0.039 (-2.29) | -0.032 (-1.51) |
| L21xM3 deferred revenue growth YoY | +0.034 (+3.22) | +0.017 (+1.28) |
| L21xM6 deferred revenue growth YoY | +0.033 (+2.32) | +0.023 (+1.20) |
| L22xM3 R&D ÷ revenue | +0.038 (+2.12) | -0.003 (-0.11) |
| L22xM6 R&D ÷ revenue | +0.047 (+2.37) | -0.014 (-0.50) |
| L31xM1 6-1 month momentum | +0.024 (+1.95) | +0.021 (+1.51) |
| L32xM1 1-month return | -0.020 (-2.03) | +0.016 (+1.34) |
| L35xM3 200-day average slope (3 months) | +0.037 (+2.11) | +0.027 (+1.32) |
| L36xM3 realized volatility (3 months) | -0.052 (-2.10) | -0.048 (-1.26) |
| L36xM6 realized volatility (3 months) | -0.069 (-1.95) | -0.048 (-0.92) |
| L37xM3 max daily return last month | -0.046 (-2.55) | -0.043 (-1.40) |
| L37xM6 max daily return last month | -0.054 (-2.06) | -0.038 (-0.88) |
| L43xM3 12-1 momentum minus industry 12-1 momentum | +0.024 (+2.44) | +0.015 (+1.09) |
| L43xM6 12-1 momentum minus industry 12-1 momentum | +0.027 (+2.35) | +0.015 (+0.71) |
| L44xM1 price ÷ 20-day average − 1 | -0.020 (-2.05) | +0.009 (+0.81) |
| L49xM6 number of filing concepts with 6-month return in the top quartile | +0.016 (+1.98) | +0.013 (+0.57) |
| L59xM6 fresh filing (≤ 30 days) with accelerating revenue (1/0) | +0.010 (+1.98) | +0.005 (+0.94) |
| L60xM3 revenue growth rank change over 3 months | +0.017 (+2.03) | -0.005 (-0.49) |
| L60xM6 revenue growth rank change over 3 months | +0.026 (+2.80) | +0.003 (+0.25) |
| L62xM6 v5 Model C conditions met (bottleneck top 20% + momentum + above 200-day) | +0.024 (+2.10) | +0.022 (+1.49) |
| L64xM1 revenue accelerating and industry momentum positive (1/0) | +0.015 (+2.26) | -0.001 (-0.17) |
| L64xM3 revenue accelerating and industry momentum positive (1/0) | +0.025 (+2.67) | -0.005 (-0.47) |
| L64xM6 revenue accelerating and industry momentum positive (1/0) | +0.031 (+2.77) | +0.001 (+0.08) |
| L67xM1 gross margin stability (−s.d. over 6 quarters) | +0.019 (+2.60) | +0.012 (+1.32) |
| L67xM3 gross margin stability (−s.d. over 6 quarters) | +0.029 (+2.89) | +0.018 (+1.32) |
| L67xM6 gross margin stability (−s.d. over 6 quarters) | +0.037 (+2.62) | +0.019 (+1.11) |

IC = Spearman rank correlation between the feature and the outcome across stocks, averaged over month-ends. Top − bottom fifth = average outcome (excess return; for MV, share of big movers) of the highest-feature fifth minus the lowest fifth.
