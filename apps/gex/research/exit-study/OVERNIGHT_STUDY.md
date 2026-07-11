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

## DECISIONS NEEDED

_(proposals for live-code changes — none approved yet; await morning review)_

1. **Afternoon suppression (1:30–3:00 ET)** for BULL_REVERSE — the single
   clearest robust signal (−10%/−18% both halves). Lowest-risk filter.
2. **Tape gate refinement** — the shipped bull-tape gate is directionally right,
   but the data says *mild-up* beats *strong-up*; consider not chasing strong-up
   extremes. (Needs more data before changing live.)
3. **Pending Phase 2** — instrument test (0DTE vs 1–3 DTE): MFE is +100%+ in
   every bucket but 0DTE theta destroys it; if 1–3 DTE converts that catch, it
   could dwarf every filter above. TBD.
