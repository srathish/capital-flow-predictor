# How do we find the stocks? — selection study (2026-10-03)

Every rule below was written down before it was run, then judged on periods it was not built on.
Total cost ≈ 330 credits (daily bars for 294 stocks + 148 Discord tickers, earnings records). No code in the live path changed.

## Verdict

**No mechanical stock-picking rule clears the bar.** Across ~50 pre-registered rules in 6 families, the only consistent
signals are weak and already known (12-1 momentum; avoid laggards when buying dips). Picking by maps, themes, earnings
history, flow alerts, or the Discord room's watchlists does not find better stocks.

| Family | Data | Result |
|---|---|---|
| A+ map setup, 16 selectors | 15 names, Jan–Oct 2026, 63 trades | A+ itself fails out-of-sample (+0.41R → −0.58R). "Leader vs SPY + index with you" looked good (+1.26R / +0.91R) but n=8–10 |
| Same RS filters on every older strategy | 1,826 trades, real option prices | Does **not** generalize: "pick" beats baseline in 0/9 strategies. Leader-only helps the buy-the-dip styles (bounce, Giul dip-buy, R3+buy time) in all 3 quarters — but those styles still lose / break even |
| Price rankers (12) | 294 stocks, 193 weeks, 2023–2026 | Only **12-1 momentum** positive in train, test and holdout (weekly +0.27/+0.85/+1.00%, t 1.8; monthly t 1.3). Survivorship-biased universe flatters it. Dip-in-leader, breakouts, volume surges, near-high: fail |
| Theme / sector rankers (6) | 12 sector baskets from memory | "Laggard in hot theme" just passes weekly (t 2.0, holdout +0.23%) and fails monthly → treat as chance (≈36 tests run). Hot-theme rules turned negative in 2026 |
| Earnings history | 294 stocks, 1,429 walk-forward reports | Past beat-the-implied-move does **not** predict the next (corr −0.009). Buying the priced move loses on average (beat rate 20%) |
| Discord stock calls | 2,019 deduped calls, 359 tickers, beta-adjusted | Room ≈ 0 (+0.05%/5d). Giul's stock calls ≈ 0. Only TheArchitect's posted *own* whale trades were positive (+3.3%/5d β-adj, both halves) — but 25 days in Apr–Jun 2026, his personal positions, posts stopped 6/9: not reproducible. Glitch channel +2.3%/5d (n=50), gone by 20d |

## What to use

1. **Momentum 12-1 leaders** as the default watchlist (weak prior, outside literature agrees).
2. **Don't buy dips in laggards** (stock weaker than SPY over 20d) — consistent across the dip-buy styles.
3. **No earnings holds** (already in the A+ rule).
4. Everything else = discretionary context, not a filter.

## Files
`shadow/select_study.mjs` · `shadow/rs_filter_study.mjs` · `shadow/rank_study.mjs [--fetch] [--hold 20]` · `shadow/theme_study.mjs` ·
`shadow/earnings_study.mjs` · `community/verify_stock_calls.mjs` · outputs in `shadow/reports/*.txt`. `OFFLINE=1` re-runs the map walks for 0 credits.
