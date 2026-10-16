# "GEX is a map → catch the move": node breaks into air pockets — locked 2026-10-16, before any engine output

**User:** "find something that works — if gex and vex are a map we should be able to catch moves." Prior tests asked
whether nodes REVERSE price (no) or whether gamma predicts DIRECTION (no). The trader's map use is different: once price
breaks through a node, it should run through the empty space ("air pocket") to the next node. Never tested.

## Data
SPY, QQQ, IWM, DIA 1-minute RTH bars (UW, .cache/uw/m1; minute handling from vwap_node.mjs) 2023-11-09 → 2026-10-02.
Map = UW net gamma by strike at the PRIOR close (.cache/uwgreeks/{T}.jsonl; call + put gamma per strike).
Nodes = strikes within ±3% of the prior close with |net gamma| ≥ 30% of that day's largest |net gamma| there.

## Event and trade
09:45–15:00: a one-minute close crosses a node N (previous close on the other side). Up-break → long; down-break →
short. Next node beyond N in the break direction = N2; air pocket A = |N2 − N| ÷ N (no N2 within 3% → skipped).
Entry = the break bar's close; stop = N ∓ 0.05% (just behind the broken node); target = N2 ∓ 0.02%; exit at 15:55 if
neither; stop first if both in one bar; $0.01/share/side. Skipped if entry − stop ≤ 0 or target is < 1R away.
First break of each node per day only. R = P&L ÷ |entry − stop|.
Retest variant (RT): after the break, wait for a one-minute touch back to N (within 30 minutes) that closes on the break
side; enter at that close, same stop/target.

## Groups
AIR = A ≥ 0.40% · CROWD = A < 0.20% · NEG = AIR breaks where the summed net gamma strictly between N and N2 is < 0
(dealers short gamma in the pocket → acceleration) · POS = AIR with ≥ 0.

## Hypotheses (one-sided; build = 2023-11-09 → 2025-03-31, holdout = 2025-04-01 → 2026-10-02; day-clustered; BH q = 0.10 across 8)
G1 AIR mean R > 0 · G2 AIR beats CROWD · G3 NEG beats POS · G4 AIR beats ≥ 19/20 random-level twins (all node levels
shifted by a common random ±0.15–0.60% per day/twin; same rules) · G5–G8 the same four for the retest entry.
Reported: hit rate of reaching N2, mean R by symbol, long vs short, and the share of the day's range captured.
