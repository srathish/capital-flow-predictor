---
title: Research Journal
source_url: repo://apps/gex/research/JOURNAL.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T19:10:43Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
summary: 'PRE-REGISTERED (research/forecast-ensemble/DESIGN.md + Amendment A1, both written before compute): thesis = L2-logistic ensemble of z-scored daily features from ≥10 UW families predicts SPY next-session open→close at ≥52.5% OOS + logloss < base + both placebos ≥95th + no single family clears alone…'
url_sha1: f4db7f98bcb0f408ee32db0edc19bf53049c6164
simhash: '11326968991591264343'
status: vault
ingested_by: seed
---

# Research Journal

Newest entry first. Template:

```
## YYYY-MM-DD session N
PRE-REGISTERED: <thesis / metric / bar for each item, written before compute>
RAN: <what actually executed>
VERDICTS: <confirmed / research_more / rejected / not_testable + key numbers>
BACKLOG: <re-rank + new items queued>
DECISIONS NEEDED: <anything requiring the user — proposals only, nothing acted on>
```

---

## 2026-07-11 session 1 (interactive — forecast ensemble Phase 1)

PRE-REGISTERED (research/forecast-ensemble/DESIGN.md + Amendment A1, both
written before compute): thesis = L2-logistic ensemble of z-scored daily
features from ≥10 UW families predicts SPY next-session open→close at
≥52.5% OOS + logloss < base + both placebos ≥95th + no single family
clears alone + stability cuts. A1 (user request): 3-class chop label
(|ret| < trailing-60 30th pctile), chop bar AUC ≥0.55. Interpretability
deliverable: what tilts up/down/chop days.

RAN: backfilled 250 sessions × 10 families (1,361 paced UW calls, 0
errors); 440-row × 47-feature matrix (SPY+QQQ); walk-forward (train 120
step 20, C frozen at 0.01 from first window); 400 placebo runs; 10 single-
family + 10 drop-one ablations; ONE follow-up (rule 2): placebo + cuts on
the shortvol single-family anomaly. Report: forecast-ensemble/REPORT.md.

VERDICTS:
- Ensemble binary direction: **rejected** — OOS hit 50.0% (base 56%),
  logloss 0.729 > 0.691, placebos 46th/40th pctile. Second convergent
  negative on daily direction-from-positioning (extends s4/s5 GEX-sign).
- Chop (A1 secondary): **rejected** — AUC 0.537 < 0.55 bar.
- Shortvol factor (post-hoc, ablation-discovered): **research_more** —
  SPY 58.0% OOS, QQQ 58.0%, both placebos 99.5th, halves hold, but
  even-days cut = 50% and n_oos=100. Direction: rising short-volume
  ratio (5d delta strongest) → next session down.

BACKLOG: forecast-ensemble item resolved → replaced by pre-registered
shortvol forward test (new item). Forward-capture job for 4 snapshot-only
families waits on DECISIONS NEEDED.

DECISIONS NEEDED:
1. Stand up a daily forward-capture cron (research-side, writes CSV under
   research/forecast-ensemble/data/forward/) for sector tides, yield
   curve, crypto whales, OI changes? Recurring process = user sign-off.
2. Shortvol factor: approve the pre-registered forward test (item queued);
   no live use before it passes.

---

## 2026-07-09 session 3 (continuous run — pure GEX/VEX conditioning)

PRE-REGISTERED (before compute):
- Item A (backlog: VIX-expansion × negGEX): thesis = negative local GEX
  fires only pay when VIX is EXPANDING at fire time; negGEX + flat/falling
  VIX is chop that doesn't reward long premium. Metric: real-dollar EV of
  the 2×2 (net_gex_local sign × vixd15 sign). Bar: negGEX+VIXup beats
  negGEX+VIXflat by >+10pp AND holds odd/even + H1/H2 AND placebo (shuffle
  vixd15 across fires) ≥95th. Guard: vixd15 coverage <100% — report n.
- Item B (GEX "sign persistence"): NEW pre-reg. thesis = a fire is better
  when the local GEX sign at fire AGREES with where it was 15-30m earlier
  (stable regime) vs a fresh sign flip (unstable). Feature: sign(net_gex
  _local now) vs sign 30m back from surface history proxy — approximate
  with net_gex_global sign stability using the m30 frame already built.
  Metric: EV of sign-stable vs sign-flipped fires. Bar: gap >+10pp, all
  four cuts, placebo ≥95th. If it duplicates net_gex_local level → reject
  as non-incremental (study 77 rule).

RAN: research/sessions s3 inline. Item A: negGEX×VIXup gap +10.1pp but
placebo 44th (noise), negGEX×VIXflat cell unstable (even −19/H2 −24) →
**rejected.** Item B: built the missing 30m-back SIGNED net_gex feature
from the archive (coverage 407/537); sign-STABLE −3.9% vs sign-FLIP +3.0%,
gap −6.9pp but placebo 37th and flip cell unstable (odd +28/even −8);
within-sign conditioning shows no clean incremental effect → **rejected,
non-incremental.**

META (recorded): five straight secondary GEX/VEX conditioners now reject
(VIX×GEX, sign-persistence, + the 77-program's density/curvature/migration
families) — the tape gate + nflags + net_gex_local LEVEL already absorb the
tradeable GEX/VEX signal on this fire set. Re-slicing the 537 fires has hit
diminishing returns; pivoting to foundational structure→spot physics (s4)
and the campaign system (different universe) is the higher-value direction.

VERDICT: session 3 effectively DRY (2 rejects). Per charter, the
"condition-the-fire-set on a new feature" thread is now on its first dry
mark; one more dry conditioning session parks that whole approach.

---

## 2026-07-09 session 16 (continuous, new idea): short-premium on predicted pins — REJECTED

RAN: F4-grounded inverse — high-trap fires predict pins (s6); would SHORTING
the ATM option profit from theta? Long-hold-to-1555 return negated, by trap.
VERDICT: **rejected.** Predicted-pin tercile: short mean +1.7%, win 65% (theta),
but CATASTROPHIC tail (23% lose >50%, worst -633% — naked 0DTE short can lose
6x premium) and UNSTABLE (odd +14.9% / even -10.5% flip). Penny-in-front-of-
steamroller. Defined-risk (spread/condor) would cap the tail but erase the
+1.7% edge after costs. Not viable.

CLOSES the short-premium direction. Full instrument picture: LONG premium pays
in expansion, dies in pins; SHORT premium pays in pins but has an uninvestable
tail. The confirmed s6 pin-prediction edge is real but NEITHER 0DTE side
captures it cleanly. The current system (long premium + structural exits to cut
pin losses) is near the best achievable with the 0DTE index instrument.

END-OF-BLOCK SYNTHESIS (s3-s16, 2026-07-09 continuous exploration):
- CONFIRMED: F1 (GEX sign != forward move), F2 (scalar conditioners exhausted),
  F3 (dual-wall topology -> pinning, placebo 100th), F4 (structure predicts
  VOLATILITY not DIRECTION, across expirations + horizons incl. 3DTE/multi-day).
- SIGNAL SIDE SATURATED: every entry conditioner (scalar, structural, temporal,
  doctrine, cross-index, cross-expiration) rejects or is uncapturable. The tape
  gate + nflags + net_gex level + structural exits already hold the tradeable
  0DTE index signal.
- INSTRUMENT IS THE CONSTRAINT: exit-patience (+38.8pp real, whipsaw-eaten),
  gatekeeper-continuation (+1bps vs ~10bps spread), short-on-pins (catastrophic
  tail) — three real edges, none capturable in 1-contract 0DTE ATM.
- FRONTIER: (a) execution-policy (partial holds — s15 DECISIONS NEEDED), (b)
  the campaign/stock universe (different instrument, longer hold, lower spread%),
  (c) forward-data graduation of the watchlist. NOT more index signal discovery.

---

## 2026-07-09 sessions 14-15 (continuous): volatility-filter bridge + partial-hold instrument

s14 — BRIDGE s6 physics to option EV: trap score at fire (min up/down wall
share) vs pnl_atfire. **REJECTED at aggregate** — not monotone (open -1.9 /
mid -8.8 / trapped +1.7), placebo 32nd, ticker-inconsistent. The fire
detectors already select for structure, so the vol channel is absorbed;
no free volatility filter to add. (Within flags_eq_0 open +43.9 vs trapped
+19.0 — overlaps the existing open_field watchlist item, not new.)

s15 — PARTIAL-HOLD instrument (addresses s13: instrument is the constraint):
2-contract policy on trigger-conditioned fires — one exits structurally, one
rides to 15:55. Triggered fires: baseline +14.1% -> partial +33.5% (+19.4pp),
captures 50% of the naked-hold uplift at HALF the give-back tail (naked 27%
blow-back >50pp vs partial 9%). BUT EV improvement UNSTABLE (odd -7.1pp, even
+56pp) — the trigger instability (s2) persists; the instrument fixes the TAIL,
not the EV stability. **research_more -> DECISIONS NEEDED proposal.**

DECISIONS NEEDED (proposal, NOT implemented, needs approval + >=2-contract
sizing the $1K account cannot support):
  "Partial-hold exit option — when the live trend trigger fires (aligned move
   >=40bps AND ER>=0.40 at a structural exit), hold a SECOND contract to 15:55
   instead of flat. Recovers ~half the exit-patience edge and cuts the >50pp
   give-back tail from 27% to 9%. Risk-management win; EV gain even-days-driven
   (unstable). Requires >=2 contracts -> only viable at larger account sizes,
   AFTER live validation. Do NOT implement now."

META: s14+s15 confirm the s13 conclusion decisively. Signal discovery on the
0DTE index system is saturated; every remaining lever is EXECUTION (partial
holds, instrument selection, sizing) or a DIFFERENT UNIVERSE (campaign). The
research frontier has moved off signal and onto execution-policy + the stock
system.

---

## 2026-07-09 session 13 (continuous): gatekeeper-break bps magnitude — RESOLVES real-$ question

RAN: measured ACTUAL bps captured by thick_break_ride (not just hit%), to gate
whether the queued real-dollar UW study is worth the API cost.
VERDICT: **edge too small for 0DTE options — real-$ study DEPRIORITIZED (concluded
without the UW pull).** thick_break_ride n=1063: hit 52.4%, avg win +18.4 / avg
loss -18.2 -> MEAN captured move +1.0bps (median +1.1). With Phase-1 H2 target
filter +1.3bps. A 0DTE ATM option spread costs ~8-15 underlying-bps-equiv, so
the +1bps expectancy is an ORDER OF MAGNITUDE below cost. The trend-continuation
edge is REAL in the underlying (s11 placebo 98th) but UNCAPTURABLE in 0DTE
options at this size. To revive: (a) a sub-filter pushing captured move >15bps,
or (b) a different instrument (underlying/futures, or longer-dated lower-spread%
options). Saved the UW collection.

TAKEAWAY: two independent edges now confirmed-but-uncapturable in the 0DTE
options instrument — exit patience (s2b: +38.8pp real but whipsaw-eaten) and
gatekeeper continuation (s13: +1bps vs ~10bps spread). The instrument (1-contract
0DTE ATM) is the binding constraint, not signal discovery. Points to the
execution-policy/sizing frontier (partial holds, instrument selection) as where
remaining edge lives — an execution question, not a research one.

---

## 2026-07-09 session 12 (user hypothesis): does 3DTE structure predict multi-day direction?

USER Q: do 3DTE nodes affect 0DTE / signal a down-trend for the next 3 days?
RAN (s12a-d): extracted 3DTE surface (expirationIndex 3) at EOD, tested vs
forward 1/2/3-day index returns AND forward 3-day range, all 3 tickers.

VERDICT: **DIRECTION REJECTED.** 3DTE gamma structure (net GEX, COM bias,
King-vs-spot) null for multi-day direction (com_bias->r3 placebo 3rd).
A 3DTE VANNA lead appeared (SPY +0.24 corr, peaks specifically at 3DTE) —
but REPLICATION KILLED IT: QQQ +0.02 (12th), SPXW -0.02 (14th), pooled
+0.05 (54th). SPY-only = multiple-comparison noise. So 3DTE structure does
NOT predict the next 1-3 days' direction — F4 extends to longer expirations
and multi-day horizons.
VOLATILITY reframe (F4-consistent): 3DTE concentration null (placebo 7th);
3DTE dual-wall trap -> less forward-3d range shows a WEAK but ticker-
CONSISTENT negative corr (-0.10 pooled; SPY -0.05/QQQ -0.14/SPXW -0.12 all
negative) = the s6 pin effect faintly echoing at multi-day, placebo 84th
(below bar). Not confirmed, but the only directionally-coherent thread.

TAKEAWAY: 3DTE nodes do not forecast a multi-day trend. The map is a
volatility instrument at every horizon tested (0DTE 30-min through 3-day),
never a direction instrument. Strongest re-confirmation of F4 yet.

---

## 2026-07-09 session 11 (continuous): gatekeeper-break continuation — REPLICATES (weak), real-$ pending

ENRICHMENT: read docs/findings.md (Phase 1, Apr 2026). Surfaced the documented
BIGGEST GAP: no trend-continuation pattern; system caught 1/802 impulse events.
Phase 1 found thin_break_fade (3-5% relsig breaks revert 64%) + thick_break_ride
(7-10% continue 58.7%) but never real-dollar validated or placebo'd.

RAN (s11): re-validated on full 64-day archive (5,384 gatekeeper-break events).
VERDICT: **replicates but WEAKER — research_more, real-$ pending.**
Continuation by broken-node rel_sig: thin 3-5% 47.3% (=52.7% revert), med 48.3%,
thick 7-10% 52.4%, huge 10%+ 50.2%. Thick vs baseline placebo 98th, stable
odd/even (53/52). BUT 52.4% is far below Phase 1's 58.7% and marginal after
0DTE option bid-ask. This is the ONLY directional edge to survive any test —
and it CONFIRMS F4: structure (relsig band) selects WHICH tape-breaks continue;
direction comes from the break (tape), not the structure sign.

NEXT (queued, needs UW candles at break events — NOT during backfill): price
thin_break_fade + thick_break_ride in real option dollars incl. spread. Only
then is it a candidate. This is a genuinely new feature class (event-level,
trend-continuation) that re-opens the entry frontier the fire-set exhausted.

---

## 2026-07-09 session 10 (continuous): Trinity structural alignment (Ch 10) — REJECTED + F4 synthesis

ENRICHMENT: read Academy Ch 10 (Trinity/cross-index confluence). Claim:
structural alignment across SPX/SPY/QQQ -> cleaner delivery; divergence -> chop.
RAN: foundational test on 64-day archive (4,864 matched 5-min timestamps).
Structural bias per index = sign(gamma center-of-mass - spot) in +-1.5%;
alignment count vs forward-30m SPY efficiency ratio (delivery cleanliness).
VERDICT: **rejected.** ER by alignment 1/3=0.338, 2/3=0.367, 3/3=0.363 (NOT
monotone), 3-vs-1 gap +0.025 placebo 91st (<95), and FLIPS across day-splits
(odd 3/3<1/3, even 3/3>1/3 = unstable). Directional: floor-heavy 53% up vs
ceiling-heavy 51% = coin flip. Caveat: gamma-COM operationalization; richer
floor/ceiling/King alignment could differ.

SYNTHESIS -> FOUNDATIONAL_FINDINGS F4: **GEX/VEX structure predicts
VOLATILITY (pin vs release), not DIRECTION.** s6 dual-wall trap -> compression
(confirmed, placebo 100th) is the one robust forecast; s4/s5 sign, s4-H2
mean-reversion, s10 Trinity direction all null. Direction comes from the
tape/chart (Academy "Charts First"). Explains why the bull tape gate (a
tape rule) is the only shipped entry edge and structural exits (pin=vol
compression) work while structural DIRECTION conditioners all reject.

---

## 2026-07-09 session 9 (continuous): air-pocket+fuel entry (Ch 8) — REJECTED + thread PARKED

RAN: built air-pocket-ahead (empty forward band) + barney-fuel-growth (rising
negative gamma in fire direction over 30m) from archive; tested vs real dollars.
VERDICT: **rejected.** air-pocket gap -1.4pp (placebo 13th), fuel gap -7.2pp
(placebo 49th, non-monotone), combined both-high -2.5% vs -3.2% rest. Within
flags_eq_0 both-high +38.2% vs +28.0% (n=9 — far below floor, not evidence).

META — ENTRY-CONDITIONING THREAD PARKED (charter: multiple dry sessions).
The tally on conditioning the 537-fire set with new GEX/VEX features:
- scalar: all reject (s3 VIX×GEX, sign-persistence; 77-study curvature/etc)
- structural/temporal doctrine ideas: node-growth REJECTED (s8), air-pocket+
  fuel REJECTED (s9); fresh-vs-delivered research_more only inside flags_eq_0
  (s7, n<30). The runner's 46-feature sweep: 0 promising, 17 watchlist (all
  fail ticker-neutrality or n).
CONCLUSION: the bull tape gate + nflags + net_gex_local LEVEL + structural
EXITS already capture the tradeable GEX/VEX signal on this fire set. Entry-
side conditioning is MINED OUT. This is a finding, not a failure — it says
the live system is close to the in-sample frontier for 0DTE index entries.
Remaining edge lives in: (a) forward-data graduation of the watchlist
(fresh-vs-delivered, open_field, SPXW dn_vex_mass), (b) the DIFFERENT-universe
campaign system, (c) foundational physics (topology, confirmed s6). NOT in
more re-slices of these 537 fires.

DECISIONS NEEDED: none. Next real study = campaign cohort backtest, unblocks
when the universe backfill finishes (~17:55 ET); nightly session picks it up.

---

## 2026-07-09 session 8 (continuous): node growth = intent (Ch 9) — REJECTED

RAN: built target-node |gamma| growth over prior 30m from archive (coverage
407/537), tested vs real dollars.
VERDICT: **rejected.** Non-monotone (decay +6.4% / flat -14.6% / grow +1.5%),
gap -4.8pp, placebo 34th (noise), fails ticker-neutrality (QQQ -9.9pp), and
INVERTS within flags_eq_0 (decay +43.8% vs grow +4.5%, n=46). Doctrine's
"growth=intent" does not hold for 0DTE index target-nodes — a DECAYED target
did better, consistent with s7 (decay = price already delivered from it).
The Ch 9 lifecycle intuition holds for the STOCK/campaign timeframe it was
written for, not 0DTE index mechanics. Backlog #1 closed.

---

## 2026-07-09 session 6 + enrichment (topology + doctrine study)

RAN: research/sessions/s6 (map topology on raw archive) + deep read of
docs/skylit-academy.md (10 chapters).

VERDICT s6: **CONFIRMED — topology predicts pinning where the scalar
failed.** Spot trapped between two strong opposing walls (min of nearest
above/below wall shares, top tercile) → forward 30m |move| 7.9 vs 9.9 bps
low-trap, placebo 100th, holds every ticker (SPY 8.0→6.8, QQQ 13.6→10.4,
SPXW 9.1→6.9). Directional repulsion (drift away from stronger wall) NULL
(+0.3/+1.4bps) — walls compress vol symmetrically, don't push price. →
FOUNDATIONAL_FINDINGS.md F3.

ENRICHMENT (user request — "enrich yourself with knowledge about GEX/VEX,
not just studies"): read the full Skylit Academy. Key synthesis in
research/gexvex-structure/KNOWLEDGE_BASE.md. Load-bearing realization: the
doctrine NEVER uses GEX sign alone (Ch 2 "size over color" is Mistake #1;
Ch 4 "regime ≠ direction") — so my s4/s5 scalar-sign null CONFIRMS doctrine
rather than contradicting it, and s6 topology = the Academy's Type-1 range
day in realized-move data. The edge is the MAP (magnitude/topology/growth),
not the scalar. Mapped 7 verified findings to doctrine anchors; extracted 5
doctrine concepts the repo has NEVER tested.

BACKLOG: 3 new doctrine-grounded items jumped to the top (fresh-vs-delivered
node targeting #1, node-growth #2, air-pocket+fuel-on-entry #3) — all
structural/temporal (the class that survives s6), not scalar re-slices.
Node-lifecycle (Ch 9) flagged as highest-value untested doctrine idea.

DECISIONS NEEDED: none. Enrichment produced KNOWLEDGE_BASE.md + new grounded
research directions; nothing shipped.

### s7 (same session): fresh vs delivered node targeting (backlog #1) — research_more

RAN: inline — tagged each fire's target node (forward wall) fresh vs
delivered (spot tapped within 8bps earlier same day), real dollars.

VERDICT: **research_more — directionally right, weak alone, promising in
the clean-signal subset.** Fresh −2.7% vs delivered −5.0% overall (gap
+2.3pp, placebo only 64th — misses the ≥95th bar). BUT the direction is
robust to the tap threshold (5/8/12bps all show fresh > delivered by
~2pp), and the doctrine's real claim lands in the clean subset: **within
flags_eq_0, fresh +49.6% (n=33) vs delivered +21.0% (n=27) = +28.6pp
incremental.** n below graduation floor (27<30). So: the Ch 9 lifecycle
signal is real and doctrine-consistent but needs the flags_eq_0
conditioning + forward n to graduate. → forward watchlist alongside
open_field and SPXW dn_vex_mass. Does NOT ship.

NOTE: this is the first doctrine-derived hypothesis to show incremental
promise over gate+nflags — validates the enrichment→research loop. The
scalar conditioners all died; the structural/temporal one (fresh vs
delivered) survives directionally, exactly as F3/s6 predicted.

---

## 2026-07-09 session 4 (continuous — foundational GEX/VEX physics)

PRE-REGISTERED: does GEX regime predict FORWARD INDEX behavior on the raw
64-day surface archive, independent of fires/options? Two classic
hypotheses, tested on every 5-min frame for SPY/QQQ/SPXW:
- H1 (pin/trend): net local GEX < 0 → LARGER forward 30-min realized
  move; net GEX > 0 → SMALLER (pinning). Metric: median |fwd 30m move bps|
  by GEX tercile. Bar: monotone across terciles AND holds per-ticker AND
  holds on odd/even calendar days.
- H2 (mean-reversion): net GEX > 0 → forward move mean-REVERTS toward the
  dominant node (spot pulled to wall); net GEX < 0 → continuation. Metric:
  sign-correlation of forward move with (wall − spot) by regime.
- Placebo: shuffle GEX values across timestamps within ticker; real
  monotonicity must beat 95th pctl. This is science (no P&L), so no
  incremental-over-gate bar — it either holds physically or it doesn't.

RAN: research/sessions/s4_2026-07-09.py — 14,400 frames (64 days × 3
tickers), forward 30-min horizon.

VERDICTS — **both textbook hypotheses REJECTED. This is a load-bearing
finding, not a dead end:**
- H1 (negGEX→bigger moves / posGEX→pin): NOT monotone on any cut. Forward
  |move| by net-local-GEX tercile: neg 8.3 / mid 10.4 / pos 8.8 bps — the
  MIDDLE tercile moves most, not the negative one. neg-minus-pos gap
  −0.6bps, placebo 7th pctl (i.e. real "effect" is smaller than 93% of
  random shuffles — no signal, if anything faintly inverted). Fails
  per-ticker and odd/even.
- H2 (posGEX→mean-revert-to-wall): P(forward move toward dominant node) =
  posGEX 48.4% vs negGEX 44.6% vs baseline 47.5% — a coin flip; posGEX is
  barely above chance and negGEX is below it. And by raw sign, posGEX
  forward |move| 9.7bps > negGEX 8.2bps — the OPPOSITE of textbook, weakly.

INTERPRETATION (recorded as a system-level fact): on Skylit 0DTE surfaces
over these 64 days, raw net-GEX SIGN does not forecast forward index
realized-move magnitude or mean-reversion. **The system's edge therefore
does NOT come from "GEX predicts the tape" in the naive volatility-regime
sense.** It comes from (a) the specific pattern detectors identifying
structural inflection nodes, (b) the tape gate (prior-close directional
context), and (c) node-structure EXITS — i.e. GEX/VEX as a MAP of where
dealer hedging concentrates, not as a scalar volatility forecast. This
explains why five straight scalar-GEX conditioners rejected (s3 meta): the
scalar isn't where the information is.

CAVEAT / one follow-up queued (not chased now): measured net GEX in a ±1%
band on 0DTE surfaces (gamma is huge/concentrated near expiry). The
natural robustness check is a FLIP-REFERENCED measure (spot distance from
the zero-gamma level) + total signed GEX + 15-min horizon. Queued as s5;
does not change today's verdict for the local measure.

s5 (ran same session): the null is ROBUST to measurement. Total signed GEX
(all strikes): not monotone at 15m (gap −0.6, placebo 10th) or 30m (gap
−1.5, placebo 0th). Flip-referenced: spot BELOW flip forward |move|
6.3/9.1 vs ABOVE 6.4/9.2bps (15/30m) — identical, no negative-gamma
volatility premium. 29,376 samples. **Confirmed foundational null across
band, aggregation, horizon, and flip-reference.** Written to
research/gexvex-structure/FOUNDATIONAL_FINDINGS.md; memory saved.

---

## 2026-07-09 session 2 (user-initiated: 0DTE SPY/SPX/QQQ exit research)

PRE-REGISTERED (before compute):
- Item: live trend trigger for exit patience (backlog #1). At the moment
  the system takes its actual exit (exitTsMs), decide hold-to-15:55 instead
  IF a trigger computable from data available at that moment fires.
- PRIMARY trigger (fixed before compute): tape has moved ≥40bps from
  session open IN THE PLAY'S DIRECTION, AND session efficiency ratio
  ER = |spot−open| / Σ|5-min moves| ≥ 0.40, both measured at exit time
  from the fired ticker's spot stream.
- SECONDARY variants (sensitivity, not cherry-pick): move ∈ {30,50}bps ×
  ER ∈ {0.30,0.50}; plus ablations (move-only, ER-only, cross-ticker
  agreement at exit).
- Metric: capital-weighted EV delta (hold minus actual) on triggered fires;
  system-level lift when policy applied to all fires.
- Bar: triggered-subset delta > +15pp; all four stability cuts (odd/even,
  H1/H2) positive; placebo = real delta beats ≥95% of random same-size
  fire subsets; threshold sensitivity same-sign across the variant grid.
- Guards: fires whose actual exit is already ≥15:25 ET contribute ~0 by
  construction (report their share); result CANNOT ship — exit-side change
  requires explicit user approval via DECISIONS NEEDED.

RAN: research/sessions/s2_2026-07-09.py + one pre-authorized follow-up
(tail anatomy). Coverage 537/537 fires; 11% of exits already ≥15:25 ET.

VERDICTS:
- **Live trend trigger: research_more — real effect, crude instrument.**
  PRIMARY (aligned move ≥40bps AND ER ≥0.40 at exit time, fully
  live-computable): n=91, triggered delta +38.8pp (bar: >+15 ✓), placebo
  96th pctl (✓), ALL 9 sensitivity-grid cells positive +14.8..+44.2 with
  complement −1.8pp (✓ clean separation), system −3.5% → +4.3%.
  FAILED: odd-days cut −14.1pp (bar requires all four cuts positive).
  Follow-up anatomy: median play +30.1pp, 55% improve (not purely tail),
  top-3 winners = 45% of gross gains, BUT 25% of holds give back >50pp;
  odd-cut failure = three SPXW bear give-backs (2026-05-12 ×2, 06-23).
  Naked hold-to-15:55 is the wrong policy shape: it wins on runners and
  bleeds on reversals with no protection.
- Observation (not sliced further per charter): QQQ triggered subset was
  +89pp with all four cuts +86..+95 — noted for the refined study, not a
  conclusion.

BACKLOG: #1 refined → **trigger-conditioned TRAIL-PRESERVING hold**:
on trigger, suppress structural/pin exits but KEEP the trail stop armed
(and test wider trail givebacks 15/25/35%), repriced on UW 1-min candles.
Pre-registered bar: same as s2 (delta >+15pp, all four cuts, placebo ≥95,
grid same-sign) — the trail should cut the >50pp give-back tail that broke
the odd cut. This is the last refinement before the thread parks (rule:
two dry sessions parks it; s2 was not dry, but the shape must prove itself
next pass).

DECISIONS NEEDED: none — nothing ships from this. If the trail-preserving
version passes the full bar, THAT becomes the exit-side ship proposal.

### s2 item 2 (same session): trail-preserving hold — REJECTED, thread PARKED

RAN: research/sessions/s2b_2026-07-09.py — on trigger, suppress exit but
trail from hold-start mark at {15,25,35}% giveback, simulated on 1-min
candles for all 91 triggered fires (90 had post-exit trades).

VERDICT: **rejected.** Deltas +4.7/+2.1/+1.5pp (bar: >+15), placebo 59th
(noise), delta-without-top3 ≤ 0 at every giveback, median play ≈ 0 or
negative. The trail cuts the >50pp give-backs to 1-4% as designed — but
0DTE marks whip so hard that the same trail stops out the runners before
the trend leg pays. The naked-hold +38.8pp is real but inseparable from
enduring the give-back tail; with a 1-contract book and no partial-exit
capability, it is not harvestable. Third confirmation of the pattern
(wall-escalator v3, hold-extension, now this): post-hoc protective exit
logic eats the premium it protects. The current structural exits remain
the best validated instrument for this book.

THREAD PARKED (pre-declared: last refinement before park). Re-open only
with NEW capability (multi-contract partial holds — a sizing change,
execution-policy territory) or new forward data contradicting this.

---

## 2026-07-09 session 1 (first autonomous session)

PRE-REGISTERED:
- R1 ingest: summarize today's live observation logs (count, executed vs
  blocked, flags distribution); note archive/backfill state. No bar — ingest.
- Item 1 (trend-day exit patience): thesis = holding fired contracts to
  15:55 beats the system's actual exits ON TREND DAYS ONLY, in real option
  dollars. Metric: EV delta (hold-to-1555 minus actual) on trend vs
  non-trend days, priced from UW 1-min candles. Bar: trend-day delta > +5pp
  with odd/even + H1/H2 holds AND non-trend delta ≤ 0 (the conditioning must
  matter). Caveat pre-registered: `trend_day` flag is hindsight → a positive
  result is an UPPER BOUND and only queues a live-trigger follow-up; it
  cannot ship anything.
- Item 2 (red-streak bull overlap): thesis = the bulls-in-red-streak bleed
  (−11.4%) is already absorbed by the bull tape gate. Metric: EV of
  red-streak bulls the gate does NOT block. Bar: residual cell worse than
  −8% with n≥30 and odd/even holds → queue follow-up; otherwise declare
  absorbed and close the thread.

RAN: research/sessions/s1_2026-07-09.py (all three items).

VERDICTS:
- R1: 10 live fires today (5 executed / 5 gate-blocked), red-flag dist
  {1:3, 2:4, 3:3}, ZERO flags_eq_0 candidates today (forward count: still
  ~1 session of data). Archive at 64 days through 2026-07-08.
- Item 1 (trend-day exit patience): **research_more — strongest exit
  signal yet found, as an upper bound.** Hold-to-15:55 vs actual exits:
  TREND days +49.7pp delta (n=263; odd +37.9 / even +59.5 / H1 +61.1 /
  H2 +44.0 — all four cuts hold; trend×up +70.5, trend×down +42.5). And
  the conditioning matters enormously: non-trend days −33.8pp (holding is
  catastrophic there). Passed the pre-registered bar (+5pp) by 10×. Per
  pre-registration this is HINDSIGHT-conditioned (trend_day flag) → upper
  bound only, ships nothing. Queued follow-up at #1: find a LIVE-detectable
  trend trigger (regime strips at fire time / by-13:00 tape state) and
  re-run the A/B on trigger-conditioned holds.
- Item 2 (red-streak bull overlap): **confirmed absorbed — thread closed.**
  Red-streak bulls n=63 @ −11.4%; the bull tape gate blocks 46 of them
  (−13.7%); residual 17 @ −5.7% with odd/even flipping sign (−13.7/+3.3),
  n<30. Fails the follow-up bar exactly as hoped. No new rule needed.

BACKLOG: new #1 = live trend trigger for exit patience (pre-registered:
trigger must be computable at exit-decision time from regime strips/tape;
bar = trigger-conditioned hold delta > +15pp with all four stability cuts,
plus placebo vs random same-size day subsets). Red-streak item removed
(closed). Campaign cohort backtest unblocks tonight after the 16:15 backfill.

DECISIONS NEEDED: none yet — trend-day exit patience stays research until
the live-trigger version passes; if it does, THAT becomes a ship proposal
(exit-side change, needs explicit approval).

---

## 2026-07-09 session 0 (charter bootstrap — summary of the day's supervised work)

RAN (supervised, pre-charter): down-day verification; cross-ticker/MTF
confluence study; 77-study GEX/VEX structure program; bull tape gate
shipped (user-approved, commit 87a57d3, activates next tracker restart).

STANDING VERDICTS INHERITED: see research/gexvex-structure/
GEXVEX_STRUCTURE_REPORT.md for the full 77-study map. Live-relevant:
bull tape gate = only approved entry rule; dn_vex_mass (SPXW-only),
open_field-on-flags0 = forward watchlist; all other entry rules rejected
or absorbed.

DECISIONS NEEDED: none — tomorrow's plan already agreed (dry-mode gate +
observation logging at 9:25 ET restart).
