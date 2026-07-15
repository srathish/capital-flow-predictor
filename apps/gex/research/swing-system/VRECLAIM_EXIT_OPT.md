# V-RECLAIM EXIT OPTIMIZATION — freeze the entry, tune the exit for expectancy

**RESEARCH ONLY (Clause 0). No live-code change. Findings → DECISIONS NEEDED / ghost paper only.**
Snapshot 2026-07-15. Reproducer: `apps/gex/research/swing-system/vreclaim_exit_opt.py`
(reuses `../velocity-capture/pipeline/operator_eye.py` for signals + real UW 1-min option prints).
Full numbers: `vreclaim_exit_opt_results.json`. Viewer events: `vreclaim_best_events.jsonl`.

**Frozen entry (untouched):** V-reclaim LONG-only, R=0.25%, CONFIRM=2, counter-trend suppression
(`openable`), ≤6/day, flips/shorts/higher-low OFF — the exact `SWING_V2_VALIDATION` primary. The
entry set is frozen **under the baseline stall(S=12) exit** (that is what gates when a position frees
for the next entry); every exit variant is then scored on the **identical** entry list (apples-to-apples).
**Guardrail:** restricted to the 18 validation days this reproduces the frozen baseline **exactly —
n=92, +10.4%/trade, 47% hit, +960% total.** So the entry engine is faithful; only the exit changes below.

**Data:** ALL 34 complete backfill days (2026-05-26 → 07-14), SPXW/SPY/QQQ, **162 frozen entries
(160 with a priced option path)**. Option P&L on real UW `option-contract/…/intraday` 1-min prints,
ATM call at entry, **3% all-leg haircut** (targets book at the haircut'd target — the conservative
convention). Day-block bootstrap (3,000), chronological walk-forward halves, leave-one-day-out,
volume-matched random control.

---

## One-line verdict

**Best exit = `TP+100` — full exit at +100% option gain, else stall-12/EOD backstop. It lifts
expectancy from the full-sample baseline +1.4%/trade to +5.0%/trade (+3.6 pts), a paired improvement
that is robust (P(Δ>0)=98%, LOO-worst-day still +2.4 pts), beats the baseline in BOTH walk-forward
halves, cuts OOS from −8.4% to −1.3%, and the random-entry control loses (−5.3%), confirming the entry
carries it.** BUT it does **not** clear the pre-registered *absolute* P(mean>0)≥0.90 bar (it tops out at
**87%**) and OOS stays marginally negative — because the **frozen entry's edge does not generalize** to
the newly-backfilled earlier OOS days (the baseline itself is OOS −8.4%). **The +10.4% "baseline to
beat" was an in-sample-only figure; on the full 34-day sample the same entry+stall exit is +1.4% and
OOS-negative, so no exit can reach +10.4% OOS — the binding constraint is now the entry, not the exit.**
Directionally, the study is unambiguous: **take profit beats letting winners run — decisively — for
0DTE** (let-run-to-EOD = **−32%/trade**), and a **simple hard cap beats the verified ladder and every
structural-stop / trailing / regime variant.**

---

## Exit grid — all 21 variants on the SAME 162 frozen entries (3% all-leg haircut)

`exp/tr` = expectancy per trade · `P>0` = day-block bootstrap absolute · `H1/H2` = walk-forward halves
(H1 = 05-26…06-17, mostly OOS; H2 = 06-18…07-14, mostly in-sample) · `OOS` = the 18 earlier days ·
`INS` = the orig-16. `^` beats baseline in BOTH halves.

| variant | exp/tr | hit | avgW | avgL | total | P>0 | H1 | H2 | OOS | INS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`TP+100`  ← WINNER (pre-reg)** | **+5.0%** | 40% | +52% | −26% | +799% | 87% | −6.0% | +13.7% | −1.3% | +11.5% |
| `TP+150` ^ (exploratory) | +6.2% | 39% | +57% | −26% | +988% | 87% | −7.8% | +17.4% | −1.7% | +14.3% |
| `TP+120` (exploratory) | +5.1% | 39% | +55% | −26% | +819% | 83% | −8.2% | +15.8% | −2.8% | +13.2% |
| `TP+200` (exploratory) | +4.9% | 39% | +54% | −26% | +778% | 83% | −9.1% | +16.0% | −1.7% | +11.5% |
| `TP+80` (exploratory) | +3.5% | 41% | +47% | −26% | +555% | 81% | −5.6% | +10.7% | −1.3% | +8.4% |
| `trail-gb40` ^ | +2.6% | 39% | +46% | −26% | +408% | 73% | −10.2% | +12.7% | −6.1% | +11.4% |
| `trail-gb30` ^ | +2.5% | 40% | +45% | −26% | +407% | 73% | −10.4% | +12.9% | −5.6% | +10.9% |
| `ladder-stall` (verified ladder) | +2.4% | 42% | +42% | −27% | +389% | 74% | −8.1% | +10.8% | −3.7% | +8.7% |
| `trail-gb20` | +2.2% | 40% | +44% | −26% | +350% | 69% | −6.6% | +9.2% | −2.1% | +6.6% |
| `TP+60` | +2.1% | 42% | +42% | −27% | +330% | 71% | −6.0% | +8.5% | −2.1% | +6.3% |
| `struct+trail` | +1.7% | 40% | +45% | −27% | +275% | 65% | −10.0% | +11.1% | −5.5% | +9.2% |
| `ladder+struct` | +1.6% | 42% | +41% | −28% | +257% | 66% | −7.7% | +9.1% | −3.7% | +7.0% |
| **`baseline` (stall-12 + EOD)** | **+1.4%** | 38% | +46% | −26% | +222% | 64% | −11.0% | +11.2% | −8.4% | +11.4% |
| `struct+stall` | +0.6% | 38% | +46% | −27% | +90% | 55% | −10.6% | +9.5% | −8.3% | +9.7% |
| `stall-S16` | −0.2% | 36% | +52% | −29% | −25% | 50% | −11.7% | +9.1% | −8.4% | +8.3% |
| `stall-S8` | −0.4% | 38% | +37% | −23% | −57% | 46% | −8.5% | +6.1% | −6.1% | +5.5% |
| `TP+40` | −1.3% | 46% | +30% | −27% | −201% | 34% | −8.0% | +4.1% | −4.7% | +2.3% |
| `stall-S20` | −1.3% | 38% | +51% | −33% | −207% | 38% | −12.6% | +7.8% | −8.9% | +6.5% |
| `ladder+strEOD` | −4.8% | 41% | +59% | −49% | −767% | 27% | −13.1% | +1.8% | −8.3% | −1.2% |
| `ladder-EOD` (runner to close) | −12.2% | 44% | +61% | −71% | −1957% | 10% | −26.8% | −0.6% | −19.8% | −4.5% |
| `trail-gb{20,30,40}-EOD` | −13 to −17% | ~45% | ~+55% | ~−75% | ≈−2400% | ~7% | ~−29% | ~−3% | ~−23% | ~−5% |
| `let-run-EOD` (no cap) | **−32.0%** | 28% | +86% | −77% | −5121% | 1% | −29.1% | −34.4% | −24.4% | −39.8% |

**MFE reach (entry→EOD, option path, n=160):** 56% reach +50%, **38% reach +100%**, 26% reach +150%,
12% reach +200%. This is the fuel `TP+100` monetises: 38% of trades touch +100% intraday, but held to
the stall/EOD most of that round-trips (baseline avg MFE +48% → realized +1.4%).

---

## The decisive test — PAIRED improvement vs baseline (same entries, does the EXIT add value?)

Because every variant runs the identical entries, the honest exit question is the **per-trade delta
(variant − baseline)** and whether it is robustly positive. Day-block bootstrap on the delta, plus
leave-one-day-out worst-day delta:

| variant | Δexp/tr | P(Δ>0) | Δ 90% CI | LOO-worst-Δ | pre-reg |
|---|---:|---:|---:|---:|:--:|
| `TP+150` (exploratory) | +4.8 pts | **99%** | [+1.3, +8.7] | +3.0 pts | no |
| `TP+120` (exploratory) | +3.7 pts | 98% | [+0.7, +6.8] | +2.3 pts | no |
| **`TP+100` ← WINNER** | **+3.6 pts** | **98%** | [+0.5, +6.9] | **+2.4 pts** | **yes** |
| `TP+200` (exploratory) | +3.5 pts | 95% | [+0.1, +8.1] | +1.0 pts | no |
| `trail-gb40` | +1.2 pts | 92% | [−0.0, +2.7] | +0.4 pts | yes |
| `trail-gb30` | +1.2 pts | 76% | [−1.2, +3.7] | −0.0 pts | yes |
| `ladder-stall` (verified ladder) | +1.0 pts | 73% | [−1.6, +4.0] | −0.0 pts | yes |
| `TP+60` | +0.7 pts | 61% | [−3.4, +5.1] | −0.5 pts | yes |
| `struct+trail` | +0.3 pts | 57% | [−2.0, +3.0] | −0.7 pts | yes |
| `ladder+struct` | +0.2 pts | 54% | [−2.8, +3.5] | −0.8 pts | yes |
| `struct+stall` | −0.8 pts | 6% | [−1.6, +0.0] | −1.0 pts | yes |
| `stall-S{8,16,20}` | −1.5 to −2.7 pts | 17–21% | — | −2.3 to −4.4 | yes |
| `TP+40` | −2.6 pts | 18% | [−6.9, +2.0] | −3.7 pts | yes |
| `*-EOD` / `let-run` | −6 to −33 pts | ≤15% | — | −9 to −40 | yes |

**Only `TP+100` (of the pre-registered variants) clears P(Δ>0)≥0.90 with a materially positive delta and
a positive LOO-worst-day** (`trail-gb40` also clears the paired gate but with a third of the delta and a
LOO-worst of +0.4, i.e. one day from flat). The exploratory TP curve (`TP+80…+200`) shows a **broad
plateau**: expectancy is +3.5→+6.2% across +80…+150 and every level +100…+200 has P(Δ>0)≥0.95 — so the
edge is "cap the winner around +100–150%," **not knife-edge on the exact +100 level.**

---

## The three questions, answered

**(a) Do the ladder or the structural stop lift expectancy above the +10.4% baseline OOS? — NO.**
Nothing on the full sample is anywhere near +10.4% (that number is in-sample only). The verified
scale-out **ladder** = +2.4%/tr (OOS −3.7%, paired Δ+1.0, P(Δ>0)=73%, LOO 0.0) — a weak, **non-robust**
improvement over the +1.4% full-set baseline. The **structural stop** is neutral-to-harmful as a
standalone (`struct+stall` paired Δ−0.8, P(Δ>0)=6%; `struct+trail` Δ+0.3, P=57%) — the −0.05%/1-min
pivot break fires late and mostly books a loss that stall would have booked anyway. **Neither is the
edge here; the simple hard cap is.** And because the baseline is OOS −8.4%, *no* exit can reach a
+10.4% OOS expectancy — the entry is the ceiling.

**(b) Best expectancy while staying P(mean>0)≥0.9? — On an absolute basis, NONE qualifies.**
The maximum absolute bootstrap is 87% (`TP+100`/`TP+150`); the OOS drag from the frozen entry caps every
variant below 0.90. On the *paired* (exit-improvement) basis, `TP+100` is the best qualifying exit
(+5.0%/tr, P(Δ>0)=98%). So the answer is honest-split: **best robust EXIT improvement = `TP+100`
(+5.0%/tr); best robust ABSOLUTE OOS-positive edge = does not exist on this entry.**

**(c) Does letting winners run beat taking profit (the buy-side thesis)? — NO, decisively, for 0DTE.**
`let-run-EOD` = **−32%/tr**; every trail-to-EOD runner = −12% to −17%/tr; `ladder-EOD` (keep the trailed
third to close) = −12.2%. The generic "let it run" heuristic **inverts** on 0DTE index options: 38% of
trades touch +100% MFE but theta + intraday round-trip give it all back by the close, so a **disciplined
hard cap is essential**. This also reconciles with `SCALEOUT_2026-07-13`: that study's *trailing
remainder* beat *hold-EOD* on a bear/decay-heavy mix; here, on directional-long V-reclaims, an even
simpler **full cap at +100%** beats the trailed remainder (which bleeds the runner).

---

## WINNER — frozen exit spec, ready to ghost (paper-only)

```
entry        : FROZEN — V-reclaim LONG-only, R=0.25%, CONFIRM=2, openable() gate,
               ≤6/day, 5-min cooldown, SPXW/SPY/QQQ 0DTE (do NOT touch)
exit         : FULL EXIT at option mark >= entry * 2.00  (i.e. +100% gain),
               a resting LIMIT that fills when a 1-min candle high >= the target;
               BACKSTOP = swing-stall S=12 (no new favorable spot extreme for 12 min) else EOD flat 15:45
contract     : same-day-expiry ATM call at the entry minute; 3% round-trip haircut
robust level : the take-profit is a broad plateau — anywhere +100%…+150% is equivalent
               (P(Δ>0)>=0.95); +100% is the conservative pre-registered pick
```

**Performance vs the frozen baseline (full 34-day, 160 trades):**

| | expectancy/tr | hit | avgWin | avgLoss | total | P(mean>0) | H1 | H2 | OOS(18d) | INS(16d) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline stall-12+EOD | +1.4% | 38% | +46% | −26% | +222% | 64% | −11.0% | +11.2% | −8.4% | +11.4% |
| **WINNER `TP+100`** | **+5.0%** | **40%** | +52% | −26% | **+799%** | 87% | **−6.0%** | **+13.7%** | **−1.3%** | +11.5% |
| Δ (paired) | **+3.6 pts** | +2 | | | +577% | | +5.0 | +2.5 | +7.1 | +0.1 |

- **Walk-forward: beats baseline in BOTH halves** (H1 −6.0 vs −11.0; H2 +13.7 vs +11.2) — not a single-period fluke.
- **Paired robustness:** Δ+3.6 pts, P(Δ>0)=**98%**, 90% CI [+0.5, +6.9], **LOO-worst-day still +2.4 pts.**
- **The improvement is entirely OOS/H1 loss-reduction:** in-sample it's a tie (+11.5 vs +11.4); TP+100
  earns its edge by refusing to give back the +100% MFE on the choppy earlier days (OOS −1.3 vs −8.4).
- **Random control (entry carries it):** volume-matched random-entry + the *same* TP+100 exit = **−5.3%/tr**
  (hit 32%), losing in both halves (H1 −9.2 / H2 −2.7). Edge of the real entry over random = **+10.3 pts.**
  The exit is not a generic "cap any option" trick — it only works on the V-reclaim entries.

**Does it meaningfully beat the +10.4% baseline? The question is mis-framed.** +10.4% was the 18-day
in-sample figure; the honest full-sample baseline is **+1.4%**, and `TP+100` **robustly beats that by
+3.6 pts (→ +5.0%)**. So: the stall exit is **not** near-optimal — a simple +100% cap clearly and
robustly beats it, mostly by de-risking the OOS. But even the best exit **cannot** make this a
certified-OOS-positive edge (OOS −1.3%, absolute bootstrap 87% < 0.90): the frozen **entry** no longer
survives out-of-sample on the fuller backfill, and that — not the exit — is the thing to fix next.

---

## Honest caveats
1. **The absolute pre-registered gate (P(mean>0)≥0.90) is NOT cleared by any variant.** The winner is
   chosen on the *paired* exit-improvement gate, which it clears at 98%. State this plainly before any escalation.
2. **The entry is the binding constraint, not the exit.** The baseline's OOS collapsed from the
   validation's +4.7% (n=13, 2 days) to −8.4% (n=81, 18 days) as the backfill filled. Re-validate the
   *entry* on this fuller sample before trusting any live expectancy.
3. **Trade-print marks, not mids** — UW `close`/`high` are prints; a resting +100% limit fills on a
   candle high ≥ target (overshoot not credited → conservative), and the 3% all-leg haircut docks it. The
   +3.6-pt paired delta clears that noise band.
4. **`TP+150` (exploratory) edges out `TP+100` (+6.2 vs +5.0)** but is post-hoc; the plateau means the
   choice inside +100…+150 is second-order. `TP+100` is the defensible pre-registered pick.
5. **n=34 day-blocks; H1 is dominated by the harder earlier days.** Every number is a lean.

---

## DECISIONS NEEDED (not shipped — Clause 0)
- **D1 — Ghost `TP+100` (paper-only) as the V-reclaim exit**, logging live +100% limit fills to confirm
  they fill at/near target. It robustly beats the stall exit (paired P(Δ>0)=98%, both WF halves, LOO-stable).
- **D2 — DROP the verified scale-out ladder and the structural stop for this entry** — on directional-long
  V-reclaims the simple +100% cap dominates both (ladder Δ+1.0/P=73%; struct Δ≤+0.3).
- **D3 — DROP every "let it run"/trail-to-EOD exit** — catastrophic on 0DTE (−12 to −32%/tr).
- **D4 — Re-open the ENTRY, not the exit.** The frozen entry is OOS-negative on the fuller backfill;
  the exit can de-risk it (OOS −8.4→−1.3) but not rescue it to positive. Before any escalation beyond
  paper, the entry must be re-validated (or re-derived) on the 34-day sample.

## Reproduce
- `python3 apps/gex/research/swing-system/vreclaim_exit_opt.py`
- Frozen entries via `operator_eye.compute_signals` + `openable`; real UW 1-min option prints cached in
  `pipeline/prices_v0/`; grid, paired bootstrap, LOO, WF halves, random control all inline.
- Outputs: `vreclaim_exit_opt_results.json` (full grid) + `vreclaim_best_events.jsonl` (160 TP+100 events
  for the node-terrain viewer; `minute`/`exit_minute` are UTC HH:MM, `kind:"vr"`, `implied:"up"`).
