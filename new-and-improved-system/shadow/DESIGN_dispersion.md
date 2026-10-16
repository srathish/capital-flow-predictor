# Dispersion: sell QQQ weekly premium, buy its top holdings' weekly premium — locked 2026-10-16, before any QQQ price

**Why (from results):** gamma-filtered SPY/QQQ premium selling made money; single-stock weekly premium selling lost on
10 liquid mega-caps (DESIGN_single_stock_premium.md) — index options carry a premium single-stock options do not.
The classic way to harvest that gap is a dispersion trade.

## Trade (weekly, entry at each week's last close t, expiry = next Friday listed; real UW closing quotes)
- SELL the QQQ ATM weekly straddle at the **bid** (collector dispersion_collect.mjs, same rules as single_stock_collect W).
- BUY the ATM weekly straddles of AAPL, AMZN, AVGO, GOOGL, META, MSFT, NVDA, TSLA at the **ask** (already collected,
  .cache/ssprem W entries), each sized to premium weight w_i = fixed weights 0.125 (equal), total long premium = Q × the
  QQQ premium collected, Q ∈ {0.5, 1.0} ("half-hedged" and "premium-neutral").
- Hold all to expiry (intrinsic). P&L per $1 of QQQ premium sold: (1 − QQQ payoff ÷ QQQ premium) + Q × (mean over names
  of payoff_i ÷ cost_i − 1). Weeks need the QQQ straddle and ≥ 6 of 8 names.
- Variant: QQQ side only on gamma-filter weeks (QQQ ±1% gamma balance at t ≥ its build top-third threshold 0.7562).

## Hypotheses (one-sided; build = t ≤ 2025-06-30, holdout = t ≥ 2025-07-01; week-level t; BH q = 0.10 across 4)
D1 Q = 1.0, all weeks: mean > 0 · D2 Q = 0.5, all weeks · D3 Q = 1.0, gamma weeks · D4 Q = 0.5, gamma weeks.
Reported: naked QQQ weekly short straddle alone (reference), win rate, worst week, worst 8 weeks.
