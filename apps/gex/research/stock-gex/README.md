# Stock-GEX swing study — screen without Skylit, then forward-poll only the winners

Extends the GEX node-pattern system (king-floor, node-flip — the "Glitch model")
from 0DTE indexes to **individual stocks on weekly/monthly options, held over
days** (swing, not 0DTE). Weeklies decay far slower than 0DTE, so the same
directional node edge monetizes better — this sidesteps the theta wall that
capped the index program.

## Why this design

Two constraints shaped it:

1. **Skylit only retains ~2–3 months of history** (verified 2026-07-16: HOOD data
   exists back to ~mid-May, gone by mid-April). So a 6-month *backtest* is
   impossible. We **collect forward** instead — which is strictly better: a forward
   study can't be tainted by hindsight, the exact flaw that inflated every index
   backtest.
2. **Never over-poll Skylit.** We do NOT poll the 500-ticker universe. A cheap,
   broad **UW screen (no Skylit)** picks the handful of names worth watching, and
   we poll Skylit **only for those**.

```
  screen.mjs  ──(UW only, no Skylit)──▶  candidates.json  ─┐
  pinned.json (HOOD, GOOG archetypes) ────────────────────┼─▶  poll.mjs ──▶ data/snapshots.jsonl
                                                           │    (Skylit aggregate GEX, RTH, ~30-min)
                                          (bounded: ~10 names × ~13 polls/day)
```

## The 0DTE-vs-swing data distinction (critical)

- **0DTE** uses column 0 of Skylit `GammaValues` (nearest expiry) — the index system.
- **Swing** uses the **AGGREGATE = sum across ALL expirations** — that's what
  `poll.mjs` stores (`g`, `v` per strike are summed over all 12 expirations). The
  further-out monthly nodes are where the multi-day dealer magnets live.

## Components

| File | Role |
|---|---|
| `screen.mjs` | Non-Skylit UW screener → ranks liquid, trending, unusually-active large-caps → `candidates.json`. Run `node research/stock-gex/screen.mjs [N=8]`. |
| `pinned.json` | Reference archetypes always polled (HOOD = operator's pick; GOOG = Glitch's king-floor name). |
| `poll.mjs` | Pulls Skylit **aggregate** GEX/VEX for the basket, appends to `data/snapshots.jsonl`. Run `node research/stock-gex/poll.mjs` (add `--rth-gate` for scheduled runs). |
| `com.bellwether.stock-gex-poll.plist` | launchd job: fires every 30 min; `--rth-gate` self-limits to weekdays 09:30–16:00 ET. |

## Screen criteria (candidate selection, NOT the GEX analysis)

Gates: Common Stock only, price $15–700, total OI ≥ 300k (tight spreads), mktcap
≥ $20B, implied move 2–15% (moves enough to swing, not a lottery ticket).
Composite score: liquidity 0.28, directional conviction 0.22, trend 0.22,
unusual-activity 0.12, move 0.08, UW-gamma-regime hint 0.08.

> **Doctrine:** the GEX/VEX *analysis* comes from **Skylit, never UW**. UW's own
> `gex_*` fields are used only as a weak *selection* hint (regime shifting = a
> possible node-flip). See memory `feedback_gexvex_source_skylit`.

## Snapshot schema (`data/snapshots.jsonl`, one line per ticker per poll)

`{ ts, ticker, spot, exps, band, nodes:[{k,g,v}], king, floor, ceiling, accel_below, accel_above, vmag }`
where `g`/`v` are **aggregate** gamma/vanna in $M; `king` = biggest |node|; `floor`
= strongest pika below spot (support); `ceiling` = strongest pika above (resistance);
`accel_*` = strongest barney below/above (acceleration/squeeze fuel); `vmag` = biggest vanna magnet.

## Patterns to test (once data accrues — same rigor as the index v2)

- **king-floor**: king pika BELOW spot acting as support → bounce long (Glitch GOOGL +371%).
- **node-flip**: king/node changing sign or the king flipping side → directional (Glitch GOOG +211%).

Test with: **mirror control** (does a king-floor bounce beat a phantom level? — the
test that killed every static index node idea), **real bid/ask fills** on the
weekly/monthly option, **walk-forward**. Fold in the one dynamic signal that
survived the index program: **vanna-velocity**.

## Status

- 2026-07-16: pipeline built + verified. First basket: AAPL NFLX GOOGL IBM ORCL
  SOFI CRWD MSFT (screened) + HOOD GOOG (pinned). Forward collection begins on
  schedule load. Basket is **frozen** for the study window so every name gets full
  history; re-run `screen.mjs` only to start a new cohort.
