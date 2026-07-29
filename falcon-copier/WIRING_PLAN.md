# Doctrine → Tracker wiring plan (proposal — Clause 0, shadow-first, forward-validated)

Goal: connect the doctrine our grader path already computes to the **entry gate** that actually
opens plays, so the system fires what the doctrine calls (7/21: long to the 7520 king +66–133%) and
suppresses what it shouldn't (7/20: the −$893 mid-range reversals).

**Non-negotiables:** every change is built to **SHADOW-LOG only first** (observe, never block a live
fire), then **forward-validated on live fires** — does the doctrine decision separate winners from
losers in **expectancy** (not win rate)? — before it is allowed to gate. One change graduates per
forward window (≥40 fires); a graduate must replicate in a 2nd window before it touches live logic.
No live-code behavior change ships without operator approval.

Evidence base: **7/20** (−$893; doctrine would veto the range/whipsaw mid-range reversals) and **7/21**
(0 fires from the double-run clobber; doctrine long to the 7520 king = +66–133%, exit-at-king beat the
+45% cap by ~+88pt). See PICKS_2026-07-21.md, DOCTRINE.md §delta.

---

## Phase 0 — operational (NO code; do first, biggest single win)
Neither 7/20 nor 7/21 was lost to doctrine — 7/20 missed the morning (**late start**), 7/21 fired **0**
(**two trackers clobbering session A**). Fix the plumbing before touching logic:
1. Run **one** tracker (`kill` the duplicate).
2. Load the launchd job so it's live before 9:30; pre-open = session-A re-auth popup + `auth-preflight`.
No doctrine change matters if we aren't cleanly live at the open.

## Phase 1 — WIRE the regime / no-trade veto (shadow)  ← highest leverage, lowest risk
The pieces already exist and are **tested**, just disconnected: `classifyRegimes` (`regime.js`),
`rainbow_road`/`whipsaw` `no_trade`, `pika_cloud` PIN, `regimeScore` (grader path).
- **Build:** in `fire-loop.js`, on each fire compute the grader-path regime verdict and **stamp it into
  the observation log** (new field `doctrine_regime_verdict` = allow/veto + reason). **Do not block.**
- **Validate:** over ≥40 forward fires, do doctrine-**vetoed** fires have worse expectancy than
  **allowed** ones? Graduate to a live gate only if veto-exp << allow-exp by a pre-set margin.
- **7/20 check:** would flag the 7490/7440 bracket + positive-gamma pin as Range/Whipsaw and veto the
  mid-range bull reversals (the −$843).

## Phase 2 — WIRE the shared King/Floor/Ceiling object + cross-expiry (shadow)
- Feed `deriveStructure` (`structure.js`) + `significance` king into the tracker as the **authoritative**
  king/floor/ceiling (today each pattern recomputes ad-hoc). Add the **back-expiry (monthly) king** from
  `allExpirations` — already fetched then discarded (`constants.js:14`).
- **Shadow-log:** king/floor/ceiling + **front-vs-back agreement** flag per fire.
- **Validate:** do fires where front/back **disagree** (doctrine chop) underperform? If yes → chop gate.

## Phase 3 — Entry precision (new logic, shadow)
- **Log per fire:** was entry at a **deflection-zone tap** (±$5 SPX / ±$0.50 QQQ-SPY), at a **confirmed
  close-through** the inner node, or **mid-range** ("no catalyst")? Plus node **tap-count/freshness**
  (fresh/tested/delivered — §2).
- **Validate:** do mid-range / stale-node fires underperform tap-or-break / fresh-node fires? If yes →
  require tap-or-break + fresh node to fire.
- **Config fix:** rug/reverse-rug use flat ±1% of spot → switch to the ±$5 deflection zone (`config.js`).

## Phase 4 — Rolling / node-flip / exit-at-king (new logic, shadow)
- **Rolling floor/ceiling** detection (largest floor/ceiling migrates ≥2 consecutive updates = signal, 3
  = confirmation, §6) → trend direction. **Node-flip** (king above↔below spot) → direction switch.
- **Exit-at-king:** when the play's target king is reached within its deflection zone **and it's a pika
  (pin)**, exit — vs the fixed +45% cap. (7/21: exit-at-king caught +133% where the cap booked +45%.)
- Validate each independently; ties into the standing "loosen the cap for barney/runner" backtest finding.

## Validation protocol (all phases)
- **Shadow = observe-only**; live fires unchanged (Clause 0). Shadow decisions ride in the observation log.
- **Metric = expectancy** ($/play or %-return per fire). Win rate is never the criterion.
- **Sample floor ≥40 forward fires** per phase; pre-register the margin + kill criterion before the window.
- Graduate ONE phase per window; **replicate in a 2nd window** before it gates live. A failed phase is dead
  (a tweaked variant is a new rule + new window).

## Order & rationale
Phase 0 (plumbing) → 1 (wire regime veto, biggest/safest) → 2 (structure+cross-expiry, wiring) →
3 (entry precision, new) → 4 (rolling/flip/exit, new). Wiring-existing before new-logic keeps early
phases low-risk and fast to validate. All → DECISIONS NEEDED; nothing ships without operator sign-off.
