# Rapid-style ladder + GEX/VEX confluence — results (SPY/QQQ/IWM/DIA)

Run 2026-10-16T22:58:44.068Z · R per trade, target = next ladder level, stop behind the broken level

**Validated (BH q = 0.10 across 8): C4**

| id | test | build | holdout |
|---|---|---|---|
| C1 | all ladder breaks | -0.147 (t -4.60, n 5875, hit 21%) | **-0.044 (t -1.35, n 6396, hit 22%)** |
| C2 | CONF breaks (target on a node + air pocket) | -0.114 (t -1.64, n 958, hit 23%) | **+0.057 (t 0.78, n 990, hit 25%)** |
| C3 | CONF minus non-CONF | +0.039 (t 0.50, n 958) | **+0.119 (t 1.48, n 990)** |
| C4 | CONF vs 20 map-shifted twins (holdout) | — (t —, n ) | **+0.088 (beat 20/20 twins)** |
| C5 | AIR minus non-AIR | -0.011 (t -0.17, n 3440) | **+0.057 (t 0.87, n 3908)** |
| C6 | TGT minus non-TGT | +0.049 (t 0.80, n 2502) | **+0.028 (t 0.45, n 2352)** |
| C7 | CONF longs only | -0.134 (t -1.30, n 464, hit 23%) | **-0.069 (t -0.67, n 483, hit 22%)** |
| C8 | CONF retest entry | -0.245 (t -2.68, n 383, hit 22%) | **+0.112 (t 1.06, n 427, hit 27%)** |

Holdout CONF by symbol: SPY +0.077 · QQQ +0.026 · IWM -0.138 · DIA +0.180
