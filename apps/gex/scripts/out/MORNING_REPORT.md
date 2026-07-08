# Skylit Grader Backtest — Morning Status Report

**Run:** 2026-07-08 04:26 → 05:38 ET (72 min)
**Universe:** 378 Skylit tickers × 55 business days (Apr 15 → Jun 27, 2026)
**Hold window:** 5 business days walk-forward
**Data source:** Skylit `/api/data?timestamp=` (historical stock GEX+VEX, reverse-engineered from Next.js chunk 6571)
**Total trades generated:** 14,898 across 20,790 snapshot attempts
**Raw JSON:** `apps/gex/scripts/out/backtest-stocks-trades.json` (5.1 MB)

---

## The infrastructure works

1. Skylit's UI history endpoint is `GET /api/data?symbol=X&timestamp=<ISO>&max_strikes=200&max_expirations=10`. My earlier attempt using `/api/stream?date=` was wrong — that param is silently ignored. `/api/data?timestamp=` is the correct one and returns the same GEX+VEX matrix the web UI's playback shows.
2. Retention window is **~85 days** back from today (Apr 15, 2026 works; Apr 1, 2026 returns HTTP 400).
3. New `fetchHistoricalSnapshot(ticker, timestampIso)` in [heatseeker/client.js](../src/heatseeker/client.js) returns the same normalized shape as `fetchSnapshot()` — grader and backtester code paths are identical.
4. Backtest driver checkpointed to disk every 25 trades, ran 72 min, zero auth errors, zero fatal errors.

## Headline results (raw, unfiltered)

| Grade | n     | Win  | Loss | Timeout | Win rate | Decision rate |
|-------|-------|------|------|---------|----------|---------------|
| A+    | 3,424 | 1,346 | 132  | 1,946   | **91.1 %** | 43.2 %      |
| A     | 8,039 | 3,857 | 249  | 3,933   | **93.9 %** | 51.1 %      |
| B     | 3,435 | 861  | 320  | 2,254   | 72.9 %   | 34.4 %        |

Bull direction: 86.7 % · Bear direction: 92.1 %
Rug setup pattern: 93.5 % · Reverse rug pattern: 91.5 %

**These numbers look amazing.** They are also almost entirely inflated by a methodological gap.

## The uncomfortable truth

Skylit doctrine (Chapter 6) says: *"We enter at the direct tap of the major node."* Entry = the anchor node. Target = opposing anchor. Stop = one node beyond.

My backtest computes entry = anchor node, but walks forward using **current spot as the starting point**, not the anchor. In every one of the 14,898 trades, spot is already displaced from the anchor at grading time — 100 % of them. The setup was graded assuming price would first *return to the anchor* and then deflect toward target. The walk-forward never enforced that. It just checked whether spot crossed target or stop from wherever it happened to be.

Result: A bull setup with spot at $286, anchor at $270 (floor), target at $290 becomes "does AAPL move 1.3 % up in 5 days" rather than "does AAPL drop to $270 and then bounce to $290." The former is a directional bet with asymmetric distance to target vs. stop — of course it wins ~90 % of the time.

When I filter to only trades where spot was actually near the anchor at grading time (Skylit's real "direct tap" condition), the picture collapses:

| Filter | A+ n | A+ win rate | A win rate | B win rate |
|--------|------|-------------|------------|------------|
| All trades (unfiltered) | 3,424 | 91.1 % | 93.9 % | 72.9 % |
| Spot within 3 % of anchor | 69 | 73.2 % | 45.3 % | 35.5 % |
| Spot within 2 % of anchor | 18 | 45.5 % | 35.7 % | 30.6 % |
| Spot within 1 % of anchor (deflection zone) | 4 | 0.0 % | 20.0 % | 30.2 % |

At the strict Skylit "direct tap" definition (spot in the deflection zone), the grader performs at or below random on the sample we have. The whole edge came from directional bias, not from Skylit's dealer-positioning framework.

## What this means, plainly

- The grader is picking direction reasonably (bull vs bear correct ~86-92 % of the time when a ticker moves at all).
- The grader is **not** capturing the specific edge Giul's Chapter 6 doctrine claims — the deflection-off-anchor trade.
- Either (a) the doctrine's edge is smaller than promised on stocks vs. indexes, or (b) my grader isn't measuring the right thing yet, or (c) the walk-forward test needs to enforce the anchor-tap requirement before it can test the doctrine at all.

Most likely: (c) is the biggest issue. Fix that first.

## Recommended next step (v2 backtest)

1. **Only qualify snapshots where spot is within the deflection zone of the anchor.** For stocks, roughly 0.5-1.0 % of the anchor strike.
2. **Enter at anchor tap, not current spot.** Walk-forward should require spot to touch the anchor first before checking target/stop.
3. **Test tighter target distances first** — a 0.5R or 1R take-profit (RR = 0.5 or 1) instead of full opposing-anchor target. The Chapter 6 language is "target = structure, play node-to-node," but the [findings.md empirical calibration](../docs/findings.md) note on the index test showed structural targets were unreachable on median trades.

Expected v2 sample size at deflection-zone filter: ~200-800 trades over 55 days (based on how often 378 stocks tap an anchor at 09:35 ET open). Still statistically meaningful.

## What ran cleanly, no fixes needed

- Historical fetch via `/api/data?timestamp=`
- Checkpointing to disk (would have survived a crash)
- Full 378-ticker universe processed
- No auth expiries during a 72-min run
- Log at `apps/gex/scripts/out/backtest-stocks.log`, trades at `backtest-stocks-trades.json`

## To reproduce or drill down

```bash
cd apps/gex

# Full run (~72 min)
node scripts/backtest-stocks.js --days-back=55 --hold-days=5 --concurrency=5 --min-grade=B

# Small subset for iteration
node scripts/backtest-stocks.js --tickers=AAPL,MSFT,NVDA --days-back=10 --verbose

# Read the summary
tail -30 scripts/out/backtest-stocks.log
```
