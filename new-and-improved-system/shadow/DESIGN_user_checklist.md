# User checklist v1: trade toward a stable king (locked 2026-10-17, before any run)

Source: the user's March 2026 review notes (sniper/user_notes/MARCH_NOTES.md), themes 1–6 and rules U2/U3/U4/U7/U8.
March is the month the rules came from. A March result is a **description**, not evidence. December–February stays
sealed as the test. Do not run on it until the user has reviewed March and this file has been amended, before results.

## What is visible at minute m

These are Skylit board frames (skylit_all.json), the same ones the replay shows. Frame m reflects the UW candle that
closes at m.

- **K:** the king, the largest |gamma| strike within ±2% of price.
- **Tenure:** how many consecutive frames, ending at m, K has been king.
- **Flips in the last 60:** how many times the king changed in frames m−59 … m.
- **K growth:** d15, the % change in |K|'s size over the last 15 minutes.
- **p:** price, the close of UW candle m−1.

## Entry: all of these must hold at frame m

1. **The king is stable:** tenure ≥ 20 minutes **and** at most 3 king changes in the last 60 minutes (U7: a flipping king
   means stand aside).
2. **The king is not shrinking:** K's d15 ≥ 0. A missing d15 fails this check (themes 3/13 and 3).
3. **There is room to the king:** 0.25% ≤ |K − p| / p ≤ 1.5%.
4. **Direction is toward the king:** buy a call if K > p, a put if K < p (theme 1, U2). Never trade away from or past the
   king (U4).
5. **Time window:**
   - CORE: 10:00 ≤ m ≤ 14:30.
   - LATE variant (U8, buy cheaper premium later): 12:00 ≤ m ≤ 14:30.
6. **Trade limits:** flat (no open trade on this ticker), and at most 2 trades per ticker per day.

**Option:** the 0DTE at-the-money contract, strike = round(p). It is bought at the close of UW option candle m, the same
fill convention as the engine.

## Exits, checked each 1-minute candle from m to 15:50, in this order

1. **Option stop −50%:** the option candle's low ≤ 0.5 × entry fills at 0.5 × entry.
2. **King reached (U3):** the UW stock candle's high (for a call) or low (for a put) comes within 0.05% of the current
   target king. Sell at that option candle's close.
3. **King moves against the trade:** a new king, held for 5 consecutive frames, sits on the other side of price. Sell at
   the close of the 5th frame's candle. If the new king is on the same side, it becomes the new target and the trade is
   held.
4. **Time:** sell at the 15:50 candle close.

## Reported

- Every trade: time, contract, entry/exit price, %, why it exited, and peak while held.
- March totals for SPY and QQQ, CORE vs LATE, next to the engine's March trades.
- Results with $0 and with $0.02 slippage per side.
- Day by day against the user's notes.
- No significance claims: March is in-sample.

## Result, March 2026 (in-sample, run 2026-10-17)

| | Trades | Avg per trade | After $0.02 slippage | Win rate | Exits |
|---|---|---|---|---|---|
| Engine (reference) | 52 | +6.7% | +4.6% | 31% | — |
| CORE (10:00+) | 46 | **−8.2%** | −10.4% | 35% | 27 stopped at −50%, 14 reached the king (avg +45%), 4 king moved, 1 at the close |
| LATE (12:00+) | 34 | **−17.6%** | −20.1% | 29% | — |

- **By ticker (CORE):** SPY −13% over 21 trades, QQQ −4% over 25.
- **Stopped trades:** 11 of the 27 were up at least 25% at some point before they hit the −50% stop.
- **Verdict:** the checklist loses even on the month it came from. Late entry is worse, not better. Do not test it on
  Dec–Feb as written. All trades are in replay/user_checklist_trades.tsv and on the replay page under "Your checklist".

## Amendment 1: trinity confluence (user request 2026-10-17, locked before the run)

"When we enter something bullish or bearish, are all three leaning bullish or all three leaning bearish?"

- **Lean of one board at frame m.** The board's own king K and spot s come from the Skylit replay frame. SPX uses the
  SPXW board; the king is defined the same way as above. Extracted by replay/trinity_kings.py.
  - Bullish if K > s × 1.0005.
  - Bearish if K < s × 0.9995.
  - Neutral otherwise (price is at the king).
- **TRI variant:** the CORE checklist (10:00–14:30) plus one more entry condition: SPX, SPY and QQQ all lean in the
  trade's direction at frame m. Everything else is unchanged. Written to s.rulesTri.
- **Also reported (diagnostic):** the engine's March trades split by whether all three boards leaned the trade's way at
  entry.
- **Same caveat:** March is in-sample. Dec–Feb stays sealed until the user has reviewed this.

### Amendment 1 result (March, in-sample)

| | Trades | Avg per trade | After slippage | Win rate |
|---|---|---|---|---|
| CORE | 46 | −8.2% | −10.4% | 35% |
| **TRI (all three agree at entry)** | 23 | **−9.8%** | −11.9% | 35% |
| CORE trades that happened to have agreement | 16 | −0.2% | −2.5% | 38% |
| CORE trades without agreement | 30 | −12.5% | −14.6% | 33% |
| Engine, all three agree | 7 | +29.7% | +27.3% | 43% |
| Engine, 2 of 3 agree | 16 | −19.9% | | 13% |
| Engine, 1 of 3 agree | 22 | +14.4% | | 41% |
| Engine, 0 of 3 agree | 7 | +20.1% | | 29% |

- **No consistent confluence effect.**
  - Required at entry, confluence made the checklist slightly worse.
  - The engine's results don't step up with more agreement: 0 of 3 beats 2 of 3.
  - Groups of 7–16 trades are noise-sized.
- **Verdict:** not confirmed in March. Do not spend Dec–Feb on it alone.
