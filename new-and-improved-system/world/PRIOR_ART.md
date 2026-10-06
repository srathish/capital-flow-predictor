# Prior art for the bottleneck screen and node graph (research scan 2026-10-06)

## What already exists

- **Nobody has publicly shown a full "growth spreads through the economy" model that beats simple baselines out of sample.**
  The pieces exist separately.
- **Situational Awareness LP** reasons along the bottleneck chain by hand (compute → power → grid). Concentrated, about 24–42
  names. It is narrative evidence from one fund in one regime, not validation.
- **Goldman's 4-phase AI baskets** are hand-picked: Phase 1 NVDA, Phase 2 infrastructure, Phase 3 AI revenue, Phase 4
  productivity. They are a prior on which nodes light up in which order.
- **FactSet's supply-chain momentum study** uses Revere data, 27k companies, 2003–2019. It pushes momentum up to 4 links
  deep, weighted by network centrality. It is a vendor study with no out-of-sample test and no costs.
- **Graph-neural-network stock models** (qlib, RSR, HIST, MASTER, THGNN) are price-only, with no costs. BSIC's walk-forward
  test (2018–2025, 10bp costs):
  - plain Ridge regression: rank IC 0.029, Sharpe 0.61
  - graph neural networks: about 0.010 IC and negative returns
  - a random graph beat the real one
- **Extraction tools:**
  - edgartools: XBRL and filings
  - edgar-crawler: 10-K item text
  - FinReflectKG: LLM-built knowledge graph. About 65% rule compliance, so LLM-extracted links are noisy.

## What the academic record says

| Finding | Status |
|---|---|
| Customer → supplier return momentum (Cohen & Frazzini 2008, >150bp/mo) | **Decayed.** Not significant after publication (Pinchuk 2023) |
| Supplier/customer *industries* predict each other, links from BEA input-output tables (Menzly & Ozbas 2010) | Weaker where analysts cover heavily |
| Technology links from patents (Lee et al. 2019, 117bp/mo) | Links also predict **fundamentals** (earnings, revisions) |
| Shared analyst coverage (Ali & Hirshleifer 2020, 1.68%/mo, t 9.7) | **Absorbs** industry, customer, supplier and technology link effects |
| Big-firm returns lead small-firm returns within an industry (Hou 2007) | Edge sits in small, neglected names |
| Industries lead the market (Hong, Torous & Valkanov 2007) | **Mostly failed replication** (Tse 2015) |
| "Tail wags the dog" (Mgmt Sci 2013) | Multi-segment giants create **spurious** cross-industry lead-lag. This explains our MU ← Capital One link |
| Earnings **acceleration** (He & Narayanamoorthy 2020) | About 1.8% the first month, positive in 140 of 176 quarters. Supports our acceleration term |
| Gross profitability (Novy-Marx 2013) | Supports the margin term and the "negative gross margin a year ago" rule |
| Post-earnings drift (Martineau) | **Gone** in large caps since 2006, and now in microcaps too |
| Supply-chain shocks hit customers' sales (Barrot & Sauvagnat 2016) | **Links are real in fundamentals.** Whether prices are slow to react is the open question |
| ML stock forecasts (Gu, Kelly & Xiu 2020; Avramov et al. 2023) | Profits concentrated in microcaps and distressed stocks, and erased by costs |
| Publication decay (McLean & Pontiff 2016) | About 26% lower out of sample, about 58% lower after publication. New factors need t > 3 (Harvey, Liu & Zhu) |

## Design changes this implies

1. **Only allow links that exist economically.** Restrict industry → industry edges to real supply flows in the BEA
   input-output tables, then learn the lags only on those edges.
2. **Overlap-robust statistics.** Year-over-year growth sampled every quarter overlaps, which inflates t-stats. Use
   autocorrelation-robust standard errors (≥ 4 lags). Add a **time-shuffle placebo**: shuffle years, re-learn, and count how
   many edges survive by chance.
3. **Harder baselines:**
   - the company's own acceleration
   - its own industry's lagged acceleration
   - the v5 screen
   
   If the graph can't beat those, it's rediscovering one generic "slow information" effect.
4. **Report results by company size**, excluding microcaps, after costs.
5. **Best use:** add the graph forecast as an extra input to the bottleneck screen, not as a standalone strategy.

## Free data we are missing (ranked)

1. **Taiwan monthly revenue (MOPS/TWSE).** About 1,900 companies (TSMC, Quanta, Wiwynn, Delta: the whole AI hardware chain)
   report every month within 10 days, about a month ahead of US quarterly filings. https://data.gov.tw/en/datasets/18420
2. **Korea exports** (10- and 20-day and monthly, with a chips line): near real-time memory demand.
3. **SEC major-customer disclosures:** `ConcentrationRiskPercentage1` × `MajorCustomersAxis`. Free and point-in-time, but only
   in the Financial Statement & Notes data sets, not companyfacts. Customer names are often anonymized.
4. **Hyperscaler capex guidance** from 8-K earnings releases. It leads the reported capex we already have.
5. **Census international trade by HS code** (monthly): 8504 transformers, 8471 servers, 8541/8542 chips.
6. **BEA input-output tables** and **Hoberg-Phillips text-based industries and vertical links** (free, yearly, point-in-time).
7. **Patents:** PatentsView plus the KPSS patent-to-firm match, for technology links.
8. Paid / no free history: DRAM/NAND contract prices (DRAMeXchange), customs bills of lading (Panjiva), credit-card and job-posting panels.
