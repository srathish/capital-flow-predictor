---
title: Uw Deep2 Raw
source_url: repo://apps/gex/research/uw/out/UW_DEEP2_RAW.md
source_domain: bellwether-repo
fetched_at: '2026-07-11T07:22:07Z'
trust_tier: 1
category: my-findings
topics:
- own-research
- gex
- 0dte
- unusual-whales
- flow
summary: '== STACK TEST: layering tonight-discovered filters (real $) == L0: final system, at-fire, live exit                 n= 537  pnl=$-12,310 (-3.5%)  win=52% L1: + 1-min confirmation entry                       n= 224  pnl=$+3,544 (+2.7%)  win=57% L2: + flow f5 agrees                                 n=…'
url_sha1: d4b462d72039a51cff75fed3e92b9cc5456a23d9
simhash: '13017009849666388008'
status: vault
ingested_by: seed
---

priced rows: 537

== STACK TEST: layering tonight-discovered filters (real $) ==
L0: final system, at-fire, live exit                 n= 537  pnl=$-12,310 (-3.5%)  win=52%
L1: + 1-min confirmation entry                       n= 224  pnl=$+3,544 (+2.7%)  win=57%
L2: + flow f5 agrees                                 n= 120  pnl=$+8,142 (+12.3%)  win=59%
L3: + not one-sided (top-tercile excluded)           n=  83  pnl=$+10,509 (+21.2%)  win=59%
L4: + SL-25% hard stop                               n=  83  pnl=$+3,064 (+6.2%)  win=45%
L2b: flow-agree only (no confirm)                    n= 300  pnl=$+5,813 (+3.1%)  win=53%
L4-SPXW-excl: L4 minus SPXW                          n=  61  pnl=$+522 (+4.2%)  win=46%

consistency of the full stack (L4) by month / day-type:
  2026-04                                            n=  19  pnl=$+1,957 (+20.6%)  win=47%
  2026-05                                            n=  24  pnl=$+1,090 (+9.3%)  win=54%
  2026-06                                            n=  32  pnl=$+176 (+0.7%)  win=34%
  2026-07                                            n=   8  pnl=$-159 (-4.0%)  win=50%
  down days                                          n=  18  pnl=$+2,766 (+26.5%)  win=50%
  flat days                                          n=  40  pnl=$-665 (-2.7%)  win=45%
  up days                                            n=  25  pnl=$+964 (+6.7%)  win=40%

== S10 TIME OF DAY (final system, at-fire entry, live exit) ==
  9:30-10:00                                         n= 130  pnl=$-6,108 (-4.1%)  win=49%
  10:00-11:00                                        n=  93  pnl=$-211 (-0.4%)  win=49%
  11:00-12:00                                        n=  93  pnl=$-1,206 (-2.5%)  win=55%
  lunch 12:00-13:30                                  n=  91  pnl=$+1,484 (+3.3%)  win=53%
  13:30-15:00                                        n= 103  pnl=$-6,370 (-15.7%)  win=49%
  15:00-15:15                                        n=  27  pnl=$+101 (+0.9%)  win=70%

== S8 FLOW EXHAUSTION — extreme 15m flow vs SPY forward returns ==
SPY 30m forward return by 15m net-flow decile (0=most bearish flow, 9=most bullish):
|   bucket |   n |   net_flow_M |   fwd30_bps |   up_pct |
|---------:|----:|-------------:|------------:|---------:|
|        0 | 427 |       -13.1  |       -1.28 |    46.6  |
|        1 | 427 |        -6.2  |        0.29 |    51.29 |
|        2 | 427 |        -4.06 |       -1.02 |    49.65 |
|        3 | 427 |        -2.58 |        0.56 |    56.21 |
|        4 | 427 |        -1.38 |        1.29 |    59.95 |
|        5 | 427 |        -0.26 |       -0.1  |    54.33 |
|        6 | 427 |         0.93 |        0.89 |    53.86 |
|        7 | 427 |         2.38 |        2.17 |    57.14 |
|        8 | 427 |         4.43 |        0.19 |    53.63 |
|        9 | 427 |        10.71 |       -0.03 |    54.8  |
extreme bullish flow decile → fwd30 -0.0bps · extreme bearish decile → -1.3bps

== S9 GEX/VEX REGIME × REAL OPTION $ (final system, live exit) ==
  GEX positive  n= 354  ret=-8.9%  win=51%
  GEX neutral   n= 102  ret=+5.4%  win=50%
  GEX negative  n=  81  ret=+1.2%  win=57%
  distance to TARGET-side wall (call wall for bulls / put wall for bears):
    <20bps to wall   n= 217  ret=-7.6%  win=50%
    20-50            n= 179  ret=-4.3%  win=49%
    50-100           n= 105  ret=+6.5%  win=57%
    >100             n=  36  ret=-10.3%  win=58%

== S12 SIGNAL vs OPTION CONVEXITY ==
avg breakeven: 23bps of underlying · plays clearing breakeven by EOD: 36%
  SPXW  breakeven=20bps  cleared=30%  ret=-4.5%
  SPY   breakeven=20bps  cleared=35%  ret=-1.2%
  QQQ   breakeven=29bps  cleared=44%  ret=+3.6%

== S13/S14 EVENT & CALENDAR DAYS (final system) ==
  OPEX days                                          n=  23  pnl=$-147 (-1.0%)  win=57%
  Fridays                                            n=  94  pnl=$-166 (-0.3%)  win=63%
  non-Fridays                                        n= 443  pnl=$-12,144 (-4.1%)  win=49%
