# IV walls: fade the day's 90% implied range, plus Skylit ceiling/floor confluence (locked 2026-10-17, before any run)

**The user's idea:** historical volatility plus contract pricing give the day's range ("IV walls"). Price should stay inside
the 90% band about 90% of the time, so take the reversal off a wall. When a Skylit ceiling or floor sits at the wall,
expect a large reversal.

## Walls (SPY and QQQ; anchor = 09:30 open O)

- **IV wall:** σ_day = (0DTE ATM straddle at 09:35) / (0.798 × S at 09:35), from .cache/straddle t2.
  Available 2025-04 onward.
- **HV wall:** σ_day = standard deviation of the prior 20 daily log close-to-close returns. Available 2023 onward.
- **Walls** = O × (1 ± k·σ_day).
  - Primary: k = 1.645 (90%).
  - Secondary: k = 1.0.

## Event and trade (underlying, R units)

- **Event:** the first 1-minute bar between 09:45 and 15:30 whose high (upper side) or low (lower side) reaches the
  wall. At most one event per side per ticker-day.
- **Fade:**
  - Enter at the wall.
  - Stop: 0.25·σ_day·O beyond the wall (1R).
  - Target: 0.5·σ_day·O back toward the open (+2R).
  - Otherwise exit at the 15:55 close.
  - If stop and target fall in the same bar, the stop is taken first.
- **Twins (control):** the same fade on levels at k' drawn from [0.8, 2.4] excluding |k' − k| < 0.2. 20 twins per
  ticker-day per side, seeded 20261017.

## Splits

- **HV:** build 2023-01-03 → 2025-03-31; holdout 2025-04-01 → 2026-10-16.
- **IV:** build 2025-04 → 2025-12; holdout 2026-01-02 → 2026-10-02.

## Tests (holdout; day-clustered t; BH q = 0.10 across W1–W6)

| Test | Claim |
|---|---|
| W1 | IV-wall k = 1.645 fade, mean R > 0 |
| W2 | IV-wall k = 1.645 fade minus mean twin R > 0 |
| W3 | HV-wall k = 1.645 fade, mean R > 0 |
| W4 | HV-wall k = 1.645 fade minus mean twin R > 0 |
| W5 | IV-wall k = 1.0 fade, mean R > 0 |
| W6 | IV-wall k = 1.0 fade minus mean twin R > 0 |

**Also reported:**
- Containment: the share of days with the high and low inside the band, and with the close inside it, for each wall type
  and k.

## Confluence with Skylit nodes (exploratory; Dec 2025 – Mar 2026 only, about 64 days, so not a formal test)

- At the touch minute, a Skylit node with |rel| ≥ 0.3 within 0.1% of the wall counts as confluence: a ceiling at the
  upper wall, a floor at the lower wall.
- Fade R is compared for touches with confluence vs without. The numbers will be small; it is reported as a lead only.

## Options

- Only if W1–W6 show a positive underlying edge: price the fade with real 0DTE options.

## Result (2026-10-17) and post-hoc check

**Formal tests (results_iv_walls/summary.md):** W1–W5 passed BH.

| Test | Holdout |
|---|---|
| W1, IV 90% fade | +0.41R, t 2.09, 66 touches |
| W3, HV 90% fade | +0.40R, t 2.18, 85 touches |

The build periods were weak: t 0.95 and 0.20.

**Post-hoc check (iv_walls_kcurve.mjs, clean crosses only, fade R at k = 0.8 … 2.2):**

| Wall | Holdout at 1.645σ | Holdout at neighbours (1.4 / 1.9) | Build period |
|---|---|---|---|
| IV | +0.41R | −0.04 / −0.15 | 1.9σ and 2.2σ were better than 1.645σ |
| HV | +0.40R | +0.09 / −0.19 | 0.8–1.4σ were better (+0.11 to +0.22) |

- **The twin control in W2/W4/W6 was unfair.** Fade R varies with distance, and the twins sat mostly on one side of k.
- **The 1.645σ spike is isolated.** In the holdout, its neighbours don't support it. In the build period, other
  distances did better.

**Verdict:**
- The 90% wall is not shown to be special. The holdout pass is most likely one lucky point on a jagged curve.
- At most, HV distances of about 0.8–1.4σ show a small, general intraday fade tendency (+0.1–0.2R in build, weaker in
  holdout).
- Skylit-node confluence: no consistent effect (exploratory, n = 9–40).
- Not tradeable as is. A forward test would be the next step if pursued.
