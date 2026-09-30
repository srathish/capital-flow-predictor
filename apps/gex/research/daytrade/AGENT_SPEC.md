# DECISION-SUPPORT AGENT — spec (v1)

Role: **decision-support** (recommends; user executes). Instrument: **weekly options (1–2wk)**. Universe: **full Talon/Skylit stock universe** (~378). Backbone: **Skylit MCP (`mcp.skylit.ai/mcp`, 63 tools) + /v1 REST**, one credit-metered key. No Clerk-cookie SSE, no UW dependency, no screenshots.

## What the agent is (and is NOT)
- IS: a **decision-stack assembler** — fuses map + regime + direction + executable contract into a ranked, disciplined weekly-option card.
- IS NOT: a GEX oracle. Mechanical GEX-selection tested as NO edge (A+/gate/untouched all washed out). The map is TERRAIN/confirmation, not the trade-picker.
- Discipline lives in CODE (Falcon audit: LLM reasoning was net-negative). `claude -p` headless only ranks/synthesizes — no API cost.

## Pipeline (daily)
1. **Screen** — `top_underlyings_weekly` / `unusual_volume` / `tempest_screener` → candidate names.
2. **Map** (Skylit) — `heat_levels` per name on the nearest weekly expiry: king/gk support & resistance, relative-gate clear paths (target |value| > every intervening king/gk/barney; pika = flow-through, never gates).
3. **Regime gate** — `tempest_market` (bull/bear/neutral + Fear&Greed + VIX complex) + SPX/QQQ. Only setups aligned with the tape (lifts win rate 64%→75%).
4. **Direction trigger** — `aggregate_score` (Composite + trend) + `chain_bull_bear` (call-buying vs put-selling, NOT put-selling masquerading as bullish) + `flow_momentum`/`sweeps`. This is the WHICH-WAY the map can't give.
5. **Executable contract** — `expirations` → `option_chain` → pick nearest weekly ATM/slightly-ITM; `contract_ratio` for aggression; **reject wide spreads** (the 0DTE killer). Entry/stop/target in PREMIUM terms with real R:R.
6. **Rank + card** (`claude -p`) — Talon-style: archetype / OTE / invalidation / target / real R:R / the contract / spread.
7. **Manage** (coded alerts) — structural stop (body-close), node exit (target node discharges via velocityPct), regime-flip warning. Alerts, not auto-execution.

## Hard lessons encoded (from the 5 tests)
- **0DTE is toxic** (real SPY fills: +0.6R underlying → break-even/negative; −65% stop losses on cheap premium). → **weeklies only**.
- **Underlying R ≠ option money** → every setup priced on REAL `contract_history`, never BS, never underlying-R.
- **Reject wide spreads** → a setup with a bad real spread is not a trade.
- **Regime for win-rate/sizing**, not for return; **map for terrain**, not selection; **direction from flow/sentiment**, not GEX.

## STEP 0 (gate before building the pipeline)
Validate the core play on REAL fills: node-retest + regime, multi-day hold, nearest weekly, priced via `contract_history`, on a liquid basket. Positive → build pipeline. Not positive → fix instrument first. (We do NOT build 378-name infra on an unvalidated weekly premise — that was the 0DTE mistake.)

## Credit discipline
Skylit 100K credits/mo. Batch (heat_levels ≤10 sym, tempest ≤10, bulk stats ≤50). Screen first, deep-analyze only survivors. Cache maps per day.
