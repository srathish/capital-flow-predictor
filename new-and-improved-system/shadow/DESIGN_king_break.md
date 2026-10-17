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

## Amendment 1 (2026-10-16 evening, registered before ANY king-break outcome is computed; full run scheduled after midnight)
From the user's Oct 16 charts (SPX/SPY/QQQ all broke their maps together after SPY pinned on its 771 king for an hour):
K5 KING breaks preceded by a PIN — the SPY close within 0.10% of the (converted) king for ≥ 45 of the 60 minutes before
the break — wide stop: mean R > 0 · K6 KING breaks with QQQ CONFIRMING — at the break minute, QQQ's close is beyond its
own 09:30–10:00 opening-range low (down-breaks) / high (up-breaks) — wide stop: mean R > 0 · K7 both. BH q = 0.10 across
K1–K7. QQQ one-minute bars fetched by the collector for dates after 2026-10-02 (UW). Low power stated (few breaks).
