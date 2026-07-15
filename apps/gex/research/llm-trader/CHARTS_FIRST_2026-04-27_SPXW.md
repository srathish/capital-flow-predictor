# Charts-First 0DTE — SPXW 2026-04-27 (session cf0427, BLIND out-of-sample)

Paper only (RESEARCH, Clause 0). Charts-first discretionary. One position at a time, auto-flat 15:45.

## Day in one line
A **strong positive-gamma pin day**. SPX opened ~7165 and spent the entire session inside a ~28-pt
range (7147.88 - 7176.05), magnetized to a 7160 pika king that grew relentlessly (+56M → +138M).
One false-breakout impulse at 13:30 (through the all-day 7167 ceiling to 7175) faded and the pin
re-asserted at a slightly higher level (~7172-7175). Close ~7174, +0.13% on the day. Essentially flat.

## Method application
- Stayed **flat for 99% of the session** — the correct answer for a strong positive-gamma pin
  (theta+costs punish round-trips; the pin itself is untradeable). Fast-forwarded the dead tape,
  dropped to 1-3 min only at the range boundaries where a transition could start.
- Both range extremes rejected every test all day (day-low 7150.73 held on a false break at 11:20;
  day-high 7167 capped every rally until 13:30). Each excursion reverted to the 7160 pin — I did not
  chase the mean-reversion scalps (thin, into the pin, cost-negative).
- Took the **one** trade the method waits for: the transition OUT of the pin.

## Trade 1 — LONG (ATM 7175 call) — LOSS

- **Entry:** 13:33 ET (17:33 UTC) · spot 7173.21 · ATM strike 7175 · OCC `SPXW260427C07175000`
- **Exit:** 13:39 ET (17:39 UTC) · spot 7172.21
- **Chart thesis:** decisive breakout above the all-day ceiling 7167 (which capped every test since
  the open) to a fresh session high 7173 on 3 accelerating green candles (7163→7173 in 15m), 15-min
  momentum the best of the day (+0.11%), price above VWAP 7160.
- **GEX confirm:** the monster positive-gamma pin was **collapsing** (+203M → +88M) = the method's
  "collapsing pin = fuel"; 7160 pika now a floor ~13pts below; a barney (-34M, neg gamma) at 7175
  that turns to acceleration fuel if breached, opening the air pocket to 7200.
- **Management / exit:** price stalled at the 7175 barney (rejected twice, barney strengthened to
  -43M), 5-min momentum turned negative, and — decisively — the 7160 king began **re-building**
  (+95M → +108M, 1mΔ +4.3, money flowing back into the pin). The collapsing-gamma fuel reversed, so
  I exited on "confirming regime flips" rather than wait for a full failed-breakout reversal to 7160.
- **Real P&L (1-min option closes):** entry 6.80 → exit 4.40.
  net = 4.40·0.985 / (6.80·1.015) − 1 = **−37.21%**.
- **Why the loss was large despite only a −1 pt underlying move:** I bought the ATM/slightly-OTM
  0DTE call right at the **peak of the breakout pop** (the call spiked 5.90→6.80 on the impulse minute).
  When the breakout immediately stalled, delta+vega+theta deflated the premium from 6.80 to 4.40 in
  six minutes even though the underlying barely moved. Exiting on the regime-flip prevented a worse
  loss — had I held to the 7160 pin the call would have decayed toward ~0 (it printed 0.05 at the close).

## Totals
- Trades: **1** (1 loss, 0 wins)
- Total P&L: **−37.21%** (single trade)
- Time flat: ~99% of the session

## Self-assessment (candid)
- **Regime read: correct.** Diagnosed the strong positive-gamma pin early, stayed flat through the
  chop, and did not over-trade the four range-boundary tests. On a pin day, 0 trades is the target and
  I was 1 trade away from it.
- **The one trade was a defensible but losing marginal call.** It was method-consistent in spirit
  (act only on the transition out of the pin, chart thesis first + GEX confirm), and the exit
  discipline was good — I got out on the regime-flip before the underlying reverted, capping the loss.
- **The stricter reading was 0 trades.** The method's ideal breakout-long wants a **flip to negative
  gamma**; at my entry net gamma was +88M — collapsing but still solidly **positive**, never flipped
  negative. The price break of 7167 was real but shallow, and the overhead 7175 barney was a live
  rejection node, not yet breached. A purer application waits for a close *above* the barney AND a
  negative-gamma flip — neither happened, so the pin re-asserting was the base case. This was a
  false breakout in a regime that never actually left positive gamma.
- **Key lesson:** on a strong-pin day, even the "transition" trade is a trap when gamma only drains
  without flipping negative. And in 0DTE, entering at a breakout pop means paying peak IV/premium —
  a stall alone (not even an adverse underlying move) craters the option. Charts-first correctly
  called the day (a flat pin) and correctly stayed out of the chop; it did not profit because the
  day's only directional impulse was a fakeout, and the one attempt to catch it paid peak premium.
- **Did charts-first catch the day's move?** There was no move to catch — the day was a flat pin.
  Charts-first got the regime right (flat/pin, stay out) but lost −37% on the single false-breakout
  attempt. Net: right diagnosis, wrong (marginal) trade.
