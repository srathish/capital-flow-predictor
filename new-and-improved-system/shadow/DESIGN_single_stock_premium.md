# Making money weekly / daily from options on ONE stock — locked 2026-10-16, before any price is pulled

**User:** "figure out how we can make money daily or weekly from options on a single stock" (target ≥ 20%).
Evidence so far: buying single-stock options loses (options price the move; spreads), selling far-OTM weekly spreads
on volatile names loses to the bid/ask; the only working premium trade is gamma-filtered SPY/QQQ selling, where spreads
are pennies. So: defined-risk ATM premium selling on the most liquid single stocks (penny/nickel spreads).

## Universe and trades
AAPL, AMD, AMZN, AVGO, GOOGL, JPM, META, MSFT, NVDA, TSLA (UW daily gamma history 2023-11 → 2026-10). Price basis: UW
closes are split-adjusted; strikes are not → raw = adjusted × 10 for NVDA before 2024-06-10 and AVGO before 2024-07-15.
- **W (weekly):** at each week's last close t, the first listed expiry 3–9 calendar days later; SELL the ATM call + put
  (strike nearest the raw close) at the closing **bid**, BUY wings nearest ±3% (W3) or ±6% (W6) at the closing **ask**.
- **D (one-day):** at the close of the session before a listed expiry that is the next session (Thursday → Friday for all
  names; Mon/Wed when listed), same structure with wings ±2% (D2) / ±4% (D4).
Settle at intrinsic on the expiry close. Return = P&L ÷ max risk. Skip if any quote missing, credit ≤ 0, or the ATM
call/put mids differ by > 50% of the straddle mid (basis check).
**Gamma filter:** ±2% net gamma balance (call + put gamma within ±2% of the raw close ÷ total |gamma| there) at t, top
third per ticker on build trades (UW gamma scales with splits; the balance ratio is scale-free).

## Hypotheses (one-sided, BH q = 0.10 across 10; build = entries ≤ 2025-06-30; holdout = entries ≥ 2025-07-01)
H1 W3 all trades mean > 0 · H2 W6 · H3 D2 · H4 D4 · H5–H8 the same four, gamma-filter trades beat the others (pooled
regression, ticker effect, week-clustered) · H9 the single ticker with the best W3 build mean: its holdout W3 mean > 0 ·
H10 the same for D2. Reported: per-ticker tables, win rate, worst trade, and the account path at 2% max-risk per trade
(all names, and filter-only), annual return and max drawdown.
