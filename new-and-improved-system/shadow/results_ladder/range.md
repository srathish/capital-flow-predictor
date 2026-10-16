# Ladder breaks conditioned on the predicted day range (trend days)

Run 2026-10-16T23:09:41.813Z · SPY/QQQ/IWM/DIA · forecast fit on build days only

**Validated (BH q = 0.10 across 6): none**

| id | test | build | holdout |
|---|---|---|---|
| T1 | breaks on HIGH forecast days | -0.148 (t -2.29, n 2096, hit 20%) | **-0.032 (t -0.63, n 3164, hit 22%)** |
| T2 | HIGH minus LOW forecast days | -0.002 (t -0.03, n 2096) | **+0.046 (t 0.56, n 3164)** |
| T3 | CONF breaks on HIGH days | -0.133 (t -1.03, n 314, hit 23%) | **+0.081 (t 0.68, n 448, hit 24%)** |
| T4 | CONF: HIGH minus LOW | -0.031 (t -0.18, n 314) | **+0.031 (t 0.15, n 448)** |
| T5 | HIGH-day longs only | -0.147 (t -1.35, n 1039, hit 20%) | **+0.032 (t 0.41, n 1544, hit 23%)** |
| T6 | HIGH-day shorts only | -0.149 (t -1.79, n 1057, hit 19%) | **-0.093 (t -1.16, n 1620, hit 20%)** |

## Holdout breaks by range tercile (mean R per trade)

| split | LOW range | MID | HIGH range |
|---|---|---|---|
| by FORECAST range (knowable the night before) | -0.079 (t -1.22, n 1016, hit 21%) | -0.045 (t -0.99, n 2216, hit 22%) | -0.032 (t -0.63, n 3164, hit 22%) |
| by ACTUAL range (oracle — not knowable) | -0.184 (t -4.64, n 1924, hit 19%) | -0.085 (t -1.69, n 1916, hit 22%) | +0.093 (t 1.52, n 2556, hit 23%) |
