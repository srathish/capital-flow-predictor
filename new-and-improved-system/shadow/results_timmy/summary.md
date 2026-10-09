# Timmy hunt / raked entry B — results

Run 2026-10-09T06:52:05.963Z · design: shadow/DESIGN_timmy.md (locked before code). Cached data only.

## Test 1 — SPY + QQQ 0DTE nodes (63 days, 2026-04-10 → 2026-07-10)

- **Node trades:** n=364 · mean **+0.034R** · t=0.34 · win 30% · PF 1.05 · total 12.5R
- SPY: n=165 · mean **-0.163R** · t=-1.42 · win 27% · PF 0.78 · total -27.0R
- QQQ: n=199 · mean **+0.198R** · t=1.24 · win 33% · PF 1.29 · total 39.5R
- **Random levels fixed at the open (same rules):** n=109 · mean **+0.209R** · t=0.92 · win 29% · PF 1.29 · total 22.8R
- **Matched random levels (0.15–0.5% off each live floor/ceiling, redrawn every board):** n=264 · mean **+0.207R** · t=1.40 · win 32% · PF 1.30 · total 54.6R
- Skipped (stop too wide / no target ≥ 1R): nodes 157 / 209; random 77 / 54; matched 148 / 93

### Verdict: **FAIL** (needs mean > 0 with t ≥ 2, beats both random baselines, positive on SPY and on QQQ)

### Secondary (not used for the verdict)

**By level** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| ceiling | +0.13R (n=90, win 29%) | +0.15R (n=97, win 34%) |
| floor | -0.01R (n=106, win 30%) | -0.18R (n=71, win 28%) |

**Exit type** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| eod | +1.06R (n=13, win 69%) | +0.89R (n=8, win 75%) |
| stop | -1.03R (n=134, win 0%) | -1.03R (n=113, win 0%) |
| target | +2.74R (n=49, win 100%) | +2.37R (n=47, win 100%) |

**R1 king behind the trade** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| king behind | -0.13R (n=97, win 26%) | -0.05R (n=83, win 30%) |
| king not behind | +0.23R (n=99, win 33%) | +0.07R (n=85, win 33%) |

**R2 approach speed** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| fast (> 0.13% in 5 min) | +0.10R (n=46, win 30%) | +0.10R (n=51, win 31%) |
| normal | +0.04R (n=150, win 29%) | -0.02R (n=117, win 32%) |

**R3 level already stopped twice today** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| < 2 stops before | +0.06R (n=191, win 30%) | +0.04R (n=158, win 32%) |
| ≥ 2 stops before | -0.22R (n=5, win 20%) | -0.37R (n=10, win 30%) |

**R4 0DTE net gamma** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| net gamma > 0 | +0.05R (n=142, win 30%) | +0.07R (n=157, win 33%) |
| net gamma ≤ 0 | +0.06R (n=54, win 30%) | -0.82R (n=11, win 9%) |

**Co-pin (other symbol at its own floor/ceiling)** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| co-pinned | -0.18R (n=72, win 31%) | -0.25R (n=67, win 28%) |
| not co-pinned | +0.19R (n=124, win 29%) | +0.19R (n=101, win 34%) |

**Tap number** (Apr–May / Jun–Jul)

| group | Apr–May | Jun–Jul |
|---|---|---|
| 1st | +0.36R (n=99, win 34%) | +0.10R (n=87, win 32%) |
| 2nd | -0.17R (n=60, win 25%) | +0.03R (n=44, win 34%) |
| 3rd+ | -0.40R (n=37, win 24%) | -0.22R (n=37, win 27%) |

**raked's R1+R2+R3+R4 together:** n=107 · mean **+0.251R** · t=0.97 · win 34% · PF 1.37 · total 26.9R · Apr–May n=60 · mean **+0.322R** · t=0.77 · win 33% · PF 1.47 · total 19.3R · Jun–Jul n=47 · mean **+0.160R** · t=0.59 · win 34% · PF 1.24 · total 7.5R

**Management variants (same trades)**

| group | trades | mean R | t (day-clustered) | win | PF |
|---|---|---|---|---|---|
| all: as tested | 364 | +0.034 | 0.34 | 30% | 1.05 |
| all: half off at +2R | 364 | +0.005 | 0.06 | 37% | 1.01 |
| all: breakeven after +1R | 364 | -0.064 | -0.71 | 21% | 0.89 |
| Apr–May: as tested | 196 | +0.053 | 0.33 | 30% | 1.07 |
| Apr–May: half off at +2R | 196 | +0.004 | 0.03 | 36% | 1.01 |
| Apr–May: breakeven after +1R | 196 | -0.017 | -0.12 | 21% | 0.97 |
| Jun–Jul: as tested | 168 | +0.013 | 0.11 | 32% | 1.02 |
| Jun–Jul: half off at +2R | 168 | +0.006 | 0.06 | 38% | 1.01 |
| Jun–Jul: breakeven after +1R | 168 | -0.119 | -1.11 | 21% | 0.79 |
| all: max 3 trades / symbol / day | 283 | +0.101 | 0.78 | 30% | 1.14 |
| Apr–May: max 3 / symbol / day | 157 | +0.109 | 0.59 | 29% | 1.15 |
| Jun–Jul: max 3 / symbol / day | 126 | +0.090 | 0.51 | 32% | 1.13 |

**Why stopped trades failed**

| class | Apr–May | Jun–Jul |
|---|---|---|
| slow | 43 | 30 |
| worked then reversed (≥ +1R first) | 14 | 14 |
| right read, target hit later | 65 | 47 |
| instant (≤ 2 min) | 12 | 22 |

Median risk per trade: 0.062% of price.

## Test 2 — SPY classic levels (924 days, 2023-01-03 → 2026-10-02)

- **Level trades:** n=3239 · mean **-0.095R** · t=-3.72 · win 32% · PF 0.86 · total -307.2R
- **Random levels (same rules):** n=1383 · mean **+0.020R** · t=0.48 · win 36% · PF 1.03 · total 27.3R
- 2023: n=941 · mean **-0.154R** · t=-3.33 · win 30% · PF 0.78 · total -145.2R · random n=379 · mean **-0.028R** · t=-0.36 · win 34% · PF 0.96 · total -10.5R
- 2024: n=788 · mean **-0.116R** · t=-2.26 · win 31% · PF 0.83 · total -91.7R · random n=327 · mean **+0.072R** · t=0.87 · win 38% · PF 1.11 · total 23.7R
- 2025: n=856 · mean **-0.085R** · t=-1.72 · win 32% · PF 0.88 · total -72.6R · random n=408 · mean **+0.089R** · t=1.14 · win 38% · PF 1.14 · total 36.4R
- 2026: n=654 · mean **+0.004R** · t=0.06 · win 35% · PF 1.01 · total 2.3R · random n=269 · mean **-0.083R** · t=-0.91 · win 32% · PF 0.88 · total -22.2R
- Skipped (stop too wide / no target): levels 907 / 0; random 591 / 0

### Verdict: **FAIL** (needs mean > 0 with t ≥ 2, beats random, positive in ≥ 3 of 4 years)

### Secondary (not used for the verdict)

**By level type**

| group | trades | mean R | t (day-clustered) | win | PF |
|---|---|---|---|---|---|
| premarket high | 994 | -0.190 | -4.29 | 29% | 0.74 |
| premarket low | 962 | -0.061 | -1.32 | 33% | 0.91 |
| prior-day high | 640 | -0.072 | -1.35 | 32% | 0.89 |
| prior-day low | 642 | -0.020 | -0.32 | 34% | 0.97 |
| prior-day low + premarket high | 1 | -1.015 | NaN | 0% | 0.00 |

**Glitch: HTF sweep earlier today**

| group | trades | mean R | t (day-clustered) | win | PF |
|---|---|---|---|---|---|
| with | 627 | -0.081 | -1.42 | 32% | 0.88 |
| none | 1640 | -0.149 | -4.12 | 30% | 0.79 |
| counter | 972 | -0.013 | -0.29 | 35% | 0.98 |

**Exit type**

| group | trades | mean R | t (day-clustered) | win | PF |
|---|---|---|---|---|---|
| eod | 100 | +0.310 | 4.54 | 64% | 3.26 |
| stop | 2173 | -1.031 | -2000.59 | 0% | 0.00 |
| target | 966 | +1.970 | 3269.79 | 100% | Infinity |

**Management variant**

| group | trades | mean R | t (day-clustered) | win | PF |
|---|---|---|---|---|---|
| as tested (2R target) | 3239 | -0.095 | -3.72 | 32% | 0.86 |
| breakeven after +1R | 3239 | -0.095 | -4.32 | 24% | 0.83 |

**Wicksy "Timmy hunt the lows = bullish":** premarket-low hunt+reclaim before 10:30 on 247 days → mean move from signal to 15:55 -0.008% (up 49%) vs other days (no such signal) 10:00 → 15:55 0.041% (up 57%).
