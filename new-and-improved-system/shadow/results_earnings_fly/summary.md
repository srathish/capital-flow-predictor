# Earnings iron fly — results

Run 2026-10-17T09:13:34.814Z · design shadow/DESIGN_earnings_fly.md · events priced 2897 · skipped {"credit":22,"bodyquote":68,"wings":4,"chain":4}

| set | period | events (dates) | mean per event (date-clustered) | t | win | worst | 1%-risk account ×, max DD |
|---|---|---|---|---|---|---|---|
| all | build | 1172 (215) | -26.4% (per trade -29.6%) | -9.36 | 32% | -477% | 0.02, -98.2% |
| all | holdout | 1725 (280) | -25.6% (per trade -30.5%) | -10.64 | 29% | -348% | 0.00, -99.6% |
| rich (implied > past avg move) | build | 815 (204) | -25.7% (per trade -25.0%) | -8.11 | 37% | -179% | 0.13, -87.4% |
| rich (implied > past avg move) | holdout | 1450 (255) | -24.9% (per trade -30.6%) | -9.70 | 29% | -348% | 0.01, -99.0% |
| not rich | build | 100 (71) | -28.3% (per trade -27.6%) | -4.41 | 37% | -160% | 0.76, -25.4% |
| not rich | holdout | 165 (101) | -30.5% (per trade -31.3%) | -6.31 | 31% | -154% | 0.59, -41.5% |

build terciles of implied ÷ historical move: ratio ≤1.44: -26.7% (n 305) | ratio ≤2.54: -25.0% (n 305) | ratio ≤833.34: -24.1% (n 305)

holdout terciles of implied ÷ historical move: ratio ≤1.49: -30.6% (n 538) | ratio ≤2.90: -28.9% (n 538) | ratio ≤1244.02: -32.5% (n 539)

**Tests (holdout; BH q = 0.10; build must agree in sign):** S1 all: -25.6% t -10.64 (build -26.4%) · S2 rich: -24.9% t -9.70 (build -25.7%) · S3 rich − not rich: 5.6% t 1.03 (build 2.6%)
Fat tail (holdout): worst 10% of losing trades = 23% of all losses.
