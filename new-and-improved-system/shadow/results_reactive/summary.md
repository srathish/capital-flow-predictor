# Reactive Skylit nodes — results

72 sessions · SPXW/SPY/QQQ · touches 2076, breaks 232, king migrations 1251

**Validated (holdout, BH q = 0.10 across 5): none**

| test | build | holdout |
|---|---|---|
| touch → break rate: shrinking minus growing node | +0.063 (t 0.90, +0.397 vs +0.333, n 63) | **+0.186 (t 1.44, +0.591 vs +0.405, n 22)** |
| breaks of SHRINKING nodes: mean R | — (t nan, n 8) | **— (t nan, n 4)** |
| shrinking-node breaks minus growing-node breaks (R) | — (t nan, — vs -0.141, n 8) | **— (t nan, — vs +0.439, n 4)** |
| king migration: price moves toward the new king (minus 50%) | -0.033 (t -1.91, n 959) | **-0.034 (t -0.88, n 292)** |
| all breaks (static-style baseline): mean R | -0.008 (t -0.04, n 152) | **+0.315 (t 1.31, n 80)** |

Base break rate at touches: build 34.4%, holdout 39.1%.

## Holdout per ticker

| ticker | break rate, shrinking node | break rate, growing node | mean R, shrinking-node breaks |
|---|---|---|---|
| SPXW | 33.3% | 38.5% | -1.000 |
| SPY | 71.4% | 41.6% | +0.702 |
| QQQ | 58.3% | 41.6% | -1.000 |
