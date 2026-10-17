# trinity-ladder-gex — Skylit Atlas layout

Import `trinity-ladder-gex.json` in Skylit Atlas (layouts → import). Edited 2026-10-17 from the user's `trinity` layout.

Changes and the test behind each:
- TheQuietCalf **pdhpdl / orb / gapfill ON** — the Rapid-style ladder levels (prior-day high/low, opening range, prior
  close). Ladder breaks alone lose; with GEX/VEX confluence they beat 20/20 map-shifted twins on SPY/QQQ/IWM/DIA
  (shadow/results_ladder/summary.md) — still ≈ break-even, so use as a FILTER, not a system.
- **nodeCount 5 → 7** — shows the next node beyond the king (the air-pocket target).
- **Node labels ON** — strike + size on each node (king vs small nodes, gap width).
- **Alert lines ON** — put lines at the king and the next node to catch the break.
- Unchanged: Trinity sidebar (SPXW/SPY/QQQ net gamma + velocity), Tempest cones (expected range — the validated range
  forecast), CVD, flow VWAP, ask-side sweep flow, EMAs 5/9/20, 0DTE ("current") expiry on the panes.

Evidence limits: index ETFs only (10 random single stocks failed); most node breaks are fakeouts (~1 in 4 reach the next
node); the SPX king-break test (pin-first + QQQ-confirm variants) is running — see shadow/results_king/summary.md.
