# SKYLIT DAY-TRADE DOCTRINE — locked spec v1 (governs the SPXW/SPY/QQQ 0DTE + stock-swing backtest)

## 0. Honest frame (non-negotiable)
The map is TERRAIN, not a direction oracle (our 77-study + Falcon findings). GEX does NOT predict direction. The edge = REACTIONS at nodes + MANAGEMENT + REGIME alignment + CONVEXITY. Validated: nodes are real S/R (react on retest); the King is NOT a reliable magnet. Final grade must be in OPTION P&L, not underlying R (7-stock finding).

## 1. The read
Per strike: `value` (net gamma or vanna exposure — MAGNITUDE = strength), `nodeType`, `distancePct`, live `velocityPct`.
- GEX (gamma) = intraday S/R. Indices → **0DTE column: SPXW + expirations=<today>**. Stocks → **nearest expiry**.
- VEX (vanna) = multi-day bias (~5d+). **GEX∩VEX confluence = strongest.**

## 2. Node types — sign = INTERACTION STYLE, not direction (LOCKED)
- **PIKA (positive / long-gamma):** dampened, SMOOTH. Price RESPECTS it (stalls / rides / glides). Falcon: strong pika ≈ stable, "correct level," ~78% stable / 79% respected. → measure **RESPECT (stall/hold)**, not a sharp bounce.
- **BARNEY (negative / short-gamma):** violent, WICKY — overshoot then sharp reverse (accelerant; "gas on fire" in a rug). → measure **sharp REJECT**.
- **KING:** largest |value|. Strong S/R to REACT at. Validated NOT a magnet on indices (44% toward; 62% reject-on-touch). Don't *target* the king; react at it.
- **GATEKEEPER:** high-|value| node BETWEEN price and a further target, blocking continuation. Key S/R.
- **FLOOR / CEILING:** biggest node just below / above spot (range edges). **MIDPOINT:** avoid (~1:1 R:R, "don't diddle in the middle").

## 3. The 7-rule map read (Skylit canonical)
1) spot vs major nodes · 2) spot ABOVE node = SUPPORT, BELOW = RESISTANCE · 3) magnet node up/down · 4) AIR POCKET (few gatekeepers between → big moves) · 5) is price respecting the nodes · 6) target DELIVERED vs UNTOUCHED this week (delivered → downgrade) · 7) evolution/velocity (target grew? floor grew? fresh/vanished nodes?).

## 4. GATE STRENGTH = RELATIVE (corrected — the key fix)
A gatekeeper gates only when **gatekeeper |value| ≫ the nodes beyond it** (Skylit: "compare the gatekeeper against the second-highest node"). 
- **CLEAR PATH (air pocket) = target |value| > every intervening node's |value|** between spot and target. If an intervening node ≥ target × GATE_RATIO → path is GATED → NOT A+.
- **Cross-index (your QQQ tell):** the most-gatekept index gates the market. If QQQ (leader) is gatekept in the trade direction while SPX/SPY are clear → downgrade the market-wide directional trade. Trinity call (SPX,SPY,QQQ).

## 5. Setup anatomy (Talon-style — LOCKED)
- **Archetype:** GEX Support (bull) / GEX Ceiling (bear) / VEX Magnet / Rally-Then-Fade.
- **OTE (entry):** the entry NODE level (support for bull / resistance for bear). Enter on its **RETEST that HOLDS**, not the blind first touch.
- **Invalidation:** structural acceptance boundary = **body-close beyond the entry node by INVAL_BUF** (wicks don't count).
- **Target:** the UNTOUCHED node across the clear path. Short-term AOI = nearest; Swing / Moonshot = further nodes.
- **R:R(OTE)** = (target − OTE) / (OTE − invalidation).
- **Status:** Actionable (spot at the zone) / Watchlist (spot outside — wait) / OTE-Watch (no qualifying zone).

## 6. Direction + REGIME gate (Falcon / 77-study bull-gate — LOCKED)
Take ONLY setups ALIGNED with the tape. Bull setups only in bull regime; bear only in bear; counter-regime = skip.
- **Index regime:** SPX trend — bull = close > SMA20 > SMA50; bear = close < SMA20 < SMA50; else neutral. Overlay Tempest **regime word + Fear&Greed + VIX1D**, and the **cross-index (QQQ) gate** above.
- **Tape gate on entry:** never enter counter to the intraday dominant_trend (Falcon).

## 7. Entry (LOCKED)
Enter on the RETEST that reacts: sharp reject (king / gatekeeper / strong barney) OR smooth respect/hold (strong pika). Eligible nodes = king, gatekeeper, strong barney, strong pika. AVOID weak/mid nodes + midpoint. First touch strongest; DELIVERED (visited this week) = weaker.

## 8. Management & exits (Falcon-style — LOCKED)
- **Target:** next untouched node; trail to Swing/Moonshot if the map holds.
- **Stop:** STRUCTURAL — body-close beyond the invalidation node by INVAL_BUF (index); for stocks, structure/ATR below the support node (NOT a tight intraday %). ← the MU-swing fix.
- **Node exits:** take profit into the next node/king; exit if the map reshuffles (gatekeeper test-fail against you), the target node DISCHARGES (velocity ↓), or the entry-node support DISCHARGES.
- **EOD flatten** (0DTE indices; theta + Power-Hour forced flow). **Convexity:** defined-risk short-dated; size to the structural stop; pyramid only with-trend.

## 9. Grading (LOCKED)
- **A+** = strong entry node + CLEAR relative-gate path + UNTOUCHED target + REGIME-ALIGNED.
- **B** = missing exactly one (delivered target OR a gate in the path OR neutral regime).
- **C / skip** = counter-regime, gated path, midpoint, or Rainbow-Road (no structure).

## 10. Validated facts (LOCKED from our runs)
Nodes reject 47.8% vs random 23.5% (first touch). King 62% > Gatekeeper 56% >> Barney 38% > Pika 20%-sharp (pika = smooth respect, not sharp reject). King NOT a magnet (44% toward). Index node-retest = +0.2–0.37R / 70–82% win (underlying R, 6mo) — but crude-A+ didn't beat B, and it's underlying R. **Final test = 0DTE option P&L.**

## 11. Open parameters — YOU LOCK THESE before the run
| param | what | proposed default |
|---|---|---|
| GATE_RATIO | intervening node vs target to call the path "gated" | 0.7 |
| INVAL_BUF | structural stop buffer (index) | 0.20% |
| STOCK_STOP | stock-swing stop basis | 1.0× ATR(14) below support node |
| ENTRY_PROX | how near spot the OTE node must be | ≤1.0% |
| TARGET | which untouched node to target | nearest untouched across clear path |
| REGIME | definition | SPX close>SMA20>SMA50 (+ Tempest overlay) |
| RETEST_HOLD | reject/respect threshold + lookahead | barney/king/gk: 0.12%/20m reject · pika: hold within 0.1% for 10m |
| PIKA_METRIC | pika = respect (stall) not reject | on |
| OPTION_PNL | grade in option P&L | ATM/1-strike-OTM 0DTE, enter/exit at mid |
| SWING_WINDOW | stock-swing horizon | to nearest expiry (≤5 trading days) |
