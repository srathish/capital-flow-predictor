# Volatility program 2 — results

Run 2026-10-15T17:04:52.104Z · design shadow/DESIGN_vol_program2.md · BH q = 0.10 across 29 (one-sided, holdout)

**Validated: none**

| id | idea | build | holdout | p | validated |
|---|---|---|---|---|---|
| A1 | T1 sale spans a weekend/holiday | +0.034 (t +0.32, n 599) · on 137: 1.7% vs off -1.3% | **+0.083 (t +0.91, n 757) · on 164: 10.8% vs off 0.8%** | 0.1812 | no |
| A2 | T1 vs term-structure contango (−ln VIX/VIX3M) | -0.008 (t -0.22, n 599) | **+0.032 (t +0.82, n 757)** | 0.2053 | no |
| A3 | T1 vs variance premium (VIX1D vs 5-day realized) | -0.137 (t -3.10, n 599) | **-0.005 (t -0.12, n 757)** | 0.5481 | no |
| A4 | T1 on CPI days | -0.033 (t -0.17, n 599) · on 28: -3.3% vs off -0.5% | **+0.143 (t +1.09, n 757) · on 34: 18.0% vs off 2.3%** | 0.1379 | no |
| A5 | T1 on FOMC days (predicted WORSE; sign flipped) | +0.335 (t +1.06, n 599) · on 20: -37.8% vs off 0.7% | **-0.373 (t -2.30, n 757) · on 24: 40.5% vs off 1.8%** | 0.9892 | no |
| A6 | T1 on monthly OPEX days | -0.268 (t -1.05, n 599) · on 30: -25.6% vs off 0.7% | **+0.064 (t +0.42, n 757) · on 36: 10.5% vs off 2.6%** | 0.3374 | no |
| A7 | 0DTE short call leg minus short put leg | -0.096 (t -0.61, n 380) · call 6.9% put 9.7% | **-0.067 (t -0.42, n 378) · call 3.6% put 10.6%** | 0.6621 | no |
| B1 | T1 vs implied ÷ our range forecast | +0.007 (t +0.18, n 599) | **+0.071 (t +1.85, n 757)** | 0.0323 | no |
| B2 | 0DTE vs implied ÷ our range forecast | -0.002 (t -0.03, n 380) | **+0.127 (t +2.17, n 378)** | 0.0148 | no |
| C1 | 0DTE sold 10:30, gamma days, mean > 0 | +0.264 (t +4.70, n 161) · $+0.75/straddle, win 71.4% | **+0.089 (t +1.15, n 110) · $+0.35/straddle, win 61.8%** | 0.1241 | no |
| C2 | 0DTE sold 12:00, gamma days, mean > 0 | +0.247 (t +3.65, n 161) · $+0.56/straddle, win 71.4% | **+0.116 (t +1.34, n 110) · $+0.36/straddle, win 62.7%** | 0.0895 | no |
| C3 | 0DTE sold 14:00, gamma days, mean > 0 | +0.251 (t +4.62, n 156) · $+0.42/straddle, win 74.4% | **+0.143 (t +1.46, n 110) · $+0.30/straddle, win 68.2%** | 0.0725 | no |
| C4 | 0DTE 10:30, gamma days vs others | +0.231 (t +2.79, n 380) · on 161: 26.5% vs off -4.7% | **-0.043 (t -0.39, n 378) · on 110: 8.9% vs off 12.9%** | 0.6502 | no |
| C5 | 0DTE 12:00, gamma days vs others | +0.087 (t +0.98, n 380) · on 161: 24.7% vs off 13.8% | **-0.000 (t -0.00, n 378) · on 110: 11.6% vs off 11.3%** | 0.5009 | no |
| C6 | 0DTE 14:00, gamma days vs others | +0.085 (t +1.21, n 374) · on 156: 25.1% vs off 16.8% | **+0.004 (t +0.04, n 378) · on 110: 13.5% vs off 12.9%** | 0.4826 | no |
| D1 | IWM straddle, gamma days vs others | -0.037 (t -0.39, n 276) · on 93: 1.6% vs off 5.3% | **-0.030 (t -0.44, n 379) · on 163: 1.8% vs off 5.0%** | 0.6702 | no |
| D2 | DIA straddle, gamma days vs others | +0.234 (t +1.34, n 64) · on 22: 13.5% vs off -9.9% | **+0.116 (t +0.75, n 84) · on 33: -4.7% vs off -17.0%** | 0.2255 | no |
| D3 | IWM ±1% fly, gamma days vs others | -0.021 (t -0.20, n 275) · on 92: -9.7% vs off -5.8% | **-0.076 (t -1.02, n 379) · on 163: -12.5% vs off -4.7%** | 0.8458 | no |
| D4 | DIA ±1% fly, gamma days vs others | +0.213 (t +1.67, n 64) · on 22: -1.5% vs off -22.7% | **+0.082 (t +0.66, n 83) · on 33: -8.4% vs off -15.5%** | 0.2549 | no |
| E1 | sell quiet stocks (low vanna) vs random, 20d | +0.023 (t +0.43, n 546) · picks -23.1% vs control -25.4% | **+0.044 (t +0.64, n 424) · picks -21.9% vs control -26.3%** | 0.2618 | no |
| E2 | sell quiet stocks (S55 low) vs random, 20d | +0.079 (t +1.42, n 511) · picks -17.5% vs control -25.4% | **+0.122 (t +1.88, n 385) · picks -14.1% vs control -26.3%** | 0.0303 | no |
| E3 | sell quiet stocks (low realized vol) vs random, 20d | -0.017 (t -0.21, n 516) · picks -27.1% vs control -25.4% | **+0.015 (t +0.21, n 397) · picks -24.8% vs control -26.3%** | 0.4167 | no |
| E4 | sell quiet stocks (S53 low) vs random, 20d | -0.068 (t -1.17, n 596) · picks -32.3% vs control -25.4% | **+0.028 (t +0.38, n 456) · picks -23.5% vs control -26.3%** | 0.3520 | no |
| E5 | sell quiet stocks (combined) vs random, 20d | +0.025 (t +0.47, n 565) · picks -22.9% vs control -25.4% | **+0.023 (t +0.36, n 460) · picks -24.0% vs control -26.3%** | 0.3592 | no |
| E6 | sell quiet stocks (combined) vs random, 10d | -0.033 (t -0.88, n 576) · picks -19.0% vs control -15.7% | **-0.040 (t -1.14, n 476) · picks -22.3% vs control -18.3%** | 0.8727 | no |
| E7 | sell random stock straddles, 20d, > 0 | -0.254 (t -6.20, n 472) · picks -25.4% | **-0.263 (t -5.17, n 340) · picks -26.3%** | 1.0000 | no |
| E8 | sell quiet stocks (combined), 20d, > 0 | -0.229 (t -6.37, n 565) · picks -22.9% | **-0.240 (t -6.22, n 460) · picks -24.0%** | 1.0000 | no |
| F1 | intraday momentum: last 30 min follows the day | -0.017 (t -1.49, n 1370) | **-0.007 (t -0.44, n 1504)** | 0.6685 | no |
| F2 | intraday momentum stronger when dealers short gamma | +0.005 (t +0.30, n 1370) | **+0.027 (t +1.19, n 1504)** | 0.1173 | no |

Effects are standardized coefficients on P&L ÷ premium (continuous features: per 1 sd), dummy coefficients (event / gamma days), mean differences (E, A7, C1–C3) or bp-per-bp slopes (F).

Part E: 277 pick-weeks without contract data, 43 trades skipped at expiry without a quote. Part D counts: {"IWM":{"t1":655,"fly":654,"nofly":1,"th":0.5137809585640968,"F2":256},"DIA":{"t1":148,"fly":147,"nofly":1,"th":0.6381142934650679,"F2":55}}.
