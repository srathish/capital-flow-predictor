# Tap Mechanics & Structural-Break Exit (1-min)

**RESEARCH ONLY (Clause 0). No live-code change. Findings → DECISIONS NEEDED.**
Snapshot 2026-07-14 PM. **12 trading days, 35 (day,ticker) series** of 1-min Skylit surfaces
(06-26, 06-29, 06-30, 07-01, -02, -06, -07, -08, -09, -10, -13, -14; backfill still filling —
re-run to extend). Part A (taps) and Part B (exit) were both pre-registered before outcomes.
n ≈ 12 day-blocks → **every verdict is a LEAN**, not a finding. Day-block bootstrap (resample whole
days) + walk-forward halves + Bonferroni discount applied. Reuses `pipeline/extreme_probe.py` +
`pnl_v0.py`; engine `pipeline/tap_break_exit.py`.

---

## One-line verdict

**Two halves of the operator's sentence split cleanly. The structural-break EXIT is real (a LEAN in
its favor); tap-count as a general "level-weakening" signal is not.**

- **Part B (the exit) — CONFIRMED, LEAN.** Exiting when the position's **defining level breaks** (spot
  closes ≥0.05% beyond it for 1 minute, adverse direction) **beats trail-only** on the same probe
  entries: **+4% vs +2%** expectancy, and — the point that matters — it **tightens the downside**
  (day-block 90% CI floor **−8% → −2%**, P(mean>0) **63% → 86%**) **while keeping trail-only's high
  median (+21% vs +26%)**. It does this by cutting the **put-side** bleed (−16% → −8%) at a small cost
  to the **call-side** winners (+20% → +16%). It is **decisively better than the mark-abort** (the
  known-bad leg), which mangles the distribution (median −20%, 20% hit). **The operator's instinct is
  right: exit on the STRUCTURE breaking, not on the option mark wiggling.** This is the same lesson as
  EXTREME_PROBE §B.5 (mark-abort net-negative) — but now with the *structural* leg isolated and shown
  to be the **good** half.
- **Part A (tap-count) — mostly NULL, one floor-shaped exception.** Across **all strong nodes**, the
  probability of another bounce **does not decline with tap count** (66% / 67% / 67% / 65% at taps
  1/2/3/4+ — dead flat) and does not separate from the phantom mirror. The **only** bucket that shows
  the doctrine's "weakens with testing" shape is the **pika floor** (75% → 61% bounce, and a
  twice-tapped floor breaks within 30 min **42%** of the time vs 16–23% for ceilings/barney/King). That
  aligns with Ch3's *specific* claim ("**Floors** can give way if tested multiple times") — but it is a
  ~1.7-SE gradient in one of four buckets, with a drift-confounded mirror. **Tap-count is not broadly
  tradeable information at this n; the floor sub-signal is worth a bigger-n look, nothing more.**

**Nothing here changes live code.** One candidate is specced for **ghost/paper testing** (§B.6).

---

## PART A — Tap mechanics

**Pre-registration (frozen).** Level set = strong nodes (`relSig=|γ|/Σ|γ| ≥ 0.10` sustained ≥5 min,
armed once/day, active arm→EOD) **and** the day's **King** (dominant max-|γ| strike). **TAP** = spot
enters the band **strike ± 0.05% of spot** and exits; **bounce** = exits the side it came from,
**break** = exits the far side. Tap separation follows the dormant engine's `lifecycle.js` §6.3 (a new
tap needs ≥5 min outside **or** ≥2×band of travel since the last one — kills flicker). Sequence numbered
per (level, day): 1st / 2nd / 3rd / 4+. **MIRROR** = phantom fixed level `2·S_arm − K` (reflect strike
across spot at the arm minute), identical detection. Buckets: pika-floor (pika below spot@arm),
pika-ceiling (pika above), barney (either side), King.

### A.1 Tap-decay curve — P(bounce | tap #), REAL vs PHANTOM

`brk30@2` = P(the level breaks within 30 min *after* a 2nd-tap bounce). 809 real taps total
(553 bounce / 256 break → base break-rate **32%**).

| bucket | n(real) | tap 1 | tap 2 | tap 3 | tap 4+ | med gap | brk30@2 | brk30@3 |
|---|---|---|---|---|---|---|---|---|
| **pika_floor** REAL | 201 | **75%** (56) | 69% (45) | 62% (34) | **61%** (66) | 17m | **42%** (31) | 33% (21) |
| pika_floor PHANTOM | 202 | 44% (62) | 67% (42) | 78% (32) | 67% (66) | — | — | — |
| **pika_ceiling** REAL | 324 | 58% (85) | 69% (67) | 72% (50) | 64% (122) | 20m | 17% (46) | 22% (36) |
| pika_ceiling PHANTOM | 232 | 64% (70) | 67% (52) | 69% (39) | 59% (71) | — | — | — |
| **barney** REAL | 179 | 69% (52) | 60% (35) | 64% (25) | 70% (67) | 20m | 19% (21) | 25% (16) |
| barney PHANTOM | 219 | 67% (61) | 75% (44) | 69% (32) | 60% (82) | — | — | — |
| **King** REAL | 136 | 66% (29) | 54% (24) | 65% (20) | 71% (63) | 19m | 23% (13) | 23% (13) |
| King PHANTOM | 68 | 75% (16) | 53% (15) | 64% (14) | 52% (23) | — | — | — |
| **all_nodes** REAL | 704 | **66%** (193) | **67%** (147) | **67%** (109) | **65%** (255) | — | — | — |
| all_nodes PHANTOM | 653 | 59% (193) | 70% (138) | 72% (103) | 62% (219) | — | — | — |

**Reads.**
1. **Pooled: no decay.** Over all strong nodes the bounce-probability is **flat** across tap number
   (66/67/67/65%) and the phantom is statistically indistinguishable (59/70/72/62%). *A level tested
   four times is, on average, no weaker than a fresh one.* The operator's general hypothesis — "a level
   weakens with repeated tests" — **fails the pooled test.**
2. **Floors are the exception, and only floors.** Pika floors decline **75% → 61%** with tap count and
   are the **only** bucket where a twice-tapped level then breaks at a high rate (**42%** within 30 min,
   vs 16–23% elsewhere). This is exactly the doctrine's floor-specific wording. **Caveat that keeps it a
   LEAN, not a finding:** (i) it's a ~1.7-SE gradient (75±6% vs 61±6%) in **one of four** buckets
   (multiple-comparisons); (ii) the floor's phantom is a *supra-spot* reflected level, and on this
   mostly-up sample supra-spot levels break on first touch as price rises through them — so the
   phantom's low first-tap bounce (44%) is a **drift artifact**, not a clean null. The honest control
   for the *floor* decay is the pooled/other-bucket flatness, and against that, floors do stand out.
3. **King: no tap-decay** (66/54/65/71%, noisy at n≈20–60). The King node does not "wear down" with
   repeated tests in this sample. Real King attracts **~2×** the phantom's tap traffic (136 vs 68) —
   nodes pull price, consistent with TERRAIN_EVENTS §2, but the *reaction sequence* is not special.
4. **Median time between taps ≈ 17–20 min** across buckets — so "2nd/3rd tap" events unfold over ~½–1
   hour, not seconds.

### A.2 Part A verdict

**Tap-count is not general information here.** Use it, if at all, only as a **floor-specific** caution:
a pika floor that has already been tapped 2–3 times is a materially worse thing to be long against (42%
break-within-30-min after a 2nd-tap bounce). That is a *risk flag on the entry*, not a standalone
signal, and it needs the backfill's full ~35 days before it's more than a doctrine-consistent lean.
`tap_events.jsonl` (809 taps) ships for the terrain viewer so the operator can eyeball the bounce/break
tick marks per band.

---

## PART B — Structural-break exit

**Pre-registration (frozen).** Entry cohort = the Extreme-Probe entries (session-extreme reclaim after
10:00: new low→call / new high→put, 2-min reclaim; `detect_probes` + cooldown), **no mark-abort** —
this is the cohort EXTREME_PROBE §B.5 flagged as the only break-even survivor. **n_priced = 420**
(210 call / 210 put). Second population = the live **replay fire cohort** (§B.5). Defining level = the
**entry extreme** (the session low for calls / high for puts); where a strong node/King sits within
0.15% of it, also tested with **that node** as the level. **Exit rule S** = exit when spot closes beyond
the defining level by **M ∈ {0.05%, 0.10%}** for **C ∈ {1, 2}** consecutive minutes, **adverse**
direction (below for a call, above for a put). Winner handoff: arm at +50%, then a 0.15 giveback trail.
2×2 M×C grid enumerated for the multiple-comparison discount.

### B.1 Four-exit head-to-head (probe cohort, net of 3% round-trip haircut)

Baseline **(i) trail-only** = live trail arm .50 / giveback .15, **no downside stop** (EXTREME_PROBE's
control-c "current best"). Counterfactual for false-kill/save uses this.

| exit | n | expect | median | hit | day-block 90% CI | P(>0) | wf-1 | wf-2 | −3% stress |
|---|---|---|---|---|---|---|---|---|---|
| **(i) trail-only .15** | 420 | **+2%** | +26% | 66% | [−8%, +12%] | 63% | −7% | +11% | −1% |
| (i) trail-only .40 (loose) | 420 | +4% | −3% | 48% | [−12%, +20%] | 63% | +11% | −3% | +1% |
| **(ii) mark-abort .15/.40** (known-bad) | 420 | +1% | **−20%** | **20%** | [−11%, +16%] | 51% | +8% | −5% | −2% |
| **(iii) S-only+trail  M=.05% C=1** | 420 | **+4%** | +21% | 58% | **[−2%, +10%]** | **86%** | −0% | +8% | +1% |
| (iii) S-only+trail  M=.05% C=2 | 420 | +3% | +21% | 59% | [−3%, +10%] | 80% | −0% | +7% | +0% |
| (iii) S-only+trail  M=.10% C=1 | 420 | +2% | +22% | 59% | [−4%, +9%] | 75% | −2% | +6% | −1% |
| (iii) S-only+trail  M=.10% C=2 | 420 | +2% | +23% | 60% | [−5%, +8%] | 68% | −3% | +7% | −1% |
| **(iv) S+trail combined  M=.05% C=1** | 420 | +4% | +21% | 58% | [−2%, +10%] | 87% | −0% | +9% | +1% |

**Reads.**
- **The structural exit is the best-shaped column.** (iii)/(iv) at **M=0.05% / C=1** deliver **+4%**
  expectancy with the **tightest, most consistently-positive CI** ([−2%, +10%], P>0 **86–87%**) of any
  exit, and hold up in **both walk-forward halves** (−0% / +8%) and under an extra **−3% haircut**
  (+1%). Keeping S active after the +50% arm (iv) vs dropping it (iii) makes **no material difference**
  — the pre-arm structural stop is what does the work.
- **It beats trail-only where it counts: the tail.** Same +median-retaining shape as trail-only
  (median +21% vs +26%) but the downside CI floor lifts from **−8% to −2%** and P>0 from 63% to 86%.
  The structural stop cuts the **left tail** without selling the winners — the thing a good stop is
  supposed to do and the mark-abort fails to do.
- **Tighter break threshold wins.** M=0.05% (exit on the first 0.05% break) beats M=0.10% (+4% vs +2%):
  on a heavy-left-tail entry population, cutting a genuine break **sooner** saves more than the extra
  false-kills cost.
- **Mark-abort stays broken.** (ii) posts a near-zero mean only because a few big survivors drag it up;
  its **median −20% / hit 20%** is the giveaway — it sells noise dips into locked losses, exactly
  EXTREME_PROBE's result. **Structural ≠ mark; the operator's two "exit" ideas behave oppositely.**

### B.2 False-kill / save decomposition (S vs trail-only counterfactual)

For every entry where S fired, compare its outcome to trail-only on the *same* entry. **save** = S
ended better; **false-kill** = trail-only would have finished **profitable** and S cut it short.

| S cell | trigger rate | save % | false-kill % | mean Δ vs trail on trigger |
|---|---|---|---|---|
| **M=.05% C=1** | 165/420 = **39%** | **66%** | 22% | **+5%** |
| M=.05% C=2 | 159/420 = 38% | 68% | 21% | +3% |
| M=.10% C=1 | 156/420 = 37% | 69% | 20% | +1% |
| M=.10% C=2 | 147/420 = 35% | 71% | 17% | −1% |

**When S fires it improves the trade ~2/3 of the time**, and the *average* triggered trade finishes
**+5% better** than holding under the trail (M=.05%/C=1). Looser M lifts the save-rate and cuts
false-kills but shrinks the average gain (you exit later, after more damage) — so the *rate* looks
cleaner at M=.10% but the *dollars* are better at M=.05%. **Honest cost:** S is **not** a mark-stop — it
confirms only after spot has broken structure, by which time the option mark can already be deep
(several struct-exits in `struct_exit_events.jsonl` book −40%+). It caps losses **relative to
holding to EOD**, not relative to a fast mark-stop.

### B.3 Call/put split — where the improvement actually comes from

| exit | side | n | expect | median | hit | 90% CI | P(>0) |
|---|---|---|---|---|---|---|---|
| trail-only .15 | **call** | 210 | **+20%** | +32% | 78% | [−3%, +41%] | 93% |
| trail-only .15 | put | 210 | −16% | +15% | 54% | [−38%, +7%] | 12% |
| **S-only M.05/C1** | **call** | 210 | **+16%** | +27% | 68% | [−4%, +35%] | 91% |
| **S-only M.05/C1** | put | 210 | **−8%** | −8% | 48% | [−24%, +11%] | 23% |
| mark-abort | call | 210 | −3% | −20% | 16% | [−15%, +11%] | 33% |
| mark-abort | put | 210 | +6% | −19% | 24% | [−14%, +39%] | 64% |

**The whole aggregate gain is loss-control on the put side.** The structural stop takes the bleeding
put book from **−16% → −8%** (CI floor −38% → −24%), and **costs the call book +20% → +16%** (it clips
~4pp of winners via false-kills). Net across sides it's a small positive with a much tighter tail. So:
**if you could only trade the call side** (the one with a real entry edge per EXTREME_PROBE/control-c),
**plain trail-only is marginally better** and the structural stop is a slight drag. The structural stop
earns its keep as a **portfolio-level risk overlay** on a two-sided book, not as a call-side enhancer.
(This up-drift sample has almost no bear tape — the put side is structurally disadvantaged here; a
bear-day mix could change the call/put balance.)

### B.4 Node-as-level and the profit side

- **Node-as-level ≈ extreme-as-level.** Using a strong node within 0.15% of the extreme instead of the
  raw price extreme gives **+2%** (n=208) — same ballpark. The **price extreme itself is a fine defining
  level**; you don't need a node sitting on it.
- **Delivered-node take-profit is a NULL.** Taking profit when price breaks *through* the next favorable
  node and re-enters its band from beyond (the "breaks past up → we exit" profit half) returns **−3%**
  vs **+0%** for trail-only on the same entries; call-side **+12% vs +20%**. It exits winners too early.
  **Let the trail handle the upside — do not take profit on a node break.** The operator's structural
  logic is a good *stop*, not a good *target*.

### B.5 Second population — live replay fire cohort

175 evaluable fires (**~143 are 07-08** — effectively **one day-block**, so this is a weak check).
Defining level = nearest strong node on the stop side (floor for calls, ceiling for puts) at fire time.

| exit | n | expect | median |
|---|---|---|---|
| trail-only .15 | 175 | **−32%** | −50% |
| mark-abort | 175 | −16% | −20% |
| **S-best (M.05/C1)** | 175 | **−26%** | −30% |

Everything is negative — this cohort's *entries* were bad (matches EXTREME_PROBE control-b, live book
−23%), and no exit rescues a bad entry. But the **ordering is consistent**: S-best (−26%) beats
trail-only (−32%) by ~6pp, S trigger 82/175 with **save 57% / false-kill 15%** — the structural stop
**reduces losses even on a losing population** (saves > false-kills). Directionally supportive; too
day-concentrated to weight.

### B.6 SPEC for ghost testing (paper-only — DECISION NEEDED to run)

If the operator wants to ghost-test one thing, this is it. **Structural-break stop overlay:**

> **Defining level** = the position's entry reference (for a probe long: the session extreme it was
> entered against; general case: the nearest strong node / King within 0.15% of entry, else the entry
> spot).
> **Stop S:** exit at the next 1-min close when spot closes **≥ 0.05% beyond** the defining level in the
> **adverse** direction (below for calls, above for puts). *C=1 minute, M=0.05%.*
> **Winner handoff:** S is the sole downside stop until the position arms at **+50%**; after arming,
> hand off to the existing **0.15 giveback trail** (keeping S active too is equivalent — B.1 (iv)).
> **Do NOT** add a mark-based abort (B.1 (ii) is the known-bad), and **do NOT** take profit on a
> favorable node break (B.4 delivered-node-TP is a null — the trail owns the upside).

**Gate for promotion:** must hold its edge over trail-only (esp. the CI-floor lift and put-side save)
as the backfill fills to ~35 days, and must be watched for **call-side winner-clipping** (the false-kill
cost). Ghost/paper only; nothing ships to live logic from this study.

---

## §C — Synthesis & DECISIONS NEEDED

**What we learned (LEANS, n≈12 day-blocks):**
1. **Structural-break EXIT > trail-only** (+4% vs +2%, CI floor −8%→−2%, P>0 63%→86%), by cutting the
   left tail while keeping the median — and it is **decisively better than the mark-abort**. The
   operator's core idea ("the thesis dies when the defining level breaks, not when the mark wiggles")
   **holds as a risk overlay.** Best cell **M=0.05% / C=1**.
2. **The improvement is put-side loss-control**, with a modest call-side winner-clipping cost — so it's
   a portfolio overlay, not a call-side booster. On a calls-only book, plain trail-only edges it.
3. **Tap-count is not general information** (pooled bounce-prob flat across taps, mirror-matched). The
   **pika-floor** exception (75%→61%, 42% break-within-30 after a 2nd-tap bounce) matches doctrine's
   floor-specific claim and is the one piece worth more n.
4. **Delivered-node take-profit is a null** — do not exit winners on a favorable node break.

**DECISIONS NEEDED (no live-code change proposed):**
- **Consider ghost-testing the §B.6 structural-break stop overlay** on the extreme-probe / existing fire
  cohort — the sharpest positive lean this program has produced on the exit side. Watch call-side
  false-kills; re-measure at ~35 days before any promotion.
- **Do NOT ship a mark-based abort** (re-confirmed net-negative) and **do NOT** add a node-break
  take-profit.
- **Log tap-sequence on floors** as a future entry-risk flag only; not tradeable alone at this n.
- **Reconcile with the mirror doctrine:** the exit result is *not* a claim that nodes forecast drift
  (TERRAIN/King-as-level still fail the mirror). It's a claim that **a break of the level you entered
  against is a good moment to stop** — a stop-placement result, orthogonal to the entry-edge conservation
  law, and it survives *because* it's loss-control, not prediction.

---

## §D — Reproduce & viewer artifacts

```
cd apps/gex/research/velocity-capture/pipeline
python3 tap_break_exit.py
# -> tap_break_exit_results.json      (all numbers behind this report)
# -> ../tap_events.jsonl              (809 taps on Kings/strong nodes: {day,ticker,minute[UTC],strike,kind:"tap",tapno,resolved})
# -> ../struct_exit_events.jsonl      (420 probe entries scored under BEST S cell M=.05%/C=1:
#                                       {day,ticker,minute[UTC],strike[defining level],kind:"probe",implied,exit_minute[UTC],outcome,pnl_pct})
```
`tap_events.jsonl` minutes are **UTC** (ET+4) to match `probe_events.jsonl`; `terrain_events.jsonl` is
ET — confirm the viewer's timezone before overlaying. `struct_exit_events.jsonl` `outcome` ∈
{`struct_exit` (156), `win` (240), `eod` (24)}; `pnl_pct` is authoritative (net, 3% haircut). Emitted
for **every** entry regardless of the (positive-but-modest) verdict so the operator can see all 420 on
the map. Pre-registration (§A, §B) is frozen — re-run as the backfill fills; do not retune the grid.

*Author: Bellwether research subagent. RESEARCH ONLY — nothing here changes live code or trading rules.*
