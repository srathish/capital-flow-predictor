# Take-profit test — can we catch +20% / +50% option gains?

Run 2026-10-16T07:44:15.073Z · real ATM monthly options, buy at the ask, sell at the bid the first day it is up TP (else day 20)

**Validated (BH q = 0.10 across 12, holdout mean > 0): none**

| id | trade | build: mean/trade (t) · hit rate | holdout: mean/trade (t) · hit rate | holdout median / worst | 5%/week compounded (holdout) |
|---|---|---|---|---|---|
| T1 | radar call, take +20% | -0.1% (-0.03) · +64.5% | **-5.6% (-1.39) · +61.2%** | +25.3% / -100.0% | -13% |
| T2 | radar call, take +50% | -4.3% (-0.69) · +46.7% | **-7.7% (-1.43) · +43.6%** | -35.1% / -100.0% | -14% |
| T3 | radar put, take +20% | -2.3% (-0.48) · +64.8% | **-6.9% (-1.67) · +61.2%** | +24.0% / -100.0% | -31% |
| T4 | radar put, take +50% | -1.3% (-0.19) · +47.9% | **-15.8% (-3.00) · +37.4%** | -30.8% / -100.0% | -46% |
| T5 | radar straddle, take +20% | -0.0% (-0.00) · +49.7% | **-10.9% (-2.77) · +36.6%** | -20.1% / -100.0% | -35% |
| T6 | radar straddle, take +50% | -1.5% (-0.45) · +28.9% | **-9.2% (-2.30) · +22.0%** | -25.5% / -100.0% | -33% |
| T7 | radar straddle, take +20%, stop −50% | -0.7% (-0.26) · +48.5% | **-13.4% (-4.97) · +35.5%** | -24.4% / -76.5% | -34% |
| T8 | radar straddle, take +50%, stop −50% | -1.8% (-0.58) · +28.6% | **-11.4% (-3.55) · +21.6%** | -30.0% / -76.5% | -32% |
| T9 | COMBO straddle, take +20% | -0.3% (-0.14) · +48.0% | **-10.5% (-3.90) · +38.1%** | -17.0% / -98.9% | -28% |
| T10 | COMBO straddle, take +50% | -3.0% (-0.85) · +27.2% | **-12.6% (-4.11) · +19.2%** | -23.3% / -99.6% | -29% |
| T11 | radar − random straddle, take +20% | +1.6% (0.47) · +49.7% | **+5.1% (1.05) · +36.6%** | -20.1% / -100.0% | — |
| T12 | radar − random straddle, take +50% | +2.2% (0.50) · +28.9% | **+6.5% (1.26) · +22.0%** | -25.5% / -100.0% | — |
