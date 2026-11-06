# Flux Field: test Skylit's own reading notes (locked 2026-11-05, before any result)

**Skylit's own reading notes (docs, Atlas › Flux Field / API):**
- "Price above the level means aggressive buyers are in control."
- "A tag of the outer band is stretched … often reads as a mean-reversion spot."
- "The extreme band is reached only on outsized moves."
- "Reclaiming or losing the centre line or the inner band frames trend entries and exits."

## Data

- SPY and QQQ Flux Field, 1-minute, session anchor, 2025-11-07 → 2026-11-05 (.cache/flux/*.json; 20 credits).
- **Check done:** a separate single-day pull (2026-06-10) matches the bulk pull exactly, and the bands widen through
  the session (a running calculation). The history is treated as point-in-time.
- **Prices:** the point's own `price` (the minute close).
- **Timing:** signals are taken on minute t's close. Entry is at the next minute's price, t+1. Stops and targets are
  checked on later minute closes (close basis), exit at 15:55.
- One trade per rule per side per ticker-day.

## Rules (all from 10:00; entries no later than 15:00)

| Rule | Signal | Entry | Stop | Target |
|---|---|---|---|---|
| **F1, outer-band fade** | the first close beyond the outer band | fade it, back toward the level | the extreme band at the signal + 0.02% | the level at the signal |
| **F2, extreme-band fade** | the first close beyond the extreme band | fade it | the extreme band + (extreme − outer) gap | the outer band at the signal |
| **F3, level reclaim/loss trend** (from 10:30) | the first close across the level after ≥15 consecutive closes on the other side | in the direction of the cross | the inner band on the far side | the outer band on the trade side |

## Controls (same code, same days)

- **Twins (F1/F2):** the same rule with every band distance from the level scaled by 0.75 and by 1.25. This asks
  whether Skylit's exact band placement matters, which is the IV-wall lesson.
- **F3:** the same rule with "level" replaced by the session's simple running mean of minute closes (a plain average
  line, not Skylit's level).

## Split and pass

- **Build:** 2025-11-07 → 2026-06-30. **Holdout:** 2026-07-01 → 2026-11-05, run once.
- **Pass:**
  - holdout mean R > 0 with day-clustered t;
  - BH q = 0.10 across F1–F3;
  - build agrees in sign;
  - beats its controls in both periods.
- **Real money:** only a passing rule gets priced in 0DTE options, then an audit, then a forward ledger.

## Results (2026-11-05): FAIL, 0 of 3

| Rule | Build | Holdout | Holdout median | Holdout win rate | Control |
|---|---|---|---|---|---|
| F1, outer-band fade | +0.35R, t 0.30 | 213 trades, **−0.45R**, t −1.79 | −1.14R | 18% | twins no different |
| F2, extreme fade | −2.76R | −7.00R, t −1.00 | | | |
| F3, level reclaim trend | −0.03R | +0.08R, t 0.80 | | | plain running mean +0.05R, i.e. the same |

- **Design weakness:** early-session bands are near-zero width, so stops are tiny and R values are heavy-tailed.
  Means are unstable; medians are about −1R for F1 and F3.
- **Verdict:** none of Skylit's Flux Field reading notes gives an edge.
  - Outer-band tags are not reliable mean-reversion spots.
  - Level reclaim works no better than a plain average line.
