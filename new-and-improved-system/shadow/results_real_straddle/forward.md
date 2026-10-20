# Forward paper test — 0DTE straddle selling filter (frozen 2026-10-11, started 2026-10-12)

Holdout reference: filter days +$0.56 / straddle (+17% of premium, win 68%, worst −$6.89); other days +$0.18 (+6%, worst −$38.36).

Iron fly holdout reference (results_iron_fly, 0DTE, filter days): ±0.5% +$0.05 / +2.6% of max risk; ±1% +$0.28 / +7.6%. ±0.5% is the locked choice (from 1-day build days); ±1% is secondary.

| sample | days | mean $ / straddle | mean % of premium | win | worst $ | fly ±0.5% $ / return on risk | fly ±1% $ / return on risk |
|---|---|---|---|---|---|---|---|
| filter days | 1 | 1.14 | 55.9% | 100% | 1.14 | 0.88 / 39.6% | 1.06 / 17.5% |
| other days | 11 | -1.75 | -41.7% | 36% | -9.82 | -0.12 / -11.2% | -0.95 / -28.5% |
| all | 12 | -1.51 | -33.5% | 42% | -9.82 | -0.03 / -7.0% | -0.78 / -24.7% |

| date | symbol | filter | premium | close vs strike | P&L $ | fly ±0.5% $ | fly ±1% $ |
|---|---|---|---|---|---|---|---|
| 2026-10-19 | QQQ | no | 4.64 | -0.64 | 4 | 1.97 | 3.28 |
| 2026-10-19 | SPY | no | 3.2 | -0.52 | 2.68 | 1.76 | 2.42 |
| 2026-10-16 | QQQ | no | 4.38 | -14.20 | -9.82 | -0.43 | -3.3 |
| 2026-10-16 | SPY | no | 2.74 | -8.75 | -6.01 | -1.77 | -4.42 |
| 2026-10-15 | QQQ | no | 6.04 | 10.00 | -3.96 | -0.25 | -2.55 |
| 2026-10-15 | SPY | no | 3.73 | 5.79 | -2.06 | -0.62 | -2.46 |
| 2026-10-14 | QQQ | no | 4.49 | -9.05 | -4.56 | -1.14 | -3.17 |
| 2026-10-14 | SPY | no | 2.74 | -5.40 | -2.66 | -1.75 | -2.76 |
| 2026-10-13 | QQQ | no | 3.44 | 3.63 | -0.19 | -1.11 | -0.47 |
| 2026-10-13 | SPY | no | 2 | 0.01 | 1.99 | 1.74 | 1.91 |
| 2026-10-12 | QQQ | no | 3.3 | -1.96 | 1.34 | 0.32 | 1.1 |
| 2026-10-12 | SPY | yes | 2.04 | -0.90 | 1.14 | 0.88 | 1.06 |
