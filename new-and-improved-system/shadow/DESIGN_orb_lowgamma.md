# Direction-free breakout + trailing stop on low-gamma-balance days (locked 2026-11-05, before any result)

**Motivation:** DESIGN_flux_runners showed that coin-direction entries with chandelier exits were positive on low-B
days in both its periods (+0.16R, +0.24R). The gamma-range study showed that low B means bigger ranges. Hypothesis:
on low-B days, trend-following exits win without direction prediction.

## Untouched test period

- 2023-11-09 → 2025-10-31, SPY and QQQ.
- **Inputs:** UW 1-minute bars (.cache/uw/m1) and the prior-day B from .cache/uwgreeks.
- **Low-B threshold:** frozen from DESIGN_flux_runners (SPY −0.328, QQQ −0.541). Those were set on 2025-11 → 2026-06
  data, so they are out of sample here.
- Nothing from 2023-11 → 2025-10 has been used for this hypothesis.

## Rule O1 (opening-range breakout, both ways)

- **Range:** OR = the 09:30–09:59 high (H) and low (L).
- **Trigger:** from 10:00 to 14:00, the first 1-minute close above H means long; below L means short. One trade per
  ticker-day.
- **Entry:** the next minute's open.
- **Initial stop:** the opposite side of the OR, but at most 0.5×OR away from entry, so 1R = min(OR, 0.5·OR).
  - In effect 1R = 0.5 × OR width, placed at entry ∓ 0.5·OR.
- **Exit:** a chandelier trail on 1-minute closes at the best close − 1R; never looser than the initial stop; exit by
  15:55.

## Tests

| Test | Days | Pass condition |
|---|---|---|
| **O1-low** (primary) | low-B days only | mean R > 0, day-clustered t ≥ 2, profit factor > 1.2 |
| O1-all (control) | all days | — |
| O1-high (control) | high-B days | prediction: worse than O1-low |

**Also reported:**
- win rate;
- average win ÷ average loss;
- yearly split (2024 and 2025 separately);
- costs: a −0.02R per-trade haircut for SPY/QQQ slippage, reported too.

## Result (2026-11-05, untouched 2023-11 → 2025-10): FAIL (not significant), direction of effect as predicted

| Test | Result |
|---|---|
| O1-low (primary) | 218 trades, **+0.066R, t 0.61, PF 1.30**, win 44%, average win 1.22R vs average loss 0.73R. After −0.02R costs, +0.046R. |
| O1-low by year | 2024 +0.065R, 2025 +0.067R |
| O1-all | +0.031R, PF 1.07 |
| O1-high | −0.007R, PF 1.01 |

- **Ordering:** low-B > all > high-B, as predicted. Positive in both years.
- **Size:** about +0.05R per trade after costs, far too small to confirm (t 0.6), and thin for 0DTE options after theta.
- **Across three independent periods**, the low-B + trailing-exit effect was positive each time:
  - coin-direction +0.16R (Nov 2025 → Jun 2026);
  - coin-direction +0.24R (Jul → Nov 2026);
  - ORB +0.07R (Nov 2023 → Oct 2025).

  It is small and unproven, not tradeable as is.

## Amendment 1 (2026-11-05): replication on fresh indices, locked before computing

The rule O1 is unchanged.

| Universe | Tickers | Period | Status |
|---|---|---|---|
| **R1 (confirmatory)** | IWM and DIA | 2023-11-16 → 2026-10-02 | never used for this hypothesis |
| R2 (secondary) | the 10 stocks with both data sets (ALGN BROS CCJ CMCSA CVX GE RH STX UAMY ZS) | same | |
| R3 (summary only) | SPY, QQQ, IWM, DIA pooled | | partly seen; not a test |

- **Low-B:** each ticker's own lowest third of prior-day B over its full sample. This is a fixed rule, not tuned.
- **R1 pass:** low-B mean R > 0, day-clustered t ≥ 2, profit factor > 1.2, and low-B > high-B.
