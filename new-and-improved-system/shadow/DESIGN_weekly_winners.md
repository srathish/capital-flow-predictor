# Catching the week's winners from UW flow (+ Skylit map on the shortlist) — locked 2026-10-15, before any feature is computed

**Goal (user, 2026-10-15):** "figure out how to just catch the winners for this week using the information we have from
Unusual Whales and Skylit". This week's moves (COST into its 1000 node, NOW into 150, software +6–8%, AI hardware −7 to
−17%) looked obvious afterwards; a one-day scan of Wednesday's "clean" setups (43 lookalikes) showed the map+flow did not
separate the winners. This study asks the question on ~100 past weeks, so a rule must work before the week, not after.

## Data
UW `/stock/{t}/options-volume` (daily per stock, 2024-10-17 → 2026-10-15: call/put volume by side, net call / put
premium, bullish / bearish premium, call / put open interest, 7/30-day average volumes) and UW daily OHLC (2Y) for the
300-stock universe of the short stock factory + 15 ETFs (.cache/winners/). Skylit historical boards cost 5 credits per
stock per snapshot, so Skylit is used only on the final shortlist (map check), never in the backtest.

## Panel
Rebalance at each week's last session close t (2024-11-22 → 2026-10-09). Outcome: return from t's close to the next
week's last close (for the current week: Thursday 2026-10-15). Weeks with a stock's |return| > 45% are dropped for that
stock (UW split-basis errors). **Winner** = top 10% of the universe by next-week return; **loser** = bottom 10%.

## Features (all known at t's close; cross-sectional ranks)
| id | feature |
|---|---|
| W1 | 5-day directional flow: Σ(net call premium − net put premium) over the last 5 sessions ÷ (30-day mean daily call + put premium) |
| W2 | same, last session only |
| W3 | 5-day bullish − bearish premium ÷ (bullish + bearish) |
| W4 | call volume surge: 5-day mean call volume ÷ 30-day mean call volume |
| W5 | ask-side share of call volume, 5 days, minus ask-side share of put volume |
| W6 | 5-day change in call open interest ÷ call open interest |
| W7 | 1-week return (momentum) |
| W8 | 1-month (21-session) return |
| W9 | peer momentum: mean 1-week return of the stock's 10 most-correlated peers (60-day daily-return correlation, as of t) |
| W10 | peer flow: mean W1 of the same 10 peers |
| W11 | combined: mean rank of W1, W3, W9, W10 |
Plus W12 = W11 within the top half of W4 (flow + theme, only where activity is unusual).

## Tests
Long side: the top 10 stocks by each feature each week. Short side: the bottom 10. Measured: (a) mean next-week return
of the picks minus the universe mean (excess), as a week-level series, t = mean ÷ (sd ÷ √weeks); (b) hit rate = share of
picks that are winners (losers for the short side) vs the 10% base rate. **Build** = rebalances 2024-11-22 → 2025-12-26;
**holdout** = 2026-01-02 → 2026-10-02 (completed weeks); **this week** (10-09 → 10-15) reported for every feature as one
more observation, never used to choose. Validated: holdout excess > 0 with t ≥ 2 AND BH q = 0.10 across the 24 (12
features × long/short; short tested as picks' excess return < 0).

## After the backtest
Only a validated feature becomes the weekly scanner; its top picks for the coming week get the Skylit map (nodes above /
below, air pocket) and real option prices before any trade idea. If nothing validates, that is the answer: the
information we have does not catch winners in advance, and the report says so.

## Amendments
**Amendment 1 (2026-10-15, user direction, before any feature is computed).** The user wants the last month as the
focus. Primary view: the 5 weeks with rebalances 2026-09-11 → 2026-10-09 (outcomes through 10-15), per feature: picks,
hit rate, excess return, and this week's picks named. The full-history build/holdout test above is kept as the check
that a rule which worked last month is not luck (one month = 5 observations).
**Amendment 2 (2026-10-15, after the pre-week result was null; new question, registered before computing it).**
"Catch the winners once the week has started": enter at the close of the week's FIRST session, exit at the week's last
close (rest-of-week return). Features known at the first session's close: R1 own day-1 return; R2 peer-group day-1
return (mean of the 10 most-correlated peers, 60-day correlation as of the prior week end — theme breadth); R3 day-1
call-volume surge (day-1 call volume ÷ 30-day mean) × sign of day-1 directional flow; R4 mean rank of R2 and R1; R5 R4
restricted to names whose peer group moved the same way (R2 sign = R1 sign); R6 R2 with the day-1 move ≥ 1 peer-sd
(strong theme days only). Long = top 10, short = bottom 10. Same tests (build / holdout 2026 / last month / this week),
BH q = 0.10 across these 12. Also reported: the second-session entry variant (enter at day-2 close) for R4.
**Amendment 3 (2026-10-15, registered before computing).** Direction-free capture: "bracket the likely big movers".
At each week's last close t, pick 10 stocks by a big-move score; for each, an OCO bracket for the next week: buy-stop at
close × (1 + X), sell-stop at close × (1 − X); the first side touched is entered (at the trigger, or the open if it gaps
through); protective stop at t's close; exit at the next week's last close. A session touching both triggers counts as
the losing outcome (−X − cost). On the trigger session, if the stop is also inside that session's range and the open
was not already beyond the trigger, the trade counts as stopped (conservative). Cost 0.10% per round trip.
Scores (known at t): B1 20-day realized volatility; B2 call-volume surge (W4); B3 |5-day directional flow| (|W1|);
B4 mean rank of B1 and B2; control = 10 random stocks (fixed seed). X ∈ {3%, 5%}. Tests: mean return per trade minus the
random control's (week-level series), build / holdout 2026 / last month / this week; BH q = 0.10 across the 8
(B1–B4 × X). Also reported: share of the week's top/bottom-10% movers that the picks contained, and trigger rates.
