# SPX breaking through the Skylit king node → run to the next node? — locked 2026-10-16, before the map history is pulled

**User:** "SPX going through king nodes like that" (Oct 14 2026: SPX broke below 7800, the big positive node, and fell
~100 points to the 7700 / 7665 nodes). Earlier air-pocket tests used UW's SPY map and every node; this tests ONLY the
Skylit king on SPX, never tested before.

## Data
Skylit historical SPX gamma board (all expirations, /v1/historical, 5 credits each) at the PRIOR session's 15:59 ET —
the map known before the open — for the last ~70 sessions (2026-07-08 → 2026-10-16; credit cap 200/day, so collected
over two days). Price path: SPY one-minute RTH bars (UW; .cache/uw/m1, fetched for dates after 2026-10-02), SPX levels
converted to SPY at the prior close's SPX ÷ SPY ratio (Cboe SPX close, UW SPY close).
## Levels
KING = the strike with the largest |gamma| within ±3% of the prior close (Skylit's own 'king' label when present).
PKING = the largest POSITIVE-gamma strike within ±3% (the "big positive node" in the user's example).
Next node beyond a level in the break direction = the nearest strike with |gamma| ≥ 30% of the king's |gamma|.
## Trade
09:45–15:00: a SPY one-minute close crosses the level (converted); first break per level per direction per day. Target =
next node beyond (converted); stops 0.05% (S1) and 0.15% (S2) behind the level; exit at 15:55 otherwise; $0.01/side.
Controls: 20 random-level twins per day (level shifted ±0.15–0.60%, same rules).
## Hypotheses (one-sided; the whole sample is new — no build/holdout split; low power: expect ~30–80 breaks)
K1 KING breaks, S2 stop: mean R > 0 · K2 KING S2 beats ≥ 19/20 twins · K3 PKING breaks S2 mean R > 0 · K4 PKING S2 beats
≥ 19/20 twins. BH q = 0.10 across 4. Also reported: S1, hit rate, every break listed (date, time, direction, R).
