# Persistent king as a destination, and "don't break out of a pin" — locked 2026-10-17, before computing

From the user's read of SPY 2026-03-03: 680 kept reappearing as king, price ran 670 → 680 and pinned there, while the
engine's 10:10 call (target = next node, tight stop) was stopped out and its 13:39 call was bought right on top of the
pinned king. Two hypotheses on the Skylit 1-minute frames (SPY, QQQ, SPXW; build ≤ 2026-02-27, holdout ≥ 2026-03-02).

**K — persistent king as a destination.** At each half-hour snapshot 10:00–14:00 (frames at or before), candidate =
the current king K (largest |γ|, aggregate, within ±2%) if 0.30% ≤ |K − spot|/spot ≤ 1.50% and K was the king in ≥ 50% of
the frames of the previous 60 minutes. First qualifying snapshot per ticker-day. Outcome: spot touches K (crosses or
reaches within 0.02%) at any later minute before 15:59. Control: the mirror level spot − (K − spot), same test.
- **K1** P(touch king) > P(touch mirror) (paired, day-clustered).  **K2** P(touch king) > 50%.
- Reported: the option version (buy the ATM 0DTE option toward K at the snapshot, sell on touch or at 15:55, real UW
  minute prices), not tested.

**N — no breakout out of a pin.** Engine breaks (DESIGN_reactive_nodes.md B, scored on UW candles; replay data
Dec 2025 – Mar 2026). "Pinned" = at the entry minute a POSITIVE king lies within 0.15% of the entry price.
- **N1** mean R of non-pinned breaks > mean R of pinned breaks (build reported, holdout = March).
Both families: one-sided p < 0.05 on the holdout to call confirmed.
