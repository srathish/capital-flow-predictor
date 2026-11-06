# Flux runners: make winners outweigh losers (cut fast, let run, only on big-range days) — locked 2026-11-05, before any result

User goal: "make sure our winners outweigh the losers" on index Flux plays.

**Caveat, stated in advance:** with zero entry edge, no exit rule changes the expected value of a random-walk path.
- Exits can only help if moves persist.
- The one validated persistence/size signal we have is the prior-day local gamma balance B (gamma_range study): the
  lowest third gives about 1.2× normal day range.
- So the design pairs trailing exits with low-B days.

## Data

- Flux Field 1-minute SPY/QQQ, as in DESIGN_flux.
- **B** = net ÷ absolute gamma over strikes within ±2% of the prior close, from UW greek-exposure/strike on the prior
  trading day (.cache/uwgreeks + fetched Oct 9 → Nov 4).
- **Low-B** = below the build-period 33rd percentile per ticker.
- **Build:** 2025-11-07 → 2026-06-30. **Holdout:** 2026-07-01 → 2026-11-05 (run once).

## Entries (first per ticker-day per entry type; same definitions as DESIGN_flux)

- **E3:** F3 level cross. From 10:30, the first close across the level after ≥15 closes on the other side, in the cross
  direction.
- **E4:** F4 trend pullback. From 10:15, ≥30 minutes on one side, then a tap of the level within ±0.03%, in the trend
  direction.
- **Initial stop:** the inner band on the far side of the level (1R = |entry − stop|).

## Exits

| Exit | Rule |
|---|---|
| X0 | the original target (the outer band on the trade side), stop at 1R |
| **X1 (runner)** | no target; a chandelier trailing stop at the best close since entry − 1R (longs; mirror for shorts), never looser than the initial stop; exit by 15:55 |
| X2 | X1 plus a time stop: exit at 30 minutes after entry if the trade has not reached +0.5R by then |

Exits are close-based. R is in underlying terms.

## Primary tests (holdout; BH q = 0.10 across 2)

| Test | Rule |
|---|---|
| P1 | E3 + X1 on low-B days: mean R > 0, day-clustered t |
| P2 | E4 + X1 on low-B days: same |

- **Pass:** holdout mean > 0 with BH significance, the build agrees in sign, and it beats both controls.
- **Also reported, for every entry × exit × {all days, low-B, high-B}:**
  - mean R;
  - win rate;
  - average win ÷ average loss;
  - profit factor.

## Controls

- **C-coin:** the same timestamps with a random direction (seed 20261105, 20 draws averaged). This asks whether
  Flux's direction matters at all.
- **C-highB:** the same rule on high-B days. The prediction is that it does worse.

## Results (2026-11-05)

| Test | Build | Holdout | Coin-direction control (build → holdout) |
|---|---|---|---|
| P1, E3 + X1 + low-B | +0.31R, PF 2.04 | **+0.30R, t 1.41, PF 1.53**, average win 1.44R vs average loss 0.78R, n 64 | +0.16R → +0.24R |
| P2, E4 + X1 + low-B | −0.20R | −0.10R | |

**P1 is not significant (fail by protocol), but positive in both periods.**

**Key observation:** on low-B days, the coin-direction control is positive in both periods. Trailing exits on
big-range days have positive expectancy without any direction skill, because winners run and losers are cut at 1R.
The Flux level adds only about +0.06R. This motivates DESIGN_orb_lowgamma.md, tested on untouched 2023-11 → 2025-10
data.
