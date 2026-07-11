---
title: Uw Deep Raw
source_url: repo://apps/gex/research/uw/out/UW_DEEP_RAW.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:10:20Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- unusual-whales
- flow
summary: == S3 EXIT GRID (real marks; entry at fire) == | rule                       |   n |    pnl |   ret |   win |   worst_rank |   avg_rank | |:---------------------------|----:|-------:|------:|------:|-------------:|-----------:| | SL-30%                     | 537 |    349 |   0.1 |    36 |          9…
url_sha1: b27ece957f97cc02f34c4666b1f1fae587d0c8d3
simhash: '8346353747876889383'
status: vault
ingested_by: seed
---

final-system plays: 540
priced (base ATM): 537

== S3 EXIT GRID (real marks; entry at fire) ==
| rule                       |   n |    pnl |   ret |   win |   worst_rank |   avg_rank |
|:---------------------------|----:|-------:|------:|------:|-------------:|-----------:|
| SL-30%                     | 537 |    349 |   0.1 |    36 |          9   |        3.4 |
| SL-20%                     | 537 |  -1060 |  -0.3 |    30 |          6   |        3.9 |
| time 60min                 | 537 |    317 |   0.1 |    46 |          9   |        4.4 |
| time 90min                 | 537 |  -3788 |  -1.1 |    47 |         12   |        5.9 |
| PT+30/SL-20                | 537 |  -6454 |  -1.8 |    43 |         11   |        6.3 |
| PT+50/SL-25                | 537 |  -7310 |  -2.1 |    39 |         12.5 |        6.5 |
| PT+50/SL-25 + trail        | 537 |  -7310 |  -2.1 |    39 |         12.5 |        6.5 |
| struct only                | 537 |  -8364 |  -2.4 |    45 |         11.5 |        7.1 |
| trail15/10 (tight)         | 537 |  -9746 |  -2.8 |    62 |         13   |        7.1 |
| struct + trail50/15 (live) | 537 | -12310 |  -3.5 |    52 |         12   |        7.5 |
| PT+50%                     | 537 | -22342 |  -6.4 |    52 |         13   |       10.3 |
| PT+20%                     | 537 | -24065 |  -6.9 |    66 |         13   |       10.4 |
| PT+30%                     | 537 | -26013 |  -7.4 |    58 |         13   |       11.7 |

per-regime returns (%):
| rule                       |   m:2026-04 |   m:2026-05 |   m:2026-06 |   m:2026-07 |   d:down |   d:flat |   d:up |
|:---------------------------|------------:|------------:|------------:|------------:|---------:|---------:|-------:|
| struct only                |         0.9 |        -2.9 |        -1.7 |       -12.3 |      1.5 |    -13.3 |   15.4 |
| struct + trail50/15 (live) |        -3.9 |        -2.1 |        -1.6 |       -18.7 |      4.2 |    -13.3 |    8.3 |
| PT+20%                     |        -8   |        -3.7 |        -7.6 |       -10.4 |     -4.2 |    -12.2 |    1.2 |
| PT+30%                     |        -7   |        -5.3 |        -6.8 |       -18.9 |     -5.2 |    -12.5 |    0.5 |
| PT+50%                     |        -4.5 |        -4.3 |        -6.4 |       -17.4 |     -1.4 |    -13.7 |    3.3 |
| SL-20%                     |        -0.7 |        -1.1 |         0.6 |        -1.8 |      7.1 |     -5.6 |    3   |
| SL-30%                     |         2.6 |        -0.1 |        -0.7 |        -0.2 |      5.3 |     -3   |    1   |
| PT+30/SL-20                |        -3.1 |        -0.6 |        -0.9 |        -8.5 |      1.7 |     -4.1 |   -0.8 |
| PT+50/SL-25                |        -2.4 |         0.2 |        -2.1 |        -8.9 |      2.6 |     -5   |   -1   |
| PT+50/SL-25 + trail        |        -2.4 |         0.2 |        -2.1 |        -8.9 |      2.6 |     -5   |   -1   |
| trail15/10 (tight)         |        -9.5 |         1.3 |        -2.3 |        -3.8 |      0.6 |     -6.9 |    2   |
| time 60min                 |         6.6 |        -3.3 |         0.9 |        -8.1 |      2   |     -7.7 |   13.7 |
| time 90min                 |         5.6 |        -4.7 |        -0.4 |        -8.3 |      1   |     -9.8 |   14.3 |

== S2 ENTRY TIMING (exit = live rule) ==
| entry                     |   n |    pnl |   ret |   win |   avg_reprice_% |
|:--------------------------|----:|-------:|------:|------:|----------------:|
| at fire                   | 537 | -12310 |  -3.5 |    52 |             0   |
| +1 min                    | 537 |   -629 |  -0.2 |    53 |            -0.2 |
| +3 min                    | 537 |   -944 |  -0.3 |    53 |            -0.2 |
| +5 min                    | 537 |  -4522 |  -1.3 |    49 |             0.5 |
| confirm (opt up after 1m) | 224 |   3544 |   2.7 |    57 |           nan   |

== S4 MFE/MAE (real option %, from entry to struct exit) ==
median MFE +28% @ 13min · median MAE -33% @ 19min
profit-before-pain: 52% of plays
losers: 259 · of which MFE ≥ +25% (signal worked, exit failed): 19%
losers with MFE < +10% (signal never worked): 54%

== S5 PREMIUM vs REALIZED ==
| bucket                 |   n |   ret_% |   win_% |
|:-----------------------|----:|--------:|--------:|
| move<prem (overpriced) | 179 |    -8   |    46.9 |
| fair                   | 179 |    -8.9 |    50.3 |
| move>prem (cheap)      | 179 |     7.1 |    58.1 |
loss decomposition: 40% of losers had realized-move < premium (overpriced/no-move); 60% moved enough but in wrong direction/timing

== S6 LIQUIDITY PROXIES ==
| volT   |   n |   ret_% |   win_% |
|:-------|----:|--------:|--------:|
| thin   | 179 |    -6.3 |    46.4 |
| mid    | 179 |     4.7 |    54.2 |
| thick  | 179 |    -0.3 |    54.7 |
| premB   |   n |   ret_% |   win_% |
|:--------|----:|--------:|--------:|
| <$0.50  |   7 |    21.2 |    71.4 |
| $0.5-2  | 244 |     6.9 |    59   |
| $2-10   | 156 |   -11.4 |    42.9 |
| >$10    | 130 |    -2.4 |    47.7 |

== S7 FLOW CONFIRMATION TIERS ==
window f1:
| agree_f1   |   n |   ret_% |   win_% |
|:-----------|----:|--------:|--------:|
| False      | 250 |    -4.6 |    52.8 |
| True       | 287 |    -2.7 |    50.9 |
window f5:
| agree_f5   |   n |   ret_% |   win_% |
|:-----------|----:|--------:|--------:|
| False      | 237 |   -10.9 |    50.2 |
| True       | 300 |     3.1 |    53   |
window f15:
| agree_f15   |   n |   ret_% |   win_% |
|:------------|----:|--------:|--------:|
| False       | 238 |    -7.4 |    52.5 |
| True        | 299 |    -0.1 |    51.2 |
flow ACCELERATING in fire direction:
| accel_agree   |   n |   ret_% |   win_% |
|:--------------|----:|--------:|--------:|
| False         | 251 |    -9.4 |    50.2 |
| True          | 286 |     1.3 |    53.1 |
among 15m-agreeing fires, by one-sidedness:
| os_t      |   n |   ret_% |   win_% |
|:----------|----:|--------:|--------:|
| mixed     | 101 |     5.9 |    60.4 |
| lean      |  97 |     1.3 |    51.5 |
| one-sided | 101 |    -7.1 |    41.6 |

== S1 CONTRACT SELECTION (same fires, different contracts; exit = live rule at same timestamps) ==
| contract        |   n |    pnl |   ret |   win |   avg_entry_$ |
|:----------------|----:|-------:|------:|------:|--------------:|
| ATM (base)      | 537 | -12310 |  -3.5 |    52 |          6.53 |
| 1 ITM           | 210 | -11987 |  -8.9 |    51 |          6.4  |
| 2 ITM           | 189 |  -4308 |  -2.7 |    53 |          8.36 |
| 1 OTM           | 202 |    394 |   0.5 |    53 |          4.3  |
| 2 OTM           | 185 |   1324 |   1.9 |    50 |          3.74 |
| next-expiry ATM |  98 |   2470 |   2.3 |    55 |         10.98 |

by ticker (ATM base, live rule):
  SPXW  n= 200 pnl=$-13,128 (-4.5%) win=44%
  SPY   n= 182 pnl=$-332 (-1.2%) win=54%
  QQQ   n= 155 pnl=$+1,150 (+3.6%) win=59%
