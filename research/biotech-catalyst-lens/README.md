# Biotech Catalyst-Calendar Lens

Born from the MRNA post-mortem (2026-08): surprise binaries are invisible to GEX/VEX +
flow + catalyst tools — **correctly**, because there is nothing structural to see before
the print. The only honest exposure to binary moves is a *calendar*: know the scheduled
Phase 3 readout windows and PDUFA dates in advance, then let IV tell you which binaries
the market is already pricing and which it isn't.

**This is a lens, not a strategy.** It puts the findable binaries on the radar. It does
NOT make them good trades — most binaries resolve against the long-premium holder, and
any actual bet needs fundamental conviction + defined-risk sizing on top.

## Method (repeatable — ask Claude to "re-run the biotech catalyst lens")

1. **Calendar refresh** — pull upcoming PDUFA / Phase 3 dates (next ~90d) from
   biopharmawatch.com, marketbeat.com/fda-calendar, catalystalert.io. Update
   `catalysts.json`. Dates drift — always re-verify a date before trading it.
2. **IV layer** — for each catalyst ticker, pull the UW IV term structure
   (`get_implied_volatility_term_structure`). Find the expiry that *contains* the
   catalyst date and compare its IV to the expiries before/after:
   - **Hump at the event expiry** → market is pricing the binary (event vol embedded).
   - **Flat through the event** → market treats it as a non-event — either correctly
     (low-torque, foregone conclusion) or an underpriced binary worth a fundamental look.
   - **Front-loaded backwardation with the event days away** → fully priced, long
     premium pays the crush.
3. **Torque filter** — a PDUFA on a megacap (MRK, GILD, BIIB, VRTX) is a footnote; the
   same event on a single-asset company (CAPR, COGT, MLYS) is existential. The
   `torque` field in `catalysts.json` carries this judgment.
4. **Report** — write `REPORT_<date>.md`: table of catalyst | date | event-expiry IV
   vs neighbors | priced/unpriced verdict | implied move.

## Files
- `catalysts.json` — the living calendar (update in place, keep `updated` current)
- `REPORT_*.md` — dated snapshots of the IV-vs-calendar read

## Doctrine guardrails
- Calendar dates are *deadlines*, not promises — FDA can act early; weekend dates
  resolve adjacent business days; extensions happen.
- An "unpriced" flag is a research trigger, not a buy signal. Six-criteria /
  full-workup rules still apply before any position.
- Options on these names are thin: verify real quotes + spreads before sizing anything.
