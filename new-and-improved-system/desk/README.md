# The desk — find a stock, verify it with Skylit, you decide, it scores

Decision support, not an autotrader. It never sends orders.

Every backtest (`shadow/reports/STOCK_SELECTION_FINDINGS.md`, Rule 1 and A+ out-of-sample) says the same thing:
the Skylit map tells you **where** — level, room to target, invalidation — but not **which way**.
So the desk gives each tool only the job it has passed:

| Step | Job | Source | Evidence |
|---|---|---|---|
| 1 find | which stock, which side | your tickers · 12-1 momentum leaders · hot-theme leaders; laggards (weaker than SPY 20d) never bought | 12-1 is the only ranker positive in train/test/holdout (weak); dip-buys in laggards lost in both halves |
| 2 verify | where, how much room, where wrong, what to buy | live gamma map (A+ rubric, exact failing reason) · Tempest earnings + IV rank · UW quotes for a contract 2–7 weeks out | nodes reject ~2× random; slide-in skip cut out-of-sample losses 75%; 8/13 losers were stopped too tight; options overprice earnings 80% of the time |
| 2b watch | the entry and exit alerts | re-check at 09:35 on the live map, then UW 1-min bars | the backtest used the 09:35 map; weekend maps drift |
| 3 decide + score | does your judgment beat the list? | your take/pass + mechanical scoring with the backtest's own code | — this is the open question |

**No part of this is a proven edge.** The A+ plan with these defaults lost money out of sample (−$973 on 19 trades).
The desk exists to test the one thing we haven't: whether **your** picks from the list beat the list.

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
