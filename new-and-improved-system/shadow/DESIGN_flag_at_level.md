# Flag at our level: map level + EMA stack + tight flag + volume breakout (locked 2026-10-17, before any run)

**User idea:** "if GEX and VEX is the map, what if we use an EMA stack, is price flagging AT OUR level, and is there a
volume confirmation."

## Map (levels known before the session)

- **Primary (long history): UW daily greek exposure by strike at the prior close** (.cache/uwgreeks/{T}.jsonl, columns
  strike, call_gex, put_gex, …, call_vanna, put_vanna).
  - Take the top 4 strikes by |call_gex + put_gex| and the top 2 by |call_vanna + put_vanna|.
  - Only strikes within ±2% of the prior close count; duplicates are merged.
- **Secondary (exploratory): Skylit replay** (Dec 2025 – Mar 2026). Nodes with |rel| ≥ 0.3 on the live board at the
  breakout minute.

## Pattern (SPY, QQQ; 5-minute bars built from UW 1-minute regular-session bars; signals 10:00–15:00)

All four conditions must hold at the close of 5-minute bar t.

1. **EMA stack:** EMA8 > EMA21 > EMA34 and close > EMA8 for a bull; the mirror for a bear. EMAs run on 5-minute
   closes, seeded from the prior session.
2. **Flag at the level:** the 6 bars before t (30 minutes) satisfy both:
   - their high-low range is ≤ 0.6 × ATR14 (5-minute ATR) × √6;
   - the level L sits within 0.10% of the flag's high (bull) or low (bear).

   The level is the lid being pressed against.
3. **Breakout:** bar t closes beyond L by ≥ 0.02%, in the stack's direction.
4. **Volume:** bar t's volume ≥ 1.5 × the mean volume of the 6 flag bars.

**Trade:**
- Enter at bar t's close.
- Stop: the flag's opposite extreme (1R).
- Target: +2R.
- Otherwise exit at the 15:55 close.
- One trade per ticker per day (the first signal).

## Controls

- **Map-shift twins:** the identical pattern search with every level moved by a random ±0.3–0.8% (10 shifted maps per
  day, seeded 20261017). This asks whether it has to be OUR level.
- **Component drops**, each holding the other conditions:
  - without volume confirmation;
  - without the EMA stack;
  - without the flag condition (just a breakout through L).

## Split and tests (day-clustered t; BH q = 0.10 across F1–F3)

- **Build:** 2023-11-16 → 2025-03-31.
- **Holdout:** 2025-04-01 → 2026-10-16.

| Test | Claim |
|---|---|
| F1 | full pattern, holdout mean R > 0 |
| F2 | full pattern minus mean map-shift twin R > 0 |
| F3 | full pattern minus the no-volume variant > 0 (volume adds value) |

**Also reported:**
- every component drop;
- build-period numbers;
- the Skylit-map version (exploratory).

**If F1 and F2 pass:** price it with real 0DTE/1DTE options and send it to the audit and forward ledger.
