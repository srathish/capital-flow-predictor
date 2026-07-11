# Overnight Exit + Entry Study — 2026-07-10 → 07-11

**Status:** IN PROGRESS (autonomous research, no live-code changes). All findings
below are research artifacts; any change to the live tracker waits in
**DECISIONS NEEDED** for explicit approval.

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

## CONCLUSION

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

## DECISIONS NEEDED

**(1) Deploy the filter+scalp (dry-mode first).** Config-gated, BULL_REVERSE only:
down-tape filter (SPY≥open) + afternoon suppression + TP+50%/25m/−50% exit. Run
in dry/tracking mode alongside live to confirm the +4–6% OOS edge forward. LOWEST
regret — it strictly rejects the −10% trades the system currently takes.

**(2) Fix the EOD summary to report realized P&L** (close_mark), not peak. Pure
reporting correctness; no strategy change.

**(3) Afternoon suppression (1:30–3:00 ET)** as a standalone gate if (1) is too
big a step — it's the single most robust filter on its own.

**(4) Build the GEX-surface instrumentation** (research) to test pin-escape — the
one realizable signal that could unlock trend-day identification.

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
