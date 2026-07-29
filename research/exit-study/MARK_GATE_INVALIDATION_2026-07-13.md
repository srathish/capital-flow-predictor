# Mark-gating the structure-invalidation exit: does it stop the winner-cutting?

**Date:** 2026-07-13 · **Mode:** RESEARCH ONLY (Clause 0 — no live-code; any change → DECISIONS NEEDED)
**Question:** The structure-invalidation exit (pin-forming / opposing-anchor-hardening) closes plays regardless of profit and preempts the trail. Confirmed winner-cutting (MFE ≫ realized). Test MARK-GATING it: only let it close a play when the option mark is **not** meaningfully in profit (mark ≤ +Y% off entry; Y = 0 / +25 / +50). Held plays fall through to the existing trail (arm +50%, 15% giveback) → EOD.

**Answer up front — the hypothesis FAILS.** Mark-gating does **not** beat baseline out-of-sample, and the registered direction is **backwards**:
- **Y=0** (hold whenever profitable): portfolio **wash** (−9% vs −9%; on the 12 held legs +38%→+38%, Δ0). Median slightly worse.
- **Y=25 / Y=50**: strictly **worse** (−13% / −12% vs −9%).
- The good news half holds: mark-gating **never touches a losing play** (14/26 were flat/losing at trigger and close identically), so it provably **cannot let losers bleed further**. It just doesn't help the winners.

The intuition "never let structure-invalidation close a play up ≥Y%" is refuted because **plays that are already up a lot at the trigger are already near their peak** — the structure exit is a *good* peak-seller on them, and the loose 15%-giveback trail (+ 0DTE decay to EOD) gives back **more** than the structure exit captured. The higher Y is, the more selectively you hold exactly those near-peak winners → the worse it gets.

---

## Data & method
- Source: `apps/gex/data/gexester.db` → `tracked_plays`, **26 legs** closed `closed_structure_invalidated`, **3 days** (2026-07-09 n=4, 07-10 n=11, 07-13 n=11).
- **Mark at structure trigger = `close_mark`** (the tracker records the mid at the moment it closed the play). So `(close_mark−entry)/entry` is both the current realized *and* the profit% the mark-gate sees at trigger.
- **Full post-exit path:** UW `/api/option-contract/{sym}/intraday?date=` (1-min; `close` as mark proxy — the endpoint has no bid/ask mid). All 26 contracts returned data; **User-Agent not required** on this key (fetched clean at 200).
- **Held-exit model:** suppress the structure exit when `profit% > Y`; then walk minute closes from fire→EOD tracking the running peak, apply the live trail (arm once peak ≥ entry×1.50, exit if close ≤ peak×0.85), else exit at the **last regular bar (EOD/expiry proxy)**. This is exactly the live loop with the structure branch gated off (`apps/gex/src/tracker/plays.js:334`).
- **Fill haircut:** 5% applied to every held (counterfactual) exit fill. Current-exit realized is the tracker's own recorded `close_mark` (unhaircut). Removing the haircut lifts held numbers a few points and does not change any verdict.

## Portfolio results (equal-weight per leg, n=26)

| Exit rule | avg realized | median | held legs | on held legs: cur → mg |
|---|---:|---:|---:|---:|
| **CURRENT** (structure exit fires always) | **−9%** | −4% | — | — |
| Mark-gate **Y=0** | −9% | −6% | 12/26 | +38% → +38% (Δ 0) |
| Mark-gate **Y=25** | −13% | −4% | 6/26 | +67% → +49% (Δ −18) |
| Mark-gate **Y=50** | −12% | −4% | 3/26 | +94% → +66% (Δ −28) |

## Walk-forward by day (avg realized %)

| day | n | CUR | Y=0 | Y=25 | Y=50 |
|---|--:|--:|--:|--:|--:|
| 2026-07-09 | 4 | +36 | +35 | +28 | +30 |
| 2026-07-10 | 11 | −9 | **−5** | −11 | −10 |
| 2026-07-13 | 11 | −25 | −29 | −30 | −30 |

Only 7/10 at Y=0 improves (driven by 3 legs cut at +2/+2/+6% that then ran into the trail). 7/09 and 7/13 are worse at every Y. **No consistent OOS edge.**

## Why it fails — the mechanism
- **Losers are untouched, correctly.** 14/26 legs were flat/losing at the trigger (−81, −72, −87, −90, −94, −68, −53, −51, −37, −25, −18, −6, −6, −3%). The mark-gate holds *none* of them (verified: no loser is held at any Y). So it cannot make the downside worse — but it also means the structure exit was **not** the P&L bleeder people assumed. On these 26 legs current realized is −9% (not the −21% headline, which was all-plays); the −9% is carried by legitimately bad **bear/counter-trend entries**, not by cut winners.
- **The 12 "winners" cut at a profit are already near peak.** Their `best_pct` barely exceeds `atTrigger%` (e.g. #144 +88% at trigger vs +90% best; #157 +84 vs +108; #161 +109 vs +136). Holding them into the +50%-arm / 15%-giveback trail *gives back* the 15% (plus more, plus haircut) → e.g. #144 88→64, #161 109→56, #157 84→77. The structure exit sold these **near the local top**.
- **Selective-hold makes it worse, not better.** Raising Y filters the held set down to *only* the biggest-profit-at-trigger legs — exactly the near-peak ones that give back most — while closing the small-profit legs (#150 +2%, #155 +2%, #154 +6%) that actually had room to run. That's why Y=25/50 underperform Y=0 and baseline.
- **Counterexample the exit gets RIGHT:** #159 (QQQ 0DTE call, cut at +11% at 15:31) would have **collapsed to −84% by EOD** if held (peak never re-armed +50%, no trail, rode to expiry). The structure exit saved it.

## The winner-cut IS real — but it's an exit-*capture* problem, not a gate problem
Held winners (Y=0 set, n=12) hindsight ceiling (dayHigh **after** our exit): **avg +131%** (#161 ran to +348%, #165 +252%, #146 +198% after exit) vs the trail only realizing **+38%** — the same as the structure exit already got. So the MFE left on the table is large and real, but the **existing +50%-arm / 15%-giveback trail cannot monetize it** on 0DTE (fast decay + whip round-trips the giveback). Mark-gating routes winners into a trail that is too loose to help. Fixing the winner-cut requires a **better/tighter 0DTE exit-capture rule**, not a mark condition on the structure trigger.

## Exploratory (not registered): a LOW mark *band* is the only thing that nudges avg up
Holding only *modest*-profit legs (opposite of the registered direction):

| band held | avg | median |
|---|---:|---:|
| hold if 0% < p ≤ 25% | −5% | −6% |
| hold if 0% < p ≤ 50% | −6% | −6% |
| hold if p > 25% (registered spirit) | −13% | −4% |
| CURRENT | −9% | −4% |

The 0–25% band improves the *average* +4pt but the *median* is worse, it rests on ~3 legs from one day, and it is the reverse of the hypothesis. Not robust; not shippable on this evidence.

## VERDICT
**Do NOT mark-gate the structure-invalidation exit.** It is a wash at Y=0 and worse at Y=25/50 out-of-sample; the registered "hold plays up ≥Y" direction is backwards. The structure exit is a competent near-peak seller on winners and (importantly) never the cause of the deep losers. **Keep the exit as-is** (and keep STOP-30 from the sibling study, which protects the loser tail).

## Caveats (honest)
- **Very tiny n:** 26 legs, 3 days, one day (7/13) supplying 11. Any single big leg (#161) moves buckets.
- **Mark proxy:** intraday endpoint has only trade-price minute `close`, no bid/ask mid; entry is the tracker's mid. On penny contracts % swings are noisy. Held-fill 5% haircut applied; conclusion is haircut-insensitive.
- **Held-exit rule = trail-or-EOD.** A held winner might have state-cleared earlier in the live world; not reconstructible from the option path. If anything that would *cap* upside further, not rescue the gate.

## Scope note — why not reconstruct triggers on the Skylit replay at scale
`apps/gex/scripts/replay-fires.js` + `skylit-archive/intraday` (64 days) **can** reconstruct *when* `evaluateSurfaceExit` fires historically. But **Skylit serves no option quotes** — the replay explicitly has no option marks (its own header says so). The mark-gate is intrinsically a comparison of the option mark to entry, so it can only be evaluated where option marks exist: the **live, UW-quoted set** used here. Reconstructing trigger timing across 64 days would tell us *when* it fires but not *what the option was worth*, which is the whole question. Scope is therefore correctly limited to the 26 live legs + dayHigh-after; stated explicitly per the honesty requirement.

## DECISIONS NEEDED
1. **Winner-cut is real in MFE (+131% ceiling vs +38% captured) but unmonetizable by the current trail.** The productive next experiment is a **tighter 0DTE exit-capture rule** (e.g. giveback 5–8% instead of 15%, or a fixed profit-lock ladder), tested as a *replacement for / addition after* the structure exit — NOT a mark-gate on the trigger. Flag for a follow-up study.
2. Re-run this once ≥10 trading days of structure-invalidation legs exist; 3 days cannot settle it.
