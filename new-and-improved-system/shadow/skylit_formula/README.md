# How Skylit computes GEX (inferred from public data, 2026-10-17)

No scraping and no reverse-engineering of Skylit's app. We take Skylit's finished per-strike gamma from the replay
files and test which recipe, built from Unusual Whales' public per-contract data, reproduces it. Run with
`node fit.mjs SPY:2026-03-13 …`; the full output is in run_output.txt.

## Finding

Skylit's GEX is **flow-built dealer positioning**, not open-interest GEX:

```
Skylit value(strike, expiry) ≈ −k × gamma$ × Σ (customer buyer-initiated − seller-initiated volume)
```

- The sum covers all prior days plus today so far, for calls and puts separately.
- `gamma$` = Black-Scholes gamma × 100 × S² × 1%.
- The minus sign means dealers are assumed to hold the other side of customer flow.
- The fitted k is about 0.13–0.18, which is only a units/scale difference.

| Recipe | 0DTE R² | Later expirations R² |
|---|---|---|
| Textbook OI GEX (calls +, puts −), weights fitted | ~0.6 | ~0.03 |
| **Flow-only (4 inputs)** | **0.935** | **0.756** |

**Out of sample** (weights fit on the other 4 ticker-days):

| Ticker-day | R² | Correlation | Same king |
|---|---|---|---|
| SPY 03-13 | 0.85 | 0.993 | |
| SPY 03-04 | 0.95 | 0.985 | |
| SPY 03-19 | 0.86 | 0.926 | |
| QQQ 03-19 | 0.68 | 0.896 | |
| QQQ 03-13 | 0.32 | 0.578 | |
| All five | | | 19 of 25 snapshots |

- Skylit's 10:00→15:30 changes correlate −0.90 with today's net buyer flow.
- Against UW's own OI-based greek-exposure GEX, Skylit has sign agreement 49% and |size| correlation 0.60.

## Why UW and Skylit disagree

- **UW's greek-exposure GEX assumes a fixed sign from open interest.** Dealers are taken to be long calls and short
  puts, the reverse of what this fit finds Skylit doing.
- **Skylit signs every contract by who initiated the trades.** The dealer is short what customers bought and long what
  they sold, accumulated over the contract's life.
- So the two agree on where big positions are (size) but often disagree on sign, and therefore on which strike is king.

## Limits

- Five ticker-days.
- UW's own buyer/seller tagging stands in for whatever trade classification Skylit uses.
- QQQ 03-13 fits worse, so Skylit may use a different classifier, start date or multi-leg handling.
- The call-side prior-days weight is unstable for later expirations.
- VEX was not fitted. It presumably uses the same positions × vanna; this is untested.
