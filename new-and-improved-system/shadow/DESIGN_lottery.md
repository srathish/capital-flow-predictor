# Can a selected basket of cheap weekly OTM options win? (the "1000% gainers") — locked 2026-10-16, before any price

**Goal (user):** "find a winner … get those 1000% gainers". 1,000% gains come from cheap, short-dated, out-of-the-money
options on stocks that make an outsized move (COST weekly 1000C $0.11 → $1.37+). The radar (top realized volatility)
holds ~46% of each week's extreme movers; the open question is whether those names' cheap OTM weeklies are priced BELOW
their real tail odds, so that a basket wins on average even though most legs expire worthless. Earlier tests (ATM
monthlies, Ideas200 B) say ATM options price the move; far-OTM short-dated tails were never tested.

## Trades
Each week's last session close t (2024-11-22 → 2026-10-09): from the UW chain listed on t (`/stock/{t}/option-chains?date=`),
the expiry = the first listed expiry 3–9 calendar days after t (next week's Friday). Legs: call at the listed strike
nearest close × 1.05 and × 1.10; put nearest close × 0.95 and × 0.90 (each must be ≥ 3% OTM, else skipped). Entry = the
closing NBBO **ask** on t from `/option-contract/{id}/historic` (skip if no ask > 0 on t). Exit = intrinsic at the
expiry-day close (UW daily close). Leg return = payoff ÷ ask − 1. A week's basket return = mean of its legs' returns
(equal premium per leg). No early exits.

## Selections (known at t)
S1 radar: top 10 by 20-day realized volatility · S2 top 10 call-volume surge (5-day ÷ 30-day call volume) · S3 top 10
|5-day directional flow| · S4 top 10 by mean rank of S1 and S2 · CTL 10 random stocks (fixed seed).
Directional variant (S3 only): buy only the call legs when 5-day flow > 0, only the put legs when < 0 ("S3dir").

## Hypotheses (one-sided, holdout = rebalances 2026-01-02 → 2026-10-02; build = 2024-11-22 → 2025-12-26)
| id | statement |
|---|---|
| L1–L4 | S1–S4 basket, 5% OTM strangle legs: mean weekly basket return > 0 |
| L5–L8 | S1–S4 basket, 10% OTM legs: mean weekly basket return > 0 |
| L9–L10 | S3dir, 5% / 10% OTM: mean > 0 |
| L11–L12 | S1 basket minus CTL basket, 5% / 10% (selection beats random) |
Week-level t (sd of weekly basket returns); BH q = 0.10 across 12. **Also reported** (decides usefulness): share of legs
returning ≥ +900% (10×), longest losing streak, worst 8-week run, last month, this week (10-09 → 10-16 expiry if listed).

## Honesty rules
A positive mean driven by one or two 50× legs is flagged (also reported: mean with the top 1% of legs winsorized).
Research only.

## Amendments
**Amendment 1 (2026-10-16, during collection, before any outcome).** UW daily closes contain unadjusted split jumps
(ETR ranked "most volatile" from its split), which mis-states volatility and puts strikes on the wrong price basis.
A name is excluded for the week if any daily close-to-close move exceeds 25% in the 20-day volatility window or between
entry and the expiry week. Collection restarted from scratch.
