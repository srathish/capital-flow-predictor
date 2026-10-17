# Long iron fly on days the gamma filter rejects (locked 2026-10-17, before computing)

**Motivation:** selling the T1 iron fly on not-F1 days lost money in build (−9.6% of risk) and in holdout (−13.5%).
"Low gamma balance means bigger moves" is the validated range finding. So the hypothesis is that BUYING the fly on those
days pays.

**Caveat, stated up front:** the short-side numbers on these days were seen before this design. The holdout is therefore
partly contaminated for the direction of the idea, though not for the long-side cost structure.

**Rule (T1, SPY/QQQ, same rows and frozen F1/F2 thresholds as iron_fly.mjs):** on days with F1 = 0 (variant L1) or
F2 = 0 (variant L2), at the prior close:
- buy the ATM straddle at the ask;
- sell the wings (±0.5% and ±1%) at the bid;
- hold to the close, settle at intrinsic;
- commission $0.65 × 4 legs.

Return = P&L / debit paid.

**Pass, per variant and width (4 tests, BH q = 0.10):**
- build (2024-01-08 → 2025-03-31) mean > 0 with day-clustered t ≥ 2;
- holdout (2025-04-01 →) mean > 0 with one-sided p passing BH.

## Result (2026-10-17, single run): FAIL, 0 of 4

| Variant | Build | Holdout |
|---|---|---|
| L1 ±0.5% | −3.7%, t −1.93 | −4.5%, t −2.14 |
| L1 ±1% | −0.1% | −3.3% |
| L2 ±0.5% | −4.3% | −2.7% |
| L2 ±1% | −0.1% | −0.3% |

Buying loses too. On these days both sides of the trade lose, which means the bid/ask spread is the cost. The
short-side loss was mostly spread, not a tradeable move.
