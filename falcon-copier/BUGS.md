# Falcon-copier — bug log

## OPEN — NEXT BUILD (after the close; loop refactor = restart, so batch these)

### A. Premium/theta stop — a sideways 0DTE bleeds to a big loss WITHOUT hitting the price stop (HIGH — protects capital) [user-flagged 8/3]
The price-based stop can't catch THETA. **Live proof 8/3:** SPXW 7610C long entered 15:01 @SPX 7608 ($4.30); SPX then chopped **7603–7609 and NEVER hit the 7600 stop**, but the 0DTE call bled to $1.30 = **−70% / −$3,837** before the agent finally bailed at 15:40. Hold-to-plan held while the premium melted. **Fix:** a premium-based hard stop (cut if the option is down ≥ ~40–50% regardless of price level) — the loser-side counterpart to the trailing stop — plus doctrine making the agent theta-aware (a 0DTE long that isn't moving is bleeding — bail faster), and better late-day entry discipline (this was a chased 7610C at 15:01).

### ✅ B. Trailing stop/target — DONE 8/3 PM (moved to FIXED). The agent now ratchets its stop each tick, it's enforced + persisted, and a stop trailed above entry fires. 25/25 tests.

### B. Cost: agent-paced split loop + prompt caching + JSON compaction (MED)
Split the fast cheap price-execution (stops/targets/EOD every min, no LLM) from the LLM reasoning; add a `next_review_minutes` field so the AGENT paces its own re-checks (cap ~3 min). Cache the static doctrine+tool prefix. Drop `JSON.stringify(state, null, 1)` pretty-printing. Target ~$12/day → ~$5–7/day, more agentic not less. See conversation 8/3.

### C. Dashboard: "HOLDING" state while in a trade (MED — UX, user-flagged 8/3)
The ✗/✓ entry-trigger badge flips on conviction wobble even while a position is HELD (e.g. conv 0.55 → ✗ but still open at +110%). Once a position is open, show "HOLDING · in trade" and reserve ✗/✓ for FLAT/new-entry evaluation. Also: the level line shows the agent's *current* stop/target, which (per bug A) differs from what's enforced — surface the ENFORCED levels.

### D. QQQ-selection tracking in `--reflect` (LOW — user-flagged 8/3)
0 QQQ trades in 4 days (SPXW 24, SPY 12, QQQ 0) though QQQ is fully eligible + reasoned over every tick. Have `--reflect` flag when a strong QQQ setup was read but SPX/SPY taken instead — real preference vs blind spot?

### E. SPX stop-width calibration (LOW) — SPXW wiggle-stops (6 stopped in 4–13min on 7/31). Guide the agent to noise-aware SPX stops once the frame archive gives us the noise data.

### WATCH: trend-commitment / hold-to-plan / sizing — validated by tests + 8/3 live, NOT yet across many days
Feed each day to `--reflect` (now unblocked by the archive). One day is a hypothesis (anti-overfit). Judge on risk-parity $ across the sample.

## FIXED — 8/3 risk-parity sizing + durable frame archive (deployed live 8/3)
- **Position sizing** — each trade sized to conviction-weighted $ notional (BASE $10k × the agent's conviction), so SPXW & SPY are comparable in $ (fixes 7/31's −$2857-vs-+$2000 sizing artifact). `pnl_usd` on every closed trade; dashboard shows risk-parity $.
- **#3 frame history durability** — buffer uncapped + dated `archive/<day>_<sym>.jsonl.gz`, reloaded on restart. A restart no longer loses the day's GEX frames, and `--reflect` can finally see full-day outcomes. Verified writing live 8/3.

## FIXED — 7/31 trend-commitment + hold-to-plan deploy (validated 17/17 unit + live sample)
- **#1 exit logic** (was: no take-profit/stop, churned winners, gave back the 7385C's +28%→−25%) → `manage()` now holds to the agent's OWN numeric `target_level`/`stop_level`: take-profit at target, stop-out at stop, HOLD in between, a raised 0.6 bar to exit/reverse early. No more dumping winners on a noisy minute-read.
- **counter-trend dollar loss** (was: −$850 buying puts on a +1.67% up-day) → the agent must produce a `dominant_trend` read and COMMIT to it; counter-trend entries gated behind 0.7 conviction vs 0.5 aligned.
- **#2 fmt() crash / morning outage** → `fmt()` guards `d.direction` (no `undefined.toUpperCase()`).
- **#5 no EOD flatten** → force-flatten any open position at 15:55; no new entries after 15:45 (0DTE must be flat by close).
- **#6 exits invisible on dashboard** → OPEN (live/unrealized) vs CLOSED (final) badges + an exit-reason tag (✓ target / ✗ stop / ⏰ EOD / ↺ reversed) on every closed trade + the trend read in the header.

## FIXED — 7/30 live
- **Option pricing returned the 9:30 open bar every call** → `optMark` now takes the max-`start_time` (newest) bar.
- **Postures returned as JSON strings** → `JSON.parse` coercion.
- **Tide read the empty future template bar** → hardened to the latest-real bar.
- **Historical backtests showed fake +0% premiums** → premiums only fetched when `DAY==today`.
- **Dashboard showed stale backtest data on live start** → loop clears the dashboard + writes market-status on start.

## RETRACTED
### 4. short-option P/L sign — NOT A BUG
`manage()` BUYS the option (call for `long`, put for `short`), so the system is always LONG the option and `(exit−entry)/entry` is correct for both. Buying a put at $17.10 and selling at $12 IS −30%. My earlier "direction-adjusted" recompute was the error, not the code.
