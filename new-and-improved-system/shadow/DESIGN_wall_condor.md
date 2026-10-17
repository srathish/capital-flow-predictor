# Wall condor: sell the day's implied range at the IV walls, filtered by IV-vs-HV and dealer gamma (locked 2026-10-17, before any run)

**Lineage:**
- The user's IV-wall concept (DESIGN_iv_walls.md) showed the walls contain price, with the close inside the 90% band
  93% of the time. They do not act as reversal points.
- So here the range is sold rather than the wall faded.
- The two filters are the user's other ingredients:
  - historical volatility vs contract pricing;
  - market-maker exposure.

## Trade (SPY, QQQ; one per ticker-day)

- **σ_day** = (0DTE ATM straddle at 09:35) / (0.798 × S at 09:35), from .cache/straddle t2, as in DESIGN_iv_walls.
- **Short strikes:** call at the first listed strike ≥ S·(1 + k·σ); put at the first strike ≤ S·(1 − k·σ).
- **Long wings:** the next strikes beyond by a width of max($1, round(0.5·σ·S)).
- **Prices:** UW 1-minute option candles (.cache/uwopt_intraday, fetched if missing).
  - Each leg's close at the first minute 09:35–09:39 where all four legs printed.
  - Credit = shorts − longs, minus slippage $0.03 per leg, minus commission $0.65 × 4 per condor ($0.026 per share).
- **Hold to expiry.** Settlement at the 15:59 candle close of the underlying, intrinsic value.
- **Return on max risk** = (credit − payout) / (width − credit).

## Variants (8)

| | Short strikes | Filter |
|---|---|---|
| C1 | k = 1.645 (the 90% wall) | none |
| C2 | k = 1.645 | IV > HV |
| C3 | k = 1.645 | gamma |
| C4 | k = 1.645 | IV > HV and gamma |
| C5–C8 | k = 1.0 | the same four filters |

- **IV > HV:** the straddle σ_day is above the prior-20-day realized daily σ (iv_walls definition).
- **Gamma:** UW ±1% gamma balance at the prior close in the build-period top third, per ticker. This is the
  "F2" filter from iron_fly.mjs, recomputed with this study's build period as the threshold sample.

## Split

- **Build:** 2025-04-01 → 2025-12-31.
- **Holdout:** 2026-01-02 → 2026-10-02 (the last straddle day).

## Pass (holdout)

- Mean return on risk > 0 with day-clustered t.
- One-sided p passes BH q = 0.10 across C1–C8.
- The build mean must also be > 0.
- **Also reported:** win rate, worst trade, max drawdown at 2% risk per condor, and every filter vs its unfiltered twin.

## After a pass

- An independent audit of the code and costs.
- Then a forward paper ledger before anything is called working.
