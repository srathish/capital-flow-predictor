# Reactive Skylit nodes — results (0DTE column only)

72 sessions · SPXW/SPY/QQQ · touches 2145, breaks 196, king migrations 1370

**Validated (holdout, BH q = 0.10 across 5): none**

| test | build | holdout |
|---|---|---|
| touch → break rate: shrinking minus growing node | +0.062 (t 0.84, +0.411 vs +0.349, n 56) | **+0.006 (t 0.04, +0.423 vs +0.417, n 26)** |
| breaks of SHRINKING nodes: mean R | — (t nan, n 3) | **— (t nan, n 0)** |
| shrinking-node breaks minus growing-node breaks (R) | — (t nan, — vs +0.054, n 3) | **— (t nan, n 0)** |
| king migration: price moves toward the new king (minus 50%) | -0.064 (t -4.01, n 998) | **-0.027 (t -0.81, n 372)** |
| all breaks (static-style baseline): mean R | +0.011 (t 0.07, n 127) | **-0.121 (t -0.62, n 69)** |

Base break rate at touches: build 34.9%, holdout 39.2%.

## Holdout per ticker

| ticker | break rate, shrinking node | break rate, growing node | mean R, shrinking-node breaks |
|---|---|---|---|
| SPXW | 25.0% | 40.8% | — |
| SPY | 50.0% | 41.4% | — |
| QQQ | 45.0% | 43.3% | — |
