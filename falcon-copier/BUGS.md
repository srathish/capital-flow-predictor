# Falcon-copier — bug log

## OPEN
### 3. Raw frame history not durable — rolling 60-min window, wiped on restart (MED — data/replay)
`bufs` starts empty on loop start (agent.mjs) and each tick overwrites `today_*.jsonl.gz` from it, so (a) a restart loses all frames before it, and (b) even with no restart the file is capped at the last 60 frames — no full-day raw GEX archive. Decisions survive (mem resumes from agent_state); raw frames don't. **Fix:** on startup load today's frames into `bufs`; separately append every frame to an uncapped `archive/<day>_<sym>.jsonl.gz`. Until then: copy `today_*.jsonl.gz` aside before any manual restart. See [[feedback_never_hard_reset_live_loop]].

### WATCH: trend-commitment validated by tests + one live call, NOT yet by a full live day
The 7/31 rewrite passed 17/17 execution unit tests + a live reasoning call, but a real trend day is the true stress test. Watch 7/31: does it HOLD winners to target, SKIP casual counter-trend, flatten by 15:55, and show clean discrete exits? Feed the outcome to `--reflect`. One day is a hypothesis (anti-overfit).

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
