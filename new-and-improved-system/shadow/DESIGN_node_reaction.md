# Do 0DTE nodes make price react more than nearby random levels? — locked design (2026-10-09, before code)

**Why:** the 2026-09-30 check (22 days, one 09:35 board/day, 17 random touches) found nodes reject 47.8% vs random 23.5%.
The Timmy test (shadow/DESIGN_timmy.md) found random levels near the live nodes traded as well as the nodes. This test
asks the plain question on more data with a fair control. If nodes don't beat the control, there is nothing at a node
to predict and Step 2 (predict bounce vs break from the approach) is not built.

## Data (same as Timmy Test 1)
Skylit 5-min 0DTE boards `apps/gex/data/skylit-archive/intraday/<d>/{SPY,QQQ}.jsonl.gz` + UW 1-min regular-session
bars `apps/gex/research/exit-study/cache_underlying/`. Days with both (2026-04-10 → 07-10, frozen holidays dropped).
A bar starting at t uses the latest board with timestamp ≤ t − 60 s.

## Levels
- **Node levels (primary):** the board's floor (strongest strong node below spot) and ceiling (strongest above);
  strong = |0DTE gamma| ≥ 50% of the king.
- **Matched random (primary control):** per board, one level 0.15–0.5% (after rounding to a whole strike) to a
  random side of the live floor and of the live ceiling, not within 0.12% of any strong node; seeded per board.
- **Fixed random (secondary control):** 2 levels per symbol-day from the opening board, 0.15–1.35% from the open
  (checked after rounding), not within 0.12% of a strong node.

## Touch and outcome
- **Touch:** previous 1-min close on one side of the level and the bar's range reaches it (low ≤ L for a level
  below, high ≥ L for a level above). The approach side is where the previous close was.
- **Outcome:** M = 0.12% of the level. From the touch bar through the next 20 bars: **reject** if price first reaches
  M back on the approach side, **break** if it first reaches M beyond the level. Both in the same bar = ambiguous;
  neither within 20 bars = stall. Ambiguous and stall touches are counted and reported but are not in the rate.
- **One open touch per level:** after a touch resolves (or stalls out), the level counts again only after a close
  ≥ M away from it. Touches whose 20-bar window would run past 15:59 are scanned only to the last bar.
- **Reject rate** = rejects / (rejects + breaks).

## Primary verdict
PASS only if all hold:
1. node reject rate − matched-random reject rate > 0, with the 95% day-block bootstrap interval (2,000 resamples of
   days, fixed seed) above 0;
2. the difference is > 0 on SPY alone and on QQQ alone;
3. the difference is > 0 in Apr–May and in Jun–Jul.

## Secondary (reported, not used for the verdict)
- node vs fixed random; floor vs ceiling; level is the king vs not; positive vs negative gamma at the level;
- stall and ambiguous rates for each group (a "reaction" might be a pause, not a reversal);
- M = 0.08% and 0.20%; horizon 10 and 30 bars;
- 1st vs later touch of the level that day.

## Run discipline
Independent audit before the single run; fixes logged below. Output `shadow/results_node_reaction/`. Research only.

## Amendments
**Amendment 1 (2026-10-09, after the independent audit, before the run).**
- Touch bar: only a move beyond the level (break) is scored on the touch bar, since a move back to the approach side on
  that bar may have happened before the touch. Reject and ambiguous are scored from the next bar. Same for the busy rule.
- Matched random: the offset level is seeded by the node strike, so it lives exactly as long as its node (not redrawn
  every 5-minute board); it is skipped on any board where it lies within 0.12% of a strong node.
- Fixed random: one level above and one below the open (as coded). Rearm after a stall at bar i + 20.
- Note: on SPY one strike (~0.15%) is just under the minimum offset, so SPY matched levels are 2–3 strikes from the node.
