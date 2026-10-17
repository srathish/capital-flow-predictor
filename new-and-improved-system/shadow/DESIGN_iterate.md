# Iteration protocol: find a node rule that makes money on 0DTE options (locked 2026-10-17, before any search run)

Goal (user, active /goal): "try to make something that works with this" — Skylit board → SPY/QQQ 0DTE options.

## Data split

- **BUILD:** every SPY/QQQ session in replay/skylit_all.json, 2025-12-15 → 2026-03-31 (128 ticker-days). Iterate freely
  here.
- **HOLDOUT, sealed:** 2026-04-01 → 2026-05-05 SPY/QQQ from the same Skylit replay archive. No building, pricing,
  charting or looking until the final run. It runs once, on at most 3 rules frozen in this file beforehand.

## How every variant is scored (BUILD)

- The trade is the ATM 0DTE option (strike = round(price)) bought at the close of UW option candle m. The exit fills at
  the option candle close, or at the stop price for an option stop. Slippage is $0.02 per side, always on.
- **Score:** mean return per trade.
- **t-statistic:** clustered by date. Daily means are averaged within each date, then t is computed across dates.
- **To be a candidate, a variant needs:**
  - n ≥ 40 trades;
  - mean > 0 in at least 3 of the 4 build months;
  - day-clustered t ≥ 2;
  - it beats its placebo:
    - king rules: the same entries in the mirror direction (away from the king, target at the same distance on the
      other side);
    - other rules: the same entry times with the direction flipped.
- **Every variant tried goes in results_iterate/log.tsv.** The total number of tries is reported with any result, so a
  winner is judged against how many shots were taken.

## Families (from the user's notes and earlier findings)

| | Family | Idea |
|---|---|---|
| A | Pull to king | the checklist, with grids over stability, distance, growth, window and exits |
| B | King break | price crosses a stable king; trade the break toward the next node; stop back through the king |
| C | King migration | a new king holds 5 min ≥ 0.2% from price; trade toward it (U2) |
| D | Floor/ceiling bounce | a growing node is touched and holds; trade back toward the king (U6) |
| E | Engine + filters | reactive breaks, filtered by king stability, trinity agreement, king side |

Exit options in every family:
- underlying target touch;
- underlying structural stop, wick or 1-minute close basis;
- option stop none / −35% / −50%;
- max hold;
- 15:50.

## Holdout

- Up to 3 frozen rules.
- **Pass:** holdout mean per trade > 0 after slippage, and the one-sided day-clustered t passes Benjamini–Hochberg
  q = 0.10 across the rules sent.
- A rule that fails the holdout is reported as failed. It is not re-tuned and re-sent.

## Amendment 1 (2026-10-17, before any search run): the April–May holdout does not exist

The Skylit replay archive has only 3 days after March: 04-02, 04-30 and 05-05. New split:

- **BUILD:** 2025-12-15 → 2026-02-27. That is 50 days and 100 SPY/QQQ ticker-days. The month-consistency check becomes
  mean > 0 in at least 2 of the 3 build months.
- **HOLDOUT:** March 2026, 14 days and 28 ticker-days. It is contaminated in two ways:
  - The user formed qualitative ideas from March charts.
  - The engine's and checklist v1's March results have been seen.

  No search parameter will be chosen on March numbers. March runs once, on at most 3 frozen rules.
- **Real exam:** any rule that passes March goes to the live forward paper ledger. It uses Skylit heatmapLive under the
  existing credit guard, and runs before anything is called "working".

## Amendment 2 (2026-10-17): build search results and the frozen holdout rules

- **Tries so far:** 1,022 variants over families A–G, all logged in results_iterate/log.tsv.
  - A–E: 806 variants, including the plain-strike control and the debit-spread versions. Buying options: 0 candidates.
    Scored on the stock itself, every family is about 0 bps per trade, so these rules carry no directional skill.
  - F: sell a fly centered on a pinned king. 108 variants, 0 candidates. It averaged −17.5% of risk vs +9.8% for the
    far-king control.
  - G: sell the ATM fly when the king is ≥ X from price, against an every-day ATM-fly baseline. 108 variants,
    2 candidates.
- **Frozen for the March holdout:** results_iterate/holdout_rules.json, the two G candidates.
  - Each sells the ATM 0DTE iron butterfly (short S = round(price), long S ± w) at the first frame ≥ 11:00 and ≤ 14:30
    where all of these hold:
    - the king has held ≥ 30 frames;
    - the king changed ≤ 3 times in the last 60 frames;
    - |king − price| / price ≥ 0.4%.
  - Hold to the 15:59 candle close; P&L is intrinsic at that close.
  - Return on max risk, $0.02/leg entry slippage, one trade per ticker-day.
  - G1 uses w = $3 and G2 uses w = $2.
  - **Build:** G1 t 2.10, +33.8%; G2 t 2.02, +41.0%; 49 trades each, carried by February. The every-day 11:00 fly
    baseline made +24–29% at t 1.56.
- **Holdout pass:** mean > 0, plus one-sided day-clustered t passing BH q = 0.10 across the 2 rules. The every-day
  baseline is reported as a reference only.

## Amendment 3 (2026-10-17): independent audit before the holdout. G1/G2 withdrawn; March stays sealed.

- **Audit** (fresh agent, build data only): no look-ahead, no payoff bug, and the stale-leg fallback was never used. But
  the result depends on the cost assumption ($0.02/leg at last-trade prices):

  | Cost | G1 | G2 |
  |---|---|---|
  | $0.03/leg | t 1.91 | t 1.73 |
  | $0.05/leg | t 1.53, months fail | t 1.12, months fail |

  - Commissions (about $0.65 × 4 legs) add another 2.6–5% of risk per trade.
  - Dropping the best day (01-28) gives t 1.79 / 1.70.
- **Cost model from now on:** $0.03/leg plus $0.65/contract commission. Under it, neither G rule clears the build gate.
  Both are withdrawn and **not** sent to the March holdout.
- **The March gate now also requires beating the same-month every-day baseline.** Otherwise a pass could be plain
  short-premium drift.
- **Total tries: 1,022 variants. Surviving candidates under realistic costs: 0.**
