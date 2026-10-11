# Real-price straddle confirmation — results

Run 2026-10-11T01:08:03.709Z · design shadow/DESIGN_real_straddle.md (amendments 1–2) · SPY + QQQ

**Confirmed on the holdout (BH q = 0.10 across H1–H6): none**

| hypothesis | trade | feature | build β (t, n) | holdout β (t, n) | holdout one-sided p | confirmed |
|---|---|---|---|---|---|---|
| H1 | T1 | ±1% gamma balance | +0.069 (+1.46, 599) | **+0.064 (+1.83, 757)** | 0.0339 | no |
| H2 | T1 | ±2% gamma z-score (G23) | +0.086 (+2.18, 599) | **+0.045 (+1.42, 757)** | 0.0775 | no |
| H3 | T2 | ±1% gamma balance | — (—, 9) | **+0.044 (+1.26, 758)** | 0.1040 | no |
| H4 | T2 | ±2% gamma z-score (G23) | — (—, 9) | **+0.040 (+1.15, 758)** | 0.1249 | no |
| H5 | T1 | filter (gamma top third + above 20-day avg + no event priced) | +0.251 (+2.74, 599) | **+0.087 (+0.88, 757)** | 0.1887 | no |
| H6 | T2 | filter (gamma top third + above 20-day avg + no event priced) | — (—, 9) | **+0.096 (+1.16, 758)** | 0.1233 | no |

## Real P&L per straddle (one SPY/QQQ share each leg; unwinsorized)

| sample | trades | mean $ | mean P&L ÷ premium | win rate | worst day $ | sum of P&L ÷ premium |
|---|---|---|---|---|---|---|
| T1 one-day, build — all days | 599 | -0.03 | -0.006 | 57% | -14.86 | -3.6 |
| T1 one-day, holdout — all days | 757 | +0.09 | +0.030 | 60% | -34.55 | +22.6 |
| T1 one-day, holdout — FILTER days | 168 | +0.29 | +0.113 | 65% | -17.46 | +18.9 |
| T1 one-day, holdout — other days | 589 | +0.04 | +0.006 | 59% | -34.55 | +3.7 |
| T2 0DTE, holdout — all days | 758 | +0.27 | +0.083 | 63% | -38.36 | +62.7 |
| T2 0DTE, holdout — FILTER days | 168 | +0.56 | +0.174 | 68% | -6.89 | +29.2 |
| T2 0DTE, holdout — other days | 590 | +0.18 | +0.057 | 62% | -38.36 | +33.5 |

Short straddles carry large left tails; a positive mean with a 30–50% win rate is normal for this trade. Not sized, no compounding, no commissions.
