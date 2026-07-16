# DECISIONS NEEDED — from the 2026-07-15 forward test (operator sign-off required)

The first true forward day (7/15, live-captured) MISSED the marquee V-recovery
(7528 @ 12:37 ET → 7569). It scored +35% on a different afternoon short, but the
trade we actually wanted — the V — was not taken. Root causes and the fixes that
need YOUR decision (Clause 0: research proposals, no autonomous system changes):

## 1. LIVE CAPTURE HAS GAPS (the primary blocker)
`research/velocity-capture/capture.mjs:70` backs off exponentially on auth flaps
(60s × 2^fails, capped 16 min). Auth hiccups in the late morning → a 100-min dark
window (10:00–11:45 ET, 0 frames in the 10:00 hour). The system is blind exactly
when a setup forms. This was a deliberate "good-citizen" design so the poller does
not pressure the shared Clerk session the live fire-loop/bridge depend on.
TRADEOFF (operator's call): denser real-time capture vs auth citizenship.
  Options: (a) lower the max backoff (e.g. 16min → 3min) — more retries, slightly
  more shared-auth pressure; (b) add RETROACTIVE gap-backfill: when the poller
  recovers, refill missed minutes from Skylit history (`fetchHistoricalSnapshot`) —
  makes the DATASET complete but does NOT help LIVE real-time trading; (c) a
  dedicated auth token for the poller so it never competes with the fire-loop.
  RECOMMEND (a)+(c) for a live system; (b) alone only fixes backtests.

## 2. V-ENTRY LAG (inherent, needs a decision)
Even with perfect data, the method enters on CONFIRMED reversal (2+ green candles),
so on a sharp V it's in at ~7550, not the 7528 low. Options: accept the confirmation
lag as the system's honest limit (safer, misses the bottom), OR test an anticipatory
extreme-entry (riskier — the extremes-vs-confirmation tension already studied; extreme
entry without the quick-abort was the best prior variant but unvalidated forward).

## 3. THE HARNESS FAST-FORWARDED OVER THE BOTTOM
The blind trader, seeing sparse morning data, fast-forwarded in big steps and stepped
over the 12:37 reversal, only slowing to 1-min after price had recovered (first entry
13:58). A live/forward runner must NOT fast-forward through thin data near a potential
reversal — it should default to fine granularity when price is extended from VWAP or
range-extreme (candidate rule: no step >2 min when |price−VWAP| > 0.3% or at a day
extreme).

## BOTTOM LINE
The 7/15 forward test's real value was NOT the +35% — it was proving that the
strategy's blockers to going live are DATA COMPLETENESS + ENTRY TIMING + HARNESS
GRANULARITY, not the read itself (it correctly identified the V, just too late).
Fix these three, then run more forward days one at a time. None of these are made
autonomously — they await operator sign-off. See [[system-spec]], [[research-summary]].
