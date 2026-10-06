# Live playbook — what we actually run (after the 2026-10 research program)

Every mechanical idea was tested honestly (see `world/DESIGN*.md` and `shadow/reports/`). Three things survived. Everything here is logged with dates and graded forward.

| Strategy | Command | Cadence | Evidence |
|---|---|---|---|
| **Insider open-market buys ≥ $100k → shares, 20-session hold** | `node desk/insider.mjs` | before each open | 2022–26: +3.3–4.0% per trade, Sharpe ~1.0, positive every year |
| **Copy Situational Awareness LP** (13F changes) | `node world/sa_watch.mjs` | 13F deadlines ≈ Feb 14 · May 15 · Aug 14 · Nov 14 | Holdout 2025–26: +46.8% / 6 months vs the median stock. A copier still misses ~38% of each move (13F lag). One fund, one regime |
| **Thesis engine** (AI bottleneck reasoning over a point-in-time digest) | `THESIS_TAG=<tag> node world/thesis.mjs` | monthly | **Live log only.** No backtest is possible because the model knows the past |
| **World model v5: reported-numbers bottleneck** (revenue growth + acceleration + gross-margin expansion, top 20, 6-month hold) | `node world/facts_collect.mjs --wide && node world/model_v5.mjs --wide --holdout --force` (live list in `world/v5_live/`) | monthly, after 10-Q season | Wide universe (~5,000 SEC filers) holdout 2025-01 → 2026-03: +28.7% 6m excess vs median, 15/15 months positive, vs momentum +17.3% and random 95th pct +10.4%. Fat-tailed: median pick +3.7%, without the top 5 names +13.2% |
| Thesis scorecard | `node world/thesis_score.mjs` | any time | Interim marks now; verdicts after 6 months (first: 2027-04-05) |

## What the digest contains

- **A.** Concepts companies discuss more in Business/MD&A, with 3m / 12m / 24m basket moves (what's already priced).
- **B.** Scarcity language near each concept, and who says it.
- **C.** Insider buys.
- **D.** SA LP's latest 13F.
- **F.** FRED real-world inputs: semiconductor, transformer and switchgear PPIs; electricity; natural gas; copper; aluminum; power construction.
- **G.** PJM capacity auctions.

## What we stopped doing, and why (don't re-attempt without new data)

- GEX/VEX direction, map-node bounces, A+ rubric, Rule 1. All failed out of sample; SirFartalot's ~130 tests agree.
- Options flow (UW, Skylit, Discord), analyst actions, short interest, 50 price/theme/seasonality rankers, fib/trendlines, earnings straddles.
- World models v1–v2 (keyword and filing-text graphs), v3/v4 (13F skilled-manager consensus or concentration). All lost to copying SA and to momentum.
- Fresh filings (13D, 8-K contracts, guidance). Priced at or before filing.
- Sean (SRxTrades) breakout swing system: tight base + volume breakout, low-of-day stop, EMA 8/21/50 trims (`shadow/DESIGN_sean.md`). Holdout 2025–26: +2.85%/trade (t 0.83), 23% win rate, one trade (LITE +278%) is the whole result; random entries with the same exits beat it 8.5% of the time. FAIL.
