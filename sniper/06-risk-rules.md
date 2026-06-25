# 06 — Risk Rules

These are non-negotiable. They override every other section.

## Daily limits

| Limit | Value | What happens when hit |
|---|---|---|
| Max snipes per day | 3 | Done for the day. |
| Max consecutive losses | 2 | Done for the day, even if it's 09:45. |
| Max daily loss | −2 % of options bankroll | Done for the day. |
| Max single-trade loss | −1 % of options bankroll | Position closed. |
| Max simultaneous open positions | 2 | Wait for one to close. |
| Max bankroll in options at once | 3 % | New triggers wait. |

"Done for the day" means *no more sniper trades* — not "do other
things." Close the platform. Touching the chart further when you've
hit a limit is how 2 % days become 8 % days.

## Per-trade invalidation

Every snipe must have, *before entry*:

- The **price level** of invalidation (the rung you traded, or the
  1m 8 EMA, whichever is closer).
- The **premium** that corresponds to a −40 % stop.
- The **time** by which the trade must be in profit or out (20
  minutes for 0DTE in the morning, 10 minutes after 14:00 ET).

If you can't name all three, don't enter.

## Calendar-aware sizing

| Day / event | Size adjustment |
|---|---|
| Monday morning | Full size after first hour; half size in first hour. |
| Tuesday – Thursday | Default sizing. |
| FOMC day | **No trades from 13:00 ET to 14:30 ET.** Resume at 14:30 if regime is clear. |
| CPI / PPI / NFP morning | **No trades before 10:00 ET.** Let the dust settle. |
| OPEX Friday | Quarter size, 0DTE only with score 5/5. Expect pinning. |
| Quad-witch Friday | **No 0DTE all day.** 1DTE only at quarter size. |
| Week of Christmas / week after | **No sniper trading.** Liquidity makes the EMA/level signals unreliable. |

## Drawdown ladder

Track running 5-trade P&L:

| Last 5 trades P&L | Action |
|---|---|
| ≥ +5 % bankroll | Continue at default size. |
| 0 to +5 % | Continue at default size. |
| 0 to −2 % | Continue at default size — small variance is normal. |
| −2 % to −4 % | **Half size** until you have 3 winners in a row. |
| < −4 % | **Stop.** Two-day cooldown. Review the journal — find the broken rule. |

The two-day cooldown is critical. Most 0DTE blow-ups are revenge
trading after a bad streak. Forcing a 48-hour gap usually reveals the
streak was emotional, not statistical.

## Sizing during a hot streak

After 5 wins in a row, **drop to half size** for the next 3 trades.
This is not superstition — it's a hedge against the inevitable mean
reversion in a high-variance strategy. If trades 6, 7, 8 are all
winners too, size back up. If 6 is a loss, you protected the streak's
gains.

## "Stuck" position rule

If a position is open and the 1m 8 EMA goes flat (price chops sideways
within ±0.05 of the EMA for 4+ candles):

- 0DTE: close half immediately, hold the other half for the time stop.
- 1DTE / 2DTE: close all. Stuck on day 1 of a 2-day trade is fine for
  swing systems but not for sniper — your edge is the immediate move
  off the rung, not the slow drift.

## Black-out periods (no trades)

- 09:30 – 09:35 ET — open vol noise
- 11:45 – 13:00 ET — lunch chop
- 15:50 – 16:00 ET — closing auction
- 13:55 – 14:05 ET on FOMC days — meeting release
- 08:25 – 10:00 ET on CPI/PPI/NFP days — release + first hour
- Any 15-minute window around scheduled Powell / Treasury speeches
- Any time SPX circuit-breaker is approached

## Position-level kill switches

Any *one* of the following closes a live position immediately, no
discussion:

- Price closes back through the rung you entered on with a body
  candle.
- 1m 8 EMA flips against you.
- Premium hits −40 % of entry.
- 0DTE clock hits 15:30 ET.
- A scheduled news event you forgot about is about to release.
- The dealer regime flips on the GEX dashboard (rare, but happens
  mid-session — usually after a big print).

If you find yourself thinking "let me see what the next candle does"
on a kill-switch trigger, you've already broken the rule.

## Mental risk — the most important section

The strategy is not the leak. The leak is:

- **Adding to losers** — there is no rule that says you can add on a
  loser. Treat *any* impulse to add as a sell signal for the whole
  position.
- **Re-entering immediately after a stop** — wait 5 minutes minimum.
  Rescore from scratch. Most "second chance" re-entries are
  emotional.
- **Trading without a posted ladder** — you fabricated levels in your
  head, which means the system you backtested isn't the one you're
  running.
- **Trading outside the time windows** — sniper is a focused tool,
  not an all-day attention drain. If you're staring at the chart at
  16:30 looking for "one more setup," walk away.

A 1 %-bankroll-per-trade strategy can survive 20 losses in a row at
default sizing. The math is forgiving. *You* are the variable.
