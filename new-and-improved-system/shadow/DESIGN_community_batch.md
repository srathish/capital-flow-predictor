# Community batch (Discord thread 10-02 → 10-14 + community repo) — locked 2026-10-15, before any engine is written

Five ideas from the community, tested on data already cached. 17 registered hypotheses, one Benjamini–Hochberg family
(q = 0.10, one-sided, holdout). **Build** = data up to 2025-03-31; **holdout** = 2025-04-01 → 2026-10-02. A hypothesis is
**validated** if its holdout one-sided p passes BH across all 17 with the predicted sign; build numbers are reported.
Minute-bar handling (missing minutes filled, bad-print wicks clipped, $0.01 per share per side) is copied from the
audited trade-factory / vwap_node engines. Research only — nothing live changes.

## Part P — post-breach premium selling (shinmoon / ACCE "sigma IC", 10-11 → 10-14)
Claim: after a day that breaches its sigma / ATR with heavy volume, the next day is quieter, so a 1-day iron condor
sold near the close of the breach day pays (claimed ~80% win, ~$88 EV per contract, 5-year backtest).
Trades: the T1 one-day SPY/QQQ trades of DESIGN_real_straddle.md / DESIGN_iron_fly.md — sold at the close of day d−1,
expiry d, settled at intrinsic on d's close (bodies at the bid, wings at the ask; the same cached prices):
- **S** = ATM straddle (return = P&L ÷ premium);
- **F** = ±1% iron fly (return = P&L ÷ max risk);
- **K** = iron condor: sell the ±1% call/put at the **bid**, buy the ±2% call/put at the **ask** (strikes round(px × (1 ± w)),
  as collected; return = P&L ÷ max risk, max risk = max(call spread width, put spread width) − credit).
Breach on the entry day d−1 (known at its close):
- **B1** = |ln(close(d−1) ÷ close(d−2))| ≥ 2 × implied daily σ, implied daily σ = VIX (SPY) / VXN (QQQ) close of d−2 ÷ 100 ÷ √252;
- **B2** = high − low of d−1 ≥ ATR14 (Wilder, through d−2) AND volume of d−1 ≥ mean volume of d−21 … d−2.
| id | statement (holdout, one-sided) |
|---|---|
| P1–P3 | S / F / K return is higher on B1 days than other days |
| P4–P6 | S / F / K return is higher on B2 days than other days |
| P7 | B1 adds to the gamma signal: S return regression on B1 dummy + ±1% gamma balance (A01, d−1) |
| P8 | same with B2 |
Test: pooled regression of the return (winsorized 1/99 per structure over the full sample) on the dummy with a ticker
effect, Driscoll–Kraay lag 5 (as real_straddle.mjs). Days missing any needed leg are dropped (counts reported).
Caveat: the T1 holdout was already looked at for the straddle and fly (2026-10-11, 10-14) but never by breach state.

## Part R — runner management (DashingBixby, 10-10)
Claims: "3R inside 20 min → P(≥6R) ≈ 0.5; over 60 min → ≈ 0.3"; for SPY reactions, "QQQ hits 3R first … confirmed SPY
P(≥6R) 0.40 vs 0.25".
Events: VWAP ±1σ and ±2σ band rejections on SPY and QQQ with **no node condition and no target** — exactly the
vwap_node.mjs signal (touch, a close back inside within 5 minutes, entry at that close, stop beyond the extreme
+0.03%), 09:45–15:30 entries, one per band-side-day. R = |entry − stop|. Path followed on 1-minute bars to 15:55.
"Reaches 3R / 6R" = the high (long) / low (short) reaches entry ± 3R / 6R before the original stop is touched (stop
checked first in a bar). Minutes to 3R counted from the entry minute.
| id | statement (holdout, one-sided) |
|---|---|
| R1 | among events reaching 3R, P(reach 6R) is higher when 3R came within 20 minutes than when it took > 60 minutes |
| R2 | same, ≤ 20 minutes vs > 20 minutes |
| R3 | SPY events reaching 3R: P(reach 6R) is higher when **confirmed** — at the minute SPY reaches 3R, QQQ's return since the SPY entry minute, in the trade's direction, is ≥ SPY's — than when not |
| R4 | same for QQQ events confirmed by SPY (the post calls this direction hindsight; registered to check) |
Test: difference in proportions, day-clustered standard error. Also reported (not registered): the R outcome of the
management rule "exit at 3R unless fast / confirmed, then hold for 6R" vs "always exit at 3R".

## Part L — lunch fade (Da_cards, 10-06)
At 11:30 ET fade the 10:00 → 11:30 move, exit at 13:30. Reference = close of the 09:59 bar, entry = close of the 11:29
bar, exit = close of the 13:29 bar; direction = −sign(move); return = direction × (exit ÷ entry − 1) − 0.02 ÷ entry.
SPY, QQQ, IWM, DIA pooled (claim was SPY; the four are reported separately too).
| id | statement (holdout, one-sided: mean return > 0, day-clustered) |
|---|---|
| L1 | every day |
| L2 | days with |move| ≥ 0.25% |
| L3 | days with |move| ≥ 0.50% |

## Part E — ESB_q (mtmtempo, community repo, ES 15-minute reclaim), scaled to SPY / QQQ
15-minute bars built from RTH 1-minute bars (09:30–16:00, 26 per day), indicators continuous across days (RTH only —
we have no ES overnight; stated limit). Pivot = a bar whose high (low) is strictly above (below) the 5 bars on each
side, known 5 bars later. A newly confirmed pivot pairs with the latest earlier opposite pivot: zero = that earlier
pivot, one = the new one, U = |one − zero|; the leg is valid if U ≥ Wilder ATR14 at the confirmation bar and U ≥ 0.065%
of price (the 5 ES-point minimum scaled). The newest valid leg is the active one; each leg is used once; legs never
expire. Entry: down leg → long when price reaches zero; up leg → short when price reaches zero; trigger 15-minute bar
starting 09:30–15:45; the prior 15-minute close above EMA50 (long) / at or below it (short); one position at a time.
**Fills on 1-minute bars** (fixes the original's same-bar optimism): entry at zero in the first minute that reaches it
(at the minute's open if it opened beyond zero); stop at one; ratchet from completed 15-minute bars — best excursion
≥ 0.25U moves the stop to zero, then the stop trails 0.25U behind each further completed 0.25U step; target 2.5U; stop
checked before target within a minute; flat at 15:59. R = P&L ÷ |entry − one|, minus $0.02 per share ÷ that risk.
| id | statement (holdout, one-sided: mean R > 0, day-clustered) |
|---|---|
| E1 | current policy (ratchet + 2.5U target), SPY + QQQ pooled |
| E2 | original policy (ratchet only, no target) |

## Run discipline
One engine per part (community_P.mjs, community_R.mjs, community_L.mjs, community_E.mjs) writing per-hypothesis
rows to results_community/; a small combiner applies BH across the 17 and writes summary.md. Smoke tests, independent
audit against this file, then one run each.

## Amendments
**Amendment 1 (2026-10-15, while writing engines, before any full run).** (a) The lunch-fade smoke test printed the
L1 mean for the last 60 days (inside the holdout: +0.06% per trade, t 2.1, 239 trades). Nothing was changed because
of it; it is disclosed here. Later smoke tests print counts only. (b) ESB_q: the ratchet ladder and the 2.5U target
are measured from `zero` (the spec's wording) rather than from the fill price; they differ only on gap entries.
