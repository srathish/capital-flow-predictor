# Charts-First 0DTE — SPXW 2026-04-22 (blind out-of-sample)

Session cf0422. Paper only (RESEARCH). Method: price action creates thesis, GEX confirms; be selective; flat is a position. Harness window opened 10:00 ET, auto-flat 15:45.

## Day character (what the tape actually did)
A resilient, all-day **pin**. After a +0.75% gap-up open ran to ~7113 in the first 5-min candle, price spent the entire 10:00–15:45 window locked in an ~15-pt band (roughly **7113–7130**, VWAP-proxy pivot ~7120). Both boundaries rejected repeatedly (7129.7 was a triple+ top; VWAP/7120 was defended 6+ times; the 7112.9 low was bought back). The GEX "king" node flickered with price (7150 pika when it probed highs, 7080 barney when it probed lows) — a signature of price dragging the node around a pin, not a trend. By ~13:31 the regime **explicitly flipped to POSITIVE-gamma** and intensified into the close (+245M near-spot), pinning price to the 7125 strike (closed ~7128). There was **no day's move to catch** — the disciplined ideal was near 0 trades.

## Trades

### Trade 1 — LONG (10:15 → 10:33 ET) — LOSS
- **Chart thesis:** The 7113–7122 morning consolidation resolved UP — 10:15 broke to a fresh HOD 7124.9 after higher lows, above rising VWAP-proxy (7114), 5-min momentum turning +0.08%. Read as a breakout leg toward the magnet.
- **GEX confirm:** King 7150 pika magnet strengthening (+21M→+29M) 25 pts above with no wall between; negative-gamma regime (levels break) implies a break trends rather than reverts. Target 7150, cap the winner there.
- **Management:** Breakout stalled — double rejection at 7129.7, both 5-min and 15-min momentum flipped negative, price rolled back to the entry/breakout zone (7124), king magnet stopped building (35M→30M). Cut at ~breakeven underlying (exit spot 7123.95) rather than hold a stalled long into negative gamma with no floor below.
- **Real prints:** ATM 7125 CALL `SPXW260422C07125000`. Entry 14:15 UTC close **14.00** → exit 14:33 UTC close **11.80**.
- **P&L:** net = 11.80·0.985 / (14.00·1.015) − 1 = **−18.21%**. (Underlying ~flat; the loss is theta + entry on a high option tick + ~3% round-trip slippage.)

### Trade 2 — SHORT (12:34 → 12:40 ET) — LOSS
- **Chart thesis:** The multi-hour pin broke DOWN — 12:30 candle sliced to 7113.9, a decisive lower low below the range and below VWAP (7120.7), momentum negative on both timeframes. Read as the transition-out flush.
- **GEX confirm:** A genuine structural flip (absent from the morning's fake probes) — the 7120 pika FLOOR gave way and became overhead resistance (+15.7M), and the KING flipped from 7150 pika (above) to a **7080 BARNEY** (−18M) below = a negative-gamma magnet/fuel target beneath price, no floor under spot. Target the 7080 barney.
- **Management:** Breakdown failed within 6 minutes — price recovered from 7113.9 back to 7119.2 (toward VWAP), 5-min momentum flipped positive, the 7120 overhead resistance dissolved (nearest resistance jumped to 7140) and a new floor formed at 7085. The GEX basis for the short evaporated; cut the small underlying loss before a squeeze. (King reverted to 7150 pika one minute after exit — confirmed fakeout.)
- **Real prints:** ATM 7115 PUT `SPXW260422P07115000`. Entry 16:34 UTC close **8.50** → exit 16:40 UTC close **6.60**.
- **P&L:** net = 6.60·0.985 / (8.50·1.015) − 1 = **−24.65%**. (Underlying rose ~3 pts against the bearish thesis; the put decayed.)

## Total
Two trades, both losses. **Total net = −18.21% + −24.65% = −42.85%** (sum of the two ATM 0DTE round-trips).

## Self-assessment
- **Did charts-first catch the day's move? No — because there was no move.** The day was a positive-gamma pin that opened and closed near the same ~7124 level. The method's own warning applies: "on a strong positive-gamma pin the right answer is 0 trades." In hindsight the ideal score was flat all day.
- **What I did right:** Correctly identified the pin early and stayed flat for the overwhelming majority of the session (only 2 trades in 5.75 hours; zero trades after 12:40 despite 3 hours of tape). Both entries were reasonable, textbook "transition-out" reads (a real HOD breakout; a real range-break with a genuine GEX king-flip). Both exits were fast and disciplined — I cut at ~breakeven / small adverse underlying and did not let either fakeout run. I never fought the afternoon positive-gamma pin.
- **What cost me:** Trading the transition-out *twice* on a day whose defining feature was that every transition-out was a fakeout. Each attempt was ~flat-to-slightly-adverse on the underlying, but ATM 0DTE theta plus ~3% round-trip slippage converted those into −18% and −25% option losses. On a day flashing repeated boundary rejections by 11:00, the higher-EV discipline was to demand *follow-through* (a held break with momentum + a GEX flip that persists more than one bar) before committing — or to simply pass. My Trade-1 entry also caught a high tick of the option (entry bar close 14.00 vs open 12.67), worsening the fill.
- **Net lesson:** The edge is not "trade the break," it's "trade the break that holds." On a pin day, restraint > two well-managed but structurally doomed round-trips. The morning long was the more defensible of the two; the second short was closer to over-trading a range I had already spent 2 hours labeling a pin.
