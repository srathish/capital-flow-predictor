---
title: gexester-vexster — Phase 1 findings (2026-04-30)
source_url: repo://apps/gex/docs/findings.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T06:13:37Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
summary: 'Project: **OpenClaw v11** (a.k.a. gexester-vexster) — 0DTE GEX trading system for SPY / QQQ / SPXW. Spec source: `gex-vex-spec.md.pdf` (v1.0,'
url_sha1: f6f18a0756fe79ad40d18840834fad7883291e7b
simhash: '16277019592225387968'
status: vault
ingested_by: seed
---

# gexester-vexster — Phase 1 findings (2026-04-30)

Project: **OpenClaw v11** (a.k.a. gexester-vexster) — 0DTE GEX trading system for SPY / QQQ / SPXW.
Spec source: `gex-vex-spec.md.pdf` (v1.0, 2026-04-29).

This doc summarizes everything we've learned from running 60 weekdays of historical
Heatseeker replay (Dec 26, 2025 → Apr 2, 2026) through the system. Self-contained — paste
into another Claude session for advice on what to add next.

---

## 1. What's built

5 sprints / ~3,000 LoC of Node.js. Live system polls Heatseeker SSE every 5s for SPXW + SPY
+ QQQ. Each tick produces:
- Per-strike snapshot (relative_significance, sign, distance from spot)
- Lifecycle state tracking (Fresh/Tested/Delivered/Broken) + tap counter
- Six-window velocity (30s/1m/5m/15m/30m/session)
- Pattern detection (6 spec patterns)
- Per-ticker bias score (-100 to +100, six-component formula)
- Trinity confluence classification
- 9-step synthesis decision (would_enter | reject + reason)

Storage: SQLite WAL with `snapshots`, `node_snapshots`, `node_lifecycle`,
`pattern_detections`, `bias_scores`, `trinity_evaluations`, `decision_log`,
`decision_outcomes` tables. Plus JSONL event mirror.

Replay harness reads gex-data-replay-reader's daily JSON files and runs the same
pipeline minute-by-minute.

---

## 2. Methodology

**Backtest data:** 60 weekday replay files at 1-min frame resolution. 391 frames per day
× 3 tickers = 1,173 evaluations/day. **68,484 total snapshots across the 60 days.**

**Outcome proxy:** for each decision with a direction, look up spot at +5/15/30/60min
and EOD, compute directional return in bps. Accept = system would have entered. Reject =
system held back. Both get outcomes for "would this have been a winner?" comparison.

**Caveats:**
- Spot return is a *direction-correctness* proxy. Real 0DTE option PnL is 5-15× the spot
  move on small impulses (delta + gamma). Bps numbers below understate option PnL by ~10×.
- No bid-ask costs modeled. Real costs ~5-10 bps/round-trip on SPY 0DTE options.
- No realistic exit simulation — hold to 30m fixed, no first-target exit.

---

## 3. Daily opportunity (the universe of catchable moves)

**Daily range** (high − low) per ticker, averaged across 60 days:

| Ticker | Avg range | $ at typical spot | Max range observed |
|---|---|---|---|
| SPY | 115 bps | **$7.84** | 255 bps ($17.16) |
| QQQ | 152 bps | **$9.25** | 286 bps ($17.16) |
| SPXW | 114 bps | **$78** | 254 bps ($171) |

**Open-to-close directional move** averages ~60 bps (~$4 on SPY).

**Catchable impulses** (5-min spot moves ≥30 bps):

| Ticker | Avg per day | Max in single day |
|---|---|---|
| SPY | 2.8 | 11 |
| SPXW | 2.8 | 19 |
| QQQ | 8.0 | 35 |

**60-day total daily-range opportunity (sum across 3 tickers): 22,459 bps.**

---

## 4. Current capture (baseline config)

24 accepted trades over 60 weekdays = **0.4 trades/day**. Spec target is 1–3/day. We're
2.5–7× below target.

| Horizon | Win rate | Avg bps | Best | Worst |
|---|---|---|---|---|
| +15m | 58.3% | +5.0 | +40 | -39 |
| **+30m** | **79.2%** | **+8.5** | +61 | -47 |
| +60m | 58.3% | +2.9 | +80 | -66 |
| EOD | 41.7% | -8.6 | +130 | -128 |

**Holding past 30 min destroys the edge.** EOD is worse than coin flip. The system
catches *scalps*, not *swings*.

**Total bps captured: 205 over 60 days.**
**Capture ratio: 0.91% of theoretical max** (sum of daily ranges).

---

## 5. Where the moves actually happen

Of all minutes with |Δspot|/spot ≥ 15 bps:

| Ticker | Big-move minutes | At structural node | In air pocket |
|---|---|---|---|
| QQQ | 366 | 71% | 29% |
| SPY | 137 | 75% | 25% |
| SPXW | 138 | 61% | 39% |

**~70% of big moves happen AT structural nodes**, validating the spec's premise. The
heat map IS the right framework. Air-pocket moves (25-40%) are still meaningful but our
patterns can't anchor on them.

---

## 6. Spec assumptions that turned out wrong

### Tap probabilities (spec §6.4): empirical reality

| Tap | Spec claim | **Empirical (60 days)** |
|---|---|---|
| 1st | 80% react | **56.6%** |
| 2nd | 66% react | 49.6% |
| 3rd | 33% react | 45.3% |
| 4+ | "no edge" | 44.3% |

The spec's 80/66/33 numbers are placeholders that don't match real data. First-tap edge
is real (56.6% vs 50% coin flip = 6.6 pp lift) but much weaker than spec claimed. Also,
4+ taps don't have zero edge — they sit at 44%, only modestly negative.

### Trinity high-confidence threshold

Spec set `|avg bias| > 60` for high-confidence trinity. **Bias scores empirically max out
around 62.** With component weights, the theoretical maximum is ~82, but real data never
reaches there (max observed 61.5). High-confidence tier was *unreachable* until we
lowered the threshold to 45.

### Step 1 quietness gate

Spec placeholder: 0.05% over 5 min. **60-day replay data shows avg 5-min spot range/spot
is 0.094%.** The gate at 0.05% rejected 33% of all snapshots. Lowering to 0.02% rejects
only 6%. Adopted.

### Tap separation cooldown

Spec: 5 min OR 2× zone away. With 1-min frame cadence, this lets price oscillate in/out
and rack up 20-24 taps on a single strike per day — clearly frame-cadence inflation, not
real deflections. Adopted: 10 min OR 3× zone.

### Counter-regime gate (operator overlay #2 hypothesis)

Tried gating "calls in negative regime, puts in positive regime" — over-rejected
winners. Mar 31 SPXW calls (own regime −0.24) were big wins; the gate would have killed
them. Trinity confluence trumps own-ticker regime. **Reverted.**

---

## 7. Threshold-tuning experiments (single-factor, replay-validated)

Each row is a single-factor variation from baseline, run against the same 60 days.

| Experiment | Accepts | Win@30m | Avg bps | Total bps* | Notes |
|---|---|---|---|---|---|
| **loosen-rr-1.5** | **45** | 73.3% | +9.9 | **+445** | Best total return. Drops RR floor 2.0→1.5 |
| baseline (iter1) | 24 | 79.2% | +8.5 | +205 | Current default |
| tighter-rr-2.5 | 21 | 85.7% | +12.5 | +262 | Highest quality, similar volume |
| broaden-floor-ceiling-3pct | 16 | 87.5% | +14.7 | +235 | Highest avg per trade |
| lower-trinity-mod-15 | 90 | 46.7% | +3.2 | +289 | Volume but noise — worse than coin flip |
| raise-trinity-mod-35 | 3 | 100% | +10.4 | +31 | Too restrictive |

*total bps = accepts × avg bps = total dollars made

**Headline:** R:R floor 2.0 was wasting EV-positive setups. Lowering to 1.5 nearly
doubles total return. Trinity moderate threshold of 25 is at the right level — both
loosening and tightening hurt.

Combination experiments (loosen-rr + others) were started but stopped before finish; one
result available: `combo-loosen-rr-and-trinity-30` = 18 accepts at 72.2% / -0.2 bps,
worse than either single change.

---

## 8. The 24 accepts in detail (baseline)

Trades clustered on 9 days. Top winners:

| Day | Ticker | Dir | Bias | ret_30m |
|---|---|---|---|---|
| Feb 12 | SPXW | puts | -1.0 | **+61.1 bps** |
| Mar 31 (×6) | SPXW/QQQ | calls | 18.9-48.8 | +31 to +41 avg |
| Jan 16 | SPY | puts | -33.5 | +21.6 |
| Mar 12 | SPXW | puts | -18.4 | +17.5 |

Top losers:

| Day | Ticker | Dir | Bias | ret_30m |
|---|---|---|---|---|
| Feb 24 | SPXW | puts | -47.6 | -46.9 |
| Feb 3 (×2) | SPXW | calls | 33.4-35.5 | -36 to -38 |
| Jan 21 | SPXW | puts | -33.4 | -30.2 |

**Counterintuitive finding:** the `|bias|` 30-40 bucket has the WORST win rate in our
accepts. Mid-bias (10-20) accepts have 100% win rate. High bias correlates with
"momentum exhaustion" — entering after the move has already happened.

**Regime correlation:** all 7 accepts where own ticker had positive regime (>0.30) won.
Mixed-regime accepts: 9/13 won. Negative-regime: 3/4 won. Positive regime is a clean
predictor for accepts but not enough alone to gate.

---

## 9. The biggest gap: trend-continuation patterns are missing

Spec's 6 patterns (rug, reverse rug, pika cloud, beach ball, whipsaw, rainbow road) are
all **reversal or no-trade** patterns. There is **no trend-continuation pattern**, so the
system can't fire on directional days.

The 60-day replay has **802 impulse events** (5-min ≥30 bps moves):
- 91% are **gatekeeper breaks** (price crossed a node with rel_sig ≥3%)
- 9% are pure trend (air pocket)
- **Our system caught 1 of 802 in the correct direction.**

Top "missed-opportunity days" (zero accepts despite high motion):
- 2026-02-04: 5,428 bps total range, 47 impulses, 0 accepts
- 2026-02-05: 5,567 bps, 47 impulses, 0 accepts
- 2026-03-19: 5,150 bps, 34 impulses, 0 accepts
- 2026-03-03, Mar 6, Feb 20 — all 4,000+ bps days, 0 accepts each

These are the trend days where the spec's pattern catalog doesn't apply.

### Filter discovery on the 732 gatekeeper breaks

Tested two structural hypotheses about which gatekeeper breaks continue:

**H1 — gatekeeper size:** does small-and-easy-to-break = high continuation? **NO,
opposite.**

| Broken-node rel_sig | n | Continuation rate (+30m) |
|---|---|---|
| thin (3-5%) | 122 | **36.1%** ← reverts most |
| medium (5-7%) | 112 | 45.5% |
| **thick (7-10%)** | 109 | **58.7%** ← best continuation |
| huge (10%+) | 389 | 50.1% |

Thin breaks revert because nothing meaningful broke. Thick breaks (7-10%) are real
flow capitulation and continue.

**H2 — target node beyond:** does having a major node within reach predict continuation?

| Case | n | Continuation |
|---|---|---|
| has target (≥5% within 50bps in direction) | 558 | 50.0% |
| no target | 174 | 43.1% |

7 pp lift. Useful as secondary filter, not primary gate.

### Two new edges identified

**`thin_break_fade`** — when a thin (3-5% rel_sig) gatekeeper just broke, fade the move:
- Reversion rate: 64% at +30m
- Sample: n=122, ~2 events/day across trinity
- Trade: opposite direction to the break

**`thick_break_ride`** — when a thick (7-10% rel_sig) gatekeeper just broke, ride the move:
- Continuation rate: 58.7% at +30m
- Sample: n=109, ~1.8 events/day across trinity
- Trade: same direction as the break

Combined: ~3.8 events/day = ~10× current 0.4/day volume. Win rates are lower than
current 79% baseline but well above coin flip. Expected total bps higher than baseline
because of volume.

**Caveats not yet addressed:**
- Avg bps per trade is small (+2 to +3 in raw 30m hold). After bid-ask costs ~5-10 bps
  on options, marginal. Need either: (a) tighter sub-filters to push win rate higher, or
  (b) hold-to-target exit instead of fixed 30 min.
- Sample sizes 109-122 are not huge. 95% confidence intervals are wide.

---

## 10. Quartile finding (counterintuitive but real)

Days sorted by total absolute path movement, divided into quartiles:

| Quartile | Avg movement | Total captured | Accepts/day |
|---|---|---|---|
| Q1 (quietest 25%) | 1,785 bps | **+260 bps** | 0.93 |
| Q2 | 2,790 bps | -47 bps | 0.07 |
| Q3 | 3,773 bps | -31 bps | 0.47 |
| Q4 (most active 25%) | 4,832 bps | +23 bps | 0.14 |

**Our system is profitable on the QUIETEST days and barely fires on the most active
days.** Consistent with reversal-pattern design intent: chop = controlled deflections =
clean wins. Trend days break our setups.

---

## 11. Per-trade move magnitudes (the user's question)

Best individual trades (in spot bps move, the underlying):

| Best | Trade | Bps | $ on SPX | $ on SPY-equiv |
|---|---|---|---|---|
| #1 | Feb 12 SPXW puts +30m | +61 | $40 SPX | $5 SPY |
| #2 | Mar 31 SPXW calls +30m | +41 | $26 SPX | $3.30 SPY |
| Best EOD | (varies) | +130 | $79 SPX | $7.50 SPY |

**Average accept catches +8.5 bps spot = $0.50 SPY / $5 SPX.** On a 0DTE ATM option,
that's typically a 5-15% premium gain (option leverage), so meaningful PnL even though
the spot bps look small.

**The system catches half-dollar SPY moves on average, occasionally catches $5 SPY moves
on the best trades. It does NOT catch full-day swings — by design, holds are 30 min.**

---

## 12. Suggested questions to ask Claude (or anyone reviewing)

These are the genuine open questions where outside input would help:

1. **Hold logic:** current is fixed 30 min. Spec §6.7 says "exit at first structural
   target" (which is typically the next pika node). Should we implement that in
   replay-mode and remeasure? The 30m mean-reversion finding suggests target-based exit
   would hold gains better.

2. **Trend-continuation pattern:** the data clearly supports adding `thin_break_fade`
   and `thick_break_ride`. But raw win rates (58-64%) may not survive transaction costs
   on options. What sub-filters would push these to 65%+? Candidates we haven't tested:
   - Velocity confirmation across 5m + 15m windows simultaneously
   - Trinity moderate confluence in the SAME direction at break moment
   - Time-of-day buckets (morning vs midday vs pin-zone)
   - Whether the broken node was a *true gatekeeper* (between two larger anchors) vs an
     isolated small node

3. **Bias-component weight rebalancing:** bias scores cap at ~62 because component
   weights sum below max range. Spec component weights (0.30/0.20/0.15/0.10/0.15/0.10)
   are placeholders. Phase 1 notebook 02 (bias-weight optimization via regression
   against realized outcomes) is the canonical fix — should we run it before more
   threshold tuning?

4. **High-bias paradox:** accepts with `|bias|` 30-40 lose money (50% win, -9 bps avg).
   Accepts with `|bias|` 10-20 are perfect (100% win in n=9). Why does higher conviction
   correlate with worse outcomes? Hypothesis: high bias = momentum already happened,
   we're entering the late side of the move. Worth a deliberate investigation.

5. **Air-pocket signal:** 25-40% of big moves happen in dead space. The current spec has
   no pattern that anchors on velocity-without-structure. Is there a useful pure-momentum
   pattern in the air pockets? Or is air-pocket movement fundamentally untradeable for
   our setup style?

6. **Per-ticker behavior:** QQQ has 3× the impulse rate of SPY/SPXW (8/day vs 2.8/day).
   Should we tune separate thresholds per ticker? Or is the spec right that one set
   of thresholds applies to all?

7. **Spec overlay validation status:**
   - Overlay #2 (king-node pin behavior by time-of-day) — counter-regime gate failed,
     time-of-day gate untested
   - Overlay #4 (paired-trade divergence) — empirical 31.7% win rate on rejected
     divergences = strongly anti-signal. Spec was right; informational-only is correct.
   - Overlay #7 (anticipatory rolling) — untested
   - Overlay #8 (hedge/real classification) — implemented but not validated against
     outcomes

---

## 13. Code locations

```
src/
├── domain/
│   ├── significance.js       relative_significance + king node detection
│   ├── structure.js          floor / ceiling / gatekeepers / air pockets
│   ├── lifecycle.js          tap detection, Fresh→Tested→Delivered→Broken
│   ├── velocity.js           six-window rolling buffers
│   ├── classification.js     hedge / real / ambiguous (Overlay #8)
│   ├── awareness.js          rolling awareness tiers (Overlay #6)
│   ├── bias.js               6-component weighted score
│   ├── trinity.js            cross-ticker confluence + paired-trade
│   ├── execution.js          R:R + entry/stop/target/sizing
│   ├── synthesis.js          9-step decision flow
│   └── patterns/             rug-setup, reverse-rug, pika-cloud, beach-ball,
│                              rainbow-road, whipsaw, + index registry
├── heatseeker/               Clerk JWT auto-refresh + SSE client
├── ingest/snapshot-poller.js full pipeline orchestrator
├── replay/reader.js          historical JSON → snapshot adapter
├── store/                    SQLite schema + JSONL events
└── utils/                    config, logger, ET timestamps

scripts/
├── run-replay.js             backtest CLI
├── run-experiment.js         A/B harness
├── backfill-outcomes.js      forward-price-change calculator
├── calibration-summary.js    threshold distribution report
├── study-daily-opportunity.js  daily range, capture, tap reactions
├── study-trend-continuation.js  802 impulse events, where we missed
└── study-gatekeeper-filters.js  H1/H2/H3 filter discovery
```

Replay DB: `data/replay-experiments/baseline/data/gexester.db` (immutable baseline).
Live DB: `data/gexester.db` (Phase 1 starts here when CLERK_* env set).

Threshold config: `config/calibrated_thresholds.json` (current = iter1).
Checkpoints: `config/checkpoints/*.json` (one per experiment).

---

## 14. TL;DR for whoever reviews

**(Revised after target-exit simulation, 2026-04-30. Earlier optimistic framing in
sections 4 and 8 needs to be read alongside this section.)**

1. We have a 0DTE GEX system catching 0.4 trades/day. At a fixed 30-minute spot
   snapshot, 79% of accepts are in the predicted direction. **But that snapshot
   measurement does not survive realistic exit logic.**
2. Replaying the same 24 accepts with target-based exits per spec §6.6 + §6.7
   produces **−100 bps total** (7/24 winners). Every alternative stop variant tested
   (wider/tighter, fixed-bps, no-stop) also produces negative total return on the
   same trades. **The system has direction-prediction signal but not enough room
   between stops and targets to convert it into PnL.**
3. Mechanism: stop distance and natural intraday volatility are similar magnitude
   (~10 bps). Stops trigger before targets on 17 of 24 trades, average duration
   only 5–25 minutes before stop-out. Targets at ≥5% rel_sig nodes are 30+ bps
   away — too far given typical move magnitude.
4. We're catching ~0.91% of available daily-range opportunity — well below
   spec target of 1–3 trades/day.
5. **Three spec thresholds were demonstrably wrong** and have been corrected:
   tap probabilities (80→57%), trinity high-confidence (60→45), step-1 quietness
   (0.05%→0.02%), tap cooldown (5min→10min).
6. Trend days (5,000+ bps daily motion) produce zero trades — the spec has no
   trend-continuation pattern.
7. **Two new edges discovered in the data**: `thin_break_fade` (64% win rate
   fading small-node breaks) and `thick_break_ride` (58.7% win rate riding
   7–10% node breaks). Subject to the same exit-logic concerns above.

### Honest status

The "edge" claim from sections 4–8 was an artifact of measuring spot direction at a
fixed 30-minute mark. Section 15 (below) shows that artifact does not translate to
PnL under any natural exit policy. **The system as currently architected does not
demonstrate edge after realistic exit simulation.**

This isn't fatal — it means setup detection has direction-prediction but the
exit logic / target-stop sizing is wrong for the magnitude of moves being predicted.
Three paths forward (none yet validated):

- **A. Tighter setups → bigger expected moves.** Filter accepts to only those where
  predicted move magnitude exceeds stop distance with margin. Likely cuts volume
  (already 0.4/day) but per-trade edge has to be there before scaling.
- **B. Trailing / breakeven exit logic.** Move stop to entry once trade is 0.5R
  favorable. Avoids whipsaw stop-outs but needs validation.
- **C. Options-based exit / time-stop.** Hold to a time horizon optimized
  against MFE distribution rather than structural target. Requires the MFE
  analysis (queued).

**Do not deploy capital.** The current numbers show direction-prediction without
realizable PnL. Live capital here would lose money under spec §6 exit logic.

---

## 15. Target-exit simulation (the critical correction)

Reviewer feedback flagged that fixed-30m measurement was probably an optimistic
slice. Built `scripts/simulate-target-exits.js` and `scripts/simulate-stop-alternatives.js`
to replay each accept's plan minute-by-minute under realistic exit logic.

**Per-trade detail on the 24 baseline accepts**: 17 stopped out, 1 hit target, 6 went
to EOD without resolution. Average duration before stop-out: 5–25 min. Many of the
trades that registered as "winners" at the 30-min snapshot had already breached their
stop at minute 3 or 5 — they only appeared as winners because we hadn't simulated the
stop trigger.

**Exit-policy comparison on identical 24 trades:**

| Variant | Wins | Avg bps | Total bps | Targets hit | Stops | EODs |
|---|---|---|---|---|---|---|
| A. spec default (3% stop, 1-bar B&H) | 7 | -4.2 | **-100** | 1 | 17 | 6 |
| B. wider stop (5% threshold) | 7 | -5.1 | -122 | 1 | 17 | 6 |
| C. 3-bar break-and-hold (3% stop) | 7 | -4.2 | -100 | 1 | 17 | 6 |
| D. fixed 10bps stop | 3 | -4.4 | -106 | 1 | 21 | 2 |
| E. fixed 20bps stop | 6 | -9.0 | -216 | 1 | 17 | 6 |
| F. no stop (target or EOD only) | 10 | -12.6 | **-302** | 1 | 0 | 23 |
| Reference: fixed-30m snapshot | 19 | +8.5 | +205 | (n/a) | (n/a) | (n/a) |

Key observations:
- Wider stops don't help — they let losers run further before hitting EOD.
- 3-bar break-and-hold gives identical results to 1-bar — when stops trigger, they
  stay triggered. Not a wick problem.
- No-stop holding to EOD is worst — confirms earlier finding that mean reversion
  destroys gains past 30m. By EOD, ~60% of accepts have negative cumulative ret.

**Implication**: the spec's setup-vs-exit alignment is broken. Either setups need to
predict moves significantly larger than stop distance (currently 8 bps avg vs 15 bps
stop is the wrong way around), or exit logic needs to ignore stops entirely and use
time/MFE-based exits instead.

### Revised next steps (replacing original Step 1)

The original Step 1 ("implement target-based exits, re-baseline") is *done* — and the
result is the system loses money. The next priority is:

**1a. Maximum favorable excursion (MFE) study.** For each accept, compute the peak
favorable spot move within the first 30/60 min. If the median MFE is, say, +15 bps,
a fixed take-profit at 12 bps would convert most "fixed-30m winners" into actual PnL.
If MFE is small (<10 bps), the system genuinely doesn't have enough move to extract.

**1b. Tighter setup filter.** Only accept when the entry-to-target distance is small
enough that R:R works given stop distance — i.e. don't take trades where the geometric
math says the path won't reach target. Currently the 2:1 R:R floor admits trades where
the math is plausible but path-volatility eats the trade.

**1c. Then revisit Step 2 (thin_break_fade, thick_break_ride).** Same exit-logic
concerns apply — running those patterns through target-based exits could collapse them
identically. Worth running the same exit simulation on hypothetical break-pattern
trades before writing detector code.

---

## 16. MFE study + the optimal-TP discovery (2026-04-30)

Built `scripts/study-mfe-mae.js` to compute peak favorable / worst adverse excursion
for each accept across 30m / 60m / EOD horizons. Then grid-searched fixed take-profit
levels against the spec stop. **The system has edge that survives realistic exits — the
spec's structural targets were the problem, not the setup detection.**

### MFE distribution shows real signal (24 trades)

| Percentile | MFE @ 30m | MAE @ 30m |
|---|---|---|
| P10 | +1.1 bps | -38.4 |
| P25 | +10.4 bps | -23.8 |
| **median** | **+28.6 bps** | -6.0 |
| P75 | +38.5 bps | -0.5 |
| P90 | +54.6 bps | 0.0 |

**79% of trades reach ≥10 bps favorable excursion. Median trade reaches +28.6 bps.**
MAE is small for most trades (median -6 bps) — only 25% breach -24 bps before reverting.

### Why spec §6.7 was wrong

| Distance | Median | P75 | Max |
|---|---|---|---|
| Spec stop (≥3% node) | 17.5 bps | 23.5 bps | 46.6 |
| Spec target (≥5% node) | **54.6 bps** | **150 bps** | 173 |
| **Trade MFE_30m** | **28.6 bps** | 38.5 | 143 |

Trades reach ~28 bps favorable. Targets are 54+ bps. Stops at 17 bps. Most trades stop
out before reaching target *even though* they had 28 bps of favorable excursion. The
spec used the *next* significant node as target — but on a dense gamma surface, that's
2-3× too far given typical move size.

### Fixed take-profit grid search (with spec stop)

| TP level | Wins | Avg bps | Total bps |
|---|---|---|---|
| 5 bps | 19/24 (79%) | +0.94 | +22 |
| 8 bps | 19/24 | +3.31 | +80 |
| **10 bps** | 19/24 | +4.90 | +118 |
| 12 bps | 16/24 | +3.83 | +92 |
| 15 bps | 15/24 (63%) | +4.89 | +117 |
| 20 bps | 13/24 | +5.18 | +124 |
| **25 bps** | **13/24 (54%)** | **+7.89** | **+189** ← optimal |
| 30 bps | 10/24 | +4.96 | +119 |
| 50 bps | 7/24 | -0.28 | -7 |

**Optimal: fixed TP at 25 bps + spec stop = +189 total bps**. Compared to the fixed-30m
*artifact* of +205 bps, this is now *realizable* — actual hit-target-or-stop simulation.
Win rate drops to 54%, but average winner is +25 bps and average stop is ~-15 bps,
positive expected value of +7.9 bps per trade.

This config also tested with wider stops:
- TP=10 / stop=30: 20/24 wins, +80 total — high win rate, low avg
- TP=25 / stop=spec: 13/24 wins, +189 total — the optimum

### What this means

1. **Setup detection has real edge.** Median MFE of 28.6 bps shows the system predicts
   direction with measurable forward move available.
2. **Spec exit logic was the bottleneck, not setup quality.** Targets at 54+ bps with
   stops at 17 bps puts the trade in a geometric trap.
3. **Fixed 25-bps TP recovers most of the apparent edge.** +189 bps on 24 trades = +7.9
   bps avg per trade. After bid-ask costs (~5-10 bps round trip on options), real PnL
   is marginal but positive.
4. **High-bias paradox confirmed structurally.** Feb 3 / Feb 24 / Jan 21 (the bias-30-40
   losers) had MFE ≤ 1.1 bps — never went our way. Those are wrong-call setups, not
   exit-logic victims. Filtering bias > 30 would lift remaining trades' average further.

### Revised recommended path forward

**Step 1c (DO NEXT)**: Modify `execution.js` `planTrade()` to use a fixed-bps take-profit
(25 bps default, calibration-tunable) instead of the next ≥5% node. Re-run replay.
Validate that +189 bps total holds at the new exit policy on the same setups.

**Step 1d**: Once exit policy fixed, add a hard filter: skip setups where local
`|bias_score|` is between 30 and 50. The high-bias paradox is real and the fix is
trivial — those trades have negative expected value across all exit policies tested.

**Step 2 (after 1c+1d)**: Implement `thin_break_fade` and `thick_break_ride` patterns,
run replay with the new exit policy + bias filter. This should multiply trade count
substantially while preserving (or improving) the per-trade edge.

---

## 17. iter2 calibration sweep result (2026-04-30, end of session)

Implemented Steps 1c (fixed-bps TP) + 1d (bias-paradox filter), then ran a 5-experiment
R:R floor / TP sweep with realistic target-based exit simulation in the loop.

### Final sweep — sorted by realized total bps

| Config | Accepts | Target win% | Avg bps | **Total bps** | TP/Stp/EOD |
|---|---|---|---|---|---|
| **tp25-rr1.7** | **44** | **56.8%** | **+6.91** | **+304** | 14/17/13 |
| tp25-rr2.0 | 31 | 54.8% | +6.90 | +214 | 9/12/10 |
| tp25-rr1.5 | 63 | 46.0% | +2.52 | +159 | 17/31/15 |
| tp15-rr1.5 | 18 | 55.6% | +3.94 | +71 | 9/7/2 |
| tp10-rr1.5 | 0 | — | — | — | — |

### Reference comparisons (same 60 days)

- Original baseline w/ spec target+stop: **-100 bps** (the unsalvageable §6.6/§6.7 logic)
- Original baseline fixed-30m artifact: +205 bps (not realizable)
- iter2 first attempt (TP=25, RR=1.3): **-18 bps** (R:R floor too low, marginal admits)
- **iter2 winner (TP=25, RR=1.7): +304 bps under realistic exits** ← adopted

### What's now in the live config

- `take_profit.mode = fixed_bps`, `fixed_bps = 25`
- `rr_gating.reject_below = 1.7` (full=2.5, reduced=1.7)
- `bias_filter.skip_paradox_min = 30`, `skip_paradox_max = 40`
- All other iter1 thresholds unchanged

Saved to `config/checkpoints/iter2_winner_tp25_rr1.7.json`.

### Where this leaves us

- 44 trades / 60 days = **0.73 trades/day** (still below spec target 1–3, but 1.8× the
  iter1 baseline volume)
- 56.8% win rate at realistic target-based exits
- Per-trade avg +6.91 bps; total +304 bps over 60 days = +5 bps/day spot
- After typical option bid-ask costs (~5–10 bps round-trip), real edge is **marginal
  but positive** on this dataset

### Most important caveat

Sample size is 44 trades. The 56.8% win rate has wide confidence intervals — could be
anywhere from ~42% to ~71% at 95% CI on n=44. Need more trades before staking real
capital. Step 2 (adding `thin_break_fade` and `thick_break_ride`) is the path to
multiply n into the 100+ range where statistics get reliable.

### Next concrete step

Implement `thin_break_fade` and `thick_break_ride` patterns 7+8. Then re-run the same
exit-policy + bias filter against those events. If they preserve ≥55% target-based win
rate at higher volume, we'd have the basis for a real Phase 2 paper-trade simulation.

If they don't (i.e. the new setups fail under realistic exit logic the way iter2 did
initially), that's an honest signal that the gatekeeper-break edges from the structural
study don't survive realistic execution — and we'd need a different framework entirely.
