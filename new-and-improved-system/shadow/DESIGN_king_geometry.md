# King geometry at 10:30 → rest-of-day range (locked 2026-11-11, before any result)

Why: two community size claims live in the hypothesis registry untested: S25 "a far King (>1% away) with small counter-side nodes
means a trend day" and the Garma rule "pinned (dominant King near spot) means stay out". Both are statements about the size of the
move after the map is read, not about direction. Size is the one thing the map has predicted so far (range, overnight gap). The 368
Skylit 10:30 boards pulled for DESIGN_management_only are reused; no new credits.

## Data

- Boards: `.cache/skylit_boards_1030/<date>.json`, 2025-05-01 → 2026-10-16, SPY and QQQ, **front (session-date) expiration column**
  (secondary: the 5-expiration `value`). Provenance: today's API history, not proven live; any pass carries that caveat.
- Prices: UW 1-minute bars; VIX prior close (Cboe); prior-day EOD gamma balance B (UW file of d−1, `.cache/uw/gex_strike`).

## Features at 10:30 (nothing after the 10:29 bar close)

- `kdist` = |King strike − spot| / spot, King = largest |value| in the column.
- `kshare` = |King value| / Σ|value| over the column (dominance).
- `oppshare` = Σ|value| of nodes on the side of spot opposite the King / Σ|value| (S25's "small counter-side nodes").
- `side` = sign(King − spot) — direction control only.
- Controls: `lnVIX` (prior close), `fh` = ln(first-hour range 09:30–10:30 as % of spot), `B_prev` (prior-day EOD balance), `m20`
  (ln 20-day mean daily range).

## Targets

- Primary `rod` = ln(rest-of-day range 10:31–15:59 (high−low) / spot).
- Secondary `cls` = ln(|close_{15:59} − close_{10:30}| / spot + 0.0005).
- Direction control: sign(close − close_{10:30}) regressed on `side` with the same controls — must have |t| < 2.

## Model

Pooled SPY+QQQ OLS with symbol dummy, SEs clustered by date: `rod ~ sym + lnVIX + fh + B_prev + m20 + kdist + kshare + oppshare`.
Each hypothesis is judged on its own coefficient in that joint fit: **H1 (S25)** `kdist` > 0 (far King → bigger range);
**H2 (pin)** `kshare` < 0 (dominant King → smaller range). `oppshare` reported. Tercile ratios (set on build) reported per feature.

## Pass criteria (per hypothesis, independently)

Build (2025-05-01 → 2026-03-31): coefficient with the stated sign, clustered |t| ≥ 2.5, ΔR² from adding that feature ≥ 0.01.
Holdout (2026-04-01 → 2026-10-16, one run): same sign, clustered |t| ≥ 2.0. Direction control clean in both periods.

## What a fail means

A fail on H1 retires S25 as a range tool; a fail on H2 retires "pinned = stay out" as anything but a slogan. A pass is a
size tool only and would be folded into the range forecast as a 10:30 update, never used for direction.

## Amendments

(none)

## Result — build (2025-05-01 → 2026-03-31): **H1 FAIL, H2 PASS** (run 2026-11-11, before audit and holdout)

`python shadow/king_geometry.py build` → `results_king_geometry/build.json`. n = 454 symbol-days (SPY, QQQ).

| column | target | kdist (H1) coef / t / ΔR² / terc hi÷lo | kshare (H2) coef / t / ΔR² / terc hi÷lo | oppshare coef / t | direction t (side) |
|---|---|---|---|---|---|
| **front** | rod | +1.67 / +0.29 / 0.0009 / 1.16 | **−1.03 / −3.96 / 0.0142 / 0.72** | −0.58 / −2.89 | −1.27 |
| front | cls | −1.33 / −0.11 / 0.0000 / 1.03 | −0.78 / −1.63 / 0.0025 / 0.74 | −0.54 / −1.37 | |
| agg | rod | +0.43 / +0.10 / 0.0001 / 1.20 | −0.33 / −1.12 / 0.0003 / 0.82 | −0.46 / −2.08 | +0.08 |

H1 (S25, far King → bigger range): t 0.29, retired as a range tool. H2 (dominant front-expiration King → smaller rest-of-day
range): passes all three build criteria; days in the top King-share tercile have 28% smaller rest-of-day ranges than the bottom
tercile, after VIX, first-hour range, prior-day gamma balance and 20-day range. The effect is absent in the 5-expiration
aggregate, consistent with a 0DTE pinning mechanism rather than a general vol proxy. Holdout not yet opened: independent audit first.
