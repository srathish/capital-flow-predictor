# Charts-First 0DTE — SPXW 2026-05-26 (blind out-of-sample)

Discretionary charts-first paper trading. Price action makes the thesis; GEX only confirms.
Prices below are real SPXW option 1-min closes (UW intraday, ET+4=UTC). net = exit*0.985 / (entry*1.015) − 1.

## Day shape (what the tape did)
- Gap-up open (+0.69%), rally to 7539 by ~10:38, then a **strong positive-gamma pin** (net gamma peaked +102M) grinding 7530–7539 through late morning — untradeable, sat it out.
- **~11:00 transition OUT of the pin:** double-top rejection at 7538–39, VWAP (7528) break, regime flipped to NEGATIVE gamma → the day's one real down-leg, 7538 → 7500 over ~55 min. This is where 0DTE moves and where I traded.
- Afternoon: repeated failed tests of a very strong **7500 barney magnet** (deepened to −70M), a tight 7500–7517 range, then a positive-gamma pin into a 7510/7520 close. Mostly chop; one countertrend long attempt failed.

## Trades

### 1 — SHORT (put 7525) · 11:05 → 11:26 ET · WIN +17.0%
- **Chart:** rejected the 7538–39 double-top, 5 declining candles rolled price through VWAP (7528) to 7525; 5m/15m momentum turned down. Down thesis.
- **GEX confirm:** regime flipped +65M → NEGATIVE gamma (levels break = fuel); 7555 pika overhead ceiling; air below to the lone 7480 floor.
- **Manage:** slow bleed; 7518.7 breakdown low held and bounced, 5m momentum flipped +, neg gamma drained −15M→−6M → banked before round-trip.
- **Real P&L:** entry 11.20 → exit 13.50 → **+17.0%**.

### 2 — SHORT (put 7510) · 11:37 → 11:57 ET · WIN +24.4%  ← trade of the day
- **Chart:** clean downtrend (LH/LL 7521→7518→7516→7510), below VWAP, 11:35 broke 7516 with a −6pt candle closing at its low.
- **GEX confirm:** neg gamma intensified to −42M; king flipped to a **barney at 7500** (downside magnet, not support); air to 7480. Stronger confirm than trade 1.
- **Manage:** mistimed the exact entry (bounced to 7516 first) but 7516 retest rejected, structure re-asserted, then price accelerated into 7500 (−52M gamma). Capped at the 7500 barney (my opposing node) as the 7485 floor built fast — right before the bounce.
- **Real P&L:** entry 11.00 → exit 14.10 → **+24.4%**.

### 3 — SHORT (put 7510) · 12:42 → 12:55 ET · WIN +11.5%
- **Chart:** countertrend bounce made a lower high at 7516.9, rejected below VWAP (never reclaimed), rolled over — 12:40 down candle broke the coil.
- **GEX confirm:** neg gamma at the day's deepest (−52M, later −62M), 7500 barney magnet strengthening (−55M), air to 7485.
- **Manage:** the cleanest bearish confirm of the day, but 7500 refused to break after ~4 tests — price defended 7507 and went range-bound. Exited near breakeven-plus rather than churn the range; the modest option gain came from the initial drop.
- **Real P&L:** entry 8.70 → exit 10.00 → **+11.5%**.

### 4 — LONG (call 7515) · 14:20 → 14:29 ET · LOSS −13.5%
- **Chart:** 4-candle grind off the 7506 pin reclaimed VWAP (7516.9) — first time above since morning; 15m momentum +.
- **GEX confirm (at entry):** strong POSITIVE gamma (+85M), king flipped to the 7525→7540 pika (magnet above), pika floor at 7510. Positive-gamma drift-to-king long.
- **Why it failed / manage:** the reclaim didn't hold — price slipped back under VWAP and the king magnet flipped from the bullish 7540 pika to a **barney at 7515 sitting right overhead** as resistance. Thesis invalidated; cut fast (−0.04% underlying). Correct discipline; the positive-gamma pin rejected the reclaim exactly as it then chopped 7511–7517.

## Scorecard
| # | Side | Entry ET | Exit ET | Strike | Entry→Exit | net |
|---|------|----------|---------|--------|-----------|-----|
| 1 | short | 11:05 | 11:26 | 7525P | 11.20→13.50 | +17.0% |
| 2 | short | 11:37 | 11:57 | 7510P | 11.00→14.10 | +24.4% |
| 3 | short | 12:42 | 12:55 | 7510P | 8.70→10.00 | +11.5% |
| 4 | long  | 14:20 | 14:29 | 7515C | 5.50→4.90 | −13.5% |

**Total (sum of equal-weight nets): +39.4% · Avg per trade: +9.8% · 3W / 1L**

## Self-assessment
- **Charts-first caught the day's move.** The only directional leg (7538 → 7500) was flagged live from price action (double-top + VWAP break) and confirmed by the regime flip to negative gamma; all three shorts rode it and won. The strong morning positive-gamma pin was correctly left alone (0 trades) — no round-trips paid to theta.
- **Best trade (T2, +24.4%)** was textbook: chart downtrend + deepening negative gamma + a barney magnet below, capped at the opposing node right before the bounce.
- **The loss (T4) was the one countertrend trade** — a positive-gamma "drift-to-king" long that the pin rejected. Discipline was right (cut in 9 min when the king magnet flipped to an overhead barney and VWAP failed); the entry itself was the marginal call — a late-day countertrend long against a lower-high day was the lowest-conviction setup and it behaved like chop.
- **Improvements:** (1) T2 entry chased a candle low and bounced 6pts before working — waiting for the retest would have been a cleaner fill. (2) T3 was a valid signal but the 7500 barney had already proven a floor twice; a smaller size / faster scratch was warranted since a break wasn't converting. (3) Could have skipped T4 entirely — 3 shorts had already banked the day; the marginal long added risk without a high-conviction edge. Net: selective (4 trades), thesis-led, and the winners were the high-conviction structural setups — exactly the profile the method targets.
