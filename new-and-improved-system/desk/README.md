# The desk — find a stock, verify it with Skylit, you decide, it scores

Decision support, not an autotrader. It never sends orders.

Every backtest says the same thing:
- `shadow/reports/STOCK_SELECTION_FINDINGS.md`, Rule 1 and A+ out-of-sample: nothing mechanical makes money.
- Unusual Whales, tested 2026-10-04: the first selection signal that holds.

What the evidence supports, and what it doesn't:

| Piece | Status | Evidence |
|---|---|---|
| **Insider open-market buy ≥ $100k** (Step 1 source) | ✅ **real, on the STOCK** | 660 events, 294 stocks, 2022–26: +3.86% beta-adjusted over 20 sessions (t 3.4). It beats random dates in the same stock by +3.2% (t 2.7), with a positive average every year. Median +1.4%, so the edge is small per trade. |
| ...as a SHARE book | 🟡 **best strategy found** | 563 trades 2022–26, $10k each, 20-session hold, after costs. Unhedged: +3.99%/trade (t 3.2) in 2022–24 and **+3.29% (t 2.4)** in 2025–26, Sharpe 0.96 / 1.08. SPY-hedged: +3.14% / +2.45% (t 1.9, just under the t ≥ 2 bar), positive every year. Literature filters (officer, ≥$500k, +10% holdings, opportunistic) did not beat the plain rule. |
| ...as an options trade | ❌ not validated | ATM calls ≥35 DTE: +9.9% average but −43% median, carried by 5 lottery wins, and the second half lost. ~10% ITM calls ≥60 DTE: +9.5% (t 1.2), and the second half lost. Express it in **shares** (or deep-ITM stock replacement); don't buy short premium on it. |
| 12-1 momentum leaders (Step 1) | weak | Positive in train/test/holdout, t 1.8, flattered by survivorship. |
| Not buying laggard dips (Step 1) | ✅ consistent | Lost in both halves across the dip-buy styles. |
| Analyst upgrades/downgrades/PT raises, short-interest squeeze, options flow (UW + Skylit) | ❌ dead | ≈ 0 against controls. |
| **Map nodes as support/resistance on single stocks** (Step 2) | ❌ **no better than random** | 2,829 touches, 35 stocks, Jan–Sep 2026: 72.2% rejection vs 75.0% for random levels. UW dark-pool levels were the same (71.6%). (On 0DTE index maps, nodes did reject ~2× random — that does not carry over to stock weekly maps.) |
| A+ plan (entry at a node, slide-in skip, 0.5-ATR close stop) | ❌ lost out of sample | −$973 on 19 trades. The map gives you a **defined level to measure risk against**, not an edge. |
| Earnings blackout; buy time; real bid/ask | ✅ cost control | UW data on 1,869 reports: earnings options are about fairly priced on average. Buying the 1-day straddle lost −19.8% and selling it lost −18.2% (spreads plus fat tails). The "80% overpriced" figure (Skylit `priced_pct`, about 1.7× UW's expected move) only describes the typical report, not expected profit. Thin chains showed fake prices. |

So the honest shape of the desk is:
- **Step 1 decides.** Insider buys are the strongest source.
- **Step 2 is risk plumbing.** It gives a level to lean on, a stop, the earnings date, and a real price. It is not confirmation.
- **Step 3** tests whether your judgment adds anything.

## Daily use

```bash
node desk/run.mjs AMD GOOGL ORCL PLTR          # evening / premarket: cards for the next session (your tickers + momentum + themes)
node desk/decide.mjs 2026-10-05 MRNA take up   # your call on each A+ card (take | pass) — do this BEFORE the open
node desk/watch.mjs                            # run during the session: 09:35 re-verify, entry/skip/exit notifications
node desk/score.mjs                            # after the close, any day: take vs pass vs undecided, real option prices
```

Options: `--momentum N` (default 15, 0 = off) · `--no-themes` · `--no-contracts` · `--date YYYY-MM-DD` ·
`--refresh-universe` (weekly; ~300 credits) — refreshes daily bars for the momentum/theme ranking.

## Cost

**Credit guard (feeds/skylit.js):**
- Every Skylit call is priced and checked *before* it is sent.
- Each run stops at `SKYLIT_BUDGET` (default 50 credits).
- All scripts together stop at `SKYLIT_DAILY_CAP` (default 200 per ET day). The ledger is `.cache/skylit_ledger.jsonl`.
- A bigger research job has to opt in, e.g. `SKYLIT_BUDGET=700 node shadow/prefetch_boards.mjs …`.
- `/v1/account` is free.


About 12 Skylit credits per run for ~28 candidates:
- the map: 1 credit per 10 stocks, for gamma and again for vanna
- Tempest IV and earnings: 1 credit per 10 stocks each
- daily bars: 1 credit per stale stock

The watcher, contracts, news and option prices all come from UW, which costs no Skylit credits.
The scorer uses 1 Atlas credit per card, and only for days not already cached.

## Files

- `find.mjs`: Step 1.
- `verify.mjs`: Step 2.
- `watch.mjs`: Step 2b.
- `decide.mjs` and `score.mjs`: Step 3.
- `common.mjs`: calendar, daily bars, features and themes.
- `journal/<date>.json`: the cards, with your decisions and triggers. `journal/<date>.md` is the readable version.

The A+ checks, entry, slide-in skip, stop and trade management all live in `system/aplus.js`. That one file is shared with the backtest (`shadow/aplus_walk.mjs`).
The scorer reproduces the walk exactly: 4 MSFT trades, identical exits, +$732.
