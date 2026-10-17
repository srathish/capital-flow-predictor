# Intraday board factory: does the live Skylit board predict the next 30–60 minutes? — locked 2026-10-17, before any engine

**User:** "keep working, find any pattern, crack the code." Every earlier direction test used a once-a-day map. Skylit
1-minute replay frames (~/gex-data-replay-reader/data; SPXW/SPY/QQQ; 5 expirations; gamma + vanna per strike) allow
testing the board's intraday SHAPE and MOVEMENT. Build = 2025-12-15 → 2026-02-27; holdout = 2026-03-02 → 2026-05-05.

## Snapshots and outcomes
Every 15 minutes from 10:00 to 15:00 ET (21 per ticker-day), using only frames at or before the snapshot. Price = frame
spot. Outcomes: r30 / r60 = log return of spot to +30 / +60 minutes (capped at 15:59); a30 = |r30| (move size).
Aggregate γ = sum over the 5 expirations; 0DTE γ = the first expiration column.
## Features (each computed at the snapshot)
F1 gamma tilt ±1% = (Σ|γ| of strikes above spot − Σ|γ| below) ÷ (Σ|γ| within ±1%)
F2 change in F1 over the last 30 minutes
F3 king side and distance = (king − spot) ÷ spot (king = largest |γ| within ±2%)
F4 king growth = |γ_king| now ÷ 30 minutes ago − 1 (same strike)
F5 0DTE net gamma within ±0.5% ÷ Σ|γ 0DTE| within ±0.5% (pinning vs trending)
F6 vanna tilt ±1% (as F1 with vanna, signed sum above minus below ÷ Σ|vanna|)
F7 node-velocity tilt = Σ Δ30(|γ|) for strikes above spot within 1% minus Σ for strikes below, ÷ Σ|γ| within ±1%
F8 position in the gap = (spot − nearest big node below) ÷ (nearest big node above − nearest big node below), big = ≥ 30% of king
F9 day trend so far = log(spot ÷ 09:30 spot) (control/benchmark, not a board feature)
## Tests
For each feature × outcome {r30, r60} (direction): pooled Spearman rank correlation across all snapshots (tickers pooled),
significance from day-clustered t on the per-day mean rank product; for F5 also vs a30 (move size). 9×2 + 1 = 19 tests.
Validated = holdout |t| ≥ 2 with the SAME sign as build, and BH q = 0.10 across the 19 on holdout one-sided-in-build-sign p.
Any validated feature then gets ONE registered trading rule on the holdout (buy the ATM 0DTE option in its predicted
direction at the snapshot when the feature is in its build top/bottom decile, hold 30 minutes; real UW option prices).
