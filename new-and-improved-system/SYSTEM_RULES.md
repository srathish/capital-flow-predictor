# SYSTEM RULES — what the shadow book says to trade (v1, 2026-10-02)

> ⚠️ **2026-10-03: RESULTS BELOW ARE PENDING RE-VALIDATION.** The live-runner regression found a backtest bug: the daily
> history was stitched from four 20-day windows, which dropped ~8 trading days per quarter from the calendar and computed the
> trend filter's EMA50 from ~20 closes early in each period. Fixed in `shadow/stock*.mjs`; the full validation (original 10,
> new 10, all 3 periods) is re-running via `shadow/run_revalidate.sh`. Rules are frozen — nothing will be re-selected.

Evidence base: 10 large caps (AAPL NVDA AMZN META GOOGL AMD TSLA AVGO ORCL MSFT), weekly options priced on REAL 1-min contract bars,
$1k premium per trade, three periods: Jan–Mar 2026 (holdout), Apr–Jun, Jul–Sep. Code: `shadow/stock.mjs`, `shadow/stock2.mjs`.

## What does NOT work (retired)
| idea | result |
|---|---|
| Bounce off nodes (floor long / ceiling short / rug / reverse rug) — the original map rules | **746 trades, −$37,723, lost in all 3 periods, t≈−2.8** |
| Shorting ceilings | the single biggest loss source (stopped out as price broke through, avg −50%) |
| VIX pivot as a standalone direction call | 57% vs 52% control, t<1 (`community/vix_pivot_test.mjs`) |
| Calf std-dev fade as the entry on index 0DTE | −$1,662 / −$2,442 over 2 weeks |
| Rolling floors/ceilings as a gate | helped one period, hurt the other |
| Index 0DTE with the current loop | ≈ break-even at mid, negative at worst fills (49 trades, 2 weeks) |

## The two entry rules (stocks, weekly options)
Both require **trend** (prior close > EMA20 > EMA50 for longs, mirror for shorts) and **VEX lean** (|vanna| within ±5% of spot: more above → only longs, more below → only shorts; 1.2× threshold).

**Rule 1 — Break with the trend.** At 09:35 read the weekly-expiry gamma map. When price touches a floor/ceiling/pattern node during the session, take the OPPOSITE side of the bounce, i.e. trade the break *in the trend's direction* (uptrend → calls at a ceiling being pushed through). Plan mirrored around the node: stop one major node back, targets = next nodes in the break direction, R:R ≥ 2.

**Rule 2 — Confluence.** A node setup (floor/ceiling/rug/reverse rug) is taken only if (a) a std-dev projection of a recent intraday leg — level = P0 + k·(P0 − P1), k ∈ {2, 2.25, 2.5, 3.5, 4, 4.5}, legs from 1-min swings ≥0.10% — lands within the deflection zone of the node and fades the same way, and (b) VIX is confirmed on the right side of its rolling 5-day pivot ((5-day H + 5-day L + last C)/3; 5 consecutive 1-min closes).

## Management (both rules)
Resting limit at the node; contract = weekly expiry ≥2 DTE, ATM at the node. T1 → sell half, stop to breakeven; T2 → sell the rest. Stop = a DAILY close beyond the stop node. Exit by the close the day before expiry, max 5 trading days. One position per symbol. **Earnings blackout**: no entry if an earnings date (Tempest) falls inside the holding window.

## Results (combined system, deduped)
| period | trades | win | P&L mid ($1k/trade) | P&L worst-case fills |
|---|---|---|---|---|
| Jan–Mar 2026 (holdout) | 17 | 65% | +$2,129 | +$1,340 |
| Apr–Jun 2026 | 34 | 50% | +$4,038 | +$1,611 |
| Jul–Sep 2026 | 26 | 62% | +$3,774 | +$1,757 |
| **all** | **77** | **57%** | **+$9,941** | **+$4,708** (SQN 2.0) |

## Honest limits
77 trades / 9 months; mostly a rising market; 10 large caps only; "worst" = buy the minute's high, sell its low (real fills land between mid and worst); VEX was selected on Apr–Sep and judged on Jan–Mar. **Next gate: forward shadow on live data (2–4 weeks, intended orders logged, none sent)** before any capital.
