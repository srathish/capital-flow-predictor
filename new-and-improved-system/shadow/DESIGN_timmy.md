# Timmy hunt / raked entry B on SPY + QQQ — locked design (2026-10-09, before any code or results)

**Question.** Does "wait for the stop hunt, enter on the reclaim" make money on our index data, and does the *level*
matter (Skylit 0DTE node or classic level) versus a random level with the same entry?

Source: raked's MNQ journal (community repo, members/raked/mnq-gamma-node, Jul 13 – Sep 30 2026): entry B = price taps a
node, sweeps through it, and a 3-minute candle closes back on the right side within 15 minutes; enter at that close;
stop beyond the sweep. 92 trades, +1.34R. His rules are used **as written** (NQ points converted to % of price at
NQ ≈ 30,000: 1 NQ pt ≈ 0.0033%). Nothing is tuned on our data, so every result below is out of sample for his rules.

## Test 1 — nodes (SPY and QQQ, 0DTE)

- **Data:** Skylit 5-minute 0DTE archive `apps/gex/data/skylit-archive/intraday/<d>/{SPY,QQQ}.jsonl.gz`
  (2026-04-10 → 07-14; holidays with frozen spot dropped) + UW 1-minute bars
  `apps/gex/research/exit-study/cache_underlying/{SPY,QQQ}_<d>.json` (regular session only). Days = dates with both.
- **No look-ahead:** a bar starting at time t uses the latest board with timestamp ≤ t − 60 s.
- **Nodes:** king = strike with the largest |0DTE gamma|; strong node = |gamma| ≥ 50% of king (raked STRONG).
  **Floor** = strongest strong node below spot, **ceiling** = strongest strong node above spot (the king is one of them).
  The traded levels at any minute are that board's floor and ceiling.
- **Tap:** long setup when the previous 1-min close is above the level and the bar's low ≤ level (mirror for short).
  After a tap the level must be left by ≥ 0.10% before another tap on it counts (rearm).
- **Sweep:** after the tap, price trades beyond the level by ≥ 0.01% (≈ 3 NQ pts).
- **Reclaim / entry:** 3-minute candles on the 09:30 ET grid. The first 3-min candle that ends ≤ 15 min after the tap
  bar's start, contains or follows the sweep, and closes back on the right side of the level → enter at its close.
  No entries on candles ending after 15:54.
- **Stop:** sweep extreme (most extreme price from the tap to the entry) beyond by 0.0033%, and at least 0.0165% beyond
  the level (raked's "≥ 5 pts from the node"). Skip if entry-to-stop > 0.165% (raked MAX_STOP 50 pts).
- **Target:** the next strong node beyond the entry in the trade direction (other than the tapped level) on the entry
  board, exit 0.0033% before it. Skip if there is none or if reward < 1R.
- **Exit:** stop, target, or 15:55 close. If one bar touches both stop and target, count the stop.
- **Costs:** $0.01 per side on SPY and QQQ, inside R. R = signed P&L / (entry − stop).
- **Random baseline:** per symbol-day, 2 random integer-strike levels drawn at the open (fixed seed), 0.15–1.35% from
  the open price, one above and one below, not within 0.12% of any strong node on the opening board. Same tap /
  sweep / reclaim / stop rules; target = the next strong node beyond entry exactly as for real nodes.

### Primary verdict (Test 1)
PASS only if all three hold:
1. node trades: mean R > 0 with a day-clustered t ≥ 2.0;
2. node mean R > random-level mean R;
3. node mean R > 0 on SPY alone and on QQQ alone.

### Secondary (reported, never used to pick the verdict); each shown for Apr–May and Jun–Jul separately
- raked R1 king behind the trade (king on the opposite side of entry from the target) vs not;
- R2 fast approach: > 0.13% move toward the level in the 5 min before the tap (≈ 40 NQ pts) vs not;
- R3 the level already produced 2 stopped trades today vs not;
- R4 symbol's total 0DTE gamma > 0 vs ≤ 0;
- co-pin: the other symbol is within 0.10% of its own floor/ceiling at entry vs not (raked found co-pin *worse*);
- 1st vs 2nd vs later tap of that level that day;
- management: half off at +2R then rest to target; breakeven stop after +1R;
- cap of 3 trades per symbol per day;
- why stops fail: target reached later that day / reached ≥ +1R first / stopped within 2 min / slow.

## Test 2 — classic-level Timmy hunts (SPY, 2023-01 → 2026-10, no gamma needed)

- **Data:** `new-and-improved-system/.cache/uw/spy1m/<d>.json` (UW 1-min, m = pr/r/po).
- **Levels (fixed at 09:30):** prior day regular-session high and low; today's premarket (pr bars before 09:30) high
  and low. Long setup if the level is below price at the tap, short if above (same tap rule as Test 1).
- **Entry and stop:** identical to Test 1. **Target:** fixed 2R; otherwise exit at 15:55 close.
- **Random baseline:** per day, 4 random levels at the 09:30 open ± 0.1–1.5% (two above, two below, fixed seed), not
  within 0.05% of a real level. Same rules.

### Primary verdict (Test 2)
PASS only if: mean R > 0 with day-clustered t ≥ 2.0, AND mean R > random-level mean R, AND mean R > 0 in at least
3 of the 4 calendar years 2023, 2024, 2025, 2026.

### Secondary
- per level type (prior high, prior low, premarket high, premarket low);
- Glitch's rule: "HTF liquidity swept / LTF counter-trend = high risk". A trade is *counter* if earlier that day a
  prior-day level was swept-and-reclaimed in the opposite direction (e.g. prior-day low hunted then reclaimed = bullish;
  a later short is counter). Report counter vs with vs none;
- Wicksy's "Timmy hunt the lows = bullish": after a premarket-low hunt+reclaim, SPY open-to-close vs other days.

## Run discipline
- Independent audit of the script against this file before the single run; findings fixed first.
- One run; output to `new-and-improved-system/shadow/results_timmy/`. Script refuses to re-run unless `--force`
  (allowed only for audit-identified bug fixes, logged below).
- Research only: no changes to any live system.

## Amendments
**Amendment 1 (2026-10-09, after the independent audit, before the run).**
- Test 1 primary condition 2 now requires node mean R > BOTH random baselines: (a) the fixed-at-open random levels above,
  and (b) a **matched random** control: for every board, a level 0.15–0.5% (after rounding to a whole strike) to a random
  side of the live floor and of the live ceiling, not within 0.12% of any strong node, seeded per board; same rules and
  targets. Reason: fixed-at-open levels are only reached on big-move days, which makes (a) easy to beat. Each baseline
  must have ≥ 1 trade.
- Fixed-at-open random levels: distance checked after rounding to a whole strike.
- R1 "king behind" counts the case where the tapped level is itself the king and sits behind the entry.
- A stop gapped through fills at the bar open; the +2R half pays slippage; rearm uses the previous bar's close;
  the R2 lookback is exactly 5 minutes; the clustered t uses the small-cluster factor √(G/(G−1)).
- Test 2: half days (< 300 regular bars) dropped; levels sharing a price keep both labels; Test 2 partial-exit row
  removed (meaningless with a 2R target). Wicksy check = premarket-low hunt+reclaim before 10:30, signal → 15:55 move,
  compared with 10:00 → 15:55 on the other days.
- Test 1 data ends 2026-07-10 (no UW bars cached for 07-13/07-14). All Test 1 secondaries reported split by period.
