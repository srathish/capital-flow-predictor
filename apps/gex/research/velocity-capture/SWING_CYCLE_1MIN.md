# Swing-Cycle — the Operator's Composite Loop, End-to-End (1-min)

**RESEARCH ONLY (Clause 0). No live-code change. Findings → DECISIONS NEEDED.**
Snapshot 2026-07-14 PM. **13 trading days, 39 (day,ticker) 1-min Skylit series**
(2026-06-25 → 07-14; glob at analysis time — the backfill grew mid-study). The full rule
family (§1) is **pre-registered and frozen before outcomes**; mirror-controlled; day-block
bootstrap over ~13 day-blocks → **every verdict is a LEAN, not a finding.**

---

## One-line verdict

**The composite loop does not beat its parts, and its parts do not beat their controls.**
The full cycle is **net-negative in both entry variants** after costs — Variant A (session-extreme)
**−14.8%/entry**, Variant B (pika-touch) **−7.8%/entry** — and the **re-entry leg subtracts value in
both** (A −2.5 pts vs single-shot, B −0.7 pts), so the live system's "no re-entry while a play is open"
rule **costs nothing; it may be saving money.** Variant A's *entry location* has the same small-but-real
edge the probe study found (it beats random timing by **+12.4 pts**, −14.8% vs −27.2%) — but not enough to
clear costs. **Variant B — the operator's pika-touch rule — fails its mandatory mirror:** dominant-pika
bands bounce **77%** of touches, phantom empty bands **78%**, weak nodes **80%** — *dominance does not
change the physics* — and dominant-pika option P&L (**−7.8%**) is **no better than its distance-matched
phantom (−6.5%)** and **no better than random entry on the same contracts (−6.7%)**. The one operator
component with a positive directional contribution is the **structural break-stop** (+2.9 pts on A: it cuts
the dead-level losers). The ladder helps on the call side (consistent with the verified scale-out study) and
is a wash on puts. **Net: honest null. Nothing here qualifies for a ghost test.** The conservation law that
killed the 5-min and 1-min terrain studies kills the pika-touch cycle too.

---

## 1. Pre-registration (frozen before any outcome)

**Shared exit — the verified scale-out ladder** (from `SCALEOUT_2026-07-13`): book ⅓ at **+50%** (limit),
⅓ at **+100%** (limit), final third **trails** (arm +50 / giveback 30% of peak / hard-stop −60%). Costs =
**1.5%/leg (~3% round-trip) charged on EVERY leg** (all-leg, the hardest case). Entry/exit on 1-min closes.

**Shared structural stop (the operator's break rule).** An open position exits **all** remaining size if
spot **closes beyond the defining level by 0.10% for 2 consecutive minutes**; after a structural break the
level is **dead** — no further entries there that day.

**Shared throttle.** Max **8 entries/side/day**, **≥50% reserved for post-12:00 ET** (≤4 before noon) — the
fix for the probe study's front-loading pathology. Cooldown **5 min** between entries/side. Max **3 cycles
per level**.

**ENTRY VARIANT A — session-extreme (extreme_probe v2).** After 10:00 ET, a **new session extreme that
breaks the opening range** (09:30–10:00 hi/lo) + **2 consecutive closes reclaiming** it → ATM (call at a new
low, put at a new high). RE-ENTRY = retouch within **0.10%** of the extreme + 2-close reclaim.

**ENTRY VARIANT B — pika-touch (the operator's rule).** A **DOMINANT pika** = a +γ strike that sustains
(≥5 min) **relSig ≥ 0.15 OR is the surface King while pika** (his "relSig≥0.15 *or the King itself when
pika*"; this is the STRONG, conditioned subset — the prior mirror-kill was on unconditioned relSig≥0.10).
Band = strike ± **0.05%** of spot. **Floor→call:** price sits above the band, touches it, then **2 closes
back above** → buy call. **Ceiling→put:** price below, touches, **2 closes back below** → buy put. RE-ENTRY
= same band, same direction, ≤3 cycles. Also run **conditioned-B** (direction must agree with the day's
trend-so-far, VWAP-proxy) and a **mandatory phantom mirror** (band reflected across spot at the pika's arm).

**Comparisons (same days, all-leg 3% haircut, day-block bootstrap, walk-forward halves):**
(a) THE CYCLE · (b) single-shot ladder (no re-entry) · (c) single-shot plain trail (prior best) ·
(d) random-timing matched frequency · (e) live `tracked_plays` replay.

---

## 2. Primary — per-entry expectancy & per-day P&L (net, all-leg 3% haircut)

Day-block bootstrap 90% CI on per-entry expectancy; `p+` = P(mean>0). n≈13 day-blocks.

| config | side | legs | expect | median | hit | $/day | boot90CI | p+ |
|---|---|---:|---:|---:|---:|---:|---|---:|
| **A_cycle** (full) | all | 126 | **−14.8%** | −45.2% | 37% | −143.7% | [−22.3, −6.8] | 0% |
| | call | 48 | −9.5% | −47.1% | 38% | −35.0% | [−28.7, +27.5] | 32% |
| | put | 78 | −18.1% | −44.0% | 36% | −108.7% | [−25.6, −6.2] | 1% |
| A_ss_ladder (no re-entry) | all | 108 | −12.3% | −38.1% | 38% | −102.6% | [−20.8, −3.3] | 1% |
| | call | 43 | −3.8% | −33.1% | 40% | −12.5% | [−22.4, +29.8] | 43% |
| A_ss_ladder_nostruct | all | 94 | −15.2% | −61.5% | 40% | −110.0% | [−26.5, −2.6] | 2% |
| A_ss_trail (prior best) | all | 94 | −16.1% | −61.5% | 40% | −116.6% | [−26.6, −4.2] | 1% |
| | call | 37 | −10.2% | −61.4% | 46% | −29.1% | [−30.6, +26.6] | 30% |
| **B_cycle** (full) | all | 211 | **−7.8%** | −29.9% | 45% | −126.0% | [−12.1, −2.1] | 2% |
| | call | 103 | −2.4% | −10.4% | 48% | −19.1% | [−15.5, +11.9] | 38% |
| | put | 108 | −12.9% | −38.5% | 42% | −106.9% | [−21.6, −4.1] | 1% |
| B_ss_ladder (no re-entry) | all | 173 | −7.1% | −27.2% | 45% | −94.1% | [−13.0, −0.1] | 5% |
| | call | 84 | +1.2% | +4.2% | 50% | +7.6% | [−13.4, +15.5] | 54% |
| B_ss_trail (prior best) | all | 143 | −6.3% | +14.1% | 52% | −69.8% | [−13.5, +2.1] | 10% |
| | call | 72 | −0.8% | +21.4% | 56% | −4.7% | [−19.6, +17.1] | 46% |
| **B_cycle_cond** | all | 124 | −1.7% | +0.0% | 50% | −15.7% | [−12.7, +10.4] | 42% |
| | call | 70 | +3.6% | +16.2% | 54% | +19.6% | [−12.5, +19.8] | 63% |
| | put | 54 | −8.5% | −23.7% | 44% | −35.3% | [−23.1, +5.7] | 19% |
| **B_cycle_phantom** (mirror) | all | 199 | **−6.5%** | −29.8% | 49% | −98.8% | [−16.0, +6.7] | 20% |
| | call | 110 | −2.5% | +8.5% | 51% | −21.2% | [−17.0, +14.3] | 40% |

**Controls.**
- **(d) random-timing, matched frequency** (same ATM contracts, random entry 10:00–15:30, identical
  ladder+struct): vs A_cycle freq **−27.2%** (boot [−35.8, −18.3]); vs B_cycle freq **−6.7%** (boot [−9.4,
  −3.5]). **A beats random by +12.4 pts; B does *not* beat random (−7.8 vs −6.7).**
- **(e) live `tracked_plays`, overlap days:** all **−22.7%** (med −35.3%), **calls +14.3%**, **puts −51.1%**
  (n=175). Same signature as every prior study — the live book bled on failing put fires; both cycle
  variants' *all-side* beat the live all-side, driven entirely by not being as short-heavy.

**Cycle-count distribution** (how often re-entry actually happened): A_cycle {1:105, 2:17, 3:4};
B_cycle {1:176, 2:31, 3:4}. Re-entry fires on a minority of levels, and when it does the later cycles are
lower-quality (below).

---

## 3. Component decomposition — which piece (if any) carries it?

Reading the ladder of single-shot configs isolates each component's marginal contribution (all-side, net):

| component | comparison | Δ | read |
|---|---|---:|---|
| **Entry location (A)** | A_cycle −14.8 vs random −27.2 | **+12.4** | real edge — extremes beat random timing (replicates the probe) |
| **Entry location (B)** | B_cycle −7.8 vs random −6.7 | **−1.1** | **none** — pika touches ≈ random entry on same contracts |
| **Ladder (A)** | A_ss_ladder −12.3 vs A_ss_trail −16.1 | **+3.8** | ladder beats plain trail (call-carried, per SCALEOUT) |
| **Ladder (B)** | B_ss_ladder −7.1 vs B_ss_trail −6.3 | **−0.8** | wash / slightly worse on this cohort |
| **Structural stop (A)** | A_ss_ladder −12.3 vs …_nostruct −15.2 | **+2.9** | **helps** — the break-stop cuts dead-level losers |
| **Re-entry (A)** | A_cycle −14.8 vs A_ss_ladder −12.3 | **−2.5** | **hurts** — re-touch legs are worse than the first |
| **Re-entry (B)** | B_cycle −7.8 vs B_ss_ladder −7.1 | **−0.7** | **hurts** (marginally) |

**Answer to the brief's decomposition question:** the pieces that *add* value are (i) **entry location on
the extreme side** and (ii) the **ladder on calls** and (iii) the **structural break-stop** — each trims the
loss by 3–12 pts, but **none lifts the composite to profit.** The pieces that *cost* value are **re-entry**
(both variants) and **the pika-touch entry** (fails its mirror, §4). **No single component carries it because
there is no positive expectancy to carry** — the composite is the sum of a real-but-insufficient entry edge,
a good exit, and a re-entry leg that dilutes.

**The dedup question, answered:** the live system forbids re-entry while a play is open. This study shows
that **re-entering *after* a full exit is net-negative** — so the live rule is not leaving money on the
table; the operator's instinct to "get back in after the next touch" is, on this data, a value-*destroyer*
(the 2nd/3rd cycles catch weaker retests that the ladder can't monetise before the level dies).

---

## 4. Variant B mirror — the whole ballgame for the pika-touch rule

**Physics — P(bounce | touch), pooled over 39 series** (bounce = enter band, exit the same side within 5 min):

| node set | touches | bounces | **bounce rate** |
|---|---:|---:|---:|
| **dominant pika** (relSig≥0.15 or King-pika) | 728 | 560 | **77%** |
| weak node (relSig 0.10–0.15) | 116 | 93 | **80%** |
| **phantom** (dominant band reflected across spot) | 672 | 526 | **78%** |

**Dominance does NOT change the physics.** A dominant pika bounces price 77% of touches; a *distance-matched
empty level* bounces it 78%; a merely-weak node 80%. On a slow index, price pauses/rejects at **any** level
at the same ~77–80% base rate — real, dominant, weak, or phantom. This is exactly the `TERRAIN_EVENTS`
result (weak nodes were mirror-equal) **extended to the strong, conditioned subset the operator believes in:
strength buys no extra bounce.**

**Option P&L confirms it.** Dominant-pika cycle **−7.8%** vs its **phantom −6.5%** (real is *worse*), vs
**random −6.7%**. The touch+reclaim timing on a real dominant band earns nothing a phantom band or a random
entry doesn't. The only sliver that goes green is **conditioned-B call-side (+3.6%, p+=63%)** — but its CI
includes 0, it fails the walk-forward (train −10.9 / test +9.2, not both-positive), and the phantom call
side sits at the same −2.5% as the real call side, so even this sliver is not demonstrably pika-specific.
**Variant B fails the mirror. KILL it.**

---

## 5. Walk-forward halves (per-entry expectancy)

| config | train (n) | test (n) |
|---|---|---|
| A_cycle | −18.0% (60) | −12.0% (66) |
| A_ss_ladder | −16.5% (56) | −7.9% (52) |
| B_cycle | −11.4% (114) | −3.4% (97) |
| B_ss_ladder | −12.5% (94) | −0.6% (79) |
| B_cycle_cond | −10.9% (67) | +9.2% (57) |
| B_cycle_phantom | −9.8% (95) | −3.4% (104) |

Every composite config is **negative in the train half**; the test half is less-negative (the late sample is
more up-trending / less put-punishing) but only conditioned-B call turns positive OOS, and its train half is
−10.9% — **no config is positive in BOTH halves.** No walk-forward pass.

**Multiple-comparisons.** Pre-registered grid ≈ **9 configs × 3 sides ≈ 27 cells** plus 2 random + mirror.
Expected best-of-N under the null would surface a few nominal p+>60% cells by chance; the only such cells
(conditioned-B call p+=63%, B_ss_ladder call p+=54%) sit **inside** that expectation and none clears an
uncorrected 0.05, so **Bonferroni is moot — there is no positive result to discount.**

---

## 6. Case studies — 2026-07-14, traced cycle-by-cycle (the operator's motivating example)

### SPXW — the "7515–7520" zone
- **session_low 7515.34 @ 09:30 (the opening print); high 7556.11 @ 11:09.** Dominant pikas: **7520**
  (King-pika, peak relSig 0.137), 7555 (relSig 0.398), 7585 (King-pika 0.127).
- **The 7515 low was the open**, and price **never returned to it after 10:00** — so **Variant A fired NO
  call there** (the extreme *is* the opening range; the after-10:00-break gate can't trigger on it). This is
  the exact structural miss the probe study flagged: the motivating extreme is a 09:30 print.
- **Variant B fired no leg at 7520 either** — 7520 was touched only ~1 minute after the open; price spent
  the day pinned to the **7545–7550 BARNEY ceiling** (King-barney 151 min), not the 7520 pika floor.
- **What actually traded:** Variant A **puts** off the barney ceiling — entry 14:40 ET-UTC 14:40… → book
  **+23%** (ladder_r1) at 7546; entry 15:13 → **+35%** (ladder_r1) at the 7556 high. **The day's real edge
  was fading the negative-gamma ceiling, not buying the 7515–7520 floor the operator was watching.**

### QQQ — the "720 pin"
- **session_low 711.74; high 722.04.** Dominant pikas: **719 (0.211), 720 (0.368), 722 (0.372), 723
  (0.269)** — a genuine dominant-pika **pin cluster**, King-pika 720 for 107 min / 722 for 132 min. The 720
  band was touched **63 minutes** and **bounced 77%** of touches. **The pin was real and it held.**
- **Variant B cycled it hard — and netted negative.** Traced legs (entry→exit, ET-of-UTC labels as emitted):
  - 720 call: **struct_exit −60%** (floor broke), then **trail −63%**, then cyc2 **ladder_r1 +15%**.
  - 719 call: **struct_exit −27%**, then **ladder_r1 +36%**, then cyc2 **ladder_r1 +21%**.
  - 720 put (morning, price below → ceiling): **trail −64%**; cyc2 **struct_exit −59%**.
  - 719 put: **struct_exit −63%**, **trail −62%**.
  - 722 put (afternoon, session-high ceiling): **ladder_r2 +67%** — the one clean winner.
- **The pin pinned (77% bounce) but trading it lost money:** the bounces are too *small* to beat theta+haircut
  on ATM 0DTE (the winners are +15/+21/+36), while each time the band finally broke the structural stop booked
  a **−60%** leg. High bounce-probability ≠ positive option expectancy. This single day is the whole study in
  miniature — and it is why the mirror (§4) matters more than the bounce rate the operator sees on the tape.

---

## 7. Synthesis & DECISIONS NEEDED

**What we learned (LEANS, n≈13 day-blocks):**
1. **The composite loop is net-negative in both entry variants.** A_cycle −14.8%, B_cycle −7.8% per entry
   after costs; every all-side bootstrap CI is ≤0.
2. **Re-entry is a value-destroyer** (−2.5 pts A, −0.7 pts B). The live "no re-entry while open" rule costs
   nothing; re-entering after exit adds weaker legs. **The dedup rule is vindicated.**
3. **Variant B (pika-touch) fails its mandatory mirror.** Dominant pikas bounce 77% vs phantom 78% vs weak
   80% — dominance changes nothing — and dominant-pika P&L (−7.8%) is no better than phantom (−6.5%) or
   random (−6.7%). **The conservation law holds again.**
4. **Variant A's entry location is a real but insufficient edge** (+12.4 pts vs random); the **ladder** (+3.8
   pts, call-side) and the **structural break-stop** (+2.9 pts) each trim losses. **None lifts it to profit.**
5. **The operator's 7515–7520 example was un-tradeable by his own rules** (the low was the 09:30 open); his
   **720 pin was real and held (77% bounce) yet lost money** to trade with ATM 0DTE.

**DECISIONS NEEDED (no live-code change proposed):**
- **Do NOT ship the swing-cycle composite (either variant).** Net-negative, mirror-failed, no WF pass.
- **Do NOT build the pika-touch entry (Variant B).** It is the terrain mirror-kill re-confirmed on the strong,
  King-conditioned subset. Dominance is not the missing ingredient.
- **Do NOT add re-entry-after-exit to the tracker.** It subtracted value in every cut. Keep the current
  no-re-entry-while-open dedup.
- **The only carry-forward candidates (each already owned by another lane, not new here):** (i) the
  **structural break-stop** as an *exit* add-on (it cut dead-level losers by +2.9 pts on A) — feed it to the
  mark-gate/invalidation lane for a pre-registered exit test; (ii) the **verified ladder on the call side**,
  already the DECISIONS-NEEDED candidate from `SCALEOUT`. **Neither is an entry rule.**
- **Reconcile with doctrine:** entries at structural pins/pikas do not carry a directional edge over phantom
  levels; the durable facts remain *structural-map + tape-gate + node-aware exits*, not touch-timing entries.

---

## 8. Viewer JSONL & reproduce

**`research/velocity-capture/cycle_events.jsonl`** — 337 legs (126 Variant A · 211 Variant B), one line each:
```json
{"day","ticker","minute"(entry UTC HH:MM),"strike"(defining level),"kind":"cycle",
 "implied":"up"|"down","exit_minute"(UTC HH:MM),"outcome":"ladder_r1"|"ladder_r2"|"trail"|
 "struct_exit"|"eod","pnl_pct"(net %, haircut),"cycle_no","variant":"A"|"B"}
```
Outcome mix: struct_exit 95 · trail 99 · ladder_r1 71 · ladder_r2 70 · eod 2. `minute`/`exit_minute` are
**UTC** (ET+4); the ET-based `terrain_events.jsonl` differs by 4h — confirm the viewer's timezone before
overlaying. `strike` is the **defining level** (session extreme for A / pika strike for B), so legs plot at
the level being cycled.

```
cd apps/gex/research/velocity-capture/pipeline
python3 cycle_swing.py     # Variants A & B, ladder+struct, re-entry, controls, mirror, bootstrap, JSONL
# -> cycle_swing_results.json   (all numbers behind this report)
# -> ../cycle_events.jsonl      (337 cycle legs for the terrain viewer, both variants)
```
Pre-registration (§1) is frozen; re-run as the backfill fills (more days landing — it grew from 30 to 39
series during this study) to tighten the CIs. **Do not retune the grid.**

*Author: Bellwether research subagent. RESEARCH ONLY — nothing here changes live code or trading rules.*
