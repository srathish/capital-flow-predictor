# World model — design and pre-registration (locked 2026-10-05, before any model code or results)

**Goal.** Predict which stocks will move next by modeling how shocks travel through the economy. For example: AI demand →
HBM → memory shortage → who gets hit next. It has to *predict*: it is judged only on information that was public at
the time, against simple baselines, on a period it was never tuned on.

## 1. The graph (point-in-time)

**Nodes**
- **Companies.** The desk universe (294) plus the 148 Discord tickers that have price data. The set is fixed up front.
- **Concepts.** Economic and technology exposures: products, inputs, end-markets. These come from a **fixed taxonomy written here, before modeling** (§7). The model may not add concepts later.

**Edges.** Every edge carries the date it first became public. An edge does not exist before its filing date.
- **company → concept (exposure).** How often the company's 10-K / 10-Q / 8-K filings mention the concept, from SEC EDGAR full-text search, per calendar quarter, normalized by the company's filing count.
- **company → company (relationship).** Company A's filings name company B (customer, supplier, partner or competitor), from EDGAR full-text search on B's name.
- **Weights decay** if the mention stops appearing. Last value carried forward for at most 4 quarters.

**Data.** SEC EDGAR is free and dated. UW provides earnings, analyst actions, insiders and daily prices, all dated. **Skylit: 0 credits.**

## 2. Shocks (what changed this month, known at month-end)

For each company at month-end *t*, from data dated ≤ *t*:
- **Earnings surprise** of the latest report: (actual − estimate) ÷ price, as a z-score within the month's cross-section.
- **Analyst revision breadth:** price-target raises minus cuts in the last 60 days, as a z-score.
- **Price momentum:** the 1-month and 3-month return, as z-scores.

**Concept shock.** The exposure-weighted average of its companies' shocks. A concept "heats up" when the companies most exposed to it are surprising and being revised up.

## 3. Propagation and simulation

Impact on company *i* = Σ over concepts c: exposure(i,c) × shock(c) + Σ over related companies j: link(i,j) × shock(j), with each term lagged.
- **Uncertainty.** Edge strengths and lags are unknown, so they are drawn **10,000 times**:
  - weights multiplied by lognormal(0, 0.5) noise
  - lags uniform over 0–2 quarters
  - two hops allowed, with the second hop damped by U(0.2, 0.6)
- **Output per company:** the mean impact and P(impact > 1 sd).

**Priced in.** The company's own 3-month return percentile. **Score = P(impact > 1 sd) × (1 − own 3-month percentile)**. That is: strongly hit by the snowball, but hasn't moved yet.

*Fixed before results:* the 2-hop limit, the noise distributions, the 1 sd threshold, and the score formula. None of them gets tuned.

## 4. Prediction and scoring

- Every month-end, the model outputs its **top 20** companies.
- **Target:** the 6-month forward return minus the universe **median**.
- Secondary target: the next-quarter analyst revision (does the model see fundamentals coming?).
- **Metrics:**
  - top-20 mean excess
  - rank correlation between score and forward return (mean monthly IC, t-stat)
  - per-symbol win/loss count

## 5. Baselines it must beat

| Baseline | What it is |
|---|---|
| **Momentum 12-1** | Top 20 by 12-1 return |
| **Hot theme** | Top 20 from themes ≥ 95th percentile (the S1 "snowball") |
| **Shock only** | The same company shocks with no graph, i.e. buy the companies surprising now. This isolates the graph's contribution |
| **Random** | 20 stocks drawn from the same sectors, 1,000 draws |

## 6. Protocol

- **Development:** month-ends 2023-01 → 2024-12. Code may be debugged here, but **parameters are fixed in §3** and are not tuned on results.
- **Holdout:** month-ends 2025-01 → 2026-03 (6-month forwards end by 2026-09). Run **once**.
- **PASS** (all three must hold on the holdout):
  1. Top-20 excess > every baseline.
  2. Mean IC > 0 with t ≥ 2.
  3. Per-symbol win > loss.
- **Kill switch:** if it fails, the world model is not scaled up. The result is reported as is.
- **Live log:** from now on, every month's top 20 is saved with a date and scored 6 months later.

## 7. Concept taxonomy (fixed now; generic, not tuned to known winners)

*Hindsight risk:* I know today which themes won. To limit that bias, the taxonomy covers the broad economy, with losing and quiet themes listed at the same level of detail as AI.

**Compute and semis**
- GPU · accelerator · CPU · custom ASIC
- DRAM · NAND · high bandwidth memory · flash storage · hard disk drive
- advanced packaging · wafer · lithography · EUV · etch · deposition · semiconductor test · foundry
- analog semiconductor · power semiconductor · silicon carbide · gallium nitride

**Data center and networking**
- data center · hyperscale · cloud computing · colocation
- optical transceiver · fiber optic · Ethernet switch · InfiniBand
- liquid cooling · server · rack

**Power and energy**
- electricity demand · power purchase agreement · natural gas turbine · nuclear power · small modular reactor · uranium
- grid · transformer · battery storage · solar · wind
- oil · natural gas · LNG · refining

**Crypto**
- bitcoin mining · hashrate · digital assets · stablecoin

**Software and AI**
- artificial intelligence · large language model · inference · AI agents
- cybersecurity · SaaS · subscription

**Consumer and health**
- smartphone · personal computer · automotive · electric vehicle · autonomous driving
- GLP-1 · obesity · biosimilar · vaccine · medical device

**Industrial and materials**
- defense · satellite · launch vehicle · drone · aerospace
- tariff · rare earth · copper · lithium · steel · construction

**Macro and finance**
- interest rate · mortgage · credit card · consumer spending · housing
- restaurant · travel · advertising · e-commerce · freight · shipping

## 8. Known risks (stated, not hidden)

- **Survivorship.** The universe is today's popular names. Delisted losers are missing, which flatters every strategy, baselines included.
- **The taxonomy is still mine.** Mitigated by its breadth and by the shock-only baseline. If the graph only "works" through AI concepts, that will show in the per-concept breakdown.
- **Mentions are not dependence.** A filing can mention a concept as a risk factor rather than as revenue. This adds noise; it does not add look-ahead.
- **Small effective sample.** About 15 holdout month-ends with overlapping 6-month windows. Only a strong result counts.
