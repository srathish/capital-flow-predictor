# Node Position (Floor / Ceiling / Midpoint) — Flagship Doctrine Study

**Date:** 2026-07-14  **Status:** RESEARCH ONLY (Clause 0 — no live-code change; any
recommendation lives in DECISIONS NEEDED at the bottom).
**Script:** `research/gexvex-structure/node_position.mjs` (reproducible; run `node` on it).
**Data:** replay fire set `research/exit-study/fires_index.json` → 1,295 fires with option
marks / 61 days. Surface features read causally from
`data/skylit-archive/intraday/<date>/<TICKER>.jsonl.gz` (5-min), snapshot **at or before**
fire time (median/p95 staleness 0.0m — fires are timestamped on frame boundaries, no
look-ahead). Node/relSig definition mirrors `src/domain/significance.js`.
**Outcome:** realized P&L under the **LIVE TRAIL** (arm 0.50 / gb 0.15 / stop 0.60),
signal→EOD, 3% haircut — the SAME exit for baseline and every treatment.

---

## Pre-registration (stated before looking at outcomes)

This is the **first hypothesis derived from the DOCTRINE** (`docs/skylit-academy.md`
Ch1 "Charts First", Ch3 "Node Hierarchy") rather than from mining the GEX layer. The
doctrine is explicit: *"We fade extremes, not midpoints. If price is between nodes, the
R:R is against you."* and *"Skylit doctrine requires a 3:1 minimum R:R."* Our patterns
(`reverse-rug.js`, `rug-setup.js`) only check that a qualifying pika **exists** on the
right side of spot — they **never** check WHERE SPOT SITS between the floor and ceiling.
So the system is free to fire at midpoints, which the doctrine forbids.

- **FLOOR** = largest |gamma| node below spot. **CEILING** = largest |gamma| node above
  spot. **pos = (spot − floor) / (ceiling − floor)** — 0 = at floor, 1 = at ceiling, 0.5 = midpoint.
- **H1:** fires at a structural EXTREME (pos ≤ 0.20 or ≥ 0.80) outperform MIDPOINT fires
  (0.35 ≤ pos ≤ 0.65). Midpoints are the losing cohort.
- **H2:** direction-aligned — a CALL at the FLOOR (bounce off support) outperforms a CALL
  at/into the CEILING. Mirror for puts (PUT at ceiling >> PUT at floor).
- **H0:** null — node position carries no P&L information.

Baseline (all fires, live trail): **avg −4.5% / fire, win 47%, PF 0.86.** (Ladder +7.1%,
hold-EOD −3.6% — same qualitative story under every exit.)

---

## VERDICT: HONEST NULL — and the doctrine's R:R rule is mildly INVERTED

Node position does **not** discriminate winners from losers, the direction-aligned
prediction (H2) is **mildly reversed**, and **no** midpoint-suppression gate beats a
volume-matched random skip out-of-sample. The one doctrine concept with a pulse — path
**obstruction** (a big node sitting between spot and the target) — points the right way
and holds on both walk-forward halves, but does **not** clear significance. H0 stands.

This is the 13th consecutive structural hypothesis to die, and notably the doctrine-derived
one dies too. The single validated edge remains the bull tape gate (price structure, not GEX).

---

## 1. H1 — Extremes vs Midpoints: NULL, if anything reversed

Zone table (live trail, avg% / win / PF / train / test):

| zone | n | avg% | win | PF | train | test |
|---|---|---|---|---|---|---|
| AT-FLOOR (pos≤0.20) | 210 | −2.9 | 49% | 0.91 | −11.5 | +7.1 |
| lower band (0.20–0.35) | 183 | **−12.2** | 39% | 0.68 | −3.2 | −21.7 |
| MIDPOINT (0.35–0.65) | 462 | −3.8 | 47% | 0.89 | −2.3 | −5.3 |
| **upper band (0.65–0.80)** | 215 | **+5.5** | 56% | **1.20** | +7.8 | +3.0 |
| AT-CEILING (pos≥0.80) | 225 | **−11.1** | 46% | 0.69 | −15.9 | −7.0 |
| **EXTREMES (≤.20 or ≥.80)** | 435 | **−7.1** | 47% | 0.79 | −13.6 | −0.8 |
| **MIDPOINTS (.35–.65)** | 462 | **−3.8** | 47% | 0.89 | −2.3 | −5.3 |

**Extremes − Midpoints = −3.4pt** (95% CI [−13.4, +6.3], P(extremes better) = 0.26).
The doctrine predicts this positive; it is **negative**. The AT-CEILING extreme (−11.1,
PF 0.69) is one of the two worst cohorts in the whole study. The only zone that is
positive on **both** walk-forward halves is the **upper band 0.65–0.80** (+5.5, PF 1.20) —
i.e. approaching but *not* at the ceiling — which is the opposite of "fade the extreme."
Deciles are non-monotone; there is no ordering by position. **H1 rejected.**

## 2. H2 — Direction-aligned: NULL for calls, significant in the WRONG direction for puts

| cohort | n | avg% | win | PF |
|---|---|---|---|---|
| CALL @ floor (pos≤.20) | 84 | −8.5 | 49% | 0.74 |
| CALL @ mid | 163 | +6.5 | 55% | 1.23 |
| CALL @ ceiling (pos≥.80) | 95 | −4.0 | 54% | 0.87 |
| PUT @ ceiling (pos≥.80) | 130 | **−16.3** | 40% | 0.59 |
| PUT @ mid | 299 | −9.4 | 42% | 0.74 |
| PUT @ floor (pos≤.20) | 126 | +0.8 | 49% | 1.03 |

- **Calls:** floor − ceiling = −4.5pt (CI [−22.3, +13.4], P=0.32). Doctrine predicts
  floor >> ceiling; data says floor is slightly *worse*. Reversed, not significant.
- **Puts:** ceiling − floor = **−17.1pt** (CI [−35.7, +1.2], **P=0.033**). This is the
  only H2 leg that reaches nominal significance — **in the wrong direction.** A put fired
  INTO the ceiling (exactly the doctrine's "fade the extreme" spot for a bear) is the
  single worst cohort in the study (−16.3, PF 0.59); a put fired at the floor is flat.
  The doctrine is not merely uninformative here — mechanically applied to the GEX surface
  it is **backwards**. **H2 rejected.**

## 3. Where does the system actually fire?

36% of fires (462/1,295) land in the **midpoint** dead zone; median pos = 0.53; bulls and
bears both average pos ≈ 0.52. So the system does spray fires across the whole floor→ceiling
span with a central bias, exactly as the "no position check" code path predicts. **But**
(§5–6) the midpoint cohort is not the losing cohort, so "we fire into dead space" is not,
by itself, a costly bug.

## 4. Doctrine R:R gate (3:1 minimum): INVERTED

With floor/ceiling as the only levels, R:R is an exact monotone transform of pos
(calls RR=(1−pos)/pos), so this restates §1 in the doctrine's own units:

| R:R | n | avg% | PF |
|---|---|---|---|
| RR < 1 ("against you") | 654 | −2.1 | 0.94 |
| RR 1–2 | 248 | −1.8 | 0.95 |
| RR 2–3 | 108 | −9.4 | 0.73 |
| **RR ≥ 3 (doctrine minimum)** | 285 | **−10.8** | **0.69** |

The doctrine's 3:1-minimum fires are the **worst** cohort; the "R:R against you" fires are
the least bad. Requiring RR ≥ 3 would *lower* system P&L. **Inverted.**

## 5. Gate test — no midpoint-suppression gate beats a volume-matched random skip

A pure suppression gate leaves kept-fire entry prices unchanged, so
`system_gate = f·mean(kept)`, `system_random(f) = f·baseAll`, and the only honest metric is
`vsRandom = f·(mean(kept) − baseAll)` — positive only if the fires KEPT beat the *average*
baseline fire. (Baseline is −4.5%/fire, so any volume cut books +f·4.5 for free; that is the
random-skip control that has killed 4 prior hypotheses.)

| gate | f kept | keptAvg | vsRand | p | vsRand-train | vsRand-test |
|---|---|---|---|---|---|---|
| suppress midpoint .35–.65 | 0.64 | −5.0 | −0.3 | 0.55 | −0.8 | +0.2 |
| suppress .25–.75 | 0.44 | −5.4 | −0.4 | 0.60 | −2.3 | +1.6 |
| keep only EXTREMES | 0.34 | −7.1 | −0.9 | 0.74 | −3.0 | +1.4 |
| dir-aligned: keep RR≥2 | 0.30 | −10.4 | −1.8 | 0.92 | −1.8 | −1.8 |
| dir-aligned: keep RR≥3 | 0.22 | −10.8 | −1.4 | 0.92 | −1.8 | −0.9 |
| calls@floor / puts@ceil only | 0.32 | −9.7 | −1.7 | 0.90 | −1.3 | −2.0 |

Every doctrine-shaped gate has **vsRandom ≤ 0** or trivially small and non-significant. The
"keep only extremes" and "dir-aligned" gates (which enforce the doctrine hardest) are the
**worst** — they throw away better-than-average fires to keep worse-than-average ones.
**No gate survives. Bonferroni alpha = 0.05/17 = 0.0029; survivors: 0.**

## 6. What are we skipping? The less-bad cohort

The midpoint cohort we'd suppress has baseline avg **−3.8%** — *better* than the −4.5%
all-fires baseline. It holds 35% of all winning fires and 37% of gross gains. So a
midpoint skip removes the **less-bad** third of the book and keeps the worse extremes —
the opposite of the intended effect. We would be skipping mild winners, not losers.

## 7. Air pockets & gatekeepers — the one lead worth naming (still not significant)

The only doctrine concept that points the right way is **path obstruction**: a large gamma
node sitting *between* spot and the trade's target. This is the operative half of the
"air pocket" idea, but the predictive variable is the **obstruction (node mass in the path)**,
not spot's position between floor and ceiling.

| cohort | n | avg% | PF | train | test |
|---|---|---|---|---|---|
| path mass LOW (clear path) | 432 | −0.1 | 1.00 | −7.8 | +7.5 |
| path mass MID | 431 | −0.5 | 0.98 | +10.0 | −11.9 |
| **path mass HIGH (blocked)** | 432 | **−13.0** | 0.64 | −15.6 | −10.3 |
| **gatekeeper in path (≥3%)** | 710 | **−9.4** | 0.73 | −8.6 | −10.4 |
| no gatekeeper in path | 585 | **+1.4** | 1.04 | +1.0 | +1.8 |
| gap width ≥ median | 648 | −9.3 | 0.73 | −13.2 | −5.2 |

Run through the **same random-skip machinery**:

| gate | f kept | keptAvg | vsRand | p | tr | te |
|---|---|---|---|---|---|---|
| suppress path-mass HIGH | 0.67 | −0.3 | +2.8 | 0.12 | +3.8 | +1.9 |
| suppress GATEKEEPER in path | 0.45 | +1.4 | +2.7 | 0.082 | +2.4 | +3.0 |
| suppress gap width ≥ median | 0.50 | +0.2 | +2.4 | 0.13 | +4.5 | +0.2 |

These are the **only** gates with vsRandom > 0 on **both** halves. The gatekeeper effect
also survives a distance confound (GK-in-path is worse than no-GK within every
target-distance tercile: −28.6 / −3.2 / −3.6pt), so it is not purely "the target is far."
**But** the best p-value is 0.082 — short of nominal 0.05 and far from Bonferroni 0.0029.
This is a **suggestive lead, not a validated edge.** It says the same thing the escalator/pin
and node-exit work already say: what matters is whether a wall stands in the way, not where
spot sits in the range. Worth a dedicated pre-registered study; not worth a rule today.

## 8. Robustness (all consistent with the null)

- Production 5% significance floor for floor/ceiling: extremes −5.9 vs midpoints −4.9 —
  still no discrimination.
- Ladder exit: extremes +3.4 vs midpoints +9.1 (midpoints *better*). Hold-EOD:
  extremes −9.9 vs midpoints −1.5 (midpoints better). The reversal is exit-invariant.
- Incremental over the bull tape gate: on the 1,135 post-tape fires, suppressing midpoints
  gives vsRandom −0.4 (p=0.56). Adds nothing on top of the validated gate.

---

## DECISIONS NEEDED (proposals only — no code touched)

1. **Do NOT add a node-position / midpoint / R:R-3:1 gate to the fire path.** The
   doctrine's floor/ceiling/midpoint framing, applied mechanically to the GEX surface,
   carries no P&L signal, and its R:R and direction-aligned rules are mildly *inverted*.
   Any such gate underperforms a coin-flip skip out-of-sample.
2. **Reconcile the doctrine gap intellectually, not in code.** The finding that Heatseeker
   is a confirmation tool, not a signal generator, remains true — but "trade extremes, not
   midpoints" does not translate into a profitable GEX-surface filter. The doctrine is about
   *price/chart* structure; the GEX node positions are a weaker proxy that does not inherit
   the edge. Consistent with the standing note: *GEX is a map, not a forecast.*
3. **Follow-up worth pre-registering:** path **obstruction** (gamma mass / a gatekeeper node
   between spot and target) is the one doctrine concept that points the right way on both
   halves and survives a distance confound (p≈0.08). A focused study — obstruction magnitude
   × sign × as a HOLD/EXIT signal rather than an entry gate — is the highest-value next step
   from this program. Do not ship it as a rule until it clears the random-skip + Bonferroni bar.
