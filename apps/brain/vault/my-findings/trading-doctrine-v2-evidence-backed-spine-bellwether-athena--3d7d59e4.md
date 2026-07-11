---
title: TRADING DOCTRINE v2 — evidence-backed spine (Bellwether ⇄ Athena)
source_url: repo://apps/gex/research/exit-study/TRADING_DOCTRINE_v2.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:35:07Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- exits
summary: '**Status:** canonical shared doctrine. Supersedes stale "node → direction/target" lines in Skylit-Academy L329/L1738 and KNOWLEDGE_BASE L112. Seed as **T1**; cite by clause number. **This is knowledge, NOT a mandate to change live trading logic** — see Clause'
url_sha1: 3d7d59e4cf0baa19e0c49d8ecf9d1a9a79dc0299
simhash: '9297597256320645062'
status: vault
ingested_by: seed
---

# TRADING DOCTRINE v2 — evidence-backed spine (Bellwether ⇄ Athena)

**Status:** canonical shared doctrine. Supersedes stale "node → direction/target"
lines in Skylit-Academy L329/L1738 and KNOWLEDGE_BASE L112. Seed as **T1**; cite by
clause number. **This is knowledge, NOT a mandate to change live trading logic** —
see Clause 0.

**Provenance:** derived from `research/exit-study/OVERNIGHT_STUDY.md` (robustness),
the UW + Skylit walkforwards (`research/exit-study/walkforward/`), F1–F4
(`research/gexvex-structure/FOUNDATIONAL_FINDINGS.md`), and the campaign backtest.
Dates 2026-07-10→11.

---

## Clause 0 — GUARDRAIL (highest precedence)
Nothing in this doctrine changes the live trading engine. The fire-loop, King
computation, signals, and exits run as-is. Live-code changes require **explicit
operator approval**. Research/knowledge only.

## Clause 1 — GEX/VEX is a MAP, not a COMPASS
Structure tells you *where* volatility/pinning concentrate, **not** *up vs down*.
Evidence: GEX-King direction 45–49% (UW, 1yr) and 36–45% (Skylit, 58d) — at/below
the ~55% up-baseline in every quarter; F1/F4 on the Skylit archive concur.

## Clause 2 — DIRECTION comes from REGIME + FLOW + TAPE, not node position
Node position does not forecast direction. The campaign edge that *works* is
**flow** (66% win) confirmed by node — node-alone is a **trap** (49%/−6%). Direction
conviction = macro regime + 20-day flow accumulation + the live 3-index tape.

## Clause 3 — The King/node is a STRUCTURE MARKER, magnet UNSETTLED
Do not size on "price will reach the King" alone. Controlled intraday test
(mirror-placebo, 121 Skylit sessions): price approached the King 41% vs placebo —
**not distinguishable from chance**. Caveats: one regime, King-def may differ from
the live node, may be conditional on high-share pika pins. Treat the magnet as
**open, not proven** — a level to watch, not a target to bet.

## Clause 4 — ENTRIES catch MOVES (this part is real)
The bull-reverse signal reliably detects "something is about to move" (high MFE:
median +34%, SPY/QQQ +65–70%; 40–58% reach +25% peak). Keep the entries. Their
value is *move detection*, independent of getting direction from the node.

## Clause 5 — Don't fight the tape (bull-tape gate)
Counter-trend fires are a primary leak. Live proof: 2026-07-10 the only losers were
2 bear puts on a bull day (−72/−81%); the bull calls performed. Gate fires by
direction × tape.

## Clause 6 — EXITS: disciplined profit-taking; score on REALIZED not peak
The mechanical structure-invalidation exit gives back peaks. Take profit at targets;
let the operator's discretion run. **Grade on `close_mark` (realized), never
`best_mark` (peak)** — the plays-tracker EOD summary reports peak and overstates by
~45 pts (7/08–10: realized −21.6% vs peak +45.3%). [Reporting fix is DECISION #1,
pending approval — not yet applied.]

## Clause 7 — Both systems are BETA in bull clothing; the lever is the MACRO gate
0DTE bull-reverse and the campaign flow×node are the same trade: long calls that
print in bull tape, die in chop. Campaign intersection is **0.72-correlated (R²≈.52)
with SPY's forward return**; collapses 81%/+57% (bull-forward) → 51%/−0%
(chop-forward). Deploy either **only when the multi-week tape is bullish**; stand
down in chop/rotation. No structure-picks-direction edge survived costs+robustness.

## Clause 8 — What IS robust (pos-gamma → lower vol)
Positive total gamma → smaller realized range holds on UW (SPY 0.7 vs 1.1%, QQQ 1.1
vs 1.6%, full year). This is the one durable structural signal — a **volatility**
read, consistent with Clause 1. (Daily aggregate on the 64-day Skylit slice was
noisy/inverted — use the cleaner near-term/UW read; frame matters.)

---

## Open questions (research queue, no logic impact)
- Skylit King magnet **conditional on high-share pika pins** — re-test intraday.
- Macro-regime gate: promising (gate-off −38%) but under-powered (~1 cycle) — needs
  forward data. Collect via the live observation log.
- Intraday pin vs breakout ("wall vs escalator") on the Skylit surface — untested at
  node level with predictive lead.
