# Can we reliably catch +20% / +50% option gains? (take-profit test) — locked 2026-10-16, before computing

**User:** "can we even catch a 50 percent gain or even a 20 percent gain — those compounded would be a lot."
Short-dated lotto tickets lose (DESIGN_lottery.md). This asks the take-profit version on the ~30k cached real ATM
monthly contracts of Ideas200 part B (.cache/bigmover/contracts: whole-life daily NBBO). Win rate is NOT the target;
mean P&L per trade (what compounds) is.

## Trades
Weekly picks of the short stock factory (picks.json, 2023-11 → 2026-10): S41 (top-10 realized volatility = the radar),
COMBO (vanna + vol + footprint), S17 (top vanna balance), CONTROL (10 random). Buy the ATM option(s) on the first
standard monthly expiry ≥ 28 days out at the rebalance day's closing **ask** (as Ideas200 B). Each later session, if the
closing **bid** ≥ entry × (1 + TP) → sell there (+TP or better, at that bid). Otherwise exit at the closing bid on day
20 (or expiry intrinsic via bid 0, as Ideas200 B). Variants: TP ∈ {+20%, +50%}; stop ∈ {none, −50% on the closing bid};
structure ∈ {call, put, straddle}.

## Hypotheses (holdout = rebalances ≥ 2025-07-01, build = exits ≤ 2025-06-30; week-clustered)
T1–T6: S41 radar, {call, put, straddle} × TP {20%, 50%}, no stop: mean P&L ÷ premium > 0.
T7–T8: S41 straddle TP 20% / 50% WITH the −50% stop: mean > 0.
T9–T10: COMBO straddle TP 20% / 50%: mean > 0.  T11–T12: S41 straddle minus CONTROL straddle, TP 20% / 50% (> 0).
BH q = 0.10 across 12. Reported for every row: win rate (TP hit share), mean, median, worst, and the compounding
result of putting 5% of the account into each week's basket.
