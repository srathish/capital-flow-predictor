# Stock event factory — results

Run 2026-10-11T00:33:21.143Z · design shadow/DESIGN_event_factory.md · 168 studies · build events to 2019-12-31, holdout from 2020-01-01

**Build BH q = 0.10: 21 of 168 pass. Holdout (BH across survivors, same sign, beat ≥ 19/20 random-stock placebos): 15 validated.**

| study | event | outcome | predicted | build: n, mean (t) | holdout: n, mean (t) | placebos beaten | mechanism |
|---|---|---|---|---|---|---|---|
| P12xMV60 | 20-day return > 30% | MV60 | + | 2578, +9.86% (+8.43) | 8428, **+6.40% (+7.09)** | 20/20 | short-term overextension |
| P11xMV60 | one-day rise > 10% (no gap requirement) | MV60 | + | 4062, +6.32% (+8.56) | 11067, **+5.00% (+5.91)** | 20/20 | large up move |
| F01xMV60 | quarter revenue growth YoY > 30% | MV60 | + | 2201, +3.13% (+3.21) | 4631, **+4.60% (+5.76)** | 20/20 | strong demand, under-reacted |
| F14xMV60 | revenue growth YoY > 30% AND accelerating | MV60 | + | 1459, +3.78% (+3.23) | 3101, **+5.09% (+5.74)** | 20/20 | bottleneck inflection |
| P05xMV60 | 3-day drop > 15% | MV60 | ? | 2858, +7.98% (+7.79) | 8985, **+5.56% (+4.50)** | 20/20 | overreaction (reversal) |
| P04xMV60 | gap down > 5% on > 3× average volume | MV60 | ? | 3746, +2.73% (+3.86) | 5867, **+3.23% (+4.09)** | 20/20 | news gap continuation down |
| F06xMV60 | first profitable quarter after ≥ 4 losing quarters | MV60 | + | 129, +6.28% (+2.79) | 449, **+7.15% (+4.04)** | 20/20 | turn to profit |
| P08xMV60 | up day on > 5× average volume | MV60 | + | 4007, +2.58% (+4.17) | 5103, **+2.66% (+4.01)** | 20/20 | accumulation |
| P03xMV60 | gap up > 5% on > 3× average volume | MV60 | + | 3561, +3.42% (+5.00) | 5988, **+3.01% (+3.84)** | 20/20 | news gap continuation |
| F08xMV60 | record quarterly revenue (above every earlier quarter) with YoY > 15% | MV60 | + | 3004, +2.08% (+2.33) | 5084, **+2.37% (+3.50)** | 20/20 | breakout fundamentals |
| X01xMV60 | F14 filed within 20 trading days of a new 52-week high | MV60 | + | 685, +5.91% (+2.86) | 1291, **+4.18% (+2.65)** | 20/20 | fundamentals + price confirm |
| F13xMV60 | share count down > 3% YoY | MV60 | - | 4502, -2.60% (-6.90) | 5585, **-1.67% (-2.56)** | 20/20 | buyback |
| I04xMV60 | insider purchase after a 20% drop in 3 months | MV60 | + | 826, +6.95% (+7.43) | 1920, **+2.50% (+2.37)** | 20/20 | buying the dip |
| F11xMV60 | annual capex up > 50% | MV60 | ? | 1566, +3.54% (+3.95) | 1909, **+2.31% (+1.82)** | 20/20 | over-investment |
| X04xMV60 | gap up > 5% on volume (P03) on a 10-Q/10-K filing day | MV60 | + | 862, +3.23% (+2.45) | 2167, **+1.63% (+1.82)** | 20/20 | earnings gap (PEAD) |

## Passed the holdout but not the random-stock placebo

- F13xA5 share count down > 3% YoY: holdout +0.21% (t +2.37), placebos 17/20
- P02xA60 new 52-week high after 6 months without one: holdout +1.02% (t +1.44), placebos 6/20

## Passed build, failed holdout

- F05xA20 gross margin down > 3 pts YoY: build -0.59% (t -2.53) → holdout +0.44% (t +1.60)
- G01xA60 guidance raise: build +2.06% (t +4.40) → holdout -0.33% (t -0.35)
- P10xMV60 new 52-week closing low: build +2.36% (t +3.09) → holdout +0.68% (t +1.08)
- X03xA5 guidance raise (G01) with a gap up > 3% that day: build +1.01% (t +3.04) → holdout +0.23% (t +0.49)

Event counts (all years): F01 7246, F02 8768, F03 5918, F04 15434, F05 5126, F06 616, F07 434, F08 8563, F09 1650, F10 5498, F11 3553, F12 3086, F13 10730, F14 4833, F15 10596, I01 3966, I02 1894, I03 1768, I04 2800, I05 4721, G01 1183, G02 52, G03 337, G04 538, P01 29061, P02 10060, P03 10015, P04 10037, P05 12428, P06 15838, P07 4579, P08 9558, P09 16675, P10 15672, P11 15932, P12 11592, T01 1171, T02 2275, X01 2089, X02 488, X03 246, X04 3200. MV60 values are (share of big movers − 10%).
