# Theme-aware selling rules — locked 2026-10-06, before any run

Follows `DESIGN_exits.md` (same portfolio, 20 slots, next-close execution, 0.05% per side, same benchmark, same data
truncation). That study kept today's rule (sell at 6 months). Its best candidate, "hold while top-60 + 3-month time stop",
missed the drawdown limit by 0.04 points.

## Theme measures (industry = 3-digit SIC group; all known at the month-end)

- **Breadth:** how many *other* companies from the same industry are in that month's top 60 of the bottleneck list.
- **Industry acceleration:** the median, over the industry's scored companies that month, of revenue-growth acceleration
  (this quarter's YoY growth minus last quarter's).
- **Theme hot** = breadth ≥ 2 **and** industry acceleration > 0.
- **Theme cooled** = breadth = 0 **and** industry acceleration < 0.

## Rules

| | Rule |
|---|---|
| base | Sell at 6 months (today's rule) |
| C1 | Hold while the stock ranks in the top 60; sell when it drops out. Plus the 3-month time stop (still below entry 63 trading days after buying). *Carried over from the last study as a second look; it was chosen after seeing 2012–18, so its build numbers do not count.* |
| T1 | **Theme hold:** sell only when the stock is out of the top 60 **and** its theme is not hot |
| T1+L5 | T1 plus the 3-month time stop |
| T2 | **Theme exit:** sell when the stock is out of the top 60 **or** its theme has cooled |
| T2+L5 | T2 plus the 3-month time stop |

Every hold rule has a 24-month cap.

## Procedure

1. **Build 2012–2018** (data truncated at 2018-12-31). Among the four new theme rules, a rule is *eligible* if it beats
   the base in both halves (2012–15 and 2016–18) and its worst drawdown is no more than 5 points worse than the base's. The
   eligible rule with the highest annualized excess is chosen. If none is eligible, no theme rule goes forward.
2. **Check 2019–2022:** the chosen theme rule (if any) and C1 are each compared with the base.
   **Pass** = higher annualized excess and drawdown no more than 5 points worse.
3. **Final 2023 → 2026-09:** reported for the same rules.
4. Anything that passes the check goes into the frozen forward paper test with the base. Nothing is adopted on backtest alone.

## Deferred

The node-graph industry forecast as a theme signal. It needs 2010–2018 to learn, so it can't be used in the build period. It
gets its own test on 2019+ after this one.
