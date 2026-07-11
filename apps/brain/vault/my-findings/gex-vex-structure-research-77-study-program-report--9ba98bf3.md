---
title: GEX/VEX Structure Research — 77-Study Program Report
source_url: repo://apps/gex/research/gexvex-structure/GEXVEX_STRUCTURE_REPORT.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:40:39Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- vex
- structure
- spxw
summary: '**Date:** 2026-07-09 · **Dataset:** 537 final-system fires (of 1,322 total), 64-day Skylit archive (SPXW/SPY/QQQ, 5-min frames, per-strike gamma+vanna), real UW option dollars (`pnl_atfire`). All EV figures are option-dollar returns on premium. Stability bar: tercile direction must hold on odd/even…'
url_sha1: 9ba98bf3a67463d98d81416e8ebe091a35367af9
simhash: '1905063384588759571'
status: vault
ingested_by: seed
---

# GEX/VEX Structure Research — 77-Study Program Report

**Date:** 2026-07-09 · **Dataset:** 537 final-system fires (of 1,322 total),
64-day Skylit archive (SPXW/SPY/QQQ, 5-min frames, per-strike gamma+vanna),
real UW option dollars (`pnl_atfire`). All EV figures are option-dollar
returns on premium. Stability bar: tercile direction must hold on odd/even
days AND both halves; placebo bar: beat ≥95% of shuffled controls.

**Pipeline:** `build_features.py` (70 features/fire) → `scan_edges.py` →
`deep_dive.py` → `placebos.py` → `events_conflicts.py` → `verify_rules.py`.
Data: `outputs/fires_structure.parquet`.

---

## Headline verdicts

### 1. The bull tape gate eats most "new" structure rules (study 77 in action)
Three candidate rules emerged independently with 4/4 stability holds:
- block bulls below gamma flip (blocked set −14.8%, placebo 99th pctl)
- block fires against the opening-range break (−19.6%, 93rd pctl)
- block OR-breakouts into dense GEX (−12.2%, 90th pctl)

**With correct alignment they are shadows of the bull tape gate** (bulls
fired while SPY+QQQ+SPX all below prior close): the OR rule is 94% inside
the gate (2 fires of residual value); the flip rule's non-overlapping 108
fires are **+3.4%** (it would block winners). Full pack +0.6% vs gate alone
+0.8% → **incremental −0.2pp. Rejected as additions.** The tape gate alone
remains the one shippable entry rule (system −3.5% → +0.8%; flags_eq_0
+35.4% → +48.2%; separately verified, pending approval).

### 2. One genuinely new factor survives everything: VEX/GEX mass asymmetry
`vex_asym` / `dn_vex_mass` / `gex_asym` / `wall_dn_thick` are one factor
(|r| 0.62–0.98): **heavy GEX/VEX mass below spot is poison; mass above spot
is fuel — for ALL fires, both directions** (it is an absolute market-state
read, not trade-relative geometry: direction-aligned variant scored only
72nd placebo pctl).
- `dn_vex_mass` hi tercile −17.9% vs lo +5.7%; placebo **100th pctl** on all
  three shuffle types; threshold-stable
- works within bulls (−6.3→+1.8) and bears (−18.6→**+21.7**)
- works within nflags≥1 (−18.4→+1.1) and **within tape-gated fires
  (−11.1→+15.4)** — genuinely incremental
- **CAVEAT (ticker neutrality FAIL):** per-ticker terciles show the effect
  concentrates in SPXW (hi −20.2%) and *reverses* on SPY (+6.5) / QQQ (+9.9).
  Mechanistically plausible (SPX complex = the real dealer book) but by our
  9-check standard: **status `research_more` — added to forward-validation
  watch, NOT shipped.**

### 3. Structure explains "right direction, no pay" — diagnostically
`rv_expansion` (realized vol after fire ÷ before): lowest tercile −21.1%.
Confirms study 27's thesis, but it is post-fire information → useful for
exit logic research, not entry.

---

## Study-by-study verdicts

**1 (shape/concentration):** Partial. top1/top3/HHI/shelf-width: no stable
signal. `density_100bps` hi = bad for bulls (−20.3%) and for OR-breakouts
(see 45). `wall_dn_thick` real via the asymmetry factor.
**2 (gradient/cliff):** grad_up/dn, slope_asym, cliff_dist: no stable edge.
**3 (dealer acceleration zone):** `accel_zone_gex` U-shaped/incoherent. Reject.
**4 (GEX asymmetry):** **CONFIRMED** (the factor above, with SPXW caveat).
**5 (VEX asymmetry):** **CONFIRMED** — strongest version of the factor.
**6 (curvature):** gex_curv bears-only (+11.4 hi), bulls flat; vex_curv weak.
Not robust standalone. Reject.
**7 (pin-risk score):** works for bulls (mono +2.6→−9.4), reverses for bears.
Components (density, wall range) carry it. Weak; superseded by 45.
**8 (open-field score):** system-level placebo 20th pctl = **noise**. BUT see 31.
**9 (absorption vs rejection):** answered by wall-escalator study: 57%
reject / 33% chop / 10% roll; rolls +41.7bps vs rejects −16.6.
**10 (pre-wall deceleration):** NOT RUN (needs event-level tape features);
queued behind forward data.
**11 (wall-break confirmation entry):** wall-escalator v2/v3: all detection/
re-entry/hold-extension variants REJECTED (info arrives after the money).
**12 (flip reclaim/reject):** bulls: real (above flip +7.1% vs below −14.8%)
but **subsumed by tape gate** (residual +3.4%). Bears: thesis INVERTED
(bears above flip +1.1% vs below −10.3%). No rule ships.
**13 (compression→expansion):** all four cells ≈ flat. Reject.
**14 (structure reset after displacement):** REJECTED — structure works
*better* on big-open days (vex_asym gap +24.0pp vs +17.1pp normal).
**15 (stale structure):** not testable — archive frames all ≤5min fresh (no
staleness variance). Live logger records real staleness; revisit forward.
**16 (update shock):** `rev_gex_pct` hi = bad (−14.6%) but only ~82-84th
placebo pctl. research_more.
**17 (wall migration):** m30 migration features: no stable signal at fire
level; wall-escalator already showed migration prediction fails. Reject.
**18 (flip migration):** no signal (flip_mig_bps weak coverage/no edge).
**19 (room consumed):** thesis INVERTED for bulls — room_consumed hi tercile
+7.7% vs lo −12.3% (late entries are momentum). Filtering "late" entries
would *hurt*, incl. flags_eq_0 (+35.4→+6.9%).
**20 (implied move consumed):** move_vs_implied: no stable signal (holds 2/4).
**21 (wall+VWAP):** TWAP proxy (no volume data). `spot_vs_twap` mono 4/4 but
~86-92nd placebo pctl and correlated with tape factor. wall-near-TWAP: no signal.
**22 (wall + PDH/PDL/OR levels):** no signal (inside wall_confluence).
**23 (wall confluence score):** no signal (0/1/2 flat; ≥3 never occurred).
**24 (polarity flip):** NOT RUN (event-level); queued.
**25 (opening range):** with-break +3.9%, inside-OR −4.0%, against-break
−19.6% — real but **subsumed by tape gate** (94% overlap).
**26 (GEX×trend day):** CONFIRMED as regime map: negGEX×trend +14.0%,
negGEX×chop −23.4%, posGEX×trend +0.7%, posGEX×chop −9.0%. **GEX sign only
matters conditional on trend** — but trend_day is hindsight → exit/hold
research input, not entry rule.
**27 (RV expansion):** CONFIRMED diagnostically (see headline 3).
**28 (candle bodies):** not testable — 5-min spot samples, no OHLC/wicks.
**29 (liquidity vacuum):** proxies (wall_range, density) no standalone edge.
**30 (speed-bump vs brick-wall classifier):** subsumed by wall-escalator
rejections + study 9 base rates. No tradeable classifier found.

**31-40 (flags_eq_0 upgrades, n=60 — directional evidence only):**
- **31 open_field:** +54.4% vs +35.4% base, win 66%, odd/even consistent,
  interaction placebo 94th pctl. Best upgrade candidate. `research_more`,
  needs forward data (n too small to graduate).
- **32 wall confluence:** ≤1 confluence +37.0% — no meaningful lift.
- **33 room consumed:** would HURT (+6.9%). Rejected.
- **34 VEX accel:** not measurable at fire (no intra-frame VEX velocity);
  forward logger candidate.
- **35 GEX gradient:** no signal. **36 wall migration:** n=14, +31.0% — no lift.
- **37 flip reclaim:** subsumed by tape gate. **38 stale:** not testable (see 15).
- **39 time-to-peak prediction:** posGEX t_peak 14m vs negGEX 10m — weak;
  no scalp/runner separation found.
- **40 tail dependency:** vex_asym filter RAISES top-3 dependency 55%→93%
  (wrong direction). open_field is the only candidate that lifts EV without
  obvious tail concentration; verify forward.

**41-50 (conflict studies):**
- **41** pin vs VIX-expand: no signal. **42** negGEX needs VIX expansion:
  directionally yes (+1.6 vs −8.5). **43** CONFIRMED: VEX-good + flow-extreme
  −4.2% vs +2.3% (exhaustion veto already a red flag — validated).
- **44** flow vs thick wall: weak (+2.4 vs +3.4). **45** CONFIRMED, big:
  OR-breakout into dense GEX −12.2% vs open space **+19.8%** (32pp) — the
  best expression of density; candidate for future re-fire quality scoring.
- **46** CONFIRMED: good structure + rich premium −6.2% vs fair +11.0% —
  premium efficiency dominates structure. **47** REJECTED (opposite): 4/4
  signals agreeing = +22.1%, monotone — confluence is never "too late."
- **48** covered by 47 (lateness rejected). **49** = study 45 mechanics.
  **50** false compression: study 13 found nothing either way.

**51-60 (option-dollar):**
- **51/53** structure does not sort MFE-before-MAE meaningfully (flat medians).
- **52 (never-worked losers):** REJECTED — never-worked rate flat ~12-17%
  across every structure tercile. Structure does not predict the dead-on-
  arrival losers.
- **54 (theta drag):** consistent: posGEX = slower peak (14 vs 10m), worse EV
  (−5.0 vs −0.5%) despite higher MFE — chop drag is real.
- **55 (premium expansion):** not testable (no per-minute premium-vs-spot
  attribution). **56 (spread widening):** not testable (no spread series).
- **57 (structure-based ticker choice):** the asymmetry factor is
  SPXW-specific (see headline 2) — if it validates forward, it becomes an
  SPXW-only fire filter, not a ticker router.
- **58 (next-expiry defense):** CONFIRMED regime-conditional: in posGEX/pin
  regime next-expiry +0.3% vs 0DTE −4.5%; in negGEX no penalty (−1.0 vs
  −1.9). Refines the earlier "next-expiry most defensive" finding.
- **59 (OTM permission):** not testable (ATM-only repricing dataset).
- **60 (spreads):** not testable (no spread pricing).

**61-70 (live forward logging):** ~1 day of observation data — all queued.
The logger already records the needed fields; `summarize_live_observations.py`
+ `merge_forward_logs.py` are the entry points. Revisit with the flags_eq_0
re-rank in ~2 weeks. Study 66's separation (unknown-flag vs clean-zero) is
already implemented in the logger.

**71-77 (meta/placebos):** ALL RUN — results embedded above: threshold
sensitivity (71: survivors stable at 30/70 and 40/60), random-threshold/
permutation (72), date-shuffle (73), direction-shuffle (74: killed the
direction-relative reading of asymmetry), within-day/ticker-shuffle (75:
passed aggregate but per-ticker decomposition caught SPXW concentration —
the finer test mattered), time-bucket effects (76: hour-of-day checked in
rule verification), incremental-over-flags (77: **the decisive tool** — it
killed R1/R2 and validated vex_asym).

---

## What changes (pending approval) and what watches

**Ship-ready (awaiting user approval, unchanged from before this program):**
bull tape gate — block bulls when SPY+QQQ+SPX all below prior close.
This program *strengthened* its case: every "new" entry rule found here
collapsed into it.

**Forward-validation watchlist (add to observation logger):**
1. `dn_vex_mass`/`vex_asym` at fire (SPXW especially) — graduate if the
   SPXW concentration + direction hold on forward data
2. `open_field` on flags_eq_0 fires (study 31)
3. density-ahead on re-fires after OR breaks (study 45)

**Exit-research inputs (not entry):** rv_expansion (27), GEX×trend regime
(26), posGEX theta drag (54), regime-conditional next-expiry (58).

**Dead:** compression/expansion (13), structure reset (14), staleness at
5-min cadence (15), migration prediction (17/18), room-consumed-as-lateness
(19/33), confluence scores (22/23), lateness thesis (47), never-worked
prediction (52), open_field as system-wide filter (8).
