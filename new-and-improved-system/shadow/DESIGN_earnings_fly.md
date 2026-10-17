# Earnings iron fly: sell the implied earnings move when it is rich vs history (locked 2026-10-17, before data)

**Lineage:**
- This is the user's IV-wall concept (implied range vs historical range) applied to earnings.
- An earlier finding (memory, earnings-gap 2026-08-27): stocks beat the implied earnings move only about 24% of the time.
- The earlier lottery tests sold 5–10% OTM weekly spreads around earnings and lost, but never this structure.

## Events

- **Universe:** the 299 stocks in .cache/lottery_earnings.json, using the report dates and timing listed there.
- **Dates:** reports from 2024-01-01 to 2026-10-09.
- **Entry day E:**
  - the report date for postmarket reports;
  - the previous trading day for premarket or unknown timing.
- **Exit day X:** the trading day after E (the reaction day).
- Daily closes come from .cache/winners/{T}.json ohlc.

## Trade (one per event)

- **Expiry:** the nearest listed expiry ≥ X, from UW /stock/{T}/option-chains?date=E.
- **Body:** the listed strike nearest the close on E. Sell the call and the put.
- **Implied move** = the body's mid straddle / S_E.
- **Wings:** the nearest listed strikes at or beyond S_E·(1 ± 1.2·implied). Buy the call above and the put below.
- **Prices** come from UW /option-contract/{id}/historic daily NBBO.
  - **Entry on E:** sell the body at the bid, buy the wings at the ask.
  - **Exit on X:** buy the body back at the ask, sell the wings at the bid.
  - If X is the expiry, or a leg has no quote on X, that leg is valued at its intrinsic value from the X close.
- **Commission:** $0.65 × 8 legs per round trip.
- **Return** = P&L / max risk, where max risk = the wider wing − entry credit.
- Events are skipped (and counted) if any entry quote is missing or the credit is ≤ 0.

## "Rich" filter (known on E)

- Implied move > the mean |close-to-close reaction| of the stock's previous 8 reports (computed from closes; at least
  4 required).
- The ratio implied / historical is also reported, in terciles.

## Split

- **Build:** E ≤ 2025-03-31. **Holdout:** E ≥ 2025-04-01.
- t is clustered by entry date.

## Tests (holdout; BH q = 0.10 across 3)

| Test | Claim |
|---|---|
| S1 | all events, mean > 0 |
| S2 | rich events, mean > 0 |
| S3 | rich minus not-rich > 0 (Welch on date-clustered means) |

- **A pass needs the build period to agree in sign.**
- **Also reported:** win rate, worst trade, the distribution, the account path at 1% risk per event, and the top-decile
  loss share (fat tails).
- **After a pass:** an independent audit, then a forward ledger on upcoming earnings.
