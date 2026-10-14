# Iron-fly structure + sizing — results

Run 2026-10-14T04:26:52.307Z · design shadow/DESIGN_iron_fly.md · SPY + QQQ · T1 = 1-day (sold at the prior close), T2 = 0DTE (sold 09:35)

Rows with any wing price missing: T1 49, T2 107 (dropped from every fly table and the sizing runs so all structures are compared on the same days; the "all body days" straddle row keeps them). Fly legs with max risk ≤ 0 (counted inside the missing rows): T1 0, T2 0.

T1 missing by width: ±0.5% 3 · ±1.0% 12 · ±1.5% 16 · ±2.0% 40; mean straddle payout (|close − strike|) on dropped days $2.94 vs kept $4.65; dropped build 31 / holdout 18.

T2 missing by width: ±0.5% 9 · ±1.0% 9 · ±1.5% 14 · ±2.0% 106; mean straddle payout (|close − strike|) on dropped days $2.86 vs kept $3.89; dropped build 9 / holdout 98.

T2 minutes between the earliest and latest of the four 09:34–09:39 prices: median 0, max 5 (n 2930).

## Wing width chosen by the locked rule: **±0.5%**
Basis: T1 build days, F1, n = 112. Mean return on max risk by width: ±0.5% 12.6% · ±1.0% 9.9% · ±1.5% 6.9% · ±2.0% 5.3%

## Per-trade results (one fly = 1 share per leg; ★ = chosen width)

| trade | period | days | structure | n | mean $ | mean return on max risk | win | worst $ | worst return on risk | wing paid |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | build | F1 days | straddle (all body days) | 124 | +0.47 | — (16.7% of premium) | 66.9% | -5.84 | — | — |
| T1 | build | F1 days | straddle | 112 | +0.51 | — (18.2% of premium) | 67.0% | -5.84 | — | — |
| T1 | build | F1 days | ±0.5% ★ | 112 | +0.10 | 12.6% | 48.2% | -1.45 | -100.0% | 38.4% |
| T1 | build | F1 days | ±1.0% | 112 | +0.26 | 9.9% | 60.7% | -3.26 | -100.0% | 9.8% |
| T1 | build | F1 days | ±1.5% | 112 | +0.34 | 6.9% | 65.2% | -4.45 | -100.0% | 4.5% |
| T1 | build | F1 days | ±2.0% | 112 | +0.40 | 5.3% | 67.0% | -5.97 | -83.5% | 0.0% |
| T1 | build | F2 days | straddle (all body days) | 202 | +0.16 | — (7.7% of premium) | 61.9% | -10.51 | — | — |
| T1 | build | F2 days | straddle | 185 | +0.18 | — (8.7% of premium) | 61.6% | -10.51 | — | — |
| T1 | build | F2 days | ±0.5% ★ | 185 | +0.02 | 4.1% | 42.7% | -1.45 | -100.0% | 42.7% |
| T1 | build | F2 days | ±1.0% | 185 | +0.12 | 3.6% | 56.8% | -3.43 | -100.0% | 18.9% |
| T1 | build | F2 days | ±1.5% | 185 | +0.11 | 0.8% | 60.5% | -6.23 | -100.0% | 8.1% |
| T1 | build | F2 days | ±2.0% | 185 | +0.12 | 0.6% | 61.6% | -9.10 | -100.0% | 3.2% |
| T1 | build | other days (not F1) | straddle (all body days) | 475 | -0.16 | — (-5.1% of premium) | 54.9% | -14.86 | — | — |
| T1 | build | other days (not F1) | straddle | 456 | -0.18 | — (-5.9% of premium) | 54.4% | -14.86 | — | — |
| T1 | build | other days (not F1) | ±0.5% ★ | 456 | -0.09 | -9.6% | 37.7% | -1.47 | -100.0% | 59.0% |
| T1 | build | other days (not F1) | ±1.0% | 456 | -0.15 | -6.6% | 43.9% | -3.73 | -100.0% | 34.6% |
| T1 | build | other days (not F1) | ±1.5% | 456 | -0.21 | -4.7% | 49.3% | -6.26 | -100.0% | 17.3% |
| T1 | build | other days (not F1) | ±2.0% | 456 | -0.24 | -3.5% | 52.4% | -9.10 | -100.0% | 9.0% |
| T1 | build | all days | straddle (all body days) | 599 | -0.03 | — (-0.6% of premium) | 57.4% | -14.86 | — | — |
| T1 | build | all days | straddle | 568 | -0.04 | — (-1.1% of premium) | 56.9% | -14.86 | — | — |
| T1 | build | all days | ±0.5% ★ | 568 | -0.05 | -5.2% | 39.8% | -1.47 | -100.0% | 54.9% |
| T1 | build | all days | ±1.0% | 568 | -0.07 | -3.3% | 47.2% | -3.73 | -100.0% | 29.8% |
| T1 | build | all days | ±1.5% | 568 | -0.10 | -2.4% | 52.5% | -6.26 | -100.0% | 14.8% |
| T1 | build | all days | ±2.0% | 568 | -0.11 | -1.8% | 55.3% | -9.10 | -100.0% | 7.2% |
| T1 | holdout | F1 days | straddle (all body days) | 168 | +0.29 | — (11.3% of premium) | 64.9% | -17.46 | — | — |
| T1 | holdout | F1 days | straddle | 160 | +0.26 | — (10.4% of premium) | 65.0% | -17.46 | — | — |
| T1 | holdout | F1 days | ±0.5% ★ | 160 | +0.07 | 9.6% | 44.4% | -1.74 | -100.0% | 38.8% |
| T1 | holdout | F1 days | ±1.0% | 160 | +0.18 | 6.6% | 58.1% | -4.18 | -100.0% | 15.0% |
| T1 | holdout | F1 days | ±1.5% | 160 | +0.15 | 3.2% | 62.5% | -7.99 | -100.0% | 5.6% |
| T1 | holdout | F1 days | ±2.0% | 160 | +0.14 | 2.2% | 62.5% | -10.27 | -100.0% | 1.9% |
| T1 | holdout | F2 days | straddle (all body days) | 271 | +0.71 | — (17.2% of premium) | 67.2% | -17.46 | — | — |
| T1 | holdout | F2 days | straddle | 259 | +0.68 | — (16.6% of premium) | 67.2% | -17.46 | — | — |
| T1 | holdout | F2 days | ±0.5% ★ | 259 | +0.08 | 11.8% | 44.8% | -1.74 | -100.0% | 41.3% |
| T1 | holdout | F2 days | ±1.0% | 259 | +0.31 | 12.1% | 58.3% | -4.18 | -100.0% | 16.2% |
| T1 | holdout | F2 days | ±1.5% | 259 | +0.42 | 8.3% | 64.5% | -7.99 | -100.0% | 5.4% |
| T1 | holdout | F2 days | ±2.0% | 259 | +0.48 | 6.4% | 64.9% | -10.27 | -100.0% | 1.9% |
| T1 | holdout | other days (not F1) | straddle (all body days) | 589 | +0.04 | — (0.6% of premium) | 59.1% | -34.55 | — | — |
| T1 | holdout | other days (not F1) | straddle | 579 | +0.01 | — (0.3% of premium) | 58.9% | -34.55 | — | — |
| T1 | holdout | other days (not F1) | ±0.5% ★ | 579 | -0.14 | -10.6% | 31.1% | -2.63 | -100.0% | 59.8% |
| T1 | holdout | other days (not F1) | ±1.0% | 579 | -0.08 | -2.2% | 44.0% | -4.66 | -100.0% | 30.9% |
| T1 | holdout | other days (not F1) | ±1.5% | 579 | -0.05 | -0.7% | 51.5% | -7.49 | -100.0% | 17.3% |
| T1 | holdout | other days (not F1) | ±2.0% | 579 | -0.03 | -0.1% | 55.3% | -11.42 | -100.0% | 8.5% |
| T1 | holdout | all days | straddle (all body days) | 757 | +0.09 | — (3.0% of premium) | 60.4% | -34.55 | — | — |
| T1 | holdout | all days | straddle | 739 | +0.07 | — (2.5% of premium) | 60.2% | -34.55 | — | — |
| T1 | holdout | all days | ±0.5% ★ | 739 | -0.09 | -6.2% | 34.0% | -2.63 | -100.0% | 55.2% |
| T1 | holdout | all days | ±1.0% | 739 | -0.03 | -0.3% | 47.1% | -4.66 | -100.0% | 27.5% |
| T1 | holdout | all days | ±1.5% | 739 | -0.00 | 0.2% | 53.9% | -7.99 | -100.0% | 14.7% |
| T1 | holdout | all days | ±2.0% | 739 | +0.01 | 0.4% | 56.8% | -11.42 | -100.0% | 7.0% |
| T2 | holdout | F1 days | straddle (all body days) | 168 | +0.56 | — (17.4% of premium) | 67.9% | -6.89 | — | — |
| T2 | holdout | F1 days | straddle | 127 | +0.56 | — (17.1% of premium) | 69.3% | -6.89 | — | — |
| T2 | holdout | F1 days | ±0.5% ★ | 127 | +0.05 | 2.6% | 45.7% | -2.05 | -100.0% | 29.9% |
| T2 | holdout | F1 days | ±1.0% | 127 | +0.28 | 7.6% | 61.4% | -4.33 | -100.0% | 6.3% |
| T2 | holdout | F1 days | ±1.5% | 127 | +0.39 | 6.5% | 64.6% | -6.51 | -100.0% | 1.6% |
| T2 | holdout | F1 days | ±2.0% | 127 | +0.45 | 5.1% | 66.9% | -7.19 | -76.2% | 0.0% |
| T2 | holdout | F2 days | straddle (all body days) | 271 | +0.65 | — (18.3% of premium) | 67.9% | -6.89 | — | — |
| T2 | holdout | F2 days | straddle | 219 | +0.73 | — (20.6% of premium) | 70.3% | -6.89 | — | — |
| T2 | holdout | F2 days | ±0.5% ★ | 219 | +0.10 | 6.5% | 45.7% | -2.05 | -100.0% | 32.0% |
| T2 | holdout | F2 days | ±1.0% | 219 | +0.38 | 10.8% | 62.6% | -4.33 | -100.0% | 7.3% |
| T2 | holdout | F2 days | ±1.5% | 219 | +0.52 | 8.4% | 65.3% | -6.51 | -100.0% | 1.8% |
| T2 | holdout | F2 days | ±2.0% | 219 | +0.60 | 6.3% | 67.6% | -7.19 | -100.0% | 0.5% |
| T2 | holdout | other days (not F1) | straddle (all body days) | 590 | +0.18 | — (5.7% of premium) | 61.7% | -38.36 | — | — |
| T2 | holdout | other days (not F1) | straddle | 533 | +0.25 | — (8.2% of premium) | 63.0% | -38.36 | — | — |
| T2 | holdout | other days (not F1) | ±0.5% ★ | 533 | +0.04 | 0.4% | 41.3% | -2.13 | -100.0% | 48.8% |
| T2 | holdout | other days (not F1) | ±1.0% | 533 | +0.13 | 2.3% | 52.9% | -5.06 | -100.0% | 20.1% |
| T2 | holdout | other days (not F1) | ±1.5% | 533 | +0.24 | 2.5% | 57.2% | -8.92 | -100.0% | 7.5% |
| T2 | holdout | other days (not F1) | ±2.0% | 533 | +0.29 | 2.1% | 60.0% | -11.90 | -100.0% | 4.1% |
| T2 | holdout | all days | straddle (all body days) | 758 | +0.27 | — (8.3% of premium) | 63.1% | -38.36 | — | — |
| T2 | holdout | all days | straddle | 660 | +0.31 | — (9.9% of premium) | 64.2% | -38.36 | — | — |
| T2 | holdout | all days | ±0.5% ★ | 660 | +0.04 | 0.8% | 42.1% | -2.13 | -100.0% | 45.2% |
| T2 | holdout | all days | ±1.0% | 660 | +0.16 | 3.3% | 54.5% | -5.06 | -100.0% | 17.4% |
| T2 | holdout | all days | ±1.5% | 660 | +0.27 | 3.3% | 58.6% | -8.92 | -100.0% | 6.4% |
| T2 | holdout | all days | ±2.0% | 660 | +0.32 | 2.6% | 61.4% | -11.90 | -100.0% | 3.3% |

## Sizing: account path (max risk = X% of the account per fly; SPY and QQQ sized separately; chosen width)

| trade | period | days traded | structure | risk per fly | trades | final account | annual growth | worst day | worst 20-day return | max drawdown | longest drawdown (days) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | build | F1 days | fly ±0.5% | 1% | 112 | 1.145 | 12.1% | -2.0% | -6.9% | -6.9% | 125 |
| T1 | build | F1 days | fly ±0.5% | 2% | 112 | 1.297 | 24.4% | -4.0% | -13.5% | -13.5% | 125 |
| T1 | build | F1 days | fly ±0.5% | 3% | 112 | 1.451 | 36.7% | -6.0% | -19.7% | -19.7% | 125 |
| T1 | build | F1 days | naked straddle (undefined risk) | premium 1% | 112 | 1.223 | 18.4% | -1.6% | -3.7% | -5.1% | 76 |
| T1 | build | F2 days | fly ±0.5% | 1% | 185 | 1.067 | 5.6% | -2.0% | -4.6% | -8.1% | 109 |
| T1 | build | F2 days | fly ±0.5% | 2% | 185 | 1.115 | 9.6% | -4.0% | -9.2% | -15.8% | 109 |
| T1 | build | F2 days | fly ±0.5% | 3% | 185 | 1.141 | 11.7% | -6.0% | -13.7% | -23.0% | 109 |
| T1 | build | F2 days | naked straddle (undefined risk) | premium 1% | 185 | 1.166 | 13.8% | -6.0% | -4.7% | -8.6% | 98 |
| T1 | build | all days | fly ±0.5% | 1% | 568 | 0.709 | -25.1% | -2.0% | -19.9% | -35.1% | 294 |
| T1 | build | all days | fly ±0.5% | 2% | 568 | 0.458 | -48.1% | -4.0% | -36.2% | -61.4% | 294 |
| T1 | build | all days | fly ±0.5% | 3% | 568 | 0.271 | -66.6% | -6.0% | -49.5% | -78.9% | 294 |
| T1 | build | all days | naked straddle (undefined risk) | premium 1% | 568 | 0.908 | -7.8% | -6.8% | -13.5% | -20.5% | 187 |
| T1 | holdout | F1 days | fly ±0.5% | 1% | 160 | 1.155 | 10.1% | -2.0% | -8.1% | -15.4% | 120 |
| T1 | holdout | F1 days | fly ±0.5% | 2% | 160 | 1.308 | 19.6% | -4.0% | -15.7% | -28.8% | 120 |
| T1 | holdout | F1 days | fly ±0.5% | 3% | 160 | 1.454 | 28.2% | -6.0% | -22.7% | -40.3% | 120 |
| T1 | holdout | F1 days | naked straddle (undefined risk) | premium 1% | 160 | 1.173 | 11.2% | -6.0% | -11.4% | -18.1% | 120 |
| T1 | holdout | F2 days | fly ±0.5% | 1% | 259 | 1.331 | 21.0% | -2.0% | -6.1% | -12.7% | 121 |
| T1 | holdout | F2 days | fly ±0.5% | 2% | 259 | 1.706 | 42.6% | -4.0% | -12.0% | -24.5% | 121 |
| T1 | holdout | F2 days | fly ±0.5% | 3% | 259 | 2.106 | 64.1% | -6.0% | -17.6% | -35.2% | 121 |
| T1 | holdout | F2 days | naked straddle (undefined risk) | premium 1% | 259 | 1.518 | 32.0% | -6.0% | -7.6% | -12.2% | 121 |
| T1 | holdout | all days | fly ±0.5% | 1% | 739 | 0.585 | -30.0% | -2.0% | -13.8% | -52.5% | 295 |
| T1 | holdout | all days | fly ±0.5% | 2% | 739 | 0.296 | -55.5% | -4.0% | -26.0% | -79.4% | 295 |
| T1 | holdout | all days | fly ±0.5% | 3% | 739 | 0.130 | -74.2% | -6.0% | -36.6% | -91.9% | 295 |
| T1 | holdout | all days | naked straddle (undefined risk) | premium 1% | 739 | 1.145 | 9.4% | -10.7% | -16.6% | -27.6% | 132 |
| T2 | build | F1 days | fly ±0.5% | 1% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F1 days | fly ±0.5% | 2% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F1 days | fly ±0.5% | 3% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F1 days | naked straddle (undefined risk) | premium 1% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F2 days | fly ±0.5% | 1% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F2 days | fly ±0.5% | 2% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F2 days | fly ±0.5% | 3% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | F2 days | naked straddle (undefined risk) | premium 1% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | all days | fly ±0.5% | 1% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | all days | fly ±0.5% | 2% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | all days | fly ±0.5% | 3% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | build | all days | naked straddle (undefined risk) | premium 1% | 0 | 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| T2 | holdout | F1 days | fly ±0.5% | 1% | 127 | 1.027 | 1.8% | -2.0% | -8.8% | -11.3% | 127 |
| T2 | holdout | F1 days | fly ±0.5% | 2% | 127 | 1.041 | 2.7% | -4.0% | -16.9% | -21.6% | 127 |
| T2 | holdout | F1 days | fly ±0.5% | 3% | 127 | 1.040 | 2.7% | -6.0% | -24.5% | -30.8% | 127 |
| T2 | holdout | F1 days | naked straddle (undefined risk) | premium 1% | 127 | 1.237 | 15.2% | -3.4% | -4.0% | -5.0% | 76 |
| T2 | holdout | F2 days | fly ±0.5% | 1% | 219 | 1.137 | 8.9% | -2.0% | -6.8% | -11.0% | 100 |
| T2 | holdout | F2 days | fly ±0.5% | 2% | 219 | 1.260 | 16.6% | -4.0% | -13.4% | -21.1% | 113 |
| T2 | holdout | F2 days | fly ±0.5% | 3% | 219 | 1.361 | 22.8% | -6.0% | -19.8% | -30.4% | 121 |
| T2 | holdout | F2 days | naked straddle (undefined risk) | premium 1% | 219 | 1.558 | 34.3% | -3.4% | -7.1% | -7.4% | 32 |
| T2 | holdout | all days | fly ±0.5% | 1% | 660 | 0.997 | -0.2% | -2.0% | -15.6% | -28.0% | 249 |
| T2 | holdout | all days | fly ±0.5% | 2% | 660 | 0.889 | -7.5% | -4.0% | -29.4% | -51.2% | 249 |
| T2 | holdout | all days | fly ±0.5% | 3% | 660 | 0.711 | -20.3% | -6.0% | -41.6% | -68.9% | 249 |
| T2 | holdout | all days | naked straddle (undefined risk) | premium 1% | 660 | 1.840 | 50.0% | -15.0% | -12.1% | -16.4% | 109 |

Notes: the naked straddle row sizes premium at 1% of the account, so a 10× premium loss costs 10% in a day — the fly caps that. No commissions beyond the stated spreads; settlement at intrinsic on the close.
