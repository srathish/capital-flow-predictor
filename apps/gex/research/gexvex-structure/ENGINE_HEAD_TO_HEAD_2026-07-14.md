# Doctrine Engine vs Pattern Matcher — Head-to-Head Replay — 2026-07-14

**Status:** RESEARCH ONLY (Clause 0). No live code, config, or behavior changed.
New research artifacts only: `engine_replay.mjs`, `score_head_to_head.mjs`,
`controls.mjs` (+ their `*_out.json`).

**Question.** The repo has two decision engines. The one that trades is the simple
pattern matcher (`fire-loop → patterns → plays.js`, replay baseline ≈ −5%/fire,
PF ~0.85). The one that is fully built but *dormant* is the Skylit doctrine engine
(`bias → trinity → 9-step synthesis → execution.planTrade`), wired only to
`ingest/snapshot-poller.js` which logs `would_enter`/`reject` to `decision_log` and
never trades. **Does the dormant 9-step engine actually judge better than the matcher
that trades?** I reconstructed its decisions by replaying it over the 68 archived
5-min surface days and scored them with real UW option marks.

---

## 1. THE HEAD-TO-HEAD TABLE

Net per-trade return, 3% haircut, live-trail exit (arm 0.50 / gb 0.15 / stop 0.60) —
the *same* exit rule the tracker runs, so this is apples-to-apples.

| cohort | n | avg net/trade | win% | PF | total net | maxDD (by-day) |
|---|--:|--:|--:|--:|--:|--:|
| **Doctrine engine** (trail exit) | **10** | **+3.52%** | **70%** | **1.16** | +35% | −140% |
| Doctrine engine (plan's own exit) | 10 | +4.92% | 40% | 1.20 | +49% | −213% |
| Pattern matcher — same 9 days | 185 | −0.73% | 49% | 0.98 | −135% | −863% |
| Pattern matcher — all 66 days | 1295 | −4.55% | 47% | 0.86 | −5890% | −6992% |

Harness validation: my pattern-matcher scoring reproduces the known replay baseline
(−4.55%/fire, PF 0.86 vs the program's stated ≈−5%/fire, PF ~0.85) — so the P&L
engine is trustworthy.

**Read at face value the doctrine engine wins**: +3.5%/trade vs the matcher's
−0.7% (same days) / −4.6% (all), positive PF vs sub-1, 70% win vs 47–49%. **But the
sample is n=10, and the controls below dissolve the edge.**

---

## 2. THE FUNNEL — where the 9-step gate bites (THE key structural deliverable)

16,116 ticker-ticks fed through the engine across 68 days (SPXW+SPY+QQQ, chronological,
trinity fed cross-index exactly as the poller does).

| step | gate | reached | rejected | dominant reason |
|---|---|--:|--:|---|
| 1 | price_action (chop) | 16116 | 1585 | `unstructured_price` (range/spot < 0.02%) |
| 2 | structural_level | 14531 | 1193 | `spot_not_near_heatmap_structure` (>0.5% from floor/ceiling) |
| 3 | map (rainbow_road) | 13338 | 0 | rainbow never detected |
| **4** | **node_eval** | **13338** | **12,316** | **`no_directional_bias` 10606**, paradox 1407, tap-4+ 302 |
| 5–6 | reaction/regime (non-gating) | 1022 | — | informational only |
| 7 | path (pika cloud) | 1022 | 59 | `pika_cloud_in_path` |
| 8 | trinity | 963 | 736 | `trinity_noise` 726, divergence 10 |
| 9 | execution R:R | 227 | 216 | `insufficient_rr` 197, no_stop_node 19 |
| → | **would_enter** | | | **11** |

**Where the doctrine gate bites: Step 4 and Step 8 — both trinity/direction gates.**
- Step 4 kills 92% of survivors, overwhelmingly `no_directional_bias`: `inferDirection`
  returns null unless trinity supplies a `calls/puts` direction **or** local |bias| > 30.
  Most ticks have neither.
- Step 8 (trinity confluence) then kills another 76% of what's left, almost all
  `trinity_noise` (the 3 indices don't align 2/3 with enough magnitude).
- Step 9 (R:R ≥ 1.7) kills a further 95% — most surviving geometries can't clear even
  the *lowered* 1.7 floor (doctrine's real floor is 3:1).

Net: **the cross-index trinity requirement + R:R gate is the whole story.** The engine
is not selective about pattern quality so much as it demands SPX-SPY-QQQ agreement and
a minimum reward:risk, and almost nothing clears both.

All 11 would_enters are `moderate_confidence_directional` trinity; 10 of 11 have local
|bias| ≤ 30, so **direction comes from the cross-index trinity average, not the local
pattern** — the engine is doing exactly the confluence thing the audit said the traded
path lacks.

---

## 3. CONTROLS — the edge is not distinguishable from luck

### (1) Volume-matched random-skip (50,000 draws of 10 fires, live-trail net)
| pool | pool avg | random-draw median | **P(random 10-draw avg ≥ doctrine +3.52%)** |
|---|--:|--:|--:|
| same 9 days (n=185) | −0.73% | −4.43% | **36.8%** |
| all 66 days (n=1295) | −4.55% | −7.20% | **32.5%** |

A random skip of the *same* pattern-matcher fires matches or beats the doctrine engine
about **one time in three**. Bonferroni across the 2 exit modes needs p < 0.025; we are
at 0.33–0.37. **No significant selection edge.** The reason is visible in the table: the
option-P&L distribution is heavily right-skewed (pool *median* −4.4% but *mean* −0.7%,
because a few fat-tail winners carry it). The doctrine's 10 draws simply happened to
include a couple of those winners (+92%, +37%, +34%, +33%) — which a third of random
10-draws also do.

### (2) Overlap cohorts — does the doctrine's yes/no add value on the fires we took?
PM fires on the 9 engine days, split by whether the doctrine also approved a would_enter
on the same day+ticker+direction within 30 min:

| cohort | n | avg net | win% | PF |
|---|--:|--:|--:|--:|
| doctrine-APPROVED-adjacent | 8 | +67.6% | 25% | 2.57 |
| doctrine-REJECTED | 177 | −3.82% | 50% | 0.88 |

Directionally suggestive — the approved cohort outperforms — **but n=8 with a 25% win
rate means the +67.6% is two fat-tail winners, not a reliable filter.** This is the one
result worth a larger-sample follow-up; it is not evidence on its own.

### (3) Per-day / day-block view
Doctrine trail P&L by day: 6 up days (+26, +7, +92, +67, +37, +25%) vs 2 down days
(−79%, −140%). Two-sided sign test on days **p ≈ 0.29**. The two bad days nearly erase
the six good ones; the +35% total is fragile. n is far too small for walk-forward halves
(≈5 trades/half) or a meaningful day-block bootstrap.

---

## 4. CAVEATS (stated prominently)

1. **5-MIN CADENCE — the load-bearing caveat.** The poller runs 1-min live; the archive
   is 5-min. Step 1 (`checkPriceAction`) requires ≥5 spot samples in the passed history.
   **Under a faithful 10-min window, 0 of 16,116 ticks have ≥5 samples** — i.e. the
   engine would reject 100% at Step 1 as a pure cadence artifact. To get a funnel at all
   I passed the full trailing intraday spot buffer ("adapted mode"), which makes Step 1's
   last-5-sample range span ~20–25 min instead of 5. This is *more* permissive than prod,
   so the 11 would_enters are an upper bound on the engine's volume, and **none of them
   would exist under faithful 1-min→10-min cadence.** The deeper gates (2, 4, 7, 8, 9)
   read real structure and are cadence-robust; Step 1's specific 1,585 rejects are the
   only cadence-sensitive part of the funnel.
2. **n = 10.** No statistical power. Every headline number is one or two fat-tail trades
   away from flipping. The plan-exit +4.92% hangs entirely on a single +262% target hit
   (2026-05-06); drop it and plan-exit expectancy goes negative.
3. **Vanna is stripped in prod and here.** `computeSurface` drops `vanna`; the poller
   feeds vanna-less nodes to the detectors, so `trapdoor` / `vanna_persistent` /
   `overnight_carryover` always reject on their vanna checks. Replicated faithfully — so
   the bias `pattern_signal` is effectively rug / reverse-rug / beach-ball / pika-cloud /
   rainbow only. (This is a prod reality, not a replay shortcut.)
4. **Only `lifecycle.js` was reimplemented** (in-memory, identical state machine incl.
   first_seen_ms preservation on upsert). Every other module — significance, structure,
   velocity, awareness, classification, bias, trinity, synthesis, execution, all patterns —
   is the **real imported code**, invoked in the exact order `processSnapshot` uses.

---

## 5. VERDICT

**Honest null on selection value, with one suggestive thread.**

- The 9-step doctrine engine is *extraordinarily* strict: **11 would_enters in 68 days
  (~0.16/day) vs the pattern matcher's 1,355 fires (~20/day) — a 99.2% volume cut.** The
  cut is driven by the trinity-confluence + R:R gates (Steps 4/8/9), not by pattern
  quality.
- On its 10 scoreable decisions the engine is nominally positive-expectancy (+3.5% trail,
  +4.9% plan) where the pattern matcher is negative (−0.7% same days, −4.6% all) — **but a
  volume-matched random skip of the same fires matches or beats it ~1/3 of the time
  (p ≈ 0.33–0.37).** The 9-step gate is not shown to *add* selection value; on this
  evidence it mostly *reduces exposure* (fewer trades, less to lose), and the apparent
  win% edge is a fat-tail sampling artifact.
- The single non-trivial hint is the overlap cohort (approved-adjacent PM fires +67.6%
  vs rejected −3.8%), but n=8 / 25% win makes it a fat-tail coincidence until re-tested at
  scale.

**So: do NOT wire the doctrine engine to the traded path on this evidence.** The case for
it is "trades less, loses less," not "picks better," and even that rests on 10 trades that
can't survive the 5-min-cadence caveat (they wouldn't exist at prod fidelity).

---

## 6. DECISIONS NEEDED

1. **This is not enough to promote the doctrine engine.** The head-to-head is
   under-powered (n=10) and cadence-compromised (0/16116 ticks evaluable at true window).
   Reject "wire doctrine → traded path" for now.
2. **The right test needs 1-min fidelity — the poller's native cadence.** Two ways to get
   it, both operator-approval-gated: (a) start persisting `decision_log` off the live
   Railway poller (it already runs 1-min and computes all of this) and let it accumulate a
   few weeks of real would_enter/reject rows; or (b) re-archive surfaces at 1-min and
   re-run this exact harness. Either yields a properly-powered funnel and a would_enter set
   whose Step 1 is honest.
3. **Cheapest partial win, independent of the above:** the funnel shows the doctrine's
   discriminating gate is **cross-index trinity + R:R**, and the audit's Clause-8b
   vanna-imbalance filter is untested here (vanna is stripped). A targeted experiment —
   add *only* a trinity-agreement veto (or a vanna-imbalance confirmation) to the traded
   pattern-matcher path and re-run the exit-study — isolates whether confluence helps the
   engine we actually trade, without adopting the whole 9-step machine. That is a smaller,
   testable proposal than "reconcile the two engines."
4. Any change requires explicit operator approval per Clause 0.

---

*Method: replayed `evaluateSetup` (+ bias/trinity/lifecycle/velocity/awareness/patterns/
execution) over `data/skylit-archive/intraday/<day>/{SPXW,SPY,QQQ}.jsonl.gz`, 68 days,
invocation order copied from `ingest/snapshot-poller.js::processSnapshot`. Scored 11
would_enters with UW `/option-contract/{occ}/intraday` marks (ATM at decision spot);
pattern-matcher fires from `research/exit-study/fires_index.json` with cached marks.
Two exit modes (plan node-stop/target via the ticker's own archived spot path; live-trail
a50/gb15/stop60), 3% haircut. Controls: 50k-draw volume-matched random-skip, overlap
cohorts, per-day sign test.*
