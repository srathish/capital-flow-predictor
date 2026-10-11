# Stock-finding factory — SHORT horizon results

Run 2026-10-11T00:44:17.797Z · design shadow/DESIGN_stock_factory.md · 220 studies · 152 weeks · 300 stocks (chosen by liquidity as of 2023-10-31)

**Build (windows end ≤ 2025-06-30), BH q = 0.10: 16 of 220 pass. Holdout (from 2025-07-01), BH across survivors, same sign, beat ≥ 19/20 own placebos: 16 validated.**

| outcome | studies | pass build | validated |
|---|---|---|---|
| W1 | 55 | 0 | 0 |
| W2 | 55 | 0 | 0 |
| W4 | 55 | 0 | 0 |
| WV | 55 | 16 | 16 |

## Validated studies

| study | feature | outcome | predicted | build IC (t) | holdout IC (t) | top − bottom fifth (holdout) | own placebos beaten | mechanism |
|---|---|---|---|---|---|---|---|---|
| S17xWV | vanna balance | WV | ? | +0.140 (+7.75) | **+0.151 (+10.16)** | +13.0 pts | 20/20 | vanna flows |
| S18xWV | vanna balance within ±2% | WV | ? | +0.102 (+6.37) | **+0.111 (+9.50)** | +6.7 pts | 20/20 | local vanna |
| S55xWV | net vanna ÷ market cap | WV | ? | +0.122 (+8.73) | **+0.164 (+8.92)** | +15.2 pts | 20/20 | vanna relative to size |
| S19xWV | (vanna above − below) / Σ|vanna| | WV | ? | -0.119 (-6.66) | **-0.174 (-8.55)** | -15.4 pts | 20/20 | vanna skew |
| S41xWV | realized volatility (4 weeks) | WV | + | +0.150 (+7.05) | **+0.185 (+8.25)** | +16.3 pts | 20/20 | low-volatility anomaly |
| S44xWV | max daily return (4 weeks) | WV | + | +0.119 (+5.54) | **+0.150 (+7.40)** | +13.2 pts | 20/20 | lottery |
| S53xWV | total |delta| ÷ market cap | WV | + | +0.102 (+4.59) | **+0.150 (+6.97)** | +13.9 pts | 20/20 | options footprint |
| S56xWV | call delta ÷ market cap | WV | + | +0.105 (+4.44) | **+0.153 (+6.92)** | +14.6 pts | 20/20 | call footprint |
| S07xWV | |K − S|/S | WV | + | +0.050 (+6.57) | **+0.044 (+5.61)** | +4.2 pts | 20/20 | no pin → room to run |
| S49xWV | largest |vanna| strike above spot (1/0) | WV | + | +0.080 (+7.39) | **+0.053 (+5.39)** | +2.9 pts | 20/20 | vanna pull up |
| S20xWV | largest |vanna| strike − S, / S | WV | + | +0.083 (+7.07) | **+0.063 (+4.98)** | +5.9 pts | 20/20 | vanna magnet |
| S10xWV | distance to nearest strong node above | WV | + | +0.024 (+3.22) | **+0.023 (+4.14)** | +1.8 pts | 20/20 | room above |
| S50xWV (seen) | v5 bottleneck score | WV | + | +0.048 (+3.35) | **+0.062 (+3.57)** | +5.2 pts | 20/20 | fundamental demand (seen) |
| S09xWV | king share of |gamma| | WV | - | -0.051 (-4.33) | **-0.036 (-3.21)** | -3.3 pts | 20/20 | concentration pins |
| S42xWV | price ÷ 52-week high | WV | ? | -0.097 (-6.22) | **-0.063 (-3.10)** | -5.8 pts | 20/20 | 52-week-high effect |
| S12xWV | largest positive-gamma strike − S, / S | WV | + | +0.047 (+4.34) | **+0.021 (+1.87)** | +1.6 pts | 20/20 | positive magnet |

## Passed the holdout test but not their own placebo

| study | holdout t | placebos beaten |
|---|---|---|

## Passed build, failed holdout

| study | build IC (t) | holdout IC (t) |
|---|---|---|

## Exploratory follow-up (not pre-registered, 2026-10-11)
Vanna balance (S17) beyond realized vol (S41), max daily return (S44) and options footprint (S53), weekly cross-sectional rank regression on WV: build t 2.05 (82 weeks), holdout t 6.86 (62 weeks). Vanna is not just a volatility proxy. Run: `node shadow/stock_factory_short.mjs --beyond`.
- Exploratory (2026-10-11): vanna does NOT predict direction. Top fifth by vanna balance (S17): 17.0% big winners vs 17.0% big losers on the holdout (bottom fifth 4.1% / 5.2%); average excess +0.1%. It is a big-move-either-way signal (fits long straddles, not calls). `--asym` flag.
