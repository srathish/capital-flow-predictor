# 08 — Pre-trade Checklist

Print this. Tape it next to your monitor. Run through it before every
single snipe. Sixty seconds, no shortcuts.

## Morning (once, 09:25 ET)

- [ ] Today's Rapid ladder loaded for SPY (and QQQ if posted).
- [ ] Pivot identified. Bull rungs + bear rungs all noted.
- [ ] `apps/gex` summary read for both tickers:
  - Net GEX sign + magnitude
  - Gamma flip
  - Largest call wall ± 2%
  - Largest put wall ± 2%
  - Vanna regime
- [ ] Calendar checked — any FOMC / CPI / PPI / Powell / earnings
      that affect SPY/QQQ today?
- [ ] OPEX status — is this an OPEX Friday or quad-witch?
- [ ] Black-out windows noted on a side panel.

If any of the above can't be answered, **no sniper trading today.**

## Per-trade (60 seconds, at every rung touch)

### Location

- [ ] Price is at a **published rung** (not an inferred one).
- [ ] Which rung type? (reclaim / break / failure / breakdown /
      rejection)

### Confirmation

- [ ] **Body close** past the rung on the 1m chart (not just a wick).
- [ ] **Retest hold** — price came back to the rung and held.

### Stack

- [ ] 1m 8 EMA is on the correct side of price.
- [ ] 5m 8 EMA vs 5m 21 EMA is aligned with the trade direction.
- [ ] 15m stack noted (for sizing, not veto).

### Regime

- [ ] GEX regime supports the trade (or at least doesn't veto it).
- [ ] Wall exists at/near the next target rung (mechanical TP target).

### Veto

- [ ] Current time is *not* in a black-out window.
- [ ] No news event is releasing within the next 20 minutes.

### Plan

- [ ] DTE chosen (0 / 1 / 2).
- [ ] Strike chosen (per `05-execution.md` table).
- [ ] Size in dollars decided.
- [ ] **Invalidation level** written down (rung or 1m 8 EMA).
- [ ] **TP1** rung named.
- [ ] **Time stop** (e.g., 20 minutes from now) written down.

### Score

- [ ] Score totaled: ___ / 5.
- [ ] Action threshold met for the chosen DTE?

If any of the **Confirmation**, **Stack**, **Veto**, or **Plan**
items is blank, do not enter. If the score is 3 and you're holding
a 0DTE in your hand, you are about to break a rule.

## Post-trade (90 seconds, after exit)

- [ ] Logged to journal:
  - Time in / time out
  - Rung type
  - Score
  - DTE / strike / delta at entry
  - Entry premium, size
  - Exit reason + exit premium each leg
  - P&L net of fees
- [ ] One sentence: what was the *one thing* I'd want to remember
      about this trade in 6 months?
- [ ] Daily counters updated:
  - Trades today: ___
  - Daily P&L: ___ %
  - Consecutive wins/losses: ___
- [ ] Any daily limit hit? If yes, close the platform. Now.

## End-of-day (15:30 – 16:00 ET)

- [ ] All 0DTE positions flat by 15:30.
- [ ] Open 1DTE / 2DTE positions reviewed — does the thesis still
      stand for overnight? If not, close.
- [ ] Today's journal entries pushed to `apps/api`.
- [ ] Tomorrow's calendar checked (FOMC etc.).
- [ ] If down >2 % today, write one paragraph: what broke? Stop
      trading for the next session even if it's a recovery day.

## Weekly review (Sunday, 30 min)

- [ ] Pull last week's trades from the journal.
- [ ] Hit rate by rung type.
- [ ] Hit rate by score.
- [ ] R-multiple distribution.
- [ ] Black-out / news-window violations.
- [ ] Were there trades I took that didn't pass the checklist?
- [ ] Were there trades I skipped that would have been A+ wins?
      (Selection bias trap — only count true checklist-pass skips.)
- [ ] One thing to do better next week. One only.

## Red flags — any of these = stop

If you catch yourself:

- Counting on a single trade to "make up" earlier losses
- Watching the chart outside trading windows
- Lowering your score threshold "just for this one"
- Holding past the time stop because "it looks good"
- Adding to a losing position
- Trading without a posted ladder
- Re-entering the same rung within 5 minutes of a stop

… close the platform. Walk away. This system survives losing streaks.
It doesn't survive its operator going on tilt.
