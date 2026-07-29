# Falcon Copier — reverse-engineering Skylit.ai's "Falcon" 0DTE model

**Master guide. Point any new session here first.** This is the single map of the whole effort: what Falcon
is, what we proved, the system we built, where every file lives, and what's running live right now.

> ⚠️ The executable code lives in **`apps/gex/research/doctrine/`** (it depends on `apps/gex` for Skylit
> auth `../../src/heatseeker/auth.js`, env bootstrap, and the historical data in `research/velocity-capture/`).
> This folder is the **index + findings**; run things from `apps/gex/`. Paths below are from repo root.

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

## 3. The system (direction-free, confluence-gated, agentic)
```
1. Never forecast direction. Wait for a confirmed move OR price reaching a level.
2. Reactive regime: TREND (efficient tape) → ride to next pika; CHOP → fade the wall.
3. Ride exit = the next pika ahead (stalls there); barney ahead = accelerant (ride through).
4. At the pika: expect reversal (79% respect, vanna+ 74%). FAILED-REACH (stall short) = fade harder.
5. CONFLUENCE gate: fire ONLY when ≥5 of 9 validated criteria align (Falcon selectivity).
6. RED TEAM: the trade must SURVIVE adversarial objections (unreachable, fighting tape, bad R:R…) or veto.
7. Execute: cheap convex 0DTE, manage the pop (+25%), identical size, few trades.
```

## 4. File map (all in `apps/gex/research/doctrine/`)
**LIVE system (running now):**
- `autotrade.mjs` — the paper-trader. Confluence-gated entries + rule-based red team + king-migration + real
  0DTE option quotes + structure-invalidation exits. Runs every 60s via launchd. Logs `trades_<day>.txt`,
  `status_<day>.txt` (per-tick "thinking"), `state_autotrade.json`.
- `run_autotrade.sh` — cron/launchd wrapper. `live_copilot.mjs` — on-demand map+rules read.
- `predict.mjs` — trinity-regime reach engine (live). `engine.mjs` — node-size reach + vanna hold.
- `run_forward.sh` — post-close forward-validation logger. `RUN_TOMORROW.md` — operator runbook.

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

## 5. Live system — how to run & watch (run from `apps/gex/`)
```
cd "apps/gex"
# watch it think (per-tick) + trades:
tail -F research/doctrine/status_$(date +%F).txt
tail -F research/doctrine/trades_$(date +%F).txt
# manual one tick (FORCE bypasses the RTH gate):
ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env DATABASE_URL= FORCE=1 /usr/local/bin/node research/doctrine/autotrade.mjs
# scheduler (macOS launchd, every 60s): plist at ~/Library/LaunchAgents/com.bellwether.autotrade.plist
launchctl list | grep bellwether        # check it's alive
```
Session isolation: uses **session B** (`apps/gex/research/stock-gex/session-b.env`). Re-auth if it 401s:
`cfp-jobs skylit-login --env-file apps/gex/research/stock-gex/session-b.env`. Do NOT run co-pilot + autotrade
at once (they'd clobber session B).

## 6. Data sources
- **Skylit** `app.skylit.ai/api/data?symbol=SPXW` → per-strike `g0`(0DTE gamma) `v0`(0DTE vanna) `gAgg`/`vAgg`
  (all-expiry) + `CurrentSpot`. (`timestamp=` param pulls historical snapshots.)
- **Unusual Whales**: SPY/QQQ/VIXY 1-min OHLC; market tide (`/api/market/market-tide`); option intraday marks
  (`/api/option-contract/{occ}/intraday` — current day only); dark-pool prints (`get_dark_pool_trades`);
  **DP volume-by-price** = `/api/stock/{tkr}/stock-volume-price-levels` → `{price, lit_vol, off_vol}`
  (off_vol = dark-pool); greek exposure by strike (call/put/charm/vanna, historical).

## 7. Open threads (current build queue)
1. **Dark-pool value-area layer** — IN PROGRESS. On 07-29 Falcon top-ticked a short at 7446 with NO GEX pika
   there — it faded price stretched ~45pt above the DP value area (POC ~7400). GEX-only missed it. Build:
   pull DP off_vol by price → POC/VAH/VAL → "extended beyond value" fade signal + confluence criterion.
2. **LLM red-team debate** (tier-2) — bull vs red-team vs judge on confluence survivors (~1-3/day, on-demand).
3. **Reactive regime → wire into autotrade** (mode-switch fade↔ride on live efficiency).
4. **More data + walk-forward retraining** — the adaptive model is data-starved on 19 days; needs more history.
5. **Forward validation** — the paper-trader is accumulating the ONLY thing that matters: real forward results.

## 8. The honest bottom line
We reverse-engineered and BUILT Falcon's machine (reach + confluence + red team + reactive regime +
management). We PROVED the boundary (direction unpredictable). What we do NOT have is Falcon's proof: a
forward track record. The 60s paper-trader started that clock. **Machine — close. Proof — just started.**
