# Falcon Copier — reverse-engineering Skylit.ai's "Falcon" 0DTE model

**Master guide. Point any new session here first.** This is the single map of the whole effort: what Falcon
is, what we proved, the system we built, where every file lives, and what's running live right now.

> ⚠️ The executable code lives in **`falcon-copier/`** (it depends on `apps/gex` for Skylit
> auth `../../src/heatseeker/auth.js`, env bootstrap, and the historical data in `research/velocity-capture/`).
> This folder is the **index + findings**; run things from repo root (`the final plan/`). Paths below are from repo root.

---

## 1. What Falcon is (the target)
Skylit.ai's "Falcon" is a 0DTE SPX/SPY/QQQ options model (part of the HEATSEEKER·ATLAS platform). Its creator
(@Glitch_Trades / "The Architect" @astocks92) says it's a **trained AI model with ~200 criteria and a "red
team" of agents that argue each trade** — NOT a fixed algo. Published record: **92% win, PF 3.14, +$207K on
$100K over 6 months, ~1 trade/day, manages the pop (+~21% avg win).** Its screen layers: multi-instrument GEX
($-gamma ladders SPX+SPY+QQQ), dark-pool levels, unusual flow/sweeps, trinity (cross-index), projection
(expected-move cone), VIX pivot, and live agents (Atlas/Heatseeker/Flowseeker) narrating level interactions.

## 2. Core findings (what we PROVED — read before trusting anything)
- **DIRECTION IS UNPREDICTABLE, out-of-sample, 6+ ways.** GBM on 64 features incl. aggregate VEX, gamma-flip,
  charm, VIX, volume, trinity, AND real options flow → OOS AUC ≈ 0.51. Walk-forward retraining → 0.53. It is
  NOT in the data, for anyone (Falcon included). Stop trying to predict which way SPX goes.
- **REACH/PIN IS predictable, OOS.** "Will price reach a level / pin" → AUC 0.80–0.90. The map tells you WHERE
  price goes and WHETHER it gets there, never WHICH WAY.
- **The edge = reach + node-structure + CONFLUENCE/selectivity + convexity + management** — not a signal.
  Falcon's 92% = ultra-selectivity ("take every card = −19%") × manage-the-pop × cheap convex 0DTE.
- **Node-size changes reach** (big node = pins price, less reach; generalizes 8.6pt). **Vanna changes hold**
  (vanna+ deflects 74% vs 67%). **Failed-reach reverses ~2×** (stall short of a wall → ~9pt vs ~4pt; OOS).
- **AGENTIC > ALGORITHMIC.** Reactive regime-switching (detect current regime from the live tape, switch
  fade↔ride) beats fixed strategies (+4 vs −16 fade vs −87 ride). Value = avoiding wrong-regime disasters.
  An LLM agent reading the live tape is the answer to intraday non-stationarity (no training data needed).

## 3. The system (direction-free, confluence-gated, agentic) — THE UNIFIED ENGINE
The backtest, the live scanner, and the paper-trader now run the **same** engine. It evaluates SPX+SPY+QQQ
every minute and builds two candidate types, scores confluence, fires the single best across the complex:
```
1. Never forecast direction. Wait for price to REACH a node (reach is the only predictable thing).
2. Two candidates per instrument:
   • PIKA  — fade/bounce toward the nearest strong positive-gamma wall within range (mean-revert to the wall).
   • BARNEY — reject off a big negative-gamma node price has TAPPED and is now RETRACING from (failed-reach).
3. CONFLUENCE gate (7 criteria): at-node · strong-node · vanna(+ for pika / − for barney) · king-migration ·
   flow-agree · pivot-side · dp-extension. Fire ONLY the best setup across SPX/SPY/QQQ when ≥5/7 (selectivity).
4. RED TEAM: the trade must SURVIVE adversarial objections (unreachable, fighting tape, bad R:R, no room,
   weak anchor) or it's vetoed — scoring well is not enough.
5. Execute: cheap convex 0DTE on the firing instrument, manage the pop (+25% / −40% / structure-harden / EOD).
```
This is the machine that reverse-engineered BOTH of Falcon's 07-29 plays (12:00 SPY pika-bounce LONG + 14:54
SPXW barney-reject top-tick SHORT). In-sample day: 8 trades, 6/8 win. **In-sample — the forward test is the gate.**

## 4. File map (all in `falcon-copier/`)
**THE UNIFIED ENGINE (same logic, three surfaces):**
- `backtest_1min.mjs` — minute-granularity replay on the cached day (`node backtest_1min.mjs [THRESH]`). The
  reference implementation of the engine; where new rules get validated in-sample first.
- `scan_multi.mjs` — the engine LIVE on SPX/SPY/QQQ, prints the best setup + confluence. Observer (no orders).
- `autotrade.mjs` — the engine paper-TRADING: multi-instrument scan → fire best ≥5/7 → red-team → real 0DTE
  option quotes + peak tracking + structure-hardening exits. Runs every 60s via launchd (`com.bellwether.autotrade`).
  Logs `trades_<day>.txt`, `status_<day>.txt` (per-tick "thinking"), `state_autotrade.json`. PAPER ONLY.
- `pull_today.mjs` — caches today's 1-min GEX (g0/v0/spot/prevClose) for SPXW+SPY+QQQ → `today_<sym>.jsonl.gz`
  (feeds `backtest_1min.mjs`). Resumable.

**LIVE forward test + LEARNING LOOP (running now):** the paper-trader IS the forward record — `autotrade.mjs`
logs per-tick per-instrument confluence to `status_<day>.txt` (the signal log, even when flat), managed fires +
%P/L to `trades_<day>.txt`, and every closed trade (with its full entry context: kind, confluence, per-criterion
map) to the cumulative **`falcon_ledger.jsonl`** (survives across days). `run_autotrade.sh` = its wrapper.
- **`review.mjs` = the iterative loop** — auto-spawned by autotrade at day-done (also run by hand). Reads the
  CUMULATIVE ledger and appends a dated analysis to **`REVIEW.md`**: win/expectancy by kind/instrument/confluence,
  and each criterion's edge (present vs absent). **Anti-over-correct by construction:** it won't even consider a
  change until ≥20 trades AND ≥10 days, every stat is cumulative (never last-day), flagged patterns are WATCH-only
  needing another block of days + approval, and the default is always NO CHANGE. Read `REVIEW.md`'s header first.
- `forward_scan.sh` + `com.bellwether.forwardscan` — a PARKED pure-observer (unloaded). It runs `scan_multi.mjs`
  and logs deduped WOULD-FIRE to `forward_<date>.log` with no position gate (catches signals even while the
  trader is holding). To run it ALONGSIDE autotrade it needs its OWN Skylit session (session C) — two 60s jobs
  on session B would clobber the Clerk cookie (see §5). Re-`launchctl load` only after wiring a session-C env.

**Other live tools:** `fullstack.mjs` (every-source snapshot + king-side trinity), `monitor.mjs` (unified view
→ `monitor_state.json` agent bridge), `dp_value_area.mjs` `flow_confirm.mjs` `expiry_structure.mjs`
`multi_instrument.mjs` (per-layer reads). `predict.mjs`/`engine.mjs` — reach engines. `RUN_TOMORROW.md` — runbook.

**Models / feature pipeline:**
- `features.mjs` → `features.csv` (64-feature matrix per minute-state). `model.py` — full-picture GBM (OOS).
- `train_reach.py` → `reach_models.pkl` (saved reach models). `walk_forward.py` — retrain vs frozen test.

**Research / validated findings (each a self-contained test):**
- `node_sign.mjs` `node_prob.mjs` `engine.mjs` — node-sign regime, node-size reach, vanna hold.
- `level_check.mjs` — strong-pika levels (78% stable / 79% respected). `deflect.mjs` — deflection zones.
- `ride.mjs` — ride-length = next pika. `test_ideas.mjs` — failed-reach (WIN), reach-asymmetry (dead).
- `direction_bt.mjs` `gex_regime.mjs` `two_mode.mjs` `sim.mjs` — direction/regime/blotter.
- `reactive_regime.mjs` — agentic regime-switch (beats fixed). `momentum_ride.mjs` — trailing momentum.
- `vix_pivot.mjs` — Architect's VIX pivot (direction failed OOS, vol-regime survives).
- `premium_sell.mjs` — sell-side condors (naive form failed). `test_ideas2/3/4.mjs` — idea batches (mostly nulls).
- `falcon_picks.json` — labeled Falcon picks (training/validation data). `SYSTEM.md` `FORWARD_VALIDATION.md`
  `GEX_FRAMEWORK.md` — the doctrine docs.

## 5. Live system — how to run & watch (run from repo root `the final plan/`)
```
cd "the final plan"                       # repo root — all falcon-copier scripts run from here
ENV="ENV_FILE=apps/gex/research/stock-gex/session-b.env DATABASE_URL="
# watch the paper-trader think (per-tick) + its trades:
tail -F falcon-copier/status_$(date +%F).txt
tail -F falcon-copier/trades_$(date +%F).txt
# watch the forward-test WOULD-FIRE log:
tail -F falcon-copier/forward_$(date +%F).log
# one live scan / one trader tick (FORCE bypasses RTH + entry-time gates for off-hours testing):
env $ENV /usr/local/bin/node falcon-copier/scan_multi.mjs
env $ENV FORCE=1 /usr/local/bin/node falcon-copier/autotrade.mjs
# refresh today's cache then re-run the in-sample backtest:
env $ENV /usr/local/bin/node falcon-copier/pull_today.mjs && env $ENV /usr/local/bin/node falcon-copier/backtest_1min.mjs 5
# scheduler (macOS launchd, 60s): com.bellwether.autotrade (the trader + forward record; single session-B consumer)
launchctl list | grep bellwether          # check it's alive
```
Session isolation: uses **session B** (`apps/gex/research/stock-gex/session-b.env`). Re-auth if it 401s:
`cfp-jobs skylit-login --env-file apps/gex/research/stock-gex/session-b.env`. **Exactly ONE session-B consumer
at a time** — autotrade owns it. Two 60s jobs on one session rotate/clobber the Clerk `__client` cookie and
both start 401ing. Any second live consumer (e.g. the parked forwardscan) needs its own session env.

## 6. Data sources
- **Skylit** `app.skylit.ai/api/data?symbol=SPXW` → per-strike `g0`(0DTE gamma) `v0`(0DTE vanna) `gAgg`/`vAgg`
  (all-expiry) + `CurrentSpot`. (`timestamp=` param pulls historical snapshots.)
- **Unusual Whales**: SPY/QQQ/VIXY 1-min OHLC; market tide (`/api/market/market-tide`); option intraday marks
  (`/api/option-contract/{occ}/intraday` — current day only); dark-pool prints (`get_dark_pool_trades`);
  **DP volume-by-price** = `/api/stock/{tkr}/stock-volume-price-levels` → `{price, lit_vol, off_vol}`
  (off_vol = dark-pool); greek exposure by strike (call/put/charm/vanna, historical).

## 7. Open threads (current build queue)
DONE since last update: ✓ dark-pool value-area layer (now the `dp-extension` confluence criterion) ✓ BARNEY
reject + failed-reach confirmation (reverse-engineered Falcon's 14:54 top-tick) ✓ multi-instrument SPX+SPY+QQQ
✓ minute granularity ✓ unified engine across backtest/scan/trader ✓ forward record live via autotrade.
1. **Forward validation** — THE gate. autotrade is now accumulating the only thing that matters: real forward
   results on the full engine. Everything above is in-sample until this says it generalizes. Compare
   `trades_<day>.txt` + `status_<day>.txt` against Falcon's actual plays daily.
2. **LLM red-team debate** (tier-2) — replace the rule-based veto with bull vs red-team vs judge on confluence
   survivors (~1-3/day, on-demand). The `monitor_state.json` bridge exists for this.
3. **Full-coverage signal log while in-position** — autotrade only logs the 3-instrument scan when FLAT (it
   manages, single-position, when holding). To record signals it would've seen while holding, either make
   autotrade scan-for-log during positions, or run the parked forwardscan on a session C.
4. **More data + walk-forward retraining** — the adaptive model is data-starved (~19 days); needs more history.
5. **Reactive regime → deeper wire** (mode-switch fade↔ride on live tape efficiency).

## 8. The honest bottom line
We reverse-engineered and BUILT Falcon's machine (multi-instrument reach + PIKA/BARNEY node structure +
confluence + red team + management), and it now catches BOTH of Falcon's 07-29 plays. But that catch is
**in-sample** — the barney logic and the ≥5/7 threshold were fit to those two known plays; fitting to 2 plays
on 1 day is textbook overfit risk. We PROVED the boundary (direction unpredictable OOS). What we still do NOT
have is Falcon's proof: a FORWARD track record. The 60s multi-instrument paper-trader is now running the full
engine and accumulating exactly that. **Machine — built & unified. Proof — the forward clock is running.**
