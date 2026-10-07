# Selling rules for the bottleneck system — locked 2026-10-06, before any run

## What is being tested

The current system buys the bottleneck list and blindly holds each pick 6 months. This study picks the **selling rules**:
when to cut a loser, and how long to let a winner run. Entries (filing-day buys, cluster signal, insider confirmation, adding
to winners) come in a later, separate study.

## The portfolio (same for every rule)

- **List:** the core bottleneck score (v5 Model A: revenue growth + acceleration + gross-margin change, first-filed SEC data)
  with the hard rule (gross margin a year earlier ≥ 0). Wide universe, eligibility as v5 (price ≥ $5, 50-day $ volume ≥ $20M,
  no stale price).
- **20 slots.** At each month-end, empty slots are filled with the highest-ranked names not already held. New positions get
  1/20 of current equity (or what cash allows).
- **Timing:** every signal uses that day's close; the trade executes at the **next session's close**. Cost 0.05% per side.
- Cash earns 0.
- **Benchmark:** the typical eligible stock (median month-end-to-month-end return, compounded). SPY is also reported.

## Selling-rule menu (fixed)

**How long winners may run (choose one):**

| | Rule |
|---|---|
| W0 | Sell after 6 months (today's system) |
| W1 | Hold while the stock ranks in the top 60 at each month-end; sell when it drops out |
| W2 | Sell after 12 months |
| W3 | No time limit (24-month cap); only a loser rule ends it |

**How losers are cut (none, or one):**

| | Rule |
|---|---|
| L1 | Trailing stop: close falls X% below the highest close since entry, X ∈ {20, 30, 40} |
| L2 | **Volatility-scaled trailing stop:** the distance is k × the stock's monthly volatility at entry (60-day daily stdev × √21), k ∈ {1.5, 2, 3}. Volatile stocks get wider stops |
| L3 | Trend break: close below the 50-day average (L3a) or the 200-day average (L3b) |
| L4 | The numbers turn: at a month-end, the latest filing (filed after entry) shows revenue growth slowing vs the prior quarter **and** gross margin below a year earlier |
| L5 | Time stop: still below the entry price 63 trading days after entry |

That gives 4 × 11 = 44 combinations, including W0 with no loser rule, which is the baseline.

## Choosing (build period only)

- **Build period 2012-01 → 2018-12**, with prices and filings physically truncated at 2018-12-31 and all positions closed then.
- **Score** = annualized return minus the benchmark's.
- **Eligible to win:** the worst peak-to-trough drawdown is no more than 5 points worse than the baseline's, **and** the
  combination beats the baseline in both halves (2012–2015 and 2016–2018).
- The highest score among eligible combinations is chosen and frozen. If none qualifies, the baseline stays.

## Checking

- **Check period 2019-01 → 2022-12** (data never used for choosing). **Pass** = the frozen rule beats the baseline's
  annualized excess and its drawdown is no more than 5 points worse.
- **Final period 2023-01 → 2026-09** (the picks were seen before, the exit rules were not). Reported, same comparison.

## Reported for every period

- Annual return, benchmark, SPY, excess, worst drawdown, Sharpe (monthly), number of trades, average holding period.
- **Winner capture:** for picks that at least doubled within 12 months under plain buy-and-hold, the average share of that peak
  gain kept at exit.
- **Loss avoided:** for picks that fell ≥ 30% under 6-month buy-and-hold, the average loss actually taken.

## Known limits

- Delisted companies are missing (survivorship). That flatters every rule, but trailing stops less than holds.
- Daily closes only; no intraday stops.
- One portfolio path per rule; regime luck can matter. The two halves and the check period are the guard.
