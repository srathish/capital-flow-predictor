# Intraday board factory — results

70 sessions · 4410 snapshots (every 15 min, 10:00–15:00) · SPXW/SPY/QQQ pooled

**Validated (holdout |t| ≥ 2, same sign as build, BH q = 0.10 across 19): none**

| feature | outcome | build IC (t) | holdout IC (t) | same sign |
|---|---|---|---|---|
| F1 gamma tilt ±1% (more gamma above = +) | r30 | -0.016 (-0.71) | **+0.022 (0.47)** | no |
| F1 gamma tilt ±1% (more gamma above = +) | r60 | -0.019 (-0.71) | **-0.006 (-0.11)** | yes |
| F2 change in gamma tilt, last 30m | r30 | -0.009 (-0.37) | **+0.057 (1.59)** | no |
| F2 change in gamma tilt, last 30m | r60 | -0.017 (-0.91) | **+0.027 (0.92)** | no |
| F3 king above (+) / below (−) price, distance | r30 | -0.006 (-0.22) | **+0.042 (0.73)** | no |
| F3 king above (+) / below (−) price, distance | r60 | +0.000 (0.01) | **+0.037 (0.53)** | yes |
| F4 king growing, last 30m | r30 | -0.017 (-0.74) | **-0.022 (-0.58)** | yes |
| F4 king growing, last 30m | r60 | -0.036 (-1.48) | **+0.013 (0.31)** | no |
| F5 0DTE net gamma near price (+ = long gamma) | r30 | -0.050 (-2.02) | **-0.002 (-0.06)** | yes |
| F5 0DTE net gamma near price (+ = long gamma) | r60 | -0.038 (-1.24) | **+0.011 (0.29)** | no |
| F6 vanna tilt ±1% | r30 | -0.037 (-1.47) | **-0.047 (-1.33)** | yes |
| F6 vanna tilt ±1% | r60 | -0.022 (-0.68) | **-0.036 (-0.83)** | yes |
| F7 nodes growing above vs below (velocity tilt) | r30 | -0.038 (-1.19) | **-0.038 (-0.87)** | yes |
| F7 nodes growing above vs below (velocity tilt) | r60 | -0.048 (-1.57) | **-0.021 (-0.34)** | yes |
| F8 position inside the gap between nodes (0 = at lower node) | r30 | +0.006 (0.31) | **+0.053 (1.93)** | yes |
| F8 position inside the gap between nodes (0 = at lower node) | r60 | -0.005 (-0.23) | **+0.001 (0.12)** | no |
| F9 day trend so far (benchmark) | r30 | +0.029 (0.74) | **-0.043 (-0.50)** | no |
| F9 day trend so far (benchmark) | r60 | +0.025 (0.46) | **-0.048 (-0.40)** | no |
| F5 0DTE net gamma near price (+ = long gamma) | a30 | -0.058 (-1.46) | **+0.032 (0.85)** | no |

IC = rank correlation between the feature and the next 30/60-minute return (or move size for a30); t from day-clustered means.
