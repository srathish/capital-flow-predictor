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
