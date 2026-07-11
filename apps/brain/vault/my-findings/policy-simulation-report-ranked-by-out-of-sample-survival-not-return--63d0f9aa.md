---
title: Policy Simulation Report — ranked by OUT-OF-SAMPLE SURVIVAL, not return
source_url: repo://apps/gex/research/uw/studies/outputs/policy_summary_report.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T18:12:58Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- unusual-whales
- flow
summary: 'Universe: 1322 repriced fires (2026-04-10 → 2026-07-08). Real option marks; live exit rule (structural + trail). Research'
url_sha1: 63d0f9aa17999c3bde3ffaa4fce28c7e52dd13e6
simhash: '10697644954128778165'
status: vault
ingested_by: seed
---

# Policy Simulation Report — ranked by OUT-OF-SAMPLE SURVIVAL, not return

Universe: 1322 repriced fires (2026-04-10 → 2026-07-08). Real option marks; live exit rule (structural + trail). Research only.

A policy earns its rank by a 9-check stability score (positive mean AND median, PF>1, bounded drawdown, positive odd AND even days, positive both halves, neutral-or-better across tickers and time buckets, no outlier/tail dependency) — NOT by total P&L. A high-return policy that fails holdouts is a curve-fit.

## Stability ranking

| policy                  | recommended_status   |   stability_score |   holdout_pass_count | regime_pass_count   |   outlier_dependency_score |   tail_dependency_percent |    n |   kept_pct |   ret_on_cap_pct |   profit_factor |   win_rate |   ret_odd |   ret_even |   ret_H1 |   ret_H2 |
|:------------------------|:---------------------|------------------:|---------------------:|:--------------------|---------------------------:|--------------------------:|-----:|-----------:|-----------------:|----------------:|-----------:|----------:|-----------:|---------:|---------:|
| flags_eq_0              | research_more        |                 4 |                    4 | 5/8                 |                       1.44 |                        56 |  162 |       12.3 |             2.79 |            1.1  |       40.7 |       4.5 |        0.1 |      3.9 |      1.7 |
| FULL_COMBINED           | reject               |                 2 |                    2 | 7/8                 |                       1.03 |                        62 |   85 |        6.4 |             7.81 |            1.37 |       45.9 |      17   |      -11.6 |     -3.3 |     15.2 |
| flow_confirmation       | reject               |                 2 |                    2 | 6/8                 |                       0.55 |                        56 |  477 |       36.1 |             3.18 |            1.13 |       46.1 |       9.9 |       -4.8 |     11.1 |     -2.9 |
| flags_le_1              | reject               |                 2 |                    2 | 6/8                 |                       7.54 |                        53 |  576 |       43.6 |             0.23 |            1.01 |       41.8 |       5.2 |       -5.4 |      1.7 |     -1.1 |
| spxw_penalty            | reject               |                 1 |                    1 | 4/8                 |                       1    |                       nan |  904 |       68.4 |            -1.82 |            0.93 |       44.7 |       0.4 |       -4.4 |     -1.2 |     -2.3 |
| skip_gex_positive       | reject               |                 1 |                    1 | 2/7                 |                       1    |                       nan |  411 |       31.1 |            -2.94 |            0.87 |       43.6 |       1.2 |       -7   |     -3.7 |     -2.2 |
| positive_stack_sizing   | reject               |                 1 |                    0 | 2/8                 |                       1    |                       nan | 1322 |      100   |            -3.26 |            0.87 |       44.5 |      -0.4 |       -6.3 |     -2.4 |     -3.9 |
| convexity               | reject               |                 1 |                    0 | 2/8                 |                       1    |                       nan | 1135 |       85.9 |            -3.69 |            0.87 |       44.3 |      -0.5 |       -7   |     -3.9 |     -3.5 |
| premium_band            | reject               |                 1 |                    0 | 1/8                 |                       1    |                       nan |  946 |       71.6 |            -3.85 |            0.84 |       44.4 |      -3.3 |       -4.5 |     -3.4 |     -4.1 |
| bad_time_filter         | reject               |                 1 |                    0 | 2/8                 |                       1    |                       nan | 1087 |       82.2 |            -4.12 |            0.83 |       43.5 |      -1.7 |       -6.6 |     -2.9 |     -5   |
| flow_exhaustion         | reject               |                 1 |                    0 | 2/8                 |                       1    |                       nan | 1219 |       92.2 |            -4.29 |            0.83 |       44.2 |      -0.2 |       -8.4 |     -2.1 |     -5.7 |
| baseline_all_fires      | reject               |                 1 |                    0 | 2/8                 |                       1    |                       nan | 1322 |      100   |            -4.51 |            0.82 |       44.5 |      -2.4 |       -6.7 |     -3.6 |     -5.2 |
| confirmation_entry_only | reject               |                 1 |                    0 | 1/8                 |                       1    |                       nan |  554 |       41.9 |            -4.51 |            0.81 |       46.2 |      -0.3 |       -9.3 |     -6.9 |     -2.6 |
| wall_distance           | reject               |                 1 |                    0 | 1/8                 |                       1    |                       nan |  791 |       59.8 |            -5.02 |            0.8  |       42.5 |      -2.6 |       -7.8 |     -5.3 |     -4.8 |

### Reading guide

- Most survivable policy: **flags_eq_0** (status=research_more, stability 4/9, holdouts 4/4, ret +2.8%).
- Highest RETURN policy is **FULL_COMBINED** (+7.8%) — stability 2/9, status=reject: return without survival evidence.

## Full metric table

| policy                  |    n |   kept_pct |   total_pnl |   ret_on_cap_pct |   avg_ret_pct |   med_ret_pct |   win_rate |   profit_factor |   max_drawdown |   avg_mae_pct |   avg_mfe_pct |   med_t_peak_min |   pnl_per_day |   worst_day |   best_day |   top5pct_share |   ret_odd |   ret_even |   ret_H1 |   ret_H2 |   stability_score |   outlier_dependency_score |   tail_dependency_percent |   holdout_pass_count | regime_pass_count   | recommended_status   |
|:------------------------|-----:|-----------:|------------:|-----------------:|--------------:|--------------:|-----------:|----------------:|---------------:|--------------:|--------------:|-----------------:|--------------:|------------:|-----------:|----------------:|----------:|-----------:|---------:|---------:|------------------:|---------------------------:|--------------------------:|---------------------:|:--------------------|:---------------------|
| baseline_all_fires      | 1322 |      100   |      -31816 |            -4.51 |         -3.41 |         -4    |       44.5 |            0.82 |         -32532 |         -41.4 |          48.9 |                9 |          -522 |       -5935 |       3945 |             nan |      -2.4 |       -6.7 |     -3.6 |     -5.2 |                 1 |                       1    |                       nan |                    0 | 2/8                 | reject               |
| confirmation_entry_only |  554 |       41.9 |      -14035 |            -4.51 |         -3.94 |         -4.82 |       46.2 |            0.81 |         -13547 |         -35.5 |          58.8 |               10 |          -230 |       -2803 |       2269 |             nan |      -0.3 |       -9.3 |     -6.9 |     -2.6 |                 1 |                       1    |                       nan |                    0 | 1/8                 | reject               |
| skip_gex_positive       |  411 |       31.1 |       -7618 |            -2.94 |         -4.97 |         -2.11 |       43.6 |            0.87 |          -7613 |         -39.4 |          40.8 |                8 |          -134 |       -2710 |       3204 |             nan |       1.2 |       -7   |     -3.7 |     -2.2 |                 1 |                       1    |                       nan |                    1 | 2/7                 | reject               |
| bad_time_filter         | 1087 |       82.2 |      -25508 |            -4.12 |         -3.35 |         -3.97 |       43.5 |            0.83 |         -26943 |         -40.5 |          48.1 |                9 |          -418 |       -4502 |       3828 |             nan |      -1.7 |       -6.6 |     -2.9 |     -5   |                 1 |                       1    |                       nan |                    0 | 2/8                 | reject               |
| premium_band            |  946 |       71.6 |      -19779 |            -3.85 |         -2.31 |         -2.14 |       44.4 |            0.84 |         -19344 |         -39.9 |          49.4 |                9 |          -324 |       -4920 |       3340 |             nan |      -3.3 |       -4.5 |     -3.4 |     -4.1 |                 1 |                       1    |                       nan |                    0 | 1/8                 | reject               |
| spxw_penalty            |  904 |       68.4 |       -3849 |            -1.82 |         -2.75 |         -1.26 |       44.7 |            0.93 |          -4475 |         -38.7 |          47.6 |                9 |           -63 |       -3505 |       1937 |             nan |       0.4 |       -4.4 |     -1.2 |     -2.3 |                 1 |                       1    |                       nan |                    1 | 4/8                 | reject               |
| flow_confirmation       |  477 |       36.1 |        6737 |             3.18 |         -0.76 |          0    |       46.1 |            1.13 |          -6264 |         -40.2 |          51   |               10 |           110 |       -4636 |       3676 |             488 |       9.9 |       -4.8 |     11.1 |     -2.9 |                 2 |                       0.55 |                        56 |                    2 | 6/8                 | reject               |
| flow_exhaustion         | 1219 |       92.2 |      -24744 |            -4.29 |         -3.08 |         -4    |       44.2 |            0.83 |         -26044 |         -41   |          48.9 |                9 |          -406 |       -6100 |       4715 |             nan |      -0.2 |       -8.4 |     -2.1 |     -5.7 |                 1 |                       1    |                       nan |                    0 | 2/8                 | reject               |
| wall_distance           |  791 |       59.8 |      -23914 |            -5.02 |         -5.38 |         -5.13 |       42.5 |            0.8  |         -24219 |         -41.3 |          45.4 |                8 |          -392 |       -4248 |       3274 |             nan |      -2.6 |       -7.8 |     -5.3 |     -4.8 |                 1 |                       1    |                       nan |                    0 | 1/8                 | reject               |
| convexity               | 1135 |       85.9 |      -19667 |            -3.69 |         -2.8  |         -4.17 |       44.3 |            0.87 |         -21742 |         -42.2 |          52.1 |                9 |          -322 |       -5518 |       5298 |             nan |      -0.5 |       -7   |     -3.9 |     -3.5 |                 1 |                       1    |                       nan |                    0 | 2/8                 | reject               |
| flags_le_1              |  576 |       43.6 |         719 |             0.23 |         -3.57 |         -4    |       41.8 |            1.01 |         -10298 |         -39.8 |          47.5 |                9 |            12 |       -5344 |       5420 |            6026 |       5.2 |       -5.4 |      1.7 |     -1.1 |                 2 |                       7.54 |                        53 |                    2 | 6/8                 | reject               |
| flags_eq_0              |  162 |       12.3 |        2589 |             2.79 |         -2.1  |         -1.42 |       40.7 |            1.1  |          -3229 |         -36.5 |          40.9 |               10 |            52 |       -2813 |       2230 |             601 |       4.5 |        0.1 |      3.9 |      1.7 |                 4 |                       1.44 |                        56 |                    4 | 5/8                 | research_more        |
| positive_stack_sizing   | 1322 |      100   |      -20687 |            -3.26 |         -3.41 |         -4    |       44.5 |            0.87 |         -21674 |         -41.4 |          48.9 |                9 |          -339 |       -5296 |       4819 |             nan |      -0.4 |       -6.3 |     -2.4 |     -3.9 |                 1 |                       1    |                       nan |                    0 | 2/8                 | reject               |
| FULL_COMBINED           |   85 |        6.4 |        5310 |             7.81 |         -0.33 |         -4.88 |       45.9 |            1.37 |          -2234 |         -33.3 |          52.1 |               10 |           118 |       -2052 |       5445 |             229 |      17   |      -11.6 |     -3.3 |     15.2 |                 2 |                       1.03 |                        62 |                    2 | 7/8                 | reject               |

## Ablation (FULL_COMBINED minus one component)

| policy                    | removed            |   n |   kept_pct |   total_pnl |   ret_on_cap_pct |   avg_ret_pct |   med_ret_pct |   win_rate |   profit_factor |   max_drawdown |   avg_mae_pct |   avg_mfe_pct |   med_t_peak_min |   pnl_per_day |   worst_day |   best_day |   top5pct_share |   ret_odd |   ret_even |   ret_H1 |   ret_H2 |   delta_vs_full |   delta_vs_baseline |
|:--------------------------|:-------------------|----:|-----------:|------------:|-----------------:|--------------:|--------------:|-----------:|----------------:|---------------:|--------------:|--------------:|-----------------:|--------------:|------------:|-----------:|----------------:|----------:|-----------:|---------:|---------:|----------------:|--------------------:|
| FULL_COMBINED             | -                  |  85 |        6.4 |        5310 |             7.81 |         -0.33 |         -4.88 |       45.9 |            1.37 |          -2234 |         -33.3 |          52.1 |               10 |           118 |       -2052 |       5445 |             229 |      17   |      -11.6 |     -3.3 |     15.2 |            0    |               12.32 |
| remove_flow               | flow               | 139 |       10.5 |        5535 |             7.29 |          1.71 |         -6.62 |       46   |            1.35 |          -2404 |         -30.3 |          60.4 |                9 |           102 |       -2052 |       5313 |             251 |      15.4 |       -8   |     -2.4 |     14.2 |           -0.52 |               11.8  |
| remove_premium_efficiency | premium_efficiency |  86 |        6.5 |        5380 |             7.9  |          0.17 |         -4.41 |       46.5 |            1.38 |          -2234 |         -32.9 |          56.1 |               10 |           120 |       -2052 |       5445 |             226 |      17   |      -11.2 |     -3   |     15.2 |            0.09 |               12.41 |
| remove_time_filter        | time_filter        |  96 |        7.3 |        4982 |             7.14 |         -1.64 |         -6.12 |       45.8 |            1.34 |          -2383 |         -34.9 |          52.3 |               10 |           104 |       -2052 |       5445 |             244 |      15.9 |      -11.2 |     -3.5 |     14.4 |           -0.67 |               11.65 |
| remove_flags              | flags              |  85 |        6.4 |        5310 |             7.81 |         -0.33 |         -4.88 |       45.9 |            1.37 |          -2234 |         -33.3 |          52.1 |               10 |           118 |       -2052 |       5445 |             229 |      17   |      -11.6 |     -3.3 |     15.2 |            0    |               12.32 |
| remove_convexity          | convexity          |  86 |        6.5 |        4975 |             7.1  |         -0.52 |         -6.12 |       45.3 |            1.34 |          -2430 |         -33.1 |          51.5 |               10 |           111 |       -2052 |       5445 |             245 |      17   |      -12   |     -3.3 |     13.7 |           -0.71 |               11.61 |
| remove_wall_distance      | wall_distance      |  99 |        7.5 |        4423 |             5.93 |         -0.93 |         -4.88 |       46.5 |            1.27 |          -3400 |         -33.4 |          54.4 |               10 |            94 |       -2092 |       5445 |             278 |      13.9 |      -12.2 |      1.2 |      9.2 |           -1.88 |               10.44 |
| remove_confirmation_entry | confirmation_entry | 191 |       14.4 |        2677 |             2.14 |         -3.74 |         -3.78 |       40.8 |            1.08 |          -4226 |         -38   |          40.8 |                9 |            48 |       -3125 |       3718 |             826 |       4.1 |       -0.8 |      0   |      4.3 |           -5.67 |                6.65 |
| remove_spxw_penalty       | spxw_penalty       |  86 |        6.5 |        5655 |             8.18 |          0.04 |         -4.41 |       46.5 |            1.4  |          -2234 |         -33.3 |          53.1 |               10 |           123 |       -2052 |       5445 |             215 |      17.3 |      -11.6 |     -1.9 |     15.2 |            0.37 |               12.69 |
| remove_stack_sizing       | stack_sizing       |  85 |        6.4 |        4499 |             9.21 |         -0.33 |         -4.88 |       45.9 |            1.45 |          -1430 |         -33.3 |          52.1 |               10 |           100 |       -1416 |       3630 |             195 |      18.4 |      -11.3 |     -0   |     14.9 |            1.4  |               13.72 |

## FULL_COMBINED breakdowns

### by ticker

| ticker   |   n |   ret_% |   win_% |
|:---------|----:|--------:|--------:|
| QQQ      |  27 |     3.2 |      41 |
| SPXW     |  27 |     9.8 |      63 |
| SPY      |  31 |    -5.8 |      35 |

### by GEX state

| gex_state   |   n |   ret_% |   win_% |
|:------------|----:|--------:|--------:|
| negative    |  19 |   -24.2 |      32 |
| neutral     |  22 |    10.5 |      55 |
| positive    |  44 |    29   |      48 |

### by day type

| daytype   |   n |   ret_% |   win_% |
|:----------|----:|--------:|--------:|
| down      |  16 |    14.6 |      69 |
| flat      |  39 |     1   |      46 |
| up        |  30 |    10.4 |      33 |

### by premium band

| premium_band   |   n |   ret_% |   win_% |
|:---------------|----:|--------:|--------:|
| bad_2-10       |   8 |    -6.7 |      50 |
| good_0.5-2     |  52 |     1.2 |      42 |
| other          |  25 |    11.6 |      52 |

### by no-trade flags

|   nflags |   n |   ret_% |   win_% |
|---------:|----:|--------:|--------:|
|        0 |  71 |     8.1 |      45 |
|        1 |  14 |    -1.4 |      50 |

### by entry type

| entry_type   |   n |   ret_% |   win_% |
|:-------------|----:|--------:|--------:|
| confirm      |  85 |     7.8 |      46 |

### by time bucket

| bucket   |   n |   ret_% |   win_% |
|:---------|----:|--------:|--------:|
| 9:30-10  |  12 |     1.8 |      50 |
| 10-11    |  19 |    -3.9 |      47 |
| 11-12    |  17 |   -11.4 |      41 |
| lunch    |  15 |    41.4 |      60 |
| 13:30-15 |   5 |    14.8 |      80 |
| 15+      |   5 |    -6.5 |      20 |

### by nfp

| nfp   |   n |   ret_% |   win_% |
|:------|----:|--------:|--------:|
| False |  83 |     4.3 |      45 |
| True  |   2 |    91.8 |     100 |

### by fomc

| fomc   |   n |   ret_% |   win_% |
|:-------|----:|--------:|--------:|
| False  |  80 |     6.4 |      45 |
| True   |   5 |    24.9 |      60 |

### by big_open

| big_open   |   n |   ret_% |   win_% |
|:-----------|----:|--------:|--------:|
| False      |  72 |     4.7 |      43 |
| True       |  13 |    14.9 |      62 |
