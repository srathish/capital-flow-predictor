# Candidate rules from the user's notes (not yet tested)

| # | Rule (as stated) | From | Needs to be pinned down |
|---|---|---|---|
| U1 | Negative king at the open with price sitting on it → trade the move off it (puts on 3/4) | 3/4 | direction rule when price is on a negative king |
| U2 | A positive node growing fast (≥ +50% in 15 min) that becomes king → buy options toward it | 3/4 (685 ▲71% → king 09:47) | growth threshold, distance to the node |
| U3 | Exit when price touches that king (not a fixed target short of it) | 3/4, 3/3 | touch tolerance |
| U4 | No new trades past the king in the same direction after it's touched | 3/4 (686C −26%), 3/3 (681C −57%), 3/5 (680P −39%) | how long the ban lasts |
| U5 | Price boxed between two close positive nodes → stand aside | 3/4 (685–687) | max gap that counts as "boxed" |
| U6 | A positive node touched ≥ 2 times and growing (▲) is a floor/ceiling: don't trade through it; maybe trade the bounce back toward the king | 3/5 (676 held 13:33 and 14:34, 676P −43%; bounce to 680–682) | touch count, growth threshold, bounce entry |
| U7 | King flipping often (many changes in the last N min) → no trades | 3/3, 3/11, 3/17, 3/18 (39–47 changes/day, engine mostly lost) | N, flip-count threshold |
| U8 | Enter late (after midday) toward a still-valid king instead of at the open — cheaper 0DTE premium | 3/20 (653P $2.27 at 10:01 vs ~$1.3 at 12:30–13:00, $5.75 at 15:30) | what "still valid" means; must beat early entries net of theta |
