# Charts-First 0DTE — SPXW 2026-06-18 (BLIND out-of-sample)

Session `cf0618`. Paper/research only. Method: price action forms the thesis, GEX only confirms; be selective; cap 0DTE winners; exit fast when the chart thesis breaks.

## Day character
Gap-up open (+0.76%), a first-5-min spike to 7507, then a relentless **negative-gamma-but-pinned range** for ~5 hours. The 7500 strike dominated as a giant barney (grew from -30M to -126M through the day); price oscillated 7477–7510 with a heavily-defended pika floor that kept rebuilding at 7495. Only **two genuine directional moves** occurred: a ~1pm breakout to a new high (7510.5), and a ~3pm flush (7500 → 7480) once the floor fully collapsed. Everything else was chop that faked out every edge test.

## Trades (4 — real 1-min option prints, net = exit·0.985 / entry·1.015 − 1)

### Trade 1 — LONG (FAIL) · 10:58→11:01 ET
- **Chart:** 6-min ascending coil, higher lows (7477>7482>7489>7493>7496) pressing flat 7500 resistance; momentum turning up; above VWAP → bullish continuation pressing a breakout.
- **GEX confirm:** deep neg-gamma (-88M); a break of the 7500 barney (-36M) should force short-gamma dealers to chase. **BUT the wall was still directly overhead** (no clear-air node flip) — a partial signal.
- **Outcome:** 6th rejection at 7500; break never held. Cut the scratch fast (underlying −1pt). Contract SPXW260618C07500000. Entry **$14.70** → exit **$11.40** → **net −24.74% LOSS**.

### Trade 2 — LONG (WIN) · 13:15→13:20 ET
- **Chart:** fresh afternoon push 7494→7506 (+11pts), then a 6-min tight bull flag holding the day high without fading — coiled to break 7507 into clear air.
- **GEX confirm (clean):** overhead node **flipped from the 7500 barney to a 7520 pika** = clear air; price above the huge 7500 barney (-74M) = upside fuel; strong 7495 pika floor beneath. The structurally clean version the morning break lacked.
- **Outcome:** broke to a new day high 7510.5; capped into the stall at the node per rule (price faded right after). Contract SPXW260618C07505000. Entry **$9.20** → exit **$10.50** → **net +10.76% WIN**.

### Trade 3 — SHORT (FAIL) · 14:39→14:45 ET
- **Chart:** sustained breakdown — 4 lower closes below the 7495 pika and below VWAP; price at the recent low; held 2+ min (not the instant-bounce fake of 14:17).
- **GEX confirm:** net gamma deepest so far (-134M); 7500 barney overhead. **BUT the pika floor only relocated to 7425 — it did not vanish**, and it then rebuilt to +43M → partial/ambiguous signal.
- **Outcome:** flush never came; price ground back UP to my 7495 stop; cut for a small underlying loss (+2.5pt against). Contract SPXW260618P07490000. Entry **$5.09** → exit **$3.50** → **net −33.27% LOSS**.

### Trade 4 — SHORT (WIN) · 15:06→15:13 ET
- **Chart:** real 3-candle breakdown 7498.8→7489.3 (−9.5pts) below VWAP, price actively falling.
- **GEX confirm (clean):** the pika floor was now **completely gone — "NONE, no support under price"** (vs merely relocating at 14:39); net gamma spiked to an extreme −167M; 7500 barney overhead as resistance. Late-day, zero support below = high flush potential.
- **Outcome:** flushed 7489→7483; capped into the 7480 barney (next opposing node), which then bounced price — good timing. Contract SPXW260618P07490000. Entry **$6.20** → exit **$8.30** → **net +29.91% WIN**.

## Totals
| # | Side | ET | Contract | Entry | Exit | Net |
|---|------|-----|----------|-------|------|-----|
| 1 | long | 10:58→11:01 | 7500C | 14.70 | 11.40 | **−24.74%** |
| 2 | long | 13:15→13:20 | 7505C | 9.20 | 10.50 | **+10.76%** |
| 3 | short | 14:39→14:45 | 7490P | 5.09 | 3.50 | **−33.27%** |
| 4 | short | 15:06→15:13 | 7490P | 6.20 | 8.30 | **+29.91%** |

- **Record:** 2 wins / 2 losses.
- **Winners:** +40.67% combined. **Losers:** −58.01% combined.
- **Sum of per-trade net returns: −17.34%** (≈ −4.3% avg / trade; ≈ −4.3% on capital if equal-sized across the 4).

## Self-assessment
**Direction was excellent — charts-first caught BOTH of the day's only real moves** (the 1pm breakout up and the 3pm flush down); both were winners, both capped well at the next node with good timing. On a 5-hour pin, correctly identifying the two transitions OUT of the pin is the whole game, and that part worked.

**But the day still lost money, and the reason is the honest lesson:**
1. **0DTE ATM option asymmetry punished the two chop trades brutally.** I cut both losers "small" on the *underlying* (−1pt and +2.5pt against), yet they cost **−25% and −33%** on the ATM contracts because theta/gamma near the money plus the −3% round-trip slippage haircut are savage over a few minutes. Meanwhile disciplined winner-caps returned only +11% and +30%. A 50% hit rate loses when losers are ~1.5–3× the winners.
2. **The discriminating signal was structural completeness, not price alone.** The two WINNERS each had an *unambiguous regime shift* — the overhead node flipping to clear air (long), and the floor vanishing entirely to "NONE" (short). The two LOSERS had *partial* signals — the wall still overhead (T1), the floor merely relocating to 7425 rather than disappearing (T3). Every partial-signal break on this pin day faked out.
3. **Actionable correction:** on a strongly-pinned negative-gamma day, require the FULL structural confirmation (node flip to clear air / floor to "NONE") before taking a break, and skip "confirmed price break with the wall/floor still structurally intact." Filtering trades 1 and 3 out would have left **only the two winners: +40.67%.** Fewer trades, not more.

Charts-first read the *day* right; the leak was selectivity on the two lower-quality setups, amplified by 0DTE option mechanics.
