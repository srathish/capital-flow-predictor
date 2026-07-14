# Doctrine-vs-Implementation Compliance Audit — 2026-07-14

**Scope:** Skylit-Academy doctrine (`docs/skylit-academy.md`), our own
`research/exit-study/TRADING_DOCTRINE_v2.md`, `docs/findings.md`,
`docs/execution-policy-draft.md` **vs** the code that actually opens and manages
tracked plays.

**Status:** RESEARCH ONLY (Clause 0). No code changed. Findings + proposals only.

---

## 0. The finding that reframes the whole audit: there are TWO decision engines, and the traded one is the poorer one

The repo contains a full "validated implementation" of the doctrine —
`bias.js` (6-component score), `trinity.js` (cross-index confluence),
`synthesis.js` (9-step decision), `execution.js` (R:R gating, node stops,
node-to-node targets), `structure.js` (floor/ceiling/**gatekeeper**/**air
pocket**), `lifecycle.js` (fresh/tested/delivered + tap counter). **None of it is
on the path that opens a real play.**

Import trace (verified):

- **Traded path:** `fire-loop.js` → `patterns/index.js` (`runPerTickerPatterns`)
  → `fire-state.js` (`pickState`) → `plays.js` (`openPlaysForFire`). Gates in
  between: `gateVerdict()` (after-15:15, bear-below-anchor, bull-tape-gate,
  optional flip-flop) only.
- **`execution.js` is imported ONLY by `synthesis.js`; `synthesis.js`,
  `bias.js`, `trinity.js` are imported ONLY by `ingest/snapshot-poller.js`**,
  which ends at `stmts.insertDecision.run(... 'would_enter' | 'reject' ...)`
  (snapshot-poller.js:262) — it writes a `decision_log` row and **never touches
  `tracked_plays`.**

So every doctrine rule that IS implemented (R:R, trinity, bias, gatekeepers, air
pockets, node stops, node targets, tap degradation) lives on a research/logging
path whose output nothing trades. The path that opens the plays the operator
watches keys purely on single-pattern GEX node geometry. This is why "nobody
noticed for months": grepping the codebase shows the rules present — they're just
wired to `decision_log`, not to `openPlaysForFire`.

Every "absent" below means **absent from the traded path**; where the concept
exists on the dead path I say so explicitly.

---

## 1. COMPLIANCE MATRIX

Severity = expected P&L impact if the rule matters and we violate it.
"WHERE" cites the traded path unless noted.

### A. Charts First / market structure (Ch1, Ch4 refresher, Ch11, Ch12)

| # | RULE (verbatim + line) | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| A1 | "**Heatseeker is not a signal generator.** … **Heatseeker is a confirmation tool.** **Charts create the initial thesis.**" (skylit L100-102; echoed L235, L611, L1526, L1549) | **NO** | absent (traded path) | **critical** | Patterns *are* the signal generator. `runPerTickerPatterns` reads only `nodes`+`spot` and emits `detected:true`; `fire-state` turns that straight into a fire. No price-structure input exists anywhere in `fire-loop.js`/`plays.js`/`patterns/*`. |
| A2 | "**Where is price located within the market structure?** … approaching support / resistance / midpoint / trending" (L120-127) | **NO** | absent | **critical** | Nothing computes support/resistance, swings, or trend. `grep -i "support|resistance|swing|trend|chart"` over the traded path returns only variable names (`supportingStrikes`). |
| A3 | "**We trade extremes. We avoid midpoints.** … When price is sitting in the middle of a range, there is no structural edge. Without an edge, the trade should not exist." (L193-195; L436 "We fade extremes, not midpoints"; L937 "Do NOT trade the midpoint") | **NO** | absent | **critical** | Rug/reverse-rug fire on the *existence* of a pika+barney arrangement regardless of where spot sits between floor and ceiling. A spot at the exact midpoint with the right node signs fires identically to a spot at an extreme. No range or midpoint concept is read at fire time. |
| A4 | "generally not good practice to buy puts at a double bottom on higher-timeframe support" (L221) | **NO** | absent | major | No level memory / no HTF structure; a bear pattern will fire into support because support is invisible to the engine. |

### B. Dealer positioning & node primitives (Ch2, Ch3)

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| B1 | Yellow=pika=positive gamma; purple=barney=negative gamma (L266, L283, L300-301) | **YES** | `significance.js:56`, `fire-loop.js:211` | — | `sign = gamma>0?'pika':gamma<0?'barney':'zero'`. Correct. |
| B2 | "**Always prioritize node size over node color.**" King = "strike with the **largest absolute exposure value**" (L319, L400) | **YES** | `significance.js:39-48` (argmax\|gamma\|); patterns rank candidates by `relativeSignificance` | — | Faithful. `relativeSignificance = \|gamma\|/Σ\|gamma\|` (significance.js:57, mirrored fire-loop.js:213). |
| B3 | "Nodes act like magnets. The bigger they are, the stronger the pull. **The closer they are, the stronger the pull.**" (L311) | **partial** | magnitude yes; proximity computed (`distanceFromSpot`) but **not** used to gate/weight a fire | minor | Distance is recorded, never scored in the traded path. |
| B4 | Floor = largest pika below spot; Ceiling = largest pika above spot (L416-424) | **partial** | `structure.js:22-36` (correct) but **dead path**. Traded path derives an "opposing pika" only inside the *exit* diff (`plays.js:242-244`) | major | Floor/ceiling exist as concepts only for the exit read, not for entry/targeting. `deriveStructure` is imported by `grader` + `snapshot-poller`, never by the tracker. |
| B5 | **Gatekeeper** = node between two larger structural nodes (L440-448) | **partial** | `structure.js:44-59` `findGatekeepers` exists — **dead path only** | major | Never consulted at fire time. Prompt's belief "gatekeeper absent" is *half* right: it exists in code but is absent from every traded decision. (`min_significance_for_gatekeeper` IS read by rug/reverse-rug, but only as the 3% barney threshold — not as a gatekeeper concept.) |
| B6 | **Air pocket** = low-GEX low-resistance zone (L450-458, Ch8) | **partial** | `structure.js:65-92` `findAirPockets`/`liquidityVacuums` exists — **dead path only** | minor | Same as B5: computed on the ingest path, never used to gate a fire or shape a target. |

### C. Gamma regime & day forecasting (Ch4)

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| C1 | "**What market regime can we expect today?** That answer changes everything." Identify regime before trading (L494-501, L648) | **partial → recorded-not-used** | `regime.js` computes 1/5/10/15/30m BULL/BEAR/CHOP; `significance.js:67` computes `regimeScore` | **major** | `classifyRegimes(getSurfaceHistory(ticker))` runs at fire time (fire-loop.js:309) but its output is only (a) printed in the log strip and (b) stamped into `supporting_state.regimes` for later analysis. **It never enters `gateVerdict` or `openPlaysForFire`.** The `regime_score` you asked about (significance.js:67) is on the ingest path and is recorded to the snapshot row — used by nothing in the fire decision. Confirmed: regime is context, not a filter. |
| C2 | Type-of-day: Range(pos-γ) / Trend(neg-γ) / Whipsaw. "**When in doubt, sit out.**" (L554-599) | **NO** | absent | major | No day-type classifier gates entries. See E5/E6 for the stand-down patterns being un-wired. |
| C3 | Regime changes *behavior not direction*; in neg-γ "assume overshoot first," size/stop differently (L568, L958, L149) | **partial (dead path)** | `execution.js:146-150` shrinks size 30% in negative regime — dead path | minor | The only regime-aware sizing is in `execution.js`, which nothing trades. Traded path sizes every fire identically (1 ATM contract). |

### D. Patterns require confluence — never isolate (Ch5, Ch10, Ch12)

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| D1 | "A pattern only has meaning when combined with chart structure, gamma regime, node magnitude, and **cross-index alignment**. **If you isolate a pattern, you will misread the market.**" (L671; L762 "Patterns Do NOT Exist in Isolation"; L809; L1716) | **NO** | absent | **critical** | A single detector returning `detected:true` on one ticker fires that ticker's play. No confluence requirement. |
| D2 | Trinity: "**2/3 confluence is bare minimum for trinity**"; "If the system disagrees, your trade is weak." (L1542, L1605, L1724) | **NO** (node-confluence); tape-proxy only | `trinity.js` exists — dead path. Traded path has only `bull-tape-gate.js` (all-3-below-prior-close blocks bulls) + per-ticker bear anchor | **critical** | The gates compare each index's *spot vs its own prior close* — a coarse tape-direction proxy, **not** node/floor/ceiling alignment across SPX-SPY-QQQ. A SPY fire never checks whether QQQ/SPX node structure agrees. |
| D3 | Rug (bearish): pika above, barney below it, spot below the pika (L677-681) | **YES** | `rug-setup.js:22-53` | — | Structurally faithful (pika>spot ≥5%, barney in [spot·0.99, pika) ≥3%, no opposing pika cluster). |
| D4 | Reverse rug (bullish): negative-γ on top, positive-γ below, spot above the positive node (L692-696) | **partial** | `reverse-rug.js:21-47` | minor | Enforces pika<spot and barney above pika, but caps barney at `spot*1.01` — so the "negative node on top" sits at/just above spot, not necessarily as a true ceiling above. Acceptable simplification; note it. |
| D5 | "**We do NOT trade breakouts.**" Beach ball is overshoot→reversion, not breakout (L730, L997 rule #3 "Do NOT chase moves"); doctrine trades reversals not continuation (L1107, L1151) | **partial / contradiction** | `trapdoor.js` fires **BEAR_TRAPDOOR** as an explicit *pre-break continuation* ("fires BEFORE the break — the leading edge of a cascade", trapdoor.js:9) | major | Trapdoor is a continuation/break trade, which Ch5-7 disavow. `findings.md §9` openly notes the spec has no continuation pattern and proposes adding them — so this is a *known, deliberate* departure, but it contradicts Skylit Ch6/Ch7 and is not reconciled in the doctrine docs. |

### E. Execution — entry / stop / target / tap (Ch6, Ch9, Ch12)

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| E1 | "**Enter at the direct tap of major nodes. Not before. Not after.**" Deflection zone ±$0.50 SPY/QQQ, ±$5 SPX (L840, L849-853, L879, L999) | **NO** | `plays.js:38-54` picks the ATM strike at *current spot*; fire triggers on structure existence, not on spot reaching a node | **critical** | Rug/reverse-rug never require spot to be within the deflection zone of the pika anchor — the pika can be 1%+ away. Entry is "wherever spot is now," the opposite of "the node is the trigger." `deflectionZone()` is used only inside trapdoor/beach-ball/vanna proximity checks, never as the entry gate. |
| E2 | Stop = "**one node beyond invalidation**," break-and-hold 1 node above/below (L858-860, L978-980) | **NO** | traded path has **no price stop at all** | **critical** | `plays.js` exits are: (a) trailing giveback on the *option mark* (arm +50%, exit −15% off peak, plays.js:146-147), (b) structural surface diff (opposing pika hardening / pin), (c) EOD. There is no underlying-price stop and no break-and-hold. `execution.js:44-53` builds a node-based stop — dead path. **NB: this override is evidence-backed** — `findings.md §15` shows node-based stops lost money (−100 bps, 17/24 stopped out); the trailing/structural exit replaced them deliberately. Severity is for the *doctrine gap*, not necessarily a mistake. |
| E3 | "**R:R … 3:1 = standard, aim for higher; 2:1 = acceptable; Below = avoid.**" "Skylit doctrine requires a 3:1 minimum R:R." (L433, L973-977, L1704) | **NO** | traded path computes no R:R | **critical** | No target/stop distances are compared before a fire. `execution.js:75-78` enforces `rr_gating.reject_below` — but (i) dead path and (ii) lowered to **1.7** (`calibrated_thresholds.json` rr_gating), itself below the 2:1 "acceptable" floor and far below 3:1. So even the dead-path R:R contradicts doctrine, and the live path has none. |
| E4 | "**Targets = Structure. Play node-to-node.** From floor to ceiling." (L989-991, L914, L1709) | **NO** | traded path has no profit target | major | `plays.js` never sets a take-profit; it only trails and waits for structure-invalidation or EOD. `execution.js` has both structural and fixed-25bps TP modes — dead path. Node-to-node targeting is absent from what trades. |
| E5 | Node-tap probability: 1st tap best (~80%/emp 56.6%), **3rd tap = low-quality, avoid** (L916-933) | **NO** | `lifecycle.js` tracks tap counter — dead path | major | Fire can trigger on the Nth tap of a level with no degradation check. Tap state never reaches `fire-state`/`plays`. |
| E6 | "**When in doubt, sit out**" / Rainbow Road = "**No-trade conditions**" / Whipsaw = "stand down" (L599, L756, L818, L1685) | **NO** | `rainbow-road.js`, `whipsaw.js` detectors run but are **not in `PATTERN_TO_STATE`** (fire-state.js:42-49) | major | `pickState` only maps rug/trapdoor/vanna/overnight/reverse-rug/pika_cloud. A `rainbow_road:{detected:true}` (chaos, no-trade) or `whipsaw` result **cannot veto** a concurrent rug/reverse-rug fire. The doctrine's explicit stand-down signals are computed and discarded on the traded path. (`aggregatePatternSignal` honors `no_trade` — but that's the dead bias path.) |
| E7 | Node quality: "**We do not target used levels. We target fresh positioning.**" Real vs hedge: growth=intent, decay=protection (L1334, L1376, L1409) | **NO** | `lifecycle.js` + `classification.js` (hedge/real) exist — dead path | major | No freshness or growth/decay gate at fire time. Ironically the *exit* logic does read growth (barney fuel accumulating → hold; opposing pika hardening → invalidate, plays.js:216-283) — so growth-vs-decay is used to *exit* but never to *enter*. |
| E8 | "No new fires after 15:15 ET" (our finding, not Skylit) | **YES** | `fire-loop.js:68,115` | — | `LAST_FIRE_ET_MINUTES = 15*60+15`. Implemented. Skylit itself states no time-of-day rule; this is a `VALIDATION_REPORT` finding. |
| E9 | One live play per (ticker,direction); no adding/averaging | **YES** | `plays.js:86-95` dedup; `plays.js:21-27` single ATM leg | — | Matches execution-policy-draft §1 "1 contract only." |

### F. Rolling structure, velocity, delivery (Ch7, Ch8, Ch9)

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| F1 | Rolling floor up = bullish bias; rolling ceiling down = bearish — "**But tightening range alone is not a trade.** … No reaction: no trade." (L1052, L1069, L1718) | **partial** | `regime.js:101-107` "wall shift" scores floor/ceiling hardening — context only | minor | Correctly treated as bias-not-trigger, but since regime is unused (C1) it informs nothing. |
| F2 | "**Do NOT Fade Velocity.** If price is in an air pocket AND accelerating, you are stepping in front of dealer flow." (L1274) | **partial** | trapdoor/vanna use velocity in their own triggers; no global "don't fade acceleration" guard | minor | A reverse-rug (fade) can fire into an accelerating down-move; nothing checks velocity to suppress a counter-velocity fade. |
| F3 | Price delivered node→node through structure; far OTM nodes are possibility not target (L1347-1394) | **partial (dead path)** | `findTargets` walks node-to-node in `execution.js` — dead path | minor | Traded path has no targeting at all (E4), so cannot violate delivery logic — it just doesn't implement it. |

### G. Our own doctrine (TRADING_DOCTRINE_v2) vs the code

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| G1 | **Clause 2:** "Node position does not forecast direction. … node-alone is a **trap** (49%/−6%). Direction conviction = macro regime + 20-day flow + live 3-index tape." | **NO — code does exactly the trapped thing** | traded path sets direction 100% from node geometry (rug→puts, reverse-rug→calls) | **critical** | This is the sharpest self-contradiction: our *own* empirical doctrine says node-picks-direction is a 49%/−6% trap, yet every fire's direction is chosen by node structure alone. Flow and macro regime are not inputs. The bull-tape/bear-anchor gates are a *partial* nod to "don't fight the tape" (Clause 5) but are a coarse spot-vs-prior-close proxy, not the 20-day flow / regime the clause specifies. |
| G2 | **Clause 5:** "Don't fight the tape (bull-tape gate). Gate fires by direction × tape." | **YES** | `bull-tape-gate.js` + bear anchor (`fire-loop.js:125-133`) | — | Implemented and evidence-backed. The one doctrine-aligned entry filter that trades. |
| G3 | **Clause 6:** "Grade on `close_mark` (realized), never `best_mark` (peak) … peak overstates by ~45 pts. [Reporting fix is DECISION #1, pending approval — not yet applied.]" | **NO (known)** | EOD summary/tracker reports `best_mark`; `refreshLivePlays` maintains `best_mark`/`best_pct_gain` (plays.js:300-322) | major | Consistent with the clause's own "pending" note. Realized vs peak divergence is a reporting-integrity issue, not a P&L-generating leak, but it inflates perceived edge. |
| G4 | **Clause 3:** dominant **pika** King pins as a ±0.4% **zone**; barney Kings do NOT pin | **partial** | `plays.js:224-238` PIN-invalidate uses a pika within 0.5% of spot owning ≥20% + grown 1.5× | minor | The exit-side pin logic is pika-specific and zone-based — aligned. There is no *entry* use of the pin zone, and PIN state is informational only (fire-state.js:15). |
| G5 | **Clause 8b:** "vanna-FLOW is a real partial direction compass … use it as a directional CONFIRMATION filter (fire only when signal agrees with vanna imbalance)" | **NO** | absent | major | The single walk-forward-surviving signal in the whole program (net-vanna imbalance above vs below spot) is not used to confirm or veto any fire. Patterns read per-strike `vanna` locally (trapdoor/vanna-persistent) but nothing computes the above-minus-below-spot imbalance as a directional filter. Highest-value *addition* the research points to. |
| G6 | **Clause 0:** live engine unchanged without operator approval | **YES (by us)** | this audit changes nothing | — | Compliant. |

### H. Execution-policy-draft (explicitly DRAFT / pre-agentic — informational)

| # | RULE | IMPL? | WHERE | SEV | EVIDENCE |
|---|---|---|---|---|---|
| H1 | Daily loss stop −15%; 3-consecutive-loss stop; trade-count cap 5/day; max 2 concurrent | **NO** | absent | minor (draft) | The paper tracker enforces none of these. Only per-(ticker,direction) dedup exists, allowing up to 6 concurrent (3 tickers × 2 directions). Draft is not yet in force, so informational. |
| H2 | Account drawdown ladder (−20% half size, −30% halt) | **NO** | absent | minor (draft) | No equity/HWM tracking in the tracker. |
| H3 | "Enter after 15:15 ET" forbidden / "hold 0DTE past 15:55 ET" forbidden | **partial** | 15:15 entry cutoff YES (E8); 15:55 hold cutoff **NO** — EOD close waits for `phase==='closed'` i.e. 16:00 (`refresh-loop.js:40-42,74-75`) | minor (draft) | Plays are held to 16:00, 5 min past the draft's 15:55 forced-flat. |
| H4 | Eligible premium band $0.50–$2.00, SPY/QQQ only | **NO** | absent | minor (draft) | Tracker fires SPXW too and applies no premium band. Draft not in force. |

---

## 2. VIOLATIONS RANKED BY EXPECTED P&L IMPACT

1. **G1 / A1 / D1 — direction and the entire thesis come from single-pattern node geometry, which our own doctrine calls a 49%/−6% trap.** (critical) The traded engine is exactly the thing Clause 2 says loses money: node-picks-direction, one pattern, no chart, no flow, no confluence. Everything else is downstream of this. Biggest expected P&L bleed and the root cause.

2. **A3 / E1 — no extreme-vs-midpoint / direct-tap gate.** (critical) Fires wherever spot happens to be, not at the node. Doctrine's entire "cheap fill at the tap, near-zero drawdown" premise (L879) is unmet; you enter mid-range into chop as readily as at an extreme. Directly degrades entry price and win rate.

3. **E3 / A2 — no R:R rule of any kind on the traded path (doctrine floor 3:1).** (critical) Nothing checks that reward ≥ 3× risk (or 2×, or anything). The one R:R implementation is dead code and itself set to 1.7. Systematically admits negative-expectancy geometry.

4. **D2 — no cross-index (trinity) confluence.** (critical) Per-ticker isolated fires; the tape gate is a weak proxy for the doctrine's node-alignment requirement. Divergent-tape days ("Divergence is a warning", L1508) fire freely.

5. **C1 — regime computed every tick but never gates a fire.** (major) `regime_score`/`classifyRegimes` are recorded, not used. Trend/whipsaw days that doctrine says to sit out (C2/E6) are fired into.

6. **E6 — Rainbow-Road / Whipsaw "no-trade / stand-down" signals are computed and discarded** (not wired to `PATTERN_TO_STATE`). (major) The engine cannot stand down even when its own chaos detector fires.

7. **E7 / E5 — no node-freshness or tap-degradation gate at entry.** (major) Enters delivered/3rd-tap levels the doctrine says to skip. (Growth is used on exit, not entry.)

8. **G5 — the one walk-forward-robust directional signal (vanna imbalance, Clause 8b) is not used as a confirmation filter.** (major) Highest-value *addition*, not just a gap.

9. **E2 / E4 — no node-based stop and no node-to-node target.** (major, but E2 is an evidence-backed override — see §15 findings). The trailing/structural exit is a defensible replacement; the doctrine gap is real but the deviation was earned by data. E4 (no profit target at all) is the weaker half.

10. **D5 — trapdoor trades continuation, which Ch5-7 disavow.** (major) Known, deliberate (findings §9), but unreconciled with doctrine.

11. **G3 — reporting on peak (`best_mark`) not realized (`close_mark`).** (major, integrity) Inflates perceived edge ~45 pts; Clause 6 fix already queued as DECISION #1.

12. **B4-B6 — floor/ceiling/gatekeeper/air-pocket exist in code but only on the dead path.** (major/minor) Not absent from the repo (correcting the prompt's assumption) but absent from every traded decision.

---

## 3. WHAT IS IMPLEMENTED CORRECTLY (honest ledger)

- **Node primitives** (B1, B2): pika/barney signing and King=argmax|gamma| /
  relative_significance are faithful to Ch2/Ch3.
- **Rug / reverse-rug structural definitions** (D3, D4): match the Ch5 geometry.
- **Bull-tape gate + bear anchor** (G2): the one entry filter that trades is
  doctrine-aligned (Clause 5) and evidence-backed (64-day study).
- **15:15 entry cutoff and dedup** (E8, E9): match findings + draft §1.
- **Exit-side structural read** (Clause 3 pin, barney-fuel hold): the
  growth/decay and pika-pin-zone logic in `plays.js` is genuinely doctrine-shaped
  — it's just applied to exits, not entries.
- **Node-based stops were removed on evidence** (E2): `findings.md §15` justifies
  the departure; this is a defensible override, not an oversight.
- **Clause 0 discipline**: the research/live split is real and respected.

---

## 4. DECISIONS NEEDED (proposals — no code changed)

1. **Reconcile the two engines.** Decide whether the traded path *should* consult
   `synthesis.js`/`trinity.js`/`execution.js`, or whether those modules should be
   deleted/quarantined so the repo stops implying rules it doesn't run. Right now
   the doctrine "looks implemented" because it is — just not where it counts.
2. **Add a confluence/chart gate before the highest-leverage fires** (A1/D2): at
   minimum a cross-index tape+node agreement check; ideally a spot-within-range
   position (extreme vs midpoint) filter (A3).
3. **Wire regime and the no-trade patterns into `pickState`/`gateVerdict`** so
   Whipsaw/Rainbow can veto and trend/whipsaw regimes can stand down (C1/C2/E6).
   Lowest-effort, high-alignment change.
4. **Prototype the Clause 8b vanna-imbalance confirmation filter** (G5) —
   fire only when net-vanna(above−below spot) agrees with fire direction. The
   research says this is the only OOS-robust compass we have.
5. **Apply the Clause 6 realized-not-peak reporting fix** (G3, already DECISION #1).
6. Any of the above requires explicit operator approval per Clause 0.

---

*Audit method: read all four doc files in full; traced imports for the traded
path (`fire-loop → patterns → fire-state → plays`) vs the logging path
(`snapshot-poller → synthesis → execution`); grepped the traded path for every
doctrine concept. No code, config, or live behavior was modified.*
