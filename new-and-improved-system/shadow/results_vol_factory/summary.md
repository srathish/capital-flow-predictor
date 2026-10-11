# Volatility-premium factory — results

Run 2026-10-11T00:05:50.633Z · design shadow/DESIGN_vol_factory.md · 194 hypotheses · 2743 ticker-days (build 1227, holdout 1516)

Average short-straddle proxy P&L (premium units), build / holdout: 1-day +0.176 / +0.249 · 0DTE +0.355 / +0.419 · SPY VIX1D 0DTE +0.079 / +0.134 (proxy levels — not interpreted)

**Build BH q = 0.10: 89 of 194 pass. Holdout (BH across survivors, same sign, beat ≥ 19/20 own placebos): 53 validated.**

| outcome | hypotheses | pass build | validated |
|---|---|---|---|
| V1 | 32 | 14 | 12 |
| V2 | 33 | 18 | 6 |
| V3 | 32 | 20 | 18 |
| V4 | 32 | 13 | 0 |
| V5 | 32 | 14 | 12 |
| V6 | 33 | 10 | 5 |

## Validated

| idea | feature | outcome | predicted | build β (t) | holdout β (t) | placebos beaten | holdout outcome: top third / bottom third of feature | mechanism |
|---|---|---|---|---|---|---|---|---|
| B06xV1 | ln(VIX1D ÷ VIX9D) at the prior close (market-wide) | V1 | ? | -0.161 (-5.45) | **-0.102 (-3.52)** | 20/20 | +0.083 / +0.330 | next-day event priced |
| A01xV1 | gamma balance within ±1% (d−1) | V1 | + | +0.079 (+2.78) | **+0.069 (+3.17)** | 20/20 | +0.376 / +0.110 | long local gamma damps the day → straddle seller wins |
| A02xV1 | gamma balance within ±2% (d−1) | V1 | + | +0.083 (+2.88) | **+0.066 (+3.03)** | 20/20 | +0.363 / +0.103 | local regime (validated for range) |
| A09xV1 | largest positive-gamma strike − close, ÷ close | V1 | - | -0.060 (-2.33) | **-0.083 (-2.91)** | 20/20 | +0.109 / +0.354 | validated range feature (positive magnet far above → wider) |
| C04xV1 | close ÷ 20-day average − 1 | V1 | + | +0.068 (+2.16) | **+0.074 (+2.88)** | 20/20 | +0.349 / +0.113 | stretched up = calm; stretched down = jumpy |
| A03xV1 | gamma balance within ±5% (d−1) | V1 | + | +0.080 (+2.74) | **+0.059 (+2.60)** | 20/20 | +0.362 / +0.117 | medium regime |
| B07xV1 | implied ÷ its own 20-day average | V1 | ? | -0.057 (-2.05) | **-0.091 (-2.57)** | 20/20 | +0.175 / +0.332 | vol elevated vs recent |
| A05xV1 | ±2% gamma balance z-score vs prior 60 days (G23, strongest validated) | V1 | + | +0.072 (+2.50) | **+0.048 (+2.36)** | 20/20 | +0.343 / +0.143 | regime vs normal |
| A07xV1 | net gamma negative (1/0) | V1 | - | -0.053 (-2.17) | **-0.036 (-2.15)** | 20/20 | +0.232 / +0.331 | dealers chase → bigger move |
| A04xV1 | gamma balance, all strikes (d−1) | V1 | + | +0.074 (+2.65) | **+0.053 (+2.12)** | 20/20 | +0.357 / +0.119 | total regime |
| A13xV1 | delta balance within ±2% | V1 | ? | +0.085 (+2.99) | **+0.049 (+2.08)** | 19/20 | +0.359 / +0.118 | positioning |
| A06xV1 | all-strike balance z-score vs prior 60 days | V1 | + | +0.069 (+2.34) | **+0.034 (+1.75)** | 20/20 | +0.332 / +0.133 | regime vs normal |
| B06xV2 | ln(VIX1D ÷ VIX9D) at the prior close (market-wide) | V2 | ? | -0.074 (-3.02) | **-0.047 (-2.49)** | 20/20 | +0.331 / +0.507 | next-day event priced |
| C03xV2 | 5-day return | V2 | + | +0.064 (+2.94) | **+0.062 (+2.47)** | 19/20 | +0.479 / +0.326 | down weeks are jumpier |
| B07xV2 | implied ÷ its own 20-day average | V2 | ? | -0.050 (-2.59) | **-0.094 (-2.30)** | 19/20 | +0.347 / +0.481 | vol elevated vs recent |
| C04xV2 | close ÷ 20-day average − 1 | V2 | + | +0.075 (+3.22) | **+0.064 (+2.25)** | 20/20 | +0.484 / +0.319 | stretched up = calm; stretched down = jumpy |
| A09xV2 | largest positive-gamma strike − close, ÷ close | V2 | - | -0.059 (-2.92) | **-0.048 (-1.95)** | 20/20 | +0.340 / +0.492 | validated range feature (positive magnet far above → wider) |
| A06xV2 | all-strike balance z-score vs prior 60 days | V2 | + | +0.075 (+3.70) | **+0.030 (+1.74)** | 20/20 | +0.486 / +0.325 | regime vs normal |
| B07xV3 | implied ÷ its own 20-day average | V3 | ? | +0.081 (+3.96) | **+0.110 (+3.49)** | 20/20 | -0.026 / -0.232 | vol elevated vs recent |
| B06xV3 | ln(VIX1D ÷ VIX9D) at the prior close (market-wide) | V3 | ? | +0.129 (+8.20) | **+0.061 (+3.46)** | 20/20 | -0.056 / -0.268 | next-day event priced |
| A05xV3 | ±2% gamma balance z-score vs prior 60 days (G23, strongest validated) | V3 | - | -0.094 (-5.16) | **-0.048 (-3.36)** | 20/20 | -0.235 / -0.047 | regime vs normal |
| A06xV3 | all-strike balance z-score vs prior 60 days | V3 | - | -0.093 (-4.73) | **-0.046 (-3.15)** | 20/20 | -0.229 / -0.028 | regime vs normal |
| C03xV3 | 5-day return | V3 | - | -0.091 (-4.78) | **-0.062 (-3.09)** | 20/20 | -0.218 / -0.028 | down weeks are jumpier |
| A12xV3 | charm balance | V3 | ? | -0.061 (-3.36) | **-0.049 (-3.01)** | 20/20 | -0.225 / -0.050 | decay flows |
| C02xV3 | prior-day range ÷ 20-day mean range | V3 | + | +0.059 (+3.34) | **+0.054 (+2.74)** | 20/20 | -0.041 / -0.198 | yesterday unusually wide |
| A07xV3 | net gamma negative (1/0) | V3 | + | +0.061 (+4.18) | **+0.037 (+2.65)** | 20/20 | -0.130 / -0.227 | dealers chase → bigger move |
| C04xV3 | close ÷ 20-day average − 1 | V3 | - | -0.117 (-4.48) | **-0.054 (-2.57)** | 20/20 | -0.222 / -0.025 | stretched up = calm; stretched down = jumpy |
| A01xV3 | gamma balance within ±1% (d−1) | V3 | - | -0.093 (-4.99) | **-0.042 (-2.54)** | 20/20 | -0.237 / -0.037 | long local gamma damps the day → straddle seller wins |
| A09xV3 | largest positive-gamma strike − close, ÷ close | V3 | + | +0.096 (+4.07) | **+0.051 (+2.48)** | 20/20 | -0.043 / -0.240 | validated range feature (positive magnet far above → wider) |
| A03xV3 | gamma balance within ±5% (d−1) | V3 | - | -0.108 (-5.17) | **-0.045 (-2.47)** | 20/20 | -0.237 / -0.026 | medium regime |
| A02xV3 | gamma balance within ±2% (d−1) | V3 | - | -0.112 (-5.75) | **-0.044 (-2.45)** | 20/20 | -0.247 / -0.030 | local regime (validated for range) |
| A04xV3 | gamma balance, all strikes (d−1) | V3 | - | -0.100 (-5.05) | **-0.044 (-2.39)** | 20/20 | -0.243 / -0.024 | total regime |
| D05xV3 | day d is the first trading day of the month | V3 | + | +0.085 (+4.16) | **+0.025 (+2.25)** | 20/20 | -0.162 / -0.163 | validated wider day |
| E01xV3 | A05 × (variance premium above its build median) | V3 | - | -0.052 (-2.42) | **-0.026 (-2.00)** | 19/20 | -0.229 / -0.068 | long gamma AND rich options |
| A13xV3 | delta balance within ±2% | V3 | ? | -0.103 (-4.71) | **-0.032 (-1.75)** | 19/20 | -0.245 / -0.032 | positioning |
| B04xV3 | VIX term slope ln(VIX ÷ VIX3M) (market-wide) | V3 | + | +0.095 (+3.00) | **+0.046 (+1.73)** | 19/20 | -0.019 / -0.238 | inverted curve = stress |
| A09xV5 | largest positive-gamma strike − close, ÷ close | V5 | + | +0.028 (+1.78) | **+0.051 (+3.35)** | 20/20 | +0.258 / +0.121 | validated range feature (positive magnet far above → wider) |
| A01xV5 | gamma balance within ±1% (d−1) | V5 | - | -0.040 (-2.68) | **-0.045 (-3.21)** | 20/20 | +0.111 / +0.250 | long local gamma damps the day → straddle seller wins |
| C04xV5 | close ÷ 20-day average − 1 | V5 | - | -0.044 (-2.39) | **-0.046 (-3.02)** | 20/20 | +0.123 / +0.254 | stretched up = calm; stretched down = jumpy |
| A02xV5 | gamma balance within ±2% (d−1) | V5 | - | -0.044 (-2.82) | **-0.044 (-3.01)** | 20/20 | +0.123 / +0.262 | local regime (validated for range) |
| B06xV5 | ln(VIX1D ÷ VIX9D) at the prior close (market-wide) | V5 | ? | +0.094 (+5.07) | **+0.049 (+2.91)** | 20/20 | +0.262 / +0.141 | next-day event priced |
| A05xV5 | ±2% gamma balance z-score vs prior 60 days (G23, strongest validated) | V5 | - | -0.039 (-2.47) | **-0.034 (-2.54)** | 20/20 | +0.131 / +0.240 | regime vs normal |
| A03xV5 | gamma balance within ±5% (d−1) | V5 | - | -0.047 (-3.00) | **-0.034 (-2.42)** | 20/20 | +0.121 / +0.244 | medium regime |
| A13xV5 | delta balance within ±2% | V5 | ? | -0.051 (-3.20) | **-0.032 (-2.13)** | 19/20 | +0.131 / +0.250 | positioning |
| B05xV5 | ln(VIX9D ÷ VIX) (market-wide) | V5 | ? | +0.050 (+3.26) | **+0.042 (+2.02)** | 19/20 | +0.250 / +0.137 | near-term event priced |
| A04xV5 | gamma balance, all strikes (d−1) | V5 | - | -0.044 (-2.90) | **-0.029 (-1.90)** | 20/20 | +0.121 / +0.240 | total regime |
| A11xV5 | vanna balance | V5 | ? | +0.046 (+2.40) | **+0.031 (+1.80)** | 20/20 | +0.240 / +0.127 | vanna flows |
| A06xV5 | all-strike balance z-score vs prior 60 days | V5 | - | -0.043 (-2.72) | **-0.020 (-1.59)** | 20/20 | +0.133 / +0.226 | regime vs normal |
| C03xV6 | 5-day return | V6 | + | +0.092 (+2.16) | **+0.079 (+2.16)** | 19/20 | +0.239 / +0.084 | down weeks are jumpier |
| E01xV6 | A05 × (variance premium above its build median) | V6 | + | +0.125 (+3.41) | **+0.065 (+1.97)** | 20/20 | +0.254 / -0.013 | long gamma AND rich options |
| A06xV6 | all-strike balance z-score vs prior 60 days | V6 | + | +0.115 (+2.92) | **+0.063 (+1.93)** | 20/20 | +0.216 / +0.045 | regime vs normal |
| A04xV6 | gamma balance, all strikes (d−1) | V6 | + | +0.138 (+2.82) | **+0.069 (+1.88)** | 20/20 | +0.205 / +0.087 | total regime |
| A03xV6 | gamma balance within ±5% (d−1) | V6 | + | +0.143 (+2.76) | **+0.067 (+1.79)** | 20/20 | +0.212 / +0.107 | medium regime |

## Passed the holdout but not their own placebo

- A07xV5 net gamma negative (1/0): holdout t +1.62, placebos beaten 18/20
- B05xV3 ln(VIX9D ÷ VIX) (market-wide): holdout t +1.98, placebos beaten 18/20
- E01xV2 A05 × (variance premium above its build median): holdout t +1.55, placebos beaten 17/20

## Passed build, failed holdout

- A01xV2 gamma balance within ±1% (d−1): build +0.059 (+2.72) → holdout +0.016 (+0.96)
- A01xV4 gamma balance within ±1% (d−1): build +0.156 (+4.02) → holdout -0.027 (-0.82)
- A01xV6 gamma balance within ±1% (d−1): build +0.091 (+1.70) → holdout +0.004 (+0.11)
- A02xV2 gamma balance within ±2% (d−1): build +0.078 (+3.61) → holdout +0.017 (+0.93)
- A02xV4 gamma balance within ±2% (d−1): build +0.192 (+4.92) → holdout -0.011 (-0.29)
- A02xV6 gamma balance within ±2% (d−1): build +0.152 (+2.80) → holdout +0.026 (+0.64)
- A03xV2 gamma balance within ±5% (d−1): build +0.084 (+3.93) → holdout +0.023 (+1.21)
- A03xV4 gamma balance within ±5% (d−1): build +0.189 (+4.50) → holdout +0.017 (+0.39)
- A04xV2 gamma balance, all strikes (d−1): build +0.083 (+4.01) → holdout +0.023 (+1.19)
- A04xV4 gamma balance, all strikes (d−1): build +0.172 (+3.76) → holdout +0.028 (+0.59)
- A05xV2 ±2% gamma balance z-score vs prior 60 days (G23, strongest validated): build +0.064 (+3.11) → holdout +0.024 (+1.37)
- A05xV4 ±2% gamma balance z-score vs prior 60 days (G23, strongest validated): build +0.176 (+4.45) → holdout -0.031 (-0.96)
- A05xV6 ±2% gamma balance z-score vs prior 60 days (G23, strongest validated): build +0.119 (+2.81) → holdout +0.030 (+0.85)
- A06xV4 all-strike balance z-score vs prior 60 days: build +0.165 (+4.04) → holdout -0.008 (-0.23)
- A07xV2 net gamma negative (1/0): build -0.055 (-3.42) → holdout -0.016 (-1.01)
- A07xV4 net gamma negative (1/0): build -0.071 (-1.87) → holdout +0.031 (+0.82)
- A07xV6 net gamma negative (1/0): build -0.094 (-2.35) → holdout -0.049 (-1.43)
- A09xV4 largest positive-gamma strike − close, ÷ close: build -0.121 (-1.79) → holdout +0.005 (+0.12)
- A10xV6 king share of |gamma|: build +0.064 (+1.86) → holdout +0.061 (+1.49)
- A11xV2 vanna balance: build -0.090 (-3.72) → holdout -0.020 (-0.87)
- A11xV3 vanna balance: build +0.103 (+3.72) → holdout +0.029 (+1.44)
- A11xV4 vanna balance: build -0.203 (-2.30) → holdout -0.035 (-0.67)
- A13xV2 delta balance within ±2%: build +0.085 (+3.67) → holdout +0.015 (+0.73)
- A13xV4 delta balance within ±2%: build +0.196 (+4.07) → holdout +0.035 (+0.83)
- B04xV1 VIX term slope ln(VIX ÷ VIX3M) (market-wide): build -0.101 (-2.42) → holdout -0.039 (-0.74)
- B04xV2 VIX term slope ln(VIX ÷ VIX3M) (market-wide): build -0.059 (-1.94) → holdout +0.007 (+0.18)
- B04xV5 VIX term slope ln(VIX ÷ VIX3M) (market-wide): build +0.059 (+2.81) → holdout +0.025 (+0.99)
- B05xV1 ln(VIX9D ÷ VIX) (market-wide): build -0.075 (-2.69) → holdout -0.042 (-1.01)
- B05xV2 ln(VIX9D ÷ VIX) (market-wide): build -0.037 (-2.16) → holdout -0.010 (-0.40)
- C03xV4 5-day return: build +0.154 (+2.44) → holdout +0.013 (+0.30)
- C04xV4 close ÷ 20-day average − 1: build +0.208 (+3.91) → holdout -0.024 (-0.51)
- D05xV2 day d is the first trading day of the month: build -0.077 (-2.15) → holdout +0.002 (+0.13)
- D05xV4 day d is the first trading day of the month: build -0.021 (-1.70) → holdout -0.016 (-1.00)
