# Charts-First 0DTE Trader — SPXW 2026-06-22 (blind out-of-sample)

Session: cf0622 · Paper only (RESEARCH). Method: price action creates the thesis, GEX only confirms; be selective; cap 0DTE winners; sit out the pin.

## Day in one paragraph
Open 7500.58. Price ground UP to 7528 and stalled there four times (09:35 / 10:00 / 10:10 / 10:11) with the regime oscillating around net-zero gamma. It rolled off that exhaustion top, and at ~10:25-10:30 broke the 7500 open and 7495 floor into the **deepest negative-gamma stretch of the day (-23M)** with the sub-7495 pika floor evaporating — a clean flush-through-support that ran 7528 → **LOD 7463.71 by ~10:55** (the day's move). From ~11:00 on, positive gamma took over and steadily intensified (from +6M to an extreme **+128M** into the close), pinning price in a tight 7463-7490 box for the entire afternoon and settling near the lows (~7465). Net: a morning flush, then an all-afternoon pin.

## Trades (all SHORT / puts; scored on strict 1-min option closes, ET+4=UTC)
Scoring formula: net = exit×0.985 / (entry×1.015) − 1 (3% round-trip cost baked in).

### Trade 1 — SHORT (fade exhaustion top)
- **Chart thesis:** 4x rejection at 7528; lost VWAP-proxy (7521) on two consecutive red candles with worsening momentum (5m −0.08%, 15m −0.13%) = exhaustion-top rollover.
- **GEX confirm:** no support until the 7505 barney / 7495 pika below (~13-23pt air), nothing overhead until 7540; positive-gamma at the moment = the 7528 top holds as resistance backing the fade.
- **Fill:** entry 10:17 ET (14:17 UTC) spot 7518.30 → exit 10:22 ET (14:22 UTC) spot 7512.80. Underlying **−5.5 pt (favorable)**.
- **ATM contract:** SPXW260622P07520000. Entry close 17.10 → exit close 18.40.
- **Real P&L: +4.42%** (win). Underlying rolled over as read; short 5-min hold still cleared the entry spike.

### Trade 2 — SHORT (flush through support, the day's move)
- **Chart thesis:** decisive breakdown to new LOD — broke the 7500 open and 7495 support on accelerating downside (15m −0.35%), below VWAP all session.
- **GEX confirm (strong):** deepest negative gamma of the day (−23M); the 7495 pika floor evaporated, next support all the way down at 7425 = ~70pt air pocket; 7500 barney flipped to overhead resistance.
- **Fill:** entry 10:30 ET (14:30 UTC) spot 7495.25 → exit 10:35 ET (14:35 UTC) spot 7484.80. Underlying **−10.5 pt (favorable)**.
- **ATM contract:** SPXW260622P07495000. Entry close 22.00 → exit close 20.00.
- **Real P&L: −11.78%** (loss). Direction correct, but the entry landed on the 14:30 spike close (put ran 16.60→22.00 inside that minute); the 5-min hold + 3% cost left it net negative even though the underlying kept falling to 7463 over the next ~20 min.

### Trade 3 — SHORT (fade failed bounce / lower high)
- **Chart thesis:** grind-up stalled at 7490.7, rejected and closed on its low (7484) below VWAP — a lower high in the day's downtrend; 5m momentum turned negative.
- **GEX confirm:** very strong 7500 King barney (−21M) caps upside; positive gamma = the bounce fails; target the 7450 pika floor. (Flagged in advance: positive-gamma dampening → modest target.)
- **Fill:** entry 11:49 ET (15:49 UTC) spot 7484.01 → exit 11:52 ET (15:52 UTC) spot 7477.37. Underlying **−6.6 pt (favorable)**.
- **ATM contract:** SPXW260622P07485000. Entry close 19.50 → exit close 16.70.
- **Real P&L: −16.89%** (loss). Same artifact: entry on the 15:49 spike close (put ran 11.80→19.50 inside the minute), quick 3-min mean-reversion + cost. Underlying moved my way but the fill was the minute's high.

## Totals
- Trades: 3 (all shorts). Directionally correct on the underlying: **3/3**.
- Real P&L each: **+4.42% / −11.78% / −16.89%**.
- **Total (sum of net): −24.25%.** (Compounded: −23.4%.)
- Afternoon (11:53 → close): **0 trades** through the extreme positive-gamma pin — correct per method.

## Self-assessment
**Did charts-first catch the day's move? Directionally, yes — cleanly.** I read the 7528 exhaustion top, was short into the negative-gamma flush that defined the day (7528 → 7463), faded the failed 7490 bounce, and — the highest-value call — stood completely aside through the entire afternoon +128M positive-gamma pin instead of round-tripping it. Regime reads matched price the whole way (neg-gamma while it trended down, extreme pos-gamma while it pinned).

**Why the scorecard is red despite a correct read:** every entry was placed at the 1-min *close of the confirming minute*, and on decisive 0DTE moves that close has already spiked to price in the move (T2 put 16.60→22.00, T3 put 11.80→19.50 *within* the entry minute). I paid the spike, then my "cap fast into the next node" discipline exited after only 5-6 minutes — before the underlying's continued follow-through could overcome the elevated entry premium plus the 3% round-trip cost. The one trade I held past the entry-spike into fresh downside (T1) was the only winner.

**Lesson for this harness:** on a confirmed flush, the correct-direction edge is real but the fill is poor if you enter *at* the confirming minute and exit within a few minutes. The fix is not more trades — it's (a) entering on the setup a beat earlier (anticipate the break, don't confirm it after the candle has already run), and/or (b) holding the flush trade materially longer so the trend (T2 continued 7484→7463 over the next ~20 min) pays for the entry premium and slippage. My exits were too tight relative to the premium I paid to get in. Selectivity and the flat-all-afternoon call were exactly right; entry timing and hold duration were the miss.
