# Trend-day continuation: does a strong first hour continue to the close? (locked 2026-11-11, before any result)

Why: Nov 5 (−4.4% SPY) and Nov 9 (+2.4%) both had their direction set by 10:30 ET and continued. Our toolkit has no trend-day
layer (registry S12 Duke, S13 SirFartalot), and our gates have historically filtered big days out. This tests the simplest
version of that layer as a *system* (entry + management + real option prices), judged on expectancy, not hit rate.

## Rule (price only; fixed before computing)

Session bars: UW 1-minute regular-session bars, SPY and QQQ (`.cache/uw/m1`). Bar at minute m is the candle that closes at m.

- **Signal time:** 10:30 ET, using only bars closed by 10:30.
- **First-hour move:** `f = close(10:30) / open(09:30) − 1`.
- **VWAP hold:** session VWAP from 09:30 to 10:30 (volume-weighted close); require `sign(close(10:30) − VWAP) == sign(f)`.
- **Trigger:** `|f| ≥ θ` and VWAP hold. Primary θ = 1.0%. Sensitivity θ ∈ {0.75%, 1.5%} reported alongside, never chosen post hoc.
- **Direction:** `sign(f)`. One signal per symbol-day at most.
- **Exclusions:** half days (13:00 close) and days with < 300 regular bars. Nothing else.

## Stage A — continuation in the underlying

Outcome `c = sign(f) × (close(15:59) − close(10:30)) / close(10:30)`.

Metrics per symbol and pooled: n, P(c > 0), mean c, median c, mean c on winners/losers, share of days with c ≥ +0.5%.

Controls:
1. **Base rate:** P(sign(close − close(10:30)) == sign(f)) on *all* non-triggered days (does any first-hour move continue?).
2. **Shuffled direction:** same triggered days, direction drawn by coin, 1,000 shuffles → null distribution of mean c.
3. **Random time:** same rule evaluated at 11:30 and 12:30 instead of 10:30 (is it the first hour, or any hour?).

Pass (build): pooled P(c > 0) ≥ 58% with n ≥ 40 and one-sided binomial p < 0.05; mean c > 0 with t ≥ 2.0; mean c above the
97.5th percentile of the shuffled null. Pass (holdout): P(c > 0) ≥ 55%, mean c > 0 with one-sided p < 0.05.

## Stage B — real option P&L (holdout only, run once, only if Stage A passes on build)

SPY and QQQ 0DTE, the strike nearest spot at 10:30 in the trade direction (call for up, put for down), UW minute prices
(`.cache/uwopt_intraday`; missing contracts fetched from `option-contract/{id}/intraday`). Entry at the 10:30 minute close
+ $0.02; exit − $0.02; $0.65 commission per contract per side; one contract-equivalent of fixed $500 premium per trade
(contracts = floor(500 / premium), 0 → skip).

Management variants, all pre-declared and all reported; **primary = (iii)**:
- (i) hold to 15:55 close, no stop;
- (ii) −50% premium stop (checked each minute), else 15:55;
- (iii) exit when the underlying closes back through the session VWAP (Garma: "drifts back = cut"), else 15:55.

Control: the same management on an equal number of random non-signal days with a coin-flip direction, 200 draws.

Pass: primary variant mean return per trade > 0 with t ≥ 2.0 and profit factor ≥ 1.3 after costs, and above the 97.5th
percentile of the random-day control. Hit rate is reported but is not a criterion.

## Secondary (descriptive only, no verdict)

- Gamma pillar: on 2025-08-08 → 2026-07-10 (UW gamma balance B in `shadow/results_gamma_range/panel.json`), continuation on
  triggered days with B below vs above its median.
- Day-of-week and VIX-tercile splits of c.

## Data split

- **Build:** 2023-01-03 → 2025-04-30 (SPY, QQQ).
- **Holdout:** 2025-05-01 → 2026-10-16, sealed, touched once for Stage A and once for Stage B.
  (Option prices only exist from 2025-04, so Stage B is holdout-only by construction.)

## What a fail means

If Stage A fails on build, we stop: first-hour trend days do not continue often enough to trade, and days like Nov 5 belong
to the untradeable bucket. If A passes and B fails, the direction exists but 0DTE costs/decay eat it; we do not search for a
better exit. Any change after this point is a new design.

## Amendments

(none)
