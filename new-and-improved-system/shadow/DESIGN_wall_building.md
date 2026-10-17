# "Wall building" fresh test on the August 2026 live Skylit recordings — locked 2026-10-17, before reading them

The only board features with the same sign in build AND holdout of DESIGN_board_factory.md were F6 (vanna tilt ±1%)
and F7 (node-velocity tilt: nodes growing above vs below price over 30 minutes), both NEGATIVE vs the next 30/60-minute
return (t ≈ −0.9 to −1.6). Fresh data never used in any test: falcon-copier/archive/2026-08-*_{SPY,QQQ,SPXW}.jsonl.gz
(live Skylit ticks; per strike g0 = 0DTE gamma, v0 = 0DTE vanna). Note: 0DTE board only (the factory used the 5-expiry
aggregate) — a stated difference.
Snapshots every 15 minutes 10:00–15:00 ET (last tick at or before the snapshot), outcome r30 / r60 = spot log return.
Composite W = −(rank(F6) + rank(F7)) / 2 (ranks within the August sample; F6, F7 defined as in the factory, 0DTE values).
**W1:** rank correlation of W with r30 > 0. **W2:** with r60 > 0. One-sided, day-clustered t; confirmed only if p < 0.05
for W1 (W2 reported). If confirmed, it becomes a registered forward rule; if not, the "wall building" idea is closed.

## Result (2026-10-17, single run; 9 August days, 513 snapshots, SPY/QQQ/SPXW)
W1 (r30): IC +0.028, t 0.57, p 0.284 — NOT confirmed. W2 (r60, reported): IC +0.109, t 1.71, p 0.043. Components on r30:
vanna tilt −0.092 (same sign as before), node-velocity tilt +0.047 (sign FLIPPED). Per the registered rule the
"wall building" idea is closed (the 60-minute hint is noted, not adopted).
