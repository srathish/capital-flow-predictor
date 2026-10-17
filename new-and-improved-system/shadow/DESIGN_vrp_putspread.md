# Monthly SPY put spread when implied > realized and VIX is in contango (locked 2026-10-17, before data)

**Lineage:**
- This is the user's IV-vs-HV concept at the monthly horizon.
- Everything short-dated (0DTE, overnight, earnings) failed today on costs.
- Monthly index options have small spreads relative to the premium.
- The volatility risk premium is the best-documented "implied range > realized range" effect.

## Trade (SPY)

- **Entry:** the first trading day of each week, at the close, for entries from 2023-01-02 to 2026-08-24.
- **Expiry:** the monthly (third-Friday) expiry with 28–49 calendar days to go; if two qualify, the nearer one.
- **Short put:** the listed strike nearest S·(1 − VIX/100·√(DTE/365)), about 1σ out of the money.
- **Long put:** the listed strike nearest the short strike − 3%·S.
- **Prices:** UW /option-contract/{id}/historic daily NBBO.
  - Sell the short at the bid, buy the long at the ask.
  - Commission $0.65 × 2 at entry.
- **Hold to expiry.** Settlement is intrinsic at the SPY close on the expiry date (.cache/daily/SPY.json). There is no
  early exit.
- **Return on max risk** = (credit − payout − fees) / (width − credit).

## Filters (known at the entry close)

- **VRP:** VIX close > 20-day realized volatility of SPY (annualized, close-to-close).
- **Contango:** VIX close < VIX3M close.

## Variants

| | Filter |
|---|---|
| P1 | none |
| P2 | VRP |
| P3 | contango |
| P4 | VRP and contango |

## Split

- **Build:** entries 2023-01-02 → 2024-12-31. **Holdout:** entries 2025-01-01 → 2026-08-24.
- Trades overlap (weekly entries, monthly expiries), so t is clustered by expiry date.

## Pass (holdout)

- Mean > 0 with clustered t.
- BH q = 0.10 across P1–P4.
- The build mean must be > 0.
- Each filter must beat P1 in both periods.

**Also reported:**
- win rate and worst trade;
- the account path at 2% risk per trade, with max drawdown;
- annualized return of that path vs SPY buy-and-hold over the same holdout.

## Result (2026-10-17): FAIL, none pass

99 trades (59 weeks had no monthly expiry within 28–49 DTE; 33 had no chain).

| | Build | Holdout |
|---|---|---|
| P1 (no filter) | +6.8%, all 39 wins | +2.7%, t 0.85, 90% wins, worst −100% |
| Filters | do not beat P1 | do not beat P1 |

- At 2% risk per trade, the holdout account path is +3.3%. SPY buy-and-hold over the same window is +30.4%.
- The VRP and contango filters add nothing.
