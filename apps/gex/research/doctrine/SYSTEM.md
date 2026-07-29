# The Bellwether 0DTE System — reverse-engineered from Falcon, then improved

## THE DIRECTION-FREE LOOP (the resolution — never predicts direction)
The full-picture model proved DIRECTION is unpredictable OOS (AUC ~0.51 with GEX+VEX+aggregate+flow+charm,
5× confirmed). But REACH is (0.90) and RIDE-LENGTH tracks structure. So the machine reacts, never forecasts:
1. **Don't predict direction.** Wait for a CONFIRMED move (≥3pt/10min) or price reaching a key level.
2. **Ride to the NEXT PIKA ahead = the exit** (rides stall at it: 53% stall when pika ≤6pt ahead; ride-length
   rises with pika distance — `ride.mjs`). A **BARNEY ahead = accelerant**, ride longer/through (4.3 vs 2.8pt).
3. **At the pika, expect reversal** (strong pika respected 79%, vanna+ rejects 74%). Wait for the retrace
   confirmation candle. **FAILED-REACH is the stronger tell** (`test_ideas.mjs`, generalizes OOS): if price
   STALLS ~4pt SHORT of the pika and retraces without touching, it reverses ~7-9pt vs only ~4pt when it
   reaches — a wall that rejects before contact snaps back 2× harder. Fade the failed reach with more size.
4. **Fade back toward the next pika down = the next ride.** Repeat.
5. **Convex 0DTE, take the pop (+20-30%), cut fast, identical size.**
This is ~what Falcon does: harvest predictable REACH + node-sign exits with convexity + management. His 92% is
reach × management on selected setups, NOT a direction oracle (one doesn't exist in this data).

---


The operator's workflow: **every morning mark the SPX levels, then judge deflection vs push-through.**
Not buy-and-hold-all-day (that only works on trend days). The mode is chosen per day.

## 1. Morning — mark the CORRECT levels (by ~10:00 ET)
Pull SPXW 0DTE GEX. Mark **only strong pikas (≥15M gamma)**:
- **King** = dominant pika. **Call wall** = strongest pika above spot. **Put wall** = strongest pika below.
- **Barney floors** = negative-gamma nodes (accelerants).

> VALIDATED (`level_check.mjs`, 19 days): a strong king (≥15M) is **stable 78%** of the day and **respected
> 79%** (49/62 touches reversed 3+ pts). Weak nodes (<15M) **drift and get ignored = noise.**
> **If there is no strong king today → stand aside / wait for structure.** (~half of days.)

## 2. Classify the day (≈10:30) — TREND vs CHOP
**Signal A — tape+king agreement.** Does the early tape (SPY drift from open) **agree** with the king's side?
(king below spot = bull floor = +1 · king above spot = bear ceiling = −1)
- **AGREE → TREND** · **DISAGREE → CHOP.** VALIDATED (`direction_bt.mjs`): tape+king agreement continues the
  day's direction **80%** of the time (n=10).

**Signal B — GEX shape (`gex_regime.mjs`, VALIDATED).** Trend days have **concentrated** GEX (king ≈17% of all
gamma) and the **directional node GROWS** (×3.32 AM→PM, growing on 60% of trend days: 07-21 ×10.6, 07-09 ×6.3,
06-02 ×4.8). Chop days are **scattered** (king ≈10%, "GEX all over the place") and the node barely grows (×1.44).
- **Concentrated + a node stacking = TREND.**  **Scattered / no dominant node = CHOP / stand aside.**

**The deflection-vs-push-through tell** (ties A+B together): a **growing** node with **price moving toward it =
TREND, ride through** (escalator). A growing node with **price rejected off it = deflection WALL, fade** (07-28
7410 grew ×3.16 but repelled price = chop). So: *node growth = conviction; who's winning the tape at the node =
direction.*

- **TREND day →** hold the thesis; expect price to **push through** the level (barney/trapdoor).
- **CHOP day →** fade the strong wall — deflection scalps; take the pop, don't hold.

## 3. Node-sign playbook — which way to trade a level (the regime switch)
The whole-surface net gamma is +gamma on every 2026 low-VIX day, so it does NOT discriminate. The **local
node sign in the trade's path** does (`node_sign.mjs`):
- **Pika (g0>0) in the path → it HOLDS → fade toward/off it (deflection).**
- **Barney (g0<0) in the path → it BREAKS → ride through it (trapdoor).**
Confirmed: JUL 20 7490 pika tapped 9×/rejected 9/9 (deflection); JUL 28 7450 pika ceiling over a 7440 barney
floor = fade the rejection into the barney (deflection→trapdoor is one trade at the extreme).

## 4. Execution — from Falcon, verified on real UW marks
- Cheap **convex 0DTE** in the thesis direction.
- **Manage the pop: exit +20–30%, cut fast, NEVER hold to expiry.** Real data: Falcon's 07-23 7380P and
  07-28 7430P both expired near worthless; his +94%/+52% realized came ENTIRELY from managing. Edge =
  convexity + management, **not an index edge** (intraday SPX is ~symmetric even at high scores).
- **Few trades, identical size.** (Falcon: ~1.3/day; "take every card" book = −19%. Selection is the edge.)

## Validated numbers (measured, not asserted)
| what | number | source |
|---|---|---|
| Correct levels: strong pika stable | 78% | level_check.mjs |
| Correct levels: strong pika respected | 79% | level_check.mjs |
| Direction: tape+king agree → same-dir close | 80% | direction_bt.mjs |
| Score ranks scalp-reachability | 0→50→70% | score.mjs |

## Honest gaps — do NOT size up until closed
1. **Realized option capture is unproven.** UW keeps intraday option marks for the current day only; historical
   modeling of 0DTE P/L is unreliable. Validate FORWARD: `run_forward.sh` each close, ~2 weeks → n≈20-30.
2. **Two-mode $ P/L (+23 pts/day, `two_mode.mjs`) is INFLATED** — idealized scalp count (42 fades/day is not
   real). Trust the *structure*, not the magnitude.
3. **Small sample** — 19 days, ~9 with strong structure. Forward validation is mandatory.
4. **Direction selector still crude** — re-check the classifier live before trusting (07-28 edge cases).

## The bet on beating Falcon
Falcon fires on its own score (conviction). Our potential edge: **(a) trade only the ~9/19 strong-structure
days** (he trades more, book -19% on take-all), **(b) route trend vs chop correctly**, **(c) same convexity +
management.** If forward realized expectancy is positive AND the levels keep their 79% respect → propose
wiring into the live tracker (Clause 0: no live-code change without approval).
