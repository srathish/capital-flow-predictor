# 0DTE gamma breadth at 10:30 → rest-of-day range, fresh-window replication (locked 2026-11-11, before any board pull)

Why: the King-geometry audit found that the number of front-expiration strikes carrying meaningful gamma at 10:30 ("breadth")
predicted the rest-of-day range at t +6.0 on build (2025-05 → 2026-03) and fully absorbed the King-share effect. That variable was
found by the audit, not pre-registered, and the only holdout window on hand (2026-04 → 2026-10) has been used. This design tests
breadth once, on a window no test has touched, with the hypothesis and bar fixed first.

## Hypothesis

H: more strikes carrying ≥ 1% of the King's |gamma| in the front (session-date) expiration at 10:30 → **larger** rest-of-day
range (log high−low 10:31–15:59 / spot), after lnVIX (prior close), first-hour range, prior-day EOD gamma balance and 20-day
mean range. Size only; direction control required.

## Data (to be pulled only after this file is committed, and only with the user's approval of the credit spend)

- Skylit `/v1/historical` at 10:30 ET, `symbols=SPXW,SPY,QQQ`, `maxStrikes=200`, `maxExpirations=5`, `layout=matrix`, one call per
  SPY session **2024-01-02 → 2025-04-30** (≈ 330 calls × 5 ≈ 1,650 credits), cached at `.cache/skylit_boards_1030/`. Same provenance
  caveat as before (today's API history).
- UW 1-minute bars, prior-day `gex_strike`, Cboe VIX — already cached for the window.

## Split

Build **2024-01-02 → 2024-09-30**; holdout **2024-10-01 → 2025-04-30**, one run. The 2025-05 → 2026-10 period, where the variable
was discovered, is reported afterwards as a third, descriptive slice and carries no verdict weight.

## Model and criteria

Pooled SPY+QQQ OLS, symbol dummy, SEs clustered by date: `rod ~ sym + lnVIX + fh + B_prev + m20 + breadth`, with breadth = count of
front-column strikes with |value| ≥ 1% of the King |value| (also reported: log total front |gamma|, and breadth with lntot added, to
show it is not a total-gamma proxy). Terciles set on build and frozen.

Build pass: coef > 0, clustered t ≥ 2.5, ΔR² ≥ 0.01, tercile ratio (top ÷ bottom mean range) ≥ 1.15. Holdout pass: coef > 0,
t ≥ 2.0, tercile ratio ≥ 1.10. Direction control (sign of close − 10:30 on breadth) |t| < 2 in both.

## If it passes

Breadth becomes a 10:30 update input to the range forecast (size only). A trade test, if any, is a separate design and would start
from the fact that the 10:31 straddle is likely already priced for it (cf. DESIGN_king_geometry A1, never run).

## Amendments

(none)
