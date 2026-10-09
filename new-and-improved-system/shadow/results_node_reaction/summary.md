# Do 0DTE nodes make price react more than nearby random levels? — results

Run 2026-10-09T07:06:28.424Z · design shadow/DESIGN_node_reaction.md · 63 days (SPY + QQQ) · M = 0.12%, 20 bars

| group | touches | resolved | reject rate | stall | ambiguous |
|---|---|---|---|---|---|
| Node floor/ceiling | 1200 | 941 | **48.2%** | 21.3% | 0.3% |
| Matched random (near the nodes) | 485 | 433 | **48.7%** | 10.3% | 0.4% |
| Fixed random (at the open) | 377 | 345 | **49.0%** | 8.2% | 0.3% |

**Node minus matched random, reject rate**

| slice | node | matched | difference | 95% day-bootstrap |
|---|---|---|---|---|
| all | 48.2% | 48.7% | **-0.5 pts** | -5.3 to 4.6 pts |
| SPY | 47.2% | 53.8% | **-6.6 pts** | -15.3 to 1.7 pts |
| QQQ | 48.7% | 46.2% | **+2.5 pts** | -3.2 to 9.2 pts |
| Apr–May | 49.4% | 53.6% | **-4.2 pts** | -13.7 to 5.0 pts |
| Jun–Jul | 47.4% | 45.7% | **+1.7 pts** | -3.4 to 7.6 pts |

## Verdict: **FAIL** (needs difference > 0 with the bootstrap interval above 0, and > 0 on SPY, QQQ, Apr–May and Jun–Jul)

## Secondary (not used for the verdict)

**By group (node levels vs matched random, same slice)**

| group | touches | resolved | reject rate | stall | ambiguous |
|---|---|---|---|---|---|
| node · floor | 603 | 507 | **48.1%** | 15.6% | 0.3% |
| matched · floor | 247 | 223 | **47.1%** | 8.9% | 0.8% |
| node · ceiling | 597 | 434 | **48.4%** | 27.0% | 0.3% |
| matched · ceiling | 238 | 210 | **50.5%** | 11.8% | 0.0% |
| node · level is the king | 642 | 504 | **46.2%** | 21.2% | 0.3% |
| matched · level is the king | 0 | 0 | **—** | — | — |
| node · level not the king | 558 | 437 | **50.6%** | 21.3% | 0.4% |
| matched · level not the king | 485 | 433 | **48.7%** | 10.3% | 0.4% |
| node · positive gamma at level | 837 | 680 | **49.3%** | 18.4% | 0.4% |
| matched · positive gamma at level | 288 | 258 | **48.1%** | 9.7% | 0.7% |
| node · negative gamma at level | 363 | 261 | **45.6%** | 27.8% | 0.3% |
| matched · negative gamma at level | 197 | 175 | **49.7%** | 11.2% | 0.0% |
| node · 1st touch of the level today | 573 | 443 | **47.9%** | 22.5% | 0.2% |
| matched · 1st touch of the level today | 225 | 196 | **50.0%** | 12.4% | 0.4% |
| node · later touch | 627 | 498 | **48.6%** | 20.1% | 0.5% |
| matched · later touch | 260 | 237 | **47.7%** | 8.5% | 0.4% |

**Other move sizes and horizons (node − matched)**

| variant | node | matched | difference |
|---|---|---|---|
| M 0.12%, 20 bars | 48.2% | 48.7% | -0.5 pts |
| M 0.08%, 20 bars | 45.5% | 44.9% | 0.6 pts |
| M 0.20%, 20 bars | 48.6% | 49.2% | -0.6 pts |
| M 0.12%, 10 bars | 47.4% | 49.3% | -1.9 pts |
| M 0.12%, 30 bars | 48.2% | 48.5% | -0.3 pts |

Node vs fixed random: 48.2% vs 49.0% (fixed n=377).
