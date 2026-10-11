# 200 trade ideas — scored on trade P&L (locked 2026-10-11, before any engine or price pull for parts A and B)

Registry: `ideas200.json` (from `ideas200_registry.mjs`). Supersedes DESIGN_bigmover_straddles.md and DESIGN_vwap_node.md
(same mechanics, more variants). Every idea is "this trade makes money", judged against a control, on an untouched
holdout, with Benjamini–Hochberg q = 0.10 **within each part** (A, B, C), and the overall count reported.

## Part A — VWAP band × gamma node (96), SPY / QQQ / IWM / DIA, 2023-11-09 → 2026-10-02
Mechanics exactly as DESIGN_vwap_node.md, with: bands k ∈ {1, 1.5, 2, 2.5}σ; side short / long / both; target VWAP / 2R;
node type on the band (within 0.10%): STRONG (|γ| ≥ 50% of the day's king, d−1), KING (the d−1 king), WALL (largest
call-gamma strike above the d−1 close for the upper band; largest put-gamma strike below for the lower band); plus 24
STRONG-node rules restricted to days with the idea-factory G23 z above its build median ("GAM").
Validated: holdout (2025-04-01 →) BH within A, mean R > 0, beats its no-node twin (difference t ≥ 1.65), beats ≥ 19/20
random-level twins. Build 2023-11-09 → 2025-03-31.

## Part B — long options on predicted big movers (60), real UW prices
Weekly panel of the short stock factory (300 stocks as of 2023-10-31). Each week, top 10 by each of 15 signals (features
known at that close; "neg" = lowest values; S36up / S36dn = weekly return > +10% / < −10%, ranked by size). Trade: buy
the ATM call and/or put (strike nearest the raw close among strikes in that day's UW greek snapshot) on the first
standard monthly expiry ≥ 28 calendar days out, at the closing NBBO **ask**; exit at the closing NBBO **bid** after 10 or
20 trading days (intrinsic if expired). Outcome = P&L ÷ premium. **Control:** 10 random stocks per week (fixed seed),
same structure. Validated: holdout (rebalances ≥ 2025-07-01) picks' mean P&L ÷ premium > 0 AND > control's (difference t ≥
1.65, week-clustered), BH within B. Build: exits ≤ 2025-06-30.

## Part C — straddle-selling day filters (44), real SPY / QQQ prices already downloaded (DESIGN_real_straddle.md)
For each filter: mean P&L ÷ premium (winsorized 1/99) on filter days minus other days, pooled with a ticker effect,
Driscoll–Kraay lag 5. Thresholds from build-period features. **Caveat (stated in the report): the 2025-04 → 2026-10
holdout was already looked at for 6 related hypotheses on 2026-10-11, so Part C is weaker evidence; its real test is
the forward paper ledger (straddle_forward.mjs).** T1 build 2024-01 → 2025-03; T2 holdout only (no earlier intraday data).

## Run discipline
Engines self-checked against the earlier audit lists (look-ahead, splits, missing minutes, bad prints, clustering),
smoke-tested, then one run each. Research only — nothing live changes.

## Amendments
(none yet)
