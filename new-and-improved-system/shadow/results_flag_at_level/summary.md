# Flag at our level — results

Run 2026-10-17T07:55:40.024Z · design shadow/DESIGN_flag_at_level.md

| variant | build: trades, mean R (t), win | holdout: trades, mean R (t), win |
|---|---|---|
| full | 32, -0.050 (-0.23), 41% | 34, **-0.247** (-1.22), 32% |
| noVol | 92, -0.197 (-1.53), 32% | 125, **-0.005** (-0.04), 38% |
| noStack | 72, 0.132 (0.87), 46% | 59, **-0.159** (-0.99), 36% |
| noFlag | 182, -0.002 (-0.02), 41% | 166, **-0.009** (-0.10), 44% |
| same pattern on 10 shifted maps (avg per day) | 105, -0.085 (-0.63), 36% | 141, **-0.113** (-1.04), 33% |

**Tests (holdout, BH q = 0.10): none validated**

- F1 full pattern R: mean -0.247R, t -1.22, days 33
- F2 full − shifted-map twins: mean -0.093R, t -0.67, days 24
- F3 full − no-volume (same day): mean -0.042R, t -0.23, days 33
