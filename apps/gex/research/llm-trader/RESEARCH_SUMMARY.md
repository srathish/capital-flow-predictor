# Bellwether 0DTE — Consolidated Research Record (2026-07-14/15)
RESEARCH ONLY (Clause 0). The honest state of the whole investigation so no future
session re-runs a dead end. Numbers are blind, real-print, causal unless noted.

## THE ONE-LINE TRUTH
GEX/VEX is a MAP of where price pins/stalls, NEVER a forecast of where it goes.
The only thing that ever made money is DISCIPLINED, SELECTIVE JUDGMENT — reading the
chart, using GEX to confirm and to gate, and trading ONE confident play a day. That
edge is modest (+3–6%/day in a normal regime), high-variance, regime-dependent, and
NOT reducible to a mechanical rule.

## WHAT IS VALIDATED (survives out-of-sample)
- **Discipline is the entire edge.** Trading every setup = −0.2%/day across 97 blind
  trades / 34 days — dead flat in every cut. One gated play/day is the only positive thing.
- **One confident play per day** (first gate-open transition, size up, stop): May–Jul
  47–52% win, +3.6–6.2%/day (26 days); OOS split held 4×. THE operator's idea.
- **The gamma gate** (net near-spot gamma ≤ ~+20–40M → hunt; strong +gamma → stand down):
  the ONLY mechanical feature with signal. Incomplete (see blind spots).
- **Cap 0DTE winners** (~+100% or into next node): 38% of buy-side trades touch +100%
  then round-trip; letting run to EOD = −32%/trade.
- **Scale-out ladder** (⅓@+50, ⅓@+100, trail): verified exit improvement.
- **Bull tape gate** (price structure, not GEX): the live system's one durable entry edge.

## WHAT IS DEAD / DOWNGRADED (killed with controls; do NOT retry)
- GEX-as-direction (bounce/break, King-as-level, supportive-king gate): ~18 kills, mirror-fails.
- V-reclaim mechanical entry: +10.4% was IN-SAMPLE; OOS-negative on fuller data.
- Pika credit spreads (sell premium at walls): 80% win but NEGATIVE expectancy (1:7 payoff);
  selling at pika does not beat random. Win rate is a VANITY metric.
- Opening GEX walls as a RANGE predictor: 18% containment, under-predict, walls migrate;
  explains why the credit-spread play failed.
- Quick-abort (mark-based stop): net-negative, sells noise bottoms.
- Tap-count level-weakening: null pooled (pika-floor lean only).
- Pin-hold, node-gated flips, day-direction gate, higher-low re-entry: all subtracted value.

## MECHANICAL FEATURES TESTED TO SEPARATE WIN vs LOSS — ONLY THE GATE WORKS
gamma (weak signal) · trailing-range regime (fail) · displacement/momentum (fail) ·
prior-day extremes (fail — magnet, not predictor) · air-pocket/path-clarity (fail —
"clear path" selects losers; price already ran) · node touch (fail). CONCLUSION: the
win/loss distinction is holistic judgment, not a feature. Stop hunting for the feature.

## REGIME DEPENDENCE (the cross-regime finding)
34 blind days, 2 regimes. May–Jul (varied): +3.6–6.2%/day. April (persistent +gamma pin,
~7100, gamma to +400–817M, tight ranges): ~FLAT (−0.1%/day, ~15% win) — no transitions to
catch, so nothing to make (no blow-up, just no edge). The system needs the market to OFFER
transitions. A trailing-range regime FILTER does NOT detect the bad regime (fails). Regime
quality = transition quality = judgment, again.

## THE ONLY TEST LEFT: FORWARD
Everything computable is computed and keeps regressing toward its true (modest) value or
failing. The one thing hindsight can't taint: run the system LIVE, paper, one gated play a
day, on sessions that haven't happened. Protocol: (1) live 1-min surface via capture.mjs;
(2) each day a charts-first reasoning read forms the thesis, GEX gate decides trade/stand-down;
(3) one play, sized to conviction, capped; (4) log + score at close; (5) after ~20 live days,
compare to the +3–6%/day backtest. Only then consider real size. See [[system-spec]],
[[winrate-vanity-2026-07-14]], [[gex-not-volatility-forecast]].
