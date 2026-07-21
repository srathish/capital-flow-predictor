# Skylit / Glitch GEX Doctrine — complete rule set (extracted 2026-07-21)

Source: Skylit's published learn pages (skylit.ai/learn/*). Skylit IS our GEX feed;
Glitch/Talon/Falcon/Midas/Peregrine are its AI analyst models. This is the canonical
rule set our 0DTE system should encode. Verbatim quotes in "".

> Purpose: compile every stated rule → compare to what our code enforces (DELTA, added
> when the code audit lands) → then reproduce a specific day of Glitch's results.

---

## 0. CHARTS FIRST (the meta-discipline) — /charts-first
- **"You form the thesis from the chart. Then you check Heatseeker to see if the structure
  underneath supports it or kills it."** Chart structure FIRST, GEX SECOND — non-negotiable.
- Price read = 4 things: (1) price position vs key levels, (2) S/R zones, (3) trend sequence
  (HH/HL vs LH/LL), (4) range extremes vs middle. **"The middle of a range is where trades go to die."**
- Thesis must be specific/structural ("rallies from this support to resistance"), not "looks bullish".
- GEX **confirms** (a + node at your support) or **vetoes** (no node / opposing − cluster).
- "Without chart structure, exposure data becomes noise." (Matches our own finding: charts-first survives.)

## 1. NODE IDENTIFICATION — /reading-heatseeker
- **King node** = strike with largest **ABSOLUTE** exposure (not most +, not most −). Structural anchor;
  price pulled toward it into expiry.
- **Floor** = largest exposure node **below** spot (**biggest, not nearest**). Dealers buy on approach.
- **Ceiling** = largest exposure node **above** spot.
- **Gatekeeper** = node between two larger nodes; decides if price reaches the target cleanly. Dense
  stacking = friction; sparse = fast.
- **NEVER trade the midpoint** between nodes — "no mechanical floor, no ceiling, no dealer obligation."

## 2. NODE LIFECYCLE / TAP PROBABILITY — /node-lifecycle + /execution-doctrine
- **Fresh** (untested): **~80%** reaction — target these.
- **Tested** (1 touch): **~66%** — reduced edge, needs cleaner confluence.
- **Delivered** (rejected + moved away, 3rd tap): **~33%** — avoid.
- **Decaying** (time passes, no interaction): skip — "quiet death".
- **"A node tested twice and delivered once is not a setup. It is a graveyard."** Target fresh only.

## 3. ENTRY PRECISION / DEFLECTION — /execution-doctrine
- **Deflection zone: SPX ±5 pts, SPY/QQQ ±$0.50.** Touching anywhere in the band = a tap.
- **Two valid entries, both precise:**
  - **Deflection (node holds):** enter at the **direct tap** inside the zone, *"not after the reaction
    has already printed."* (floor bounce / ceiling fade / reverse-rug)
  - **Break (node fails):** enter on the **confirmed break — a candle that CLOSES through the inner
    node, not just wicks it** (/support-resistance-gex). (rug / breakdown)
- **Invalid:** entering mid-range = "working without a catalyst." Price moving THROUGH the deflection
  zone and continuing = overshoot, tap did **not** deflect (invalidation).
- **Stop:** "one node beyond the invalidation level. Not tight against the entry."
- **R:R: minimum 3:1, non-negotiable.**

## 4. PATTERNS — /heatseeker-patterns + /support-resistance-gex
| Pattern | Config | Type | Dir | Trigger |
|---|---|---|---|---|
| **Rug Setup** | + above spot, − below, spot below the + node | reversal | SHORT | ride acceleration **after** the + node rejects, not the rejection itself |
| **Reverse Rug** | − above, + below, spot above the + node | reversal | LONG | + below deflects up, − above amplifies — higher conviction (both align) |
| **Pika Clouds** | dense + gamma cluster | friction | — | price sticks/rotates; reduce size, fade at cloud edges |
| **Beach Ball** | price overshoots a + node | reversion | fade | **NOT a breakout** — wait for reversion signs (tape stall, volume dry), fade back through |
| **Whipsaw** | conflicting cross-index signals | range | neutral | fade extreme ends only, or sit out |
- **Spring (stacked opposite-sign nodes):** **+GEX over −GEX = "rug pull"** → short the break; **−GEX
  over +GEX = "slingshot"** → long the break. Enter on the confirmed close-through only.

## 5. GAMMA REGIME (the chop filter) — /gamma-regimes
- **RANGE DAY:** + gamma predominates, price inside floor/ceiling, **no trinity confluence**. ✅ fade
  extremes (sell ceiling test / buy floor test), TP before midpoint. ⛔ **do NOT hold for breakouts or
  trend-follow.**
- **TREND DAY:** − gamma accumulating, spot on a key level with **far** nodes, **air pockets** in the move
  direction, **rolling floors/ceilings**, **King node growing rapidly (not static)**. ✅ follow the
  direction, trail behind the rolling floor/ceiling. ⛔ **do NOT fade; do NOT exit on modest pullbacks**
  (that's dealer rebalancing, not reversal).
- **WHIPSAW DAY:** − gamma + air pockets + conflicting signals, no confluence. ✅ fade extreme ends only or
  **sit out.** ⛔ no directional entries in the middle.

## 6. ROLLING FLOORS/CEILINGS (trend confirmation) — /rolling-floors-ceilings
- **Rolling floor UP** = largest floor node migrates to higher strikes across consecutive updates = bullish
  → fade dips. **Rolling ceiling DOWN** = largest ceiling migrates lower = bearish → don't buy into it.
- **Threshold: two consecutive migrations = signal, three = confirmation.**
- Rolling (gradual repositioning) ≠ breakout (sudden structural event).

## 7. TUG-OF-WAR CONFIGS — /support-resistance-gex
- **Config 1 (low-VIX, common):** +GEX below + −GEX above → dealers buy dips / chase rallies → fade edges
  until one absorbs; breakout = follow.
- **Config 2:** −GEX below + +GEX above → dip-buyers get **no** support → choppy/deceptive → fading fails →
  avoid chop, enter only on vol confirmation.

## 8. CROSS-EXPIRY & TRINITY — /support-resistance-gex + /trinity-mode
- **Cross-expiry:** front (0DTE–2DTE = explosive gamma), middle (7–30DTE = vanna/drift), back (45–90DTE+ =
  institutional gravity). **Front + back AGREE → clean move; DISAGREE → chop.** (This is exactly why the
  stock-GEX swing tool uses the aggregate, and 0DTE uses col0.)
- **Trinity:** SPX/SPY/QQQ confluence present → clean directional; absent → range/whipsaw.

---

## DELTA vs our system (code audit 2026-07-21)

### ★ The core finding: the doctrine is already BUILT — the tracker just doesn't use it.
There are **two disconnected pipelines**. (1) The **plays tracker** that actually opens/closes trades
(`tracker/fire-loop.js` → `domain/patterns` → `domain/fire-state.js` → `gateVerdict` → `tracker/plays.js`)
fires on **raw node geometry** with only a few gates. (2) The **grader/briefing path**
(`domain/{structure,bias,synthesis,trinity,significance}.js`, `grader/seven-rules.js`) contains **almost
all the doctrine machinery** — king structure, gamma-regime score, R:R gating, trinity cross-index,
rainbow/whipsaw `no_trade`, pin veto — and the tracker **imports none of it**
(`fire-loop.js:15-27`, `plays.js:14`). So most gaps are **wiring an existing, tested layer into the
entry gate**, not writing new logic.

### Ranked gaps (rule → what the tracker does → fix type)
| # | Doctrine | Tracker today | Fix |
|---|---|---|---|
| **1** | §5 Regime + §4 no-trade vetoes | `classifyRegimes` **is computed every fire** but is context-only — never blocks (`regime.js:124`, not read in `gateVerdict`). `rainbow_road`/`whipsaw` `no_trade` + `pika_cloud` PIN gate only the **unused** grader path. | **WIRE existing** — highest leverage, lowest risk |
| **2** | §3 Entry precision (deflection tap / confirmed close-through) | **Missing everywhere.** Fires the instant a pattern is detected on one 1-min snapshot (`fire-state.js:103`); no confirm bar, no close-through, no retest. Trapdoor fires *before* the break by design (`trapdoor.js:9`). | **NEW logic** |
| **3** | §6 Rolling floor/ceiling + node-flip direction switch | **Not implemented.** Direction is hard-wired per state (`plays.js:21-27`); no dominant-pika above→below flip detection; the only "flip" is a gamma-vs-vanna divergence that only ever yields *bear continuation*. | **NEW logic** |
| **4** | §8 Cross-expiry (0DTE vs monthly) agreement | Monthly king is **fetched then discarded** — tracker reads only front expiry (`constants.js:14-16`, `client.js:168-179`). | **WIRE** (data already fetched) |
| **5** | §1 shared King/floor/ceiling object | `deriveStructure`/`significance` compute it but only for the grader; tracker recomputes ad-hoc per pattern (`rug-setup.js:22`), no authoritative king driving entries. | **WIRE** |
| **6** | §2 Tap freshness (fresh 80 / tested 66 / delivered 33) | **Not implemented anywhere** — no tap-count per node. | **NEW logic** |
| **7** | §3 Deflection tolerance consistency | Velocity bears use ±$5×1.5 (`trapdoor.js:33`); rug reversals use flat **±1% of spot** (`rug-setup.js:30`) instead of the ±$5 zone. | **Config fix** |
| **8** | §5 Bracketed-king pin-fade veto | No regime-level "two kings straddle spot → suppress conviction" gate; only per-pattern geometry rejections. | **WIRE + gate** |

### 2026-07-20 maps perfectly
That was a **Range→Whipsaw** tape (positive gamma all day, 7490/7440 kings bracketing spot, no clean
trinity). The grader path would flag low regime-score / PIN / no-trade — but the tracker ignored it and
fired **mid-range directional reversals** (§0 "middle = death", §5 "range day = don't trend-follow"). Wiring
gap #1 alone likely suppresses today's three worst losers (the bull reversals into the bracket). The two
winners were bear-continuation into the growing floor — the aligned trade.

### Exits (already close to doctrine — §5 trend-day "trail behind rolling floor")
v2 structural exit already: PIN-on-spot kill, opposing-anchor-hardening exit, and **HOLD when barney fuel
grows ≥2×** (lets winners run) — that's the trend-day "don't exit on modest pullbacks." Reasonable. The
open question stays the +45% cap (see backtest-improve/FINDINGS.md — loosen for barney/runner days).

### Implication for the reproduction test
To reproduce a Glitch/Falcon day, I can run that day's surface through the **grader/doctrine layer that
already exists** (structure + regime + bias) to see which fires it would have allowed/vetoed — i.e. simulate
"tracker WITH the doctrine wired in" — and compare to his results. The building blocks are present; the
question is whether connecting them reproduces his edge. Clause 0: all proposals → DECISIONS NEEDED.
