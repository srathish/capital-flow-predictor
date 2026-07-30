# Findings — node growth velocity & "how is Falcon winning?" (2026-07-29)

Prompted by: *"are we actually looking at node growth velocity?"* + *"how is Falcon winning, think of other data streams."*
Answer: we weren't; now we tested it; it's a dead signal. The real separator is **tape quality / selectivity**, not GEX velocity.

## 1. Were we using node growth velocity? No.
The engine tracked king **migration** (did the wall move strikes: `|king − prevKing| ≥ gap`) — a *positional* signal — never **dG0/dt** (how fast a node is growing). Confirmed by grep.

## 2. Node growth velocity — tested 3 ways (tools below), all dead
Data: velocity-capture SPXW replay, 2026-07-09 → 07-28 (fully reconstructable — pure GEX time-series, no flow/dp needed).

| form | metric | result |
|---|---|---|
| **raw king growth** | king g0 vs itself 15–20 min ago | king balloons **3–14× into every close** (0DTE gamma concentration) — identical trend vs chop. Dead. |
| **directional tilt** | Σ Δg0(above spot) − Σ Δg0(below) | tilt@10:30 vs day-drift = **43%**, tilt@12:00 = **43%** (coin flip). Day-*median* 71% is hindsight (grown side = where price already went). Dead as a forward signal. |
| **coherence (chop filter)** | \|Σ tilt\| / Σ\|tilt\| over the morning | WIN days **0.53** vs LOSE days **0.60** — no separation (slightly inverted). Dead. |

Consistent with the proven boundary: direction unpredictable OOS; raw GEX-mechanical signals don't generalize.

## 3. The real separator (surfaced by the same test): morning price path-efficiency
`eff = |close−open| / Σ|minute moves|` over 09:30–11:00, vs the engine's per-day flip-flop P/L:

| day | engine P/L | morning path-eff | |
|---|---|---|---|
| 7/20 | +6.0 | 0.27 | WIN |
| 7/23 | +10.0 | 0.11 | WIN |
| 7/27 | +6.7 | 0.25 | WIN |
| 7/17 | −39.7 | 0.13 | LOSE |
| 7/22 | −8.3 | 0.02 | LOSE |
| 7/24 | −32.9 | 0.04 | LOSE |
| 7/28 | −18.7 | 0.06 | LOSE |

**WIN days avg 0.21 vs LOSE days avg 0.06 (~3.5×)** on n=7. A ~0.10 gate would pass all 3 win days and block 3 of 4 bleed days.

**UPDATE — expanded to 16 days (06-04 → 07-28), the signal DEFLATED:** WIN 0.16 vs LOSE 0.09 (only 1.8×), with clear counterexamples (7/09 WON on choppy 0.04; 7/16 LOST on efficient 0.25). So tape-efficiency is a **weak lean, not a clean gate** — the n=7 was partly small-sample luck. This is why you expand the sample before believing a filter. Node coherence stayed inverted (WIN 0.42 vs LOSE 0.55 = still dead). And the blunt part: the structure-only engine is **net-negative across all 16 days (5 win / 11 lose, ≈ −155pt)** — neither node velocity nor tape efficiency rescues it. Kept as a LOGGED watch feature only (review's ≥10%-separation gate won't let a weak signal trigger a change).

## 4. How Falcon is (probably) winning — synthesis
Not node velocity. Not a GEX direction oracle. The evidence points to **selectivity on tape quality** + a **confirmation stack we can't replay historically**:
- **Stand aside on chop** (morning path-efficiency low) — trade only clean/directional tape. This is the ~1–3-trades/day discipline.
- **Confirmation stack** = dark-pool value-area extension + ask-side opening flow + trinity (3-index agreement) + VIX compression → the *selectivity* layer that makes 92% (falcon_picks.json: "take every card = −19%").
- **One thesis per day** (don't flip-flop — the 7/20 lock turned +6 → +66) + **manage the pop** + cheap convex 0DTE.

## 5. Disciplined next step (not over-correcting)
Log **morning tape path-efficiency** (and node coherence) as *context* on every trade in `falcon_ledger.jsonl` — behavior UNCHANGED. Then `review.mjs` can test forward, cumulatively, whether trades on efficient-tape mornings actually outperform, before we ever gate on it. Pursue the lead; don't fit n=7.

## Tools (committed)
- `node_velocity.mjs <day>` — 30-min king-growth timeline + regime read.
- `node_tilt.mjs [day]` — directional tilt test across all days (the 43% coin-flip result).
- `node_regime.mjs` — coherence vs engine-P/L + the path-efficiency separator.
