# VRP monthly put spread — results

Run 2026-10-17T09:21:50.442Z · design shadow/DESIGN_vrp_putspread.md · trades 99 · skipped {"chain":33,"noexp":59}

| id | filter | build: n, mean (t), win, worst | holdout: n, mean (t), win, worst | holdout path at 2% risk ×, max DD |
|---|---|---|---|---|
| P1 | none | 39, 6.8% (41.96), 100%, 5% | 60, **2.7%** (0.85), 90%, -100% | 1.033, -4.2% |
| P2 | VIX > realized | 36, 6.7% (43.04), 100%, 5% | 55, **2.1%** (0.84), 89%, -100% | 1.023, -4.2% |
| P3 | contango | 36, 6.7% (40.65), 100%, 5% | 53, **2.8%** (0.49), 91%, -100% | 1.030, -3.6% |
| P4 | both | 33, 6.7% (39.29), 100%, 5% | 49, **2.3%** (0.49), 90%, -100% | 1.023, -3.6% |

**Pass (holdout > 0, BH, build > 0, filters must beat P1 in both periods): none**
SPY buy-and-hold over the holdout window: 30.4%
