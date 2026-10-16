# Rapid-style level ladder + GEX/VEX confluence — locked 2026-10-16, before any engine output

**User:** "I want this strategy [Rapid Trading's 'if it gets to 100 it has room to 103' ladder] but with confluence
from GEX and VEX." Prior evidence: classic-level break→next-level rules failed (trade factory 0/492; break-and-retest
failed its holdout); GEX air-pocket breaks beat crowded breaks and random levels but are not profitable alone. Question:
does GEX/VEX agreement with the chart ladder pick the ladder breaks that run?

## Ladder (Rapid / auction levels; sniper/09-rapid-trading-methodology.md)
Per symbol-day: prior-day high, low, close (gap fill); premarket high and low (bars with volume); 09:30–10:00 opening-range
high and low. Duplicates within 0.05% merged.
## Trade
10:00–15:00: a one-minute close crosses a ladder level L (previous close on the other side) → long (up) / short (down).
Target = the next ladder level beyond L at least 0.15% away (none → skip); stop = L ∓ 0.05%; entry = the break close;
exit at target / stop (stop first) / 15:55; $0.01/share/side; first break of each level per day; skip if target < 1R.
## Confluence (map = UW net gamma and net vanna by strike at the PRIOR close; nodes = strikes within ±3% with
|value| ≥ 30% of that day's largest |value|)
- **TGT**: the target level lies within 0.15% of a gamma OR vanna node.
- **AIR**: no gamma node strictly between L and the target.
- **CONF** = TGT and AIR.
## Hypotheses (one-sided; build ≤ 2025-03-31, holdout ≥ 2025-04-01; day-clustered; BH q = 0.10 across 8)
C1 all ladder breaks mean R > 0 (baseline) · C2 CONF breaks mean R > 0 · C3 CONF beats non-CONF · C4 CONF beats ≥ 19/20
map-shifted twins (ladder unchanged; the gamma/vanna map shifted by a common random ±0.15–0.60% per day) · C5 AIR beats
non-AIR · C6 TGT beats non-TGT · C7 CONF longs only mean R > 0 · C8 CONF with retest entry (touch back to L within 30
minutes, close on the break side) mean R > 0.
Universe: SPY, QQQ, IWM, DIA (2023-11-09 → 2026-10-02); the 10 random Skylit stocks of DESIGN_air_pocket.md amendment 1
run as a separate family once their data is collected. **Caveat:** the 2025–26 holdout was already used for classic
ladder rules (trade factory) and air pockets; the CONFLUENCE split is new.

## Amendment 1 (2026-10-16, registered before computing) — condition on the predicted day range (trend days)
User: the big winners come on trend days; use the prior-day range forecast. Forecast (fit per symbol on BUILD days
only, as DESIGN_vol_program2 part B): OLS of ln(day range ÷ prior close) on ln(implied vol index at d−1: VIX for SPY,
VXN for QQQ, RVX for IWM, VXD for DIA), ±1% gamma balance A01 at d−1, ln(5-day mean range ÷ close). HIGH / LOW = the
forecast's top / bottom third, thresholds from build days per symbol. Same ladder trades (target = next ladder level).
T1 breaks on HIGH days mean R > 0 · T2 HIGH minus LOW (all breaks) · T3 CONF breaks on HIGH days mean R > 0 · T4 CONF
HIGH minus LOW · T5 HIGH-day longs only > 0 · T6 HIGH-day shorts only > 0. BH q = 0.10 across 6; build/holdout as above.
Reported, not tested: the ORACLE split by the day's ACTUAL range tercile (what a perfect forecast would capture).

## Amendment 2 (2026-10-16, registered before computing) — detect the trend day INTRADAY (by 10:30) + GEX/VEX
User: recognize the trend day as it develops, then press the breaks. Ladder gains the 09:30–10:30 initial-balance (IB)
high/low. Only breaks at or after 10:30. **TD(k)** = first-hour range ÷ the night-before forecast day range (amendment 1
model, build-fit) ≥ k. **Aligned** = an up-break while the last close is above the IB high, or a down-break below the IB
low ("holding outside the opening range"). Short gamma = ±1% gamma balance A01 at the prior close < 0.
U1 TD(0.75) breaks mean R > 0 · U2 TD(0.75) minus non-TD breaks · U3 TD(0.75) aligned > 0 · U4 TD(0.75) aligned + CONF
> 0 · U5 TD(0.75) aligned + short gamma > 0 · U6 TD(0.75) aligned + AIR > 0 · U7 TD(0.5) aligned > 0 · U8 TD(1.0)
aligned > 0. BH q = 0.10 across 8; build ≤ 2025-03-31, holdout ≥ 2025-04-01 (same caveat on the reused holdout).
