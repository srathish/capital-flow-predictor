# IV walls — results

Run 2026-10-17T07:31:41.897Z · design shadow/DESIGN_iv_walls.md

## Containment (all days with the wall defined)

| wall | k | days | high+low inside | close inside |
|---|---|---|---|---|
| IV | 1.645 | 761 | 81% | 93% |
| IV | 1 | 761 | 43% | 72% |
| HV | 1.645 | 1843 | 89% | 95% |
| HV | 1 | 1843 | 61% | 79% |

## Fade tests (R; +2R target, −1R stop; holdout day-clustered t; BH q = 0.10 across 6) — validated: W1, W2, W3, W4, W5

| id | wall | k | measure | build mean (t, touches) | holdout mean (t, touches) | holdout win |
|---|---|---|---|---|---|---|
| W1 | IV | 1.645 | fade R | 0.184 (0.95, 64) | **0.413** (2.09, 66) | 45% |
| W2 | IV | 1.645 | fade − twins | 0.690 (3.28, 64) | **1.092** (4.95, 66) | 45% |
| W3 | HV | 1.645 | fade R | 0.031 (0.20, 103) | **0.398** (2.18, 85) | 45% |
| W4 | HV | 1.645 | fade − twins | 0.549 (3.37, 103) | **0.991** (4.89, 85) | 45% |
| W5 | IV | 1 | fade R | -0.021 (-0.20, 207) | **0.181** (1.63, 208) | 38% |
| W6 | IV | 1 | fade − twins | -1.369 (-10.73, 207) | **-1.152** (-8.12, 208) | 38% |

## Exploratory: Skylit node at the wall (Dec 2025 – Mar 2026)

| wall | k | with node: n, mean R | without: n, mean R |
|---|---|---|---|
| IV | 1.645 | 15, 0.55 | 12, 0.50 |
| IV | 1 | 38, -0.18 | 31, -0.03 |
| HV | 1.645 | 10, -0.21 | 9, -0.67 |
| HV | 1 | 40, -0.29 | 26, 0.62 |
