# Community batch — results

Run 2026-10-15T06:34:59.977Z · design shadow/DESIGN_community_batch.md · BH q = 0.10 across 17 · holdout 2025-04-01 → 2026-10-02

**Validated: R1, R2**

| id | idea | build | holdout | holdout one-sided p | validated |
|---|---|---|---|---|---|
| P1 | straddle, 2σ breach day | effect +0.499 (t +4.31; breach days 15/599; mean on 47.9% vs off -1.9%) | **effect -0.359 (t -1.69; breach days 16/757; mean on -30.8% vs off 3.7%)** | 0.9547 | no |
| P2 | ±1% fly, 2σ breach | effect +0.420 (t +1.75; breach days 15/593; mean on 38.6% vs off -3.9%) | **effect -0.268 (t -1.18; breach days 16/751; mean on -7.2% vs off -0.1%)** | 0.8802 | no |
| P3 | ±1/±2% condor, 2σ breach | effect +0.230 (t +2.74; breach days 15/568; mean on 21.7% vs off -2.5%) | **effect -0.198 (t -1.66; breach days 16/742; mean on -6.0% vs off -0.4%)** | 0.9513 | no |
| P4 | straddle, ATR+volume breach | effect +0.151 (t +1.93; breach days 157/599; mean on 11.0% vs off -4.7%) | **effect -0.092 (t -1.04; breach days 169/757; mean on -6.1% vs off 5.6%)** | 0.8514 | no |
| P5 | ±1% fly, ATR+volume breach | effect +0.021 (t +0.22; breach days 155/593; mean on -0.9% vs off -3.5%) | **effect -0.192 (t -2.22; breach days 168/751; mean on -13.5% vs off 3.6%)** | 0.9869 | no |
| P6 | ±1/±2% condor, ATR+volume breach | effect +0.104 (t +2.54; breach days 151/568; mean on 6.4% vs off -4.8%) | **effect -0.040 (t -0.85; breach days 166/742; mean on -2.8% vs off 0.1%)** | 0.8017 | no |
| P7 | straddle, 2σ breach beyond gamma | effect +0.565 (t +5.35; breach days 15/599; mean on 47.9% vs off -1.9%) | **effect -0.318 (t -1.56; breach days 16/757; mean on -30.8% vs off 3.7%)** | 0.9409 | no |
| P8 | straddle, ATR+volume breach beyond gamma | effect +0.237 (t +3.07; breach days 157/599; mean on 11.0% vs off -4.7%) | **effect -0.051 (t -0.52; breach days 169/757; mean on -6.1% vs off 5.6%)** | 0.6984 | no |
| R1 | P(6R | 3R) fast ≤20m vs >60m | 65.6% vs 34.5% (t +4.86; n 346/87) | **54.3% vs 21.6% (t +5.80; n 370/88)** | 0.0000 | yes |
| R2 | P(6R | 3R) ≤20m vs >20m | 65.6% vs 47.2% (t +4.02; n 346/246) | **54.3% vs 42.8% (t +2.63; n 370/250)** | 0.0043 | yes |
| R3 | SPY P(6R | 3R) QQQ-confirmed vs not | 60.9% vs 50.0% (t +1.58; n 233/72) | **50.0% vs 49.3% (t +0.11; n 236/75)** | 0.4581 | no |
| R4 | QQQ P(6R | 3R) SPY-confirmed vs not | 66.7% vs 56.6% (t +1.00; n 24/256) | **53.3% vs 49.3% (t +0.41; n 30/268)** | 0.3394 | no |
| L1 | lunch fade, all days | -0.004% per trade (t -0.24, n 1367, win 48.8%) | **+0.009% per trade (t +0.37, n 1502, win 48.1%)** | 0.3543 | no |
| L2 | lunch fade, |move| ≥ 0.25% | -0.018% per trade (t -0.70, n 645, win 45.1%) | **+0.009% per trade (t +0.26, n 813, win 48.8%)** | 0.3989 | no |
| L3 | lunch fade, |move| ≥ 0.5% | +0.004% per trade (t +0.10, n 270, win 48.1%) | **-0.035% per trade (t -0.71, n 385, win 48.1%)** | 0.7618 | no |
| E1 | ESB_q ratchet + 2.5U target | -0.003R (t -0.11, n 511, win 42.1%, PF +0.98) | **+0.005R (t +0.21, n 524, win 42.6%, PF +1.03)** | 0.4171 | no |
| E2 | ESB_q ratchet only | -0.001R (t -0.04, n 511, win 42.1%, PF +0.99) | **+0.003R (t +0.13, n 524, win 42.4%, PF +1.02)** | 0.4494 | no |

## Runner management, R per event (not registered)

| period | events | always exit 3R | hold for 6R if fast | hold if confirmed | always hold for 6R |
|---|---|---|---|---|---|
| build | 2380 | -0.044 | +0.052 | +0.029 | +0.089 |
| hold | 2536 | -0.037 | -0.043 | -0.018 | +0.000 |

Base rates: build P(6R | 3R) 57.9% (median 16 min to 3R); holdout 49.7% (median 15 min).

Lunch fade per symbol, holdout (L1): SPY +0.010% (t +0.42) · QQQ +0.013% (t +0.48) · IWM -0.004% (t -0.12) · DIA +0.015% (t +0.71); months positive 18/36.

ESB_q per symbol, holdout (E1): SPY +0.011R (t +0.38, n 267) · QQQ -0.002R (t -0.06, n 257).

Part P rows dropped for missing legs: straddle 2, fly 14, condor 48.
