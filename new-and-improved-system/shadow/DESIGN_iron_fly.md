# Turning the gamma-filtered straddle sale into a defined-risk trade (locked 2026-10-13, before any wing price is pulled)

**Why.** Ideas200 part C and DESIGN_real_straddle.md: selling SPY/QQQ straddles on long-gamma days kept +17% of premium vs
−5% on other days, but a naked straddle has an open-ended loss (worst other-day −$38 per straddle). Before paper trading
it with sizing, pick the **structure** (how far out to buy protective wings), and measure what the sizing rule does to the
account. This is a design choice, not a new edge test: the edge itself is graded only by the forward ledger.

## Trades (same entries as DESIGN_real_straddle.md, SPY and QQQ)
- **Body:** the T1 (sell at the d−1 closing bid, expiry d) and T2 (sell 0DTE at the 09:35 one-minute close − $0.01 per
  leg) ATM straddles, unchanged.
- **Wings (iron fly):** buy the call at strike round(entry price × (1 + w)) and the put at round(entry price × (1 − w)),
  same expiry, w ∈ {**0.5%, 1%, 1.5%, 2%**}. Entry price = the d−1 close (T1) or the 09:35 price (T2). Wing cost = the d−1
  closing NBBO **ask** (T1) or the 09:35 one-minute close + $0.01 per leg (T2). Wings settle at intrinsic on d's close.
  A day is used only if all four legs have a price; wing rows missing a price are reported and skipped (the straddle row
  for that day stays in the straddle-only comparison).
- **Per-trade numbers:** net credit = straddle premium − wing cost; P&L = net credit − straddle payout + wing payout;
  **max risk** = max(call wing distance, put wing distance) − net credit (the most the fly can lose); return on risk =
  P&L ÷ max risk. The naked straddle has no max risk; for it, return is reported per $ of premium only.

## Filters (both reported; no new filters)
F1 = the frozen forward filter (±1% gamma balance in the build top third AND d−1 close above its 20-day average AND
ln(VIX1D ÷ VIX9D) below the build median; thresholds as straddle_forward.mjs). F2 = ±1% gamma balance top third alone
(Ideas200 C-G1). Plus "all days" and "other days" for contrast.

## Choosing the wing width (locked rule)
On **T1 build days (2024-01-08 → 2025-03-31), F1 days**, pick the w with the highest mean return on risk; if two are
within 0.01 of each other, take the wider wing (fewer, smaller tail losses). If F1 has < 30 build days with all wings
priced, use F2 build days instead. T2 has no build-period prices (UW intraday options start 2025-04), so T2 uses the
same w. The holdout (2025-04-01 → 2026-10-02) is reported for every w but **not** used to choose. (Caveat stays: that
holdout was already looked at for the straddle itself on 2026-10-11.)

## Sizing and max-loss rule (reported, fixed in advance, not optimized)
Account starts at 1.0. Each traded day, size so the fly's max risk = **1%** (also shown: 2%, 3%) of the current
account; SPY and QQQ each sized independently on the same day. Reported per (w, filter, sizing): final account,
compound annual growth, worst day, worst 20-day drawdown, longest drawdown in trading days. Naked straddle sized by
premium (premium = 1% of account) shown as reference, labelled "undefined risk". No commissions beyond the stated
spreads; no early exits, no assignment risk beyond intrinsic at the close.

## Outputs
results_iron_fly/summary.md: per w × trade × filter × period (build / holdout): trades, mean $ per fly, mean return on
risk, win rate, worst $ and worst return on risk, share of days the wing paid; chosen w and the rule's trace; sizing
table; then a one-line paper-trading spec (structure, filter, size) that straddle_forward.mjs will add as a second ledger
column after the run.

## Run discipline
Collector `iron_fly_collect.mjs` (wing prices only, UW `/historic` for T1, `/intraday?date=` for T2, cached in
`.cache/straddle_wings/`), smoke check, independent audit against this file, single run of `iron_fly.mjs`. Research only.

## Amendments

**Amendment 1 (2026-10-13, during wing collection, before any P&L is computed).** Some far wing strikes are not listed for
a given expiry (e.g. SPY C501/C504 in early 2024: UW has no such contract). When the exact strike has no contract, the
collector uses the nearest listed strike further out (up to $5); payout and max risk use the strike actually priced. If
the contract exists but has no price on the entry date, the day stays missing (no substitution).

**Amendment 2 (2026-10-13, after the independent audit, before any P&L is computed).** Fixes, no change of intent:
(a) width tie rule = the widest width within 0.01 of the true best score (the first version could drift in steps); the
run stops if the choice pool has < 30 days; (b) longest drawdown no longer counts flat days at the account high;
(c) sizing runs use the same all-wings-priced days as the tables; (d) the straddle row is shown both on all body days
(as line 18 says) and on the all-wings days; (e) the collector substitutes a further-out strike only when the exact
contract does not exist (a failed request or an existing contract without a price leaves the day missing), and a retry
pass re-checks failed legs and every substitution; (f) the report adds missing counts by width, the payout on dropped vs
kept days, legs with max risk ≤ 0, and the minute gap between T2 leg prices; "worst 20 days" is labelled as the worst
20-day return.
