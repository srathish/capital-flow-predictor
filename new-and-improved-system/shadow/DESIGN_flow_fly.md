# Flow-built positioning filter for the overnight iron fly (locked 2026-10-17, before data is collected)

**New input.**
- Skylit-style dealer positioning is built from signed customer flow (see shadow/skylit_formula).
- Here it is applied to the exact contracts being sold: the ATM call and put expiring tomorrow.

**Hypothesis.**
- If customers have net **sold** those options (ask-side minus bid-side volume < 0 over their life up to the entry day),
  dealers are long gamma at the money. Price should pin, so the short fly pays.
- If customers net bought them, avoid the trade.

## Trade

The T1 iron fly from DESIGN_iron_fly / long_fly, unchanged:
- sold at the prior close, with the body at the bid and the wings at the ask;
- wings ±1% (also ±0.5% reported);
- held to the close of expiry day;
- commission $0.65 × 4;
- return on max risk.

## Feature, known at the entry close (d−1)

- NB = Σ over every daily row dated ≤ d−1 of (ask_volume − bid_volume), for the ATM call and put expiring d, from UW
  /option-contract/{id}/historic.
- V = Σ volume over the same rows.
- z = NB / V: customer net buying as a share of volume.

## Sample

- SPY, QQQ, IWM, DIA, 2024-01-08 → 2026-10-02 (the straddle cache).
- **Build:** d ≤ 2025-03-31. **Holdout:** d ≥ 2025-04-01.
- Rows without the feature (no history rows) are dropped and counted.

## Tests (holdout pooled over the 4 tickers; day-clustered t; BH q = 0.10 across 4)

| Test | Wings | Claim |
|---|---|---|
| Q1 | ±1% | fly on days with z < 0: mean > 0 |
| Q2 | ±1% | fly with z < 0 minus fly with z ≥ 0 (difference of day-clustered means, Welch t) > 0 |
| Q3 | ±0.5% | same as Q1 |
| Q4 | ±0.5% | same as Q2 |

Also reported: the build period, per ticker, and terciles of z.

**A pass needs the build period to agree in sign.** Then come the audit, the cost check and the forward ledger.
