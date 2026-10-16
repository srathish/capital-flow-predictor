# Trend day detected by 10:30 + ladder breaks + GEX/VEX

Run 2026-10-16T23:15:01.870Z · SPY/QQQ/IWM/DIA · breaks at or after 10:30 · target = next ladder level (IB high/low added)

**Validated (BH q = 0.10 across 8): none**

| id | test | build | holdout |
|---|---|---|---|
| U1 | TD(0.75) breaks after 10:30 | -0.120 (t -1.49, n 799, hit 19%) | **-0.093 (t -1.04, n 704, hit 20%)** |
| U2 | TD(0.75) minus non-TD | +0.042 (t 0.46, n 799) | **-0.089 (t -0.89, n 704)** |
| U3 | TD(0.75) + aligned (holding outside the IB) | -0.310 (t -1.15, n 147, hit 13%) | **-0.207 (t -1.29, n 128, hit 21%)** |
| U4 | U3 + GEX/VEX confluence (target on node, air pocket) | — (t —, n 27) | **— (t —, n 12)** |
| U5 | U3 + dealers short gamma | -0.110 (t -0.21, n 70, hit 16%) | **-0.108 (t -0.50, n 60, hit 27%)** |
| U6 | U3 + air pocket | -0.418 (t -2.09, n 77, hit 14%) | **-0.183 (t -0.88, n 72, hit 25%)** |
| U7 | TD(0.5) + aligned | -0.343 (t -3.44, n 549, hit 14%) | **-0.137 (t -1.23, n 555, hit 21%)** |
| U8 | TD(1.0) + aligned | -0.755 (t -4.41, n 38, hit 11%) | **— (t —, n 22)** |

Share of symbol-days flagged TD(0.75): build 21%, holdout 19%.
