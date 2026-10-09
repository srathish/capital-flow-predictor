# Does the dealer gamma regime predict the size of the day? — results

Run 2026-10-09T07:17:35.786Z · design shadow/DESIGN_gamma_range.md · UW daily gamma (prior day) → next-day range

Days: SPY 231, QQQ 231 (2025-08-08 → 2026-07-10). Negative-net-gamma days: SPY 155, QQQ 141.

## Primary: coefficient on gamma balance B (with controls: prior-day range, 20-day range, VIX)

| sample | B coefficient (t) | n | R² |
|---|---|---|---|
| **SPY + QQQ pooled** | **-0.257 (t -2.99)** | 462 | 0.367 |
| SPY | -0.269 (t -2.74) | 231 | 0.308 |
| QQQ | -0.228 (t -2.44) | 231 | 0.265 |
| pooled 2025-07 → 2025-12 | -0.362 (t -2.87) | 202 | 0.454 |
| pooled 2026-01 → 2026-07 | -0.348 (t -3.00) | 260 | 0.310 |

## Verdict: **PASS** (needs pooled B < 0 with t ≤ −2, and B < 0 for SPY, QQQ and both halves)

Controls in the pooled model: prior-day +0.135 (t 2.06), 20-day +0.190 (t 1.48), VIX +0.743 (t 2.98).

## Secondary (not used for the verdict)

| check | result |
|---|---|
| B with NO controls (pooled) | -0.650 (t -7.21), R² 0.266 |
| R² controls only → controls + B | 0.353 → 0.367 |
| sign dummy (net gamma < 0), pooled with controls | +0.196 (t 3.98) |
| local balance (strikes within ±2%), pooled with controls | -0.199 (t -4.72) |
| "short gamma trends": |close−open|/range on B, pooled with controls | -0.054 (t -1.01) |
| SPY: day range ÷ 20-day average, lowest / middle / highest third of B | 1.22 / 1.09 / 0.80 |
| QQQ: day range ÷ 20-day average, lowest / middle / highest third of B | 1.18 / 1.08 / 0.87 |
| Skylit 0DTE 09:35 balance → 09:35–16:00 range, pooled with controls (126 symbol-days) | +0.140 (t 1.14) |
