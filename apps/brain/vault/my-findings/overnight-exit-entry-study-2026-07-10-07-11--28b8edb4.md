---
title: Overnight Exit + Entry Study — 2026-07-10 → 07-11
source_url: repo://apps/gex/research/exit-study/OVERNIGHT_STUDY.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T19:14:57Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- exits
summary: '**Status:** IN PROGRESS (autonomous research, no live-code changes). All findings below are research artifacts; any change to the live tracker waits in **DECISIONS NEEDED** for explicit'
url_sha1: 28b8edb4f33d08b9397e51b7f4aada911f85a626
simhash: '18188176389195528327'
status: vault
ingested_by: seed
---

# Overnight Exit + Entry Study — 2026-07-10 → 07-11

**Status:** IN PROGRESS (autonomous research, no live-code changes). All findings
below are research artifacts; any change to the live tracker waits in
**DECISIONS NEEDED** for explicit approval.

## TL;DR (after full robustness — BOTH systems)

**The single biggest finding: the 0DTE bull-reverse signal AND the stock-swing
flow×node system are the same trade — long calls that print in bull tape and die
in chop. Their edge is substantially BETA, not regime-independent alpha.**
- 0DTE: every apparent edge dissolved — exits invert train→test; the "+6%
  filter+scalp" is a mid-price illusion (~+1% OOS after ~2–3% costs,
  tail-dependent, threshold-sensitive, 2-condition-conjunction = overfit); the
  surface "escalator" is **circular** (spot-rise-only is just as good); the +65%
  trend-day hold is real but **unpredictable ex-ante**.
- Stock-swing flow×node: more robust *structurally* (70% win NOT tail-dependent,
  coherent arm structure, node-alone is a trap) BUT the same regime collapse —
  **BULL-forward 81% win/+57%, CHOP-forward 51%/−0%.** The 70% headline is a
  bull-blend.
- **Macro-regime gate** (trade only when the multi-week tape is bullish) is the
  right lever and shows promise (gate-off cohorts −38%), but the data has only
  ~one bull→chop cycle, so it's under-powered — **validate forward, don't deploy
  on backtest.**
- Data caveats: the 0DTE dataset is a 32%-faithful proxy of live fires (5-min vs
  1-min); costs (~2–3%) dominate 0DTE scalps.

**Real, actionable takeaways:** (1) fix the EOD summary — it reports *peak* not
*realized*, overstating by ~45 pts; (2) gate BOTH systems on macro regime and
collect forward data to validate; (3) the night's true value: rigor that stopped
us shipping ~7 overfit/beta "edges" as if they were alpha.

## Why this study

The live 0DTE index tracker (SPXW/SPY/QQQ) shows a specific failure signature:
- **Entries catch moves** — `BULL_REVERSE` MFE median +34% (SPY +70%, QQQ +65%),
  40–58% of fires reach a +25% peak.
- **But realized P&L is negative** — the structure-invalidation exit + 0DTE theta
  give it all back. MAE −74%; the peak comes *late* (~52 min median), so early
  exits gut winners and losers decay to zero.
- First exit-tweak backtest (16 clean live fires) showed simple trailing didn't
  help — whipsaw ate it. Needed a bigger, cleaner dataset to test properly.

## Dataset (the foundation)

- **1,339 engine fires** replayed over the Skylit archive (Apr 10 → Jul 8, 64
  days) + 16 clean live fires (Jul 9–10). De-duped to one contract per event.
- **Real option-mark paths** pulled per fire from UW `/option-contract/{occ}/intraday`
  (1-min, retention confirmed back 92 days).
- **Underlying 1-min bars** per (day,ticker) from UW `/stock/{t}/ohlc/1m` for
  EMA/VWAP/ATR/RSI signals. SPXW technicals proxied to SPY (~0.99 intraday corr).
- Fidelity guardrail: **all exits trigger off candle CLOSE — no intra-bar
  look-ahead.** This measures *recoverable* edge, not hindsight.
- Robustness: first-half vs last-half day **train/test split** to avoid
  overfitting one regime.

## Exit strategies tested (Phase 1)

- Hold-to-EOD (floor), fixed target+stop (+50/−40, +100/−50)
- Trailing % (arm/giveback grid)
- Time stops (15 / 30 / 45 min)
- **Underlying technicals (the core ask):** EMA9 cross, EMA9<EMA21 cross, VWAP
  loss, ATR chandelier trail (1.5×, 2.5×)
- **Hybrids:** technical signal + profit-lock floor

## Phases

1. **Exit strategies** — leaderboard by expectancy/win%, per-state, train/test. ← running
2. **Instrument** — 0DTE vs 1–3 DTE repricing (does less theta rescue the catch?).
3. **Entry improvement** (user-requested) — segment fires by time-of-day, tape,
   VIX, flow, GEX-King distance, wall topology; find the profitable subset and
   test new entry filters/confluence.
4. **Combine** — best entry filter × best exit → net expectancy vs live baseline.

## FINDINGS

### Phase 1 — Exits are NOT the lever (rigorous negative result)

Backtested 16 exit rules on 1,295 fires with real option marks, close-basis, with
a first-half/second-half **train/test split**. The split is decisive:

| Strategy | TRAIN (Apr 10–May 26) | TEST (May 27–Jul 8) |
|---|---|---|
| hold_eod | **+33%** | **−14%** (worst) |
| vwap_cross | +23% | −9% |
| trail_a20_gb25 | +15% | −7% |
| time_30m | +13% | −5% |
| best-in-test | — | vwap_or_target100 **+1%** (≈ zero) |

**Rankings fully invert train→test. No exit rule holds up out-of-sample.** The
#1 train performer (hold_eod, +33%) is the worst in test (−14%). The first-half
"edge" was **regime luck** — an April–May bull tape where 0DTE calls print fat
tails — and it reverses in the June–July chop/rotation.

Also note the *distribution*: even in-sample, `hold_eod` BULL_REVERSE is mean
+12% / **median −44%** — a lottery: most trades expire near-worthless, a few
monsters carry the mean. Exit rules that cut losers (vwap/time/trail) also clip
the monsters, so they trade variance for a lower mean. There is no free lunch on
the exit side.

**Conclusion:** the −23% realized isn't an exit-tuning problem. `BULL_REVERSE`
catches *volatility*, not *direction* (F4 confirmed live), so its P&L is
**regime-contingent**. The lever is **WHEN we fire (regime/entry filtering)**,
not how we exit. → Phase 3.

### Phase 3 — Entry/regime filtering IS the lever (survives train/test)

Segmented 492 BULL_REVERSE fires by regime, label = realized under a fixed
time_30m exit, evaluated **separately on train and test halves**. Only buckets
positive in BOTH halves count (everything else is regime luck).

**Time-of-day** (ET): the robust window is **midday ~11:30–1:30** (train +9% /
test +7% ✅). **Afternoon 1:30–3:00 is consistently negative** (−10% / −18%) —
a real "don't fire" zone. The "close" bucket was +47% train but −17% test (pure
bull-run luck — do NOT trust it).

**Market tape at fire** (SPY vs session open): the robust condition is
**mild-up (+0 to +0.3%)** — train +3% / test +13% ✅. Counter-intuitively,
**strong-up (>+0.3%) does NOT hold** (+25% train → −6% test) — chasing a hot
tape was the overfit; entering on a *quiet* up-tape survives.

**Ticker:** **QQQ most robust** (+22% / +2%); SPY & SPXW flip negative in test.

**Confluence (the two buckets positive in BOTH halves, ✅):**
- mild-up tape × open (0–30m): train +13% / **test +21%**
- mild-up tape × midday: train +17% / **test +22%**

**Actionable entry tilt (robust):** prefer **midday + mild-up tape**, favor
**QQQ**; **hard-avoid the 1:30–3:00 afternoon window** and do **not** chase
strong-up or capitulation-down tape. Caveat: confluence n≈30 (≈15/half) — these
are *suggestive filters*, not proven printing presses; they need more live days
to confirm. MFE is huge in every bucket (+73–170%) — the entry always catches a
move; the edge is purely in *which regime lets it convert*.

### Phase 2 — Instrument: 0DTE wins *intraday*; overnight hold still open

Same BULL_REVERSE signal, same strike/entry, alternate expiries, same-day exits:

| | MFE | exit30 (tr/te) | EOD |
|---|---|---|---|
| 0DTE | +107% | +5% (+13/−5) | +12% |
| 1-DTE | +40% | +1% (+3/−1) | +3% |
| 2-DTE | +28% | +1% (+2/−0) | +3% |

For an **intraday** hold, **0DTE is best** — its gamma catches ~2.5× the MFE of
1-2DTE, and theta doesn't bite in 30 min. Naively rolling to 1-2 DTE for the same
scalp *loses* edge. Regime-dependence persists across every DTE (all negative in
test), reconfirming the lever is regime, not instrument.

**Caveat / still open:** 1-2 DTE's actual advantage is the **overnight/multi-day
hold** (let the directional move play out without 0DTE's terminal decay). That's
a different strategy (swing, not scalp) and is tested next.

### Phase 3c — TREND-DAY HOLD is the biggest edge (user hypothesis, validated)

Segmenting BULL_REVERSE calls by DAY type (SPY close-open):

| Day type | HOLD to close (tr/te) | SCALP 30m (tr/te) |
|---|---|---|
| **trendUP** | **+124% / +65%** ✅ | +29% / +9% |
| chop | −21% / −23% ❌ | +4% / +4% |
| trendDOWN | −27% / −73% ❌ | −7% / −34% |

**On trend-UP days, holding to close is a large, out-of-sample-robust edge
(+65% test) that crushes scalping.** Chop days bleed; trend-DOWN days holding a
call is a −73% catastrophe. This is the strongest robust signal in the study.

**The open problem — realizability.** The naive early proxy (SPY already up
>0.4% at fire) does NOT survive: HOLD +65% train → **−34% test**. So the edge is
real but early trend-up-day *identification* is unsolved. This reframes the
system: its core job is **trend-up-day classification**, which separates +65%
(hold on trend days) from −23% (fire blindly). Next: a realizable classifier
from the GEX surface (pin-hold vs wall-escape — the "wall vs escalator" idea),
tested out-of-sample against this +65% target.

### Phase 3d/3e — Trend-day identification is unsolved with current features

The +65% trend-up-day hold edge (3c) is real but **not predictable ex-ante**:
- **Intraday (3d):** efficiency-ratio, VWAP-hold, ORB, and their combined gate all
  flip negative in test. The "trend-confirmation" gate makes it *worse* (PASS −40%
  vs FAIL −14% test) — in a chop regime, breakouts are traps.
- **Macro (3e):** SPY trailing-5d return at the open also fails/inverts. Buying
  after a rally loses (−9%); the naive trend filter is counterproductive.

**Culminating finding:** across exits, instrument, entry features, intraday trend
signals, and macro filters, **no realizable signal robustly selects the
profitable (trend-up) days.** The system's P&L is dominated by which days happen
to trend up, which is not forecastable from the price/tape/return features
available. The −23% realized is therefore **not** an exit/entry-tuning problem —
it's that the edge is regime-luck that can't be timed with the current feature set.

### Phase 3f/4 — CHOP SCALP + filter: the deployable, realizable edge ⭐

Chop days pay via *fast scalps*, not holds (the pin that kills hold-to-close
makes the scalp work). Best realizable strategy:

**Fire BULL_REVERSE only when SPY ≥ its open at fire (not down-tape) AND not in
the 1:30–3:00 ET window; take profit +50% (25-min time-stop, −50% stop).**

| | avg | train | test | win |
|---|---|---|---|---|
| scalp everything (no filter) | +1% | +4% | −3% | 48% |
| **filter + scalp** | **+6%** | **+8%** | **+4%** ✅ | 52% |
| rejected by filter | −10% | −6% | −14% | 39% |

Robust in **both** halves, realizable, ~5.5 trades/active day. The down-tape
filter (a tighter bull-tape gate) removes the trend-down scalp-killers; it even
beats the hindsight "chop day" label. This forgoes the trend-up hold upside
(scalp +50% vs ride +65%) in exchange for robustness without needing to predict
trend days.

### Phase 2b/4b — Swing (2-DTE) hold: higher return, not robust, filter won't fix

Holding 2-DTE to expiry converts the catch much better than 0DTE (+38% avg, 53%
win vs 0DTE +12%/39%) and is *less* chop-fragile (test −6% vs −14%). But it's
still not positive in test, and the down-tape filter does NOT rescue it (test
−6% → −19%): the intraday entry-tape is irrelevant to a 2-day forward move. So
the two edges don't stack — the swing's regime-dependence is macro/multi-day, not
intraday-filterable. **Deployable edge remains the 0DTE filter+scalp (Phase 4).**
The 2-DTE swing is a higher-return *lead* that needs a macro/multi-day regime
signal (not the intraday tape) to become robust.

### Phase 5/5b — GEX surface DOES carry signal (unlike price): "bank the pop"

Instrumented the replay to emit per-fire King-share + spot-escape trajectory.
Classifying at +15m from the surface: **escalator (pin share falling + spot
escaping the King) → cut at +15m = +19% train / +25% test / 68% win ✅**, robust.
Crucially, for the SAME escalator fires, **cutting beats holding by 34 pts in
test (+25% vs −9%)** — the fast pin-escape pops then FADE. This overturns the
"escalator → hold the trend" hypothesis: the surface signal means **take profit
fast on a confirmed real reversal**, not ride it. (Partly mechanical — spot-rise
is in the definition — but the robust *take-profit-timing* edge is real and
actionable as a management rule.) The surface carries predictive signal where
price/tape did not, and it *reinforces* the scalp thesis rather than the hold one.

## CONCLUSION

0. **The unifying answer: this is a SCALP edge, not a hold edge.** Every robust,
   realizable finding — chop scalp, down-tape filter, surface escalator — says
   *take profit fast on confirmed reversals*. The "hold for the trend day" upside
   is real but unpredictable; stop chasing it.
1. **Exits, instrument, entry-features, and trend-day *prediction* are dead ends**
   — all overfit or regime-flip out-of-sample. Rigorously ruled out (this is the
   value: it stops us shipping overfit changes).
2. **A deployable edge DOES exist** (Phase 4): **down-tape+afternoon filter + a
   +50% take-profit scalp** → +6%/trade, +8%/+4% train/test, robust. vs the
   live −23%. Small per-trade but real, realizable, and survives OOS.
3. **The big prize (trend-up-day hold, +65%) is real but unpredictable** with
   current features — leave it as upside, don't build on it.
4. **One un-mined vein (data gap):** node-level GEX surface dynamics (pin-escape
   vs stay-pinned — the "wall vs escalator" idea). Untestable on the big dataset
   until we instrument the replay to emit per-fire surface features. Best next
   research build.
5. **Reporting bug to fix:** the EOD summary shows PEAK (best_mark), not realized
   (close_mark) — flatters the system by ~45 pts. Fix so we're not flying blind.

### Phase 6 — ROBUSTNESS: costs make the scalp edge thin & fragile

The Phase-4 "+6%/trade" was mid-price. Under scrutiny:
- **Transaction costs:** calibrated from live logs (round-trip QQQ ~2.1%, SPY
  ~2.9%, SPXW ~3.3%, incl. 1.5× exit-widening). Net edge drops to **+3.5%
  full-sample**. (At an 8% strawman it goes negative — breakeven ~6%; the actual
  spreads are tighter, so it survives, but barely.)
- **Walk-forward (5 split points):** train +5–6% consistently, but **test only
  +2.3% → −0.7%**, degrading as the window moves into the June chop. The single
  50% split (test +0.9% net) flattered nothing but wasn't the whole story.
- **Block bootstrap by day (1000×):** mean net p50 **+3.8%**, p5 +0.4% — edge>0
  in **97%** of resamples on the full sample. Statistically positive, but small.
- **Tail-dependence:** drop top-10 winners (of 317) → **−0.2%**. The edge is still
  carried by a few outliers — a real fragility.
- **Per-day:** +19%/day (unit/trade), 62% positive days, **daily Sharpe ~0.20**.

**Verdict:** a *thin, fragile, tail-dependent* positive edge (~+1–2% OOS after
costs), not a printing press. Justifies a *small dry-run to gather forward data*,
not real size. Costs are the dominant reality for 0DTE scalps — every strategy
must be judged net of ~2–3% round-trip.

### Phase 6b — the FILTER is the robust edge (multiple-comparisons check passed)

To rule out cherry-picking a lucky rule×filter combo: does the down-tape+afternoon
filter help *many* exit rules? **Yes — it improves TEST net-of-cost in 6/7 exit
rules** (t+30 +5.5, t+40 +7.4, t+50 +10.0, time15/20/30 +5–6 pts; only hold_eod
unaffected — holds are regime-driven, not scalps). That generality is the strong
signal: **the FILTER is the real, robust effect; the exact scalp exit is
secondary.** Spread stress on t+50 filtered (test-half): calibrated +4.9%, p75
+5.0%, **harsh 2× (~5–6% round-trip) still +2.0%.** Survives conservative costs.

Caveat unchanged from 6: the level degrades in the *deepest* chop (walk-forward
60–70% splits → ~0) and is tail-dependent. So: **robust gate, thin edge.**

### Phase 6c — Threshold sensitivity: the filter edge is fragile / likely overfit

Swept the filter parameters. The tape cutoff is NOT a robust plateau — test net
is negative for most cutoffs and only ~breakeven in a narrow −0.1/−0.2% band.
Component decomposition (test net, calibrated cost): none −5.8%, tape-only −0.7%,
afternoon-only −4.5%, **BOTH +0.9%**. **Neither filter works alone — only the
conjunction is positive.** Requiring two conditions (each neutral alone, at a
sensitive threshold) to produce a small +0.9% test is a classic overfitting
signature. With the tail-dependence (Phase 6) and walk-forward degradation, the
honest read: **there is no strong, robust, cost-surviving edge** in the 0DTE
bull-reverse scalp. The bootstrap said edge>0 in 97% *on the full sample*, but
that leans on the favorable train half; true OOS after honest scrutiny is
marginal (~+1%) and fragile.

### Phase 6d — the surface "signal" was CIRCULAR (Phase 5 corrected)

Decomposed the escalator classifier: **spot-rise-only (+23%/+16% test, 72% win)
is as good as the full escalator (+15%/+22%, 68%); the surface component alone
(share-falling) is worthless (−2% test, 47% win).** So the GEX surface adds
nothing beyond "did the underlying rise in 15 min" — and that is itself circular
(classifying at +15m with +15m info to explain +15m P&L: "trades that are up are
up," not knowable at entry). **Phase 5's "surface carries predictive signal" was
an artifact.** No genuine ex-ante edge from the surface either.

### Phase 6e — DATA-INTEGRITY caveat: the dataset is a 32%-faithful proxy ⚠️

Cross-checked the replay fires against the live engine on the one overlapping day
(7/08): live logged **37** unique fire events, replay produced **26**, and only
**12/37 (32%) match** within ±2 min. Cause: the replay runs on **5-min** archive
frames; the live engine polls at **1-min**. So the 1,339-fire dataset is a
*related but different* population from what the live system actually fires
(similar state mix, different specific fires and timing).

**What this does and doesn't invalidate:**
- **Still valid (structural, fire-set-independent):** costs dominate 0DTE scalps;
  edges are regime-dependent; the filter is threshold-sensitive/overfit-prone; the
  surface "signal" is circular; realized ≠ peak. These are about the signal *type*
  and market structure, not the exact fires.
- **NOT directly transferable:** the specific numbers (+6% mid, +0.9% filtered
  net) are on the proxy population. The live system's real edge must be measured
  on live fires forward.
- This *strengthens* the "dry-run to collect real forward data" recommendation —
  the historical backtest isn't even on the live fire set.

Fidelity vs scale was the core tradeoff: only 16 clean live fires exist, so scale
required the 5-min replay proxy. No historical 1-min fire data is archived to do
better retrospectively.

### Phase 7 — Robustness battery ported to the STOCK-SWING system

Applied the same scrutiny to the campaign flow×node backtest (286 intersection
legs, already net of 6% cost). **It's meaningfully more robust than the 0DTE
scalp:**
- **NOT tail-dependent:** drop top-10 winners → +33% (vs +35%). Broad 70% win,
  not moonshot-driven. (The 0DTE scalp died when you dropped its top winners.)
- Coherent, interpretable arm structure: intersection 70% > flow_only 66% >
  placebo 54% > node_only 49%/−6% (node-alone is a *trap* — structure≠direction,
  reconfirmed on real stock dollars). A+ flow (ask≥52%) lifts to 73%/+44%.

**But the same warning sign:** train +68% / test +3% *within the bull sample* —
the edge front-loads into the early bull run and fades as later cohorts' 20-day
forward windows reach the chop. **The 70%/+35% is a bull-regime headline; the
late-cohort reality is +3%.** All 286 cohorts are 04-13→06-08 (bull). The
definitive test — extending cohorts fully into the June–July chop — is the next
build. Net: the stock-swing system is the more promising Glitch-competitor
(robust structure, not tail-dependent, cost-adjusted), **but it needs
regime-awareness** — trade it when the tape is bullish, stand down in chop/rotation.

### Phase 8 — DEFINITIVE cross-system finding: both edges are regime (beta), not alpha

Extended the campaign cohorts into June (chop-forward windows) and split by regime:

| cohort forward window | intersection | flow_only |
|---|---|---|
| **BULL-forward** (≤05-15) | **81% win / +57%** | 74% / +45% |
| **CHOP-forward** (>05-15) | **51% win / −0%** | 52% / +2% |

Cohort-by-cohort: April +65→+94%, June (deep chop) −38%, −52%, −56%. **The
stock-swing flow×node edge collapses in chop exactly like the 0DTE signal.** The
70%/+35% headline was a bull-blend; the honest chop number is 51%/breakeven.

**Unified conclusion across BOTH systems:** the 0DTE bull-reverse and the
stock-swing flow×node are *the same trade in different clothes* — long calls that
print in bull tape and die in chop. Their "edge" is **substantially beta**
(being long gamma/calls in a rising market), not regime-independent alpha. This
is the single most important result of the study.

**Quantitative proof (the capstone number):** across the 21 cohorts, the
correlation between SPY's forward-20d return and the intersection's mean return is
**0.72 (R² ≈ 0.52)** — over half the intersection's performance variance is
explained by market direction alone. It's ~52% beta with option leverage on top;
the residual alpha (a few cohorts beat a down market) is real but swamped.

**The real lever for both = MACRO REGIME.** Not intraday trend (that failed), but
the multi-week market state, which is more persistent/detectable. Run either
system **only when the macro tape is bullish**; stand down in chop/rotation. A
macro-regime gate is the highest-value build for beating Glitch — it turns an
81%-in-bull / 51%-in-chop blend into a deployed-only-in-bull strategy. (Whether a
*realizable* macro filter at formation cleanly separates the two is the next test.)

### Phase 9 — Macro gate: directionally promising, statistically under-powered

Tested a realizable macro gate (only trade intersection when SPY's trailing-10d
return > 0 at cohort formation): GATE ON 68% win / +31% (n=205) vs GATE OFF 33% /
−38% (n=15). The gate correctly flags the losing cohorts — but **n=15 gate-off is
far too small** to confirm: the 64-day window was almost all bull, so there's
barely any bearish regime to test against. Directionally consistent with the beta
thesis; not statistically established. (Also: SPY-10d "up" 61% < "flat" 70% —
chasing strong momentum underperforms, same as the 0DTE finding.)

**The binding limitation of the whole study: too few regime cycles.** 64 trading
days / ~92-day option retention = roughly one bull→chop transition. Every
regime-dependent conclusion is drawn from a single cycle. A macro gate is the
right idea and shows promise, but validating it needs multiple bull/chop/bear
cycles — i.e., forward data collection or a longer history than UW retention
allows. This is why the honest recommendation is **collect forward data**, not
**deploy on backtest**.

## HONEST BOTTOM LINE (post-robustness)

Robustness did its job: it turned a "+6% deployable edge" into an honest **~+1%
OOS, fragile, tail-dependent, threshold-sensitive, likely-overfit** result. The
responsible stance: treat it as an *unproven hypothesis*, not an edge. The 0DTE
index bull-reverse signal, net of ~2–3% costs, does not offer a robust
exploitable edge with any exit/filter tested tonight. The real value of the night
is the **rigor that stopped us shipping overfit changes** — and the strategic
signal to invest effort where a durable edge is more plausible (the stock-swing
flow×node campaign system).

## DECISIONS NEEDED

**(1) Fix the EOD summary to report realized P&L** (close_mark), not peak
(best_mark). Pure reporting correctness — the summary currently overstates by
~45 pts. Highest-value, zero strategy risk. **Do this first.**

**(2) Do NOT deploy the filter+scalp as an edge.** Post-robustness it's ~+1% OOS,
fragile, tail-dependent, and needs a 2-condition conjunction at a sensitive
threshold. IF you want forward data, run it in **dry/tracking mode only**, sized
at zero, explicitly as an *unproven hypothesis* — not because it's proven. Its
one defensible use: it does reject the worst (down-tape/afternoon) fires, so as a
*risk gate* (not a profit engine) it's mildly defensible.

**(3) Reconsider the 0DTE index scalp premise.** Net of ~2–3% costs, no tested
exit/entry/filter yields a robust edge. The signal catches volatility, not
direction; costs eat the small moves; the big moves (trend days) aren't
predictable. Effort likely better spent on the **stock-swing flow×node campaign
system**, where the earlier backtest showed a more durable edge — apply this same
robustness battery (costs, walk-forward, bootstrap, threshold sweep) there.

**(4) Optional research:** deeper GEX-surface features (multi-frame pin-escape,
wall-break) on more history if UW retention allows — the surface was the only
input with *any* predictive signal (Phase 5), worth one more rigorous pass.

_None approved — await review. No live code touched tonight._

_(proposals for live-code changes — none approved yet; await morning review)_

1. **Afternoon suppression (1:30–3:00 ET)** for BULL_REVERSE — the single
   clearest robust signal (−10%/−18% both halves). Lowest-risk filter.
2. **Tape gate refinement** — the shipped bull-tape gate is directionally right,
   but the data says *mild-up* beats *strong-up*; consider not chasing strong-up
   extremes. (Needs more data before changing live.)
3. **Pending Phase 2** — instrument test (0DTE vs 1–3 DTE): MFE is +100%+ in
   every bucket but 0DTE theta destroys it; if 1–3 DTE converts that catch, it
   could dwarf every filter above. TBD.
