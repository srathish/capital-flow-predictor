# Glitch box (Anubis, Skylit.API.Community.Collab, members/Anubis/Glitch_rules/glitch-box.zip) — summary 2026-10-09

A Rust "GEX/VEX map reader" that encodes Glitch's doctrine and prints the doctrine read of one board, with measured base rates
(1,688 of them; 6,801 next-session boards + 1,322 intraday pulls; discovery Nov-2025, holdout Jan-2026). Display only — it
says itself it never picks a side or sizes a trade. Source read only; the bundled binaries were NOT run.

Rules encoded: King = largest |γ| cell; Pika = largest +γ; Barney = largest −γ; Gatekeeper = node ≥ ¼ of the King; ceiling /
floor = largest |γ| each side of spot (sign doesn't decide); air pockets, rugpull / reverse rugpull, double-stacked ceiling /
floor, King peak / pit. Glitch's plan: deflection entry at the floor (long) or ceiling (short), stop one node beyond + overshoot
(SPY/QQQ 0.5, SPX 4 pts, else 0.07%), target = gatekeeper on the way to the King, else the King, else the opposite bound.
Judge = 5 filters (delivery/regime, retest ≤ 2, R:R ≥ 3, Trinity 3/3, node magnitude).

Their own measured results:
- Judge verdict INVERTED: NO-PLAY boards paid more than A+ (0–3 DTE $35.9 vs $1.1 per $1k, TP1 16% vs 3%; swing $52.8 vs −$2.8).
- Glitch plan picks the better outcome on more symbols than the engine plan (191 vs 110, p < 0.0001), but the engine plan made
  more money ($50.5 vs $43.4 per $1k); both tail-carried (83–86% of money from the top decile).
- Rugpull direction hit 53.4% vs the board's own coin 64.5%; reverse rugpull 45.1% vs 63.5% → worse than baseline.
- Trinity alignment did not pay (91 wins / 116 losses, p 0.095, opposite sign).
- Retest-decay claim (66%/33%) measured 38% vs 36% → a coin.
- Positive: double-stacked ceiling n 389, +$81.3 per $1k, 104 W / 74 L, p 0.029.
- Positive (where price visits): a King that grew is touched next session 47.7% vs 34.6% (p 4e-5); REACH: bound touched next
  session THIN 17.9%, FRESH-BIG 33.7%, TESTED 46.6%, WORN 59.1% — worn levels get touched more and hold less.
Consistent with our own work: the map says where price visits, not which direction.
