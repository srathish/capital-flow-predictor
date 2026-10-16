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
**Amendment 1b (same session, before any outcome).** Correction: a >25% move between entry and expiry is often a REAL
move (the winners this study is about), so excluding it would bias against the hypothesis. The guard now excludes only
day-over-day close ratios within 3% of a split ratio (½, ⅓, ¼, ⅕, ⅒, ⅔, 2, 3, 4, 5, 10, 1.5, 1/20, 20). Restarted.
**Amendment 2 (2026-10-16, user request, before any outcome).** Second entry timing, same everything else: pick at the
close of the week's FIRST session (usually Monday) using data known then; buy legs on the first listed expiry 2–6
calendar days later (that week's Friday); hold to expiry. Run as a separate family (results_lottery/summary_mon.md),
same 12 hypotheses (L1m–L12m), its own BH; the two timings are compared side by side.
**Amendment 3 (2026-10-16, after the Friday BUYER result, registered before computing the seller side).** The buyer
baskets lost 25–90% of premium per week; that loss is the seller's gain before spreads. Seller test on the SAME legs:
per stock-week and side, a defined-risk credit spread — SELL the 5%-OTM leg at the closing **bid**, BUY the 10%-OTM leg
(same side, same expiry) at the closing **ask**; skip if credit ≤ 0 or the long strike is not further OTM. Payoff at
expiry intrinsic; return = P&L ÷ max risk (width − credit). Iron condor = call spread + put spread on the same name
(P&L summed ÷ the larger side's max risk). Baskets: S1, S4, CTL (random) and ALL picked names; equal max-risk per trade.
Hypotheses (one-sided, holdout 2026, BH q = 0.10 across 8, both entry timings run as separate families):
K1–K4 condor return > 0 for S1 / S4 / CTL / ALL; K5–K8 the same for put spreads alone. Also reported: win rate, worst
week, worst 8 weeks, share of trades at max loss, and whether the radar names (S1) beat random (CTL) for the seller.
**Amendment 4 (2026-10-16, registered before fetching earnings dates or computing).** Two new splits on the SAME legs
(both entry timings): (a) **earnings week** = the stock's scheduled report (UW /earnings/{t}) falls inside the holding
window: before-open reports dated after entry through expiry day; after-close reports dated entry day through the
day before expiry (dates are scheduled in advance → known at entry); (b) **mid fills**: entry and exit at the mid of
bid and ask instead of crossing the spread (sensitivity: what a patient limit-order trader could get at best; exit at
expiry is intrinsic either way, so only the entry price changes). Hypotheses (one-sided, holdout 2026, BH q = 0.10 across
12 per timing): E1 radar 5% legs bought on earnings weeks > 0; E2 radar 10% same; E3 ALL picks 5% bought on earnings
weeks > 0; E4–E6 the same three on NON-earnings weeks; E7 put credit spread (ALL) on earnings weeks > 0; E8 condor (ALL)
on earnings weeks > 0; E9 radar 5% bought at mid > 0; E10 ALL 5% bought at mid > 0; E11 put credit spread (ALL) at mid
> 0; E12 condor (ALL) at mid > 0.
