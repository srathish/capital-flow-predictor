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
