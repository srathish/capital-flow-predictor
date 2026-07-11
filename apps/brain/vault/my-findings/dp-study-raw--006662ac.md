---
title: Dp Study Raw
source_url: repo://apps/gex/research/darkpool/out/DP_STUDY_RAW.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T19:10:43Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- dark-pool
- flow
summary: '== deflection rate: real DP levels vs placebo == | kind    | lookback   |   touches |   deflect_% | |:--------|:-----------|----------:|------------:| | real    | lb1        |       479 |        57.8 | | real    | lb5        |       590 |        59.5 | | placebo | lb1        |      1282 |       …'
url_sha1: 006662ace2579bdff22f8d9f90d80f49ff6cf954
simhash: '10781245232112262980'
status: vault
ingested_by: seed
---

== deflection rate: real DP levels vs placebo ==
| kind    | lookback   |   touches |   deflect_% |
|:--------|:-----------|----------:|------------:|
| real    | lb1        |       479 |        57.8 |
| real    | lb5        |       590 |        59.5 |
| placebo | lb1        |      1282 |        57.8 |
| placebo | lb5        |      1457 |        55.1 |
real 58.7% vs placebo 56.4%  (Mann-Whitney p=0.1834)

== by approach direction (real levels) ==
| approach   | kind    |   touches |   deflect_% |
|:-----------|:--------|----------:|------------:|
| support    | real    |       517 |        60   |
| support    | placebo |      1375 |        62.1 |
| resistance | real    |       552 |        57.6 |
| resistance | placebo |      1364 |        50.6 |

== by notional tercile (real levels only) ==
| notional   |   median_$B |   touches |   deflect_% |
|:-----------|------------:|----------:|------------:|
| small      |        0.15 |       366 |        58.7 |
| mid        |        0.28 |       347 |        60.5 |
| large      |        0.73 |       356 |        57   |

== by ticker (real vs placebo) ==
| ticker   | kind    |   touches |   deflect_% |
|:---------|:--------|----------:|------------:|
| SPY      | real    |       477 |        60.2 |
| SPY      | placebo |      1235 |        60.5 |
| QQQ      | real    |       592 |        57.6 |
| QQQ      | placebo |      1504 |        53   |

== fires (SPY/QQQ, n=847) near a DP level (≤10bps) vs not ==
| near_dp_level   |   n |   optEV_% |   win_% |
|:----------------|----:|----------:|--------:|
| True            | 293 |      21   |    49.8 |
| False           | 554 |       5.6 |    45.5 |
