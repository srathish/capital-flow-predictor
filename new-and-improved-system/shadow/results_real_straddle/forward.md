# Forward paper test — 0DTE straddle selling filter (frozen 2026-10-11, started 2026-10-12)

Holdout reference: filter days +$0.56 / straddle (+17% of premium, win 68%, worst −$6.89); other days +$0.18 (+6%, worst −$38.36).

| sample | days | mean $ / straddle | mean % of premium | win | worst $ |
|---|---|---|---|---|---|
| filter days | 1 | 1.14 | 55.9% | 100% | 1.14 |
| other days | 3 | 1.05 | 44.9% | 67% | -0.19 |
| all | 4 | 1.07 | 47.6% | 75% | -0.19 |

| date | symbol | filter | premium | close vs strike | P&L $ |
|---|---|---|---|---|---|
| 2026-10-13 | QQQ | no | 3.44 | 3.63 | -0.19 |
| 2026-10-13 | SPY | no | 2 | 0.01 | 1.99 |
| 2026-10-12 | QQQ | no | 3.3 | -1.96 | 1.34 |
| 2026-10-12 | SPY | yes | 2.04 | -0.90 | 1.14 |
