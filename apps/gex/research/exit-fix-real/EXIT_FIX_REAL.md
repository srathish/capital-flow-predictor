# EXIT FIX — on the REAL live fires, with REAL option price paths

**RESEARCH ONLY (Clause 0). No live-code changes. Proposal only.**
Date: 2026-07-15 · Author: exit-fix research subagent

## TL;DR

- The live system's **actual exit (X0) loses −1.6%/trade** (total −68.8% over 43 real fires, 49% win). It **captures ≈ 0% of the move that was on the table** (−2% of the true intraday path-peak; −4% of the tracked `best_mark`). The leak is confirmed and it is the exit, not the entry: the median real fire touches **+40–50% intraday** and the structural exit gives it all back.
- **A full-position profit-take at +45%, layered ON TOP of the existing structural exit, turns the book clearly positive: +11.8%/trade (conservative limit fills) to +18.3%/trade (bar-close fills), total +508% to +788%, win 70%.** It beats the actual exit **every one of the 5 days** and survives dropping the single biggest winner.
- **The pre-registered *scale-outs* (X1, X2) do NOT reliably fix it** — X1 is +1.8%/trade overall but **−5.1%/trade on the calls**, X2 is negative. They fail because "scale + hold-to-EOD, no downside stop" removes the structural protection and bleeds losers to the close. **The fix is a profit *cap*, not a scale-out.**
- Honest limit: n=43, 5 days, one regime — **LEAN, directional, not a walk-forward backtest.** The cap fixes "spike-then-fade" fires; it does **not** fix ~9 "straight-down" fires that never offered profit (an entry/hard-stop question, unsolved here — and a naive −30% hard stop, X4, was a net dud).

---

## 1. Data & method

**Fires (ground truth).** `apps/gex/data/gexester.db` → `tracked_plays`, deduped by `(fire_ts_ms, ticker)`, **excluding `trading_day='2026-07-08'`** (pooling-bug day). Result: **43 real fires** across 5 days — 7/09 (5), 7/10 (11), 7/13 (14), 7/14 (5), 7/15 (8). No intra-day dupes existed after the 7/08 exclusion. Patterns: `reverse_rug` (calls) n=29, `rug_setup` (puts) n=12, plus `trapdoor`+`vanna_persistent_bear` (puts) n=2.

**Real price paths.** For each fire's `option_symbol`, pulled the UW option-contract intraday series
`GET api.unusualwhales.com/api/option-contract/{OCC}/intraday?date={trading_day}` (Bearer key from `the final plan/.env`, User-Agent set). 33/43 were already cached under `apps/gex/research/exit-study/cache/`; the 10 missing (mostly 7/15) were fetched fresh (all HTTP 200, 389–405 bars each). Two cache schemas handled: OHLC (`start_time`,`close`,`high`) and light (`ts`,`close`). **Price path = per-minute `close`, from the fire minute → EOD.**

**Fill model (stated).** Buy at `entry_ask` (the recorded ask = real cost basis). All exits fill at **mid × (1 − 0.55%)** = the bid side of the ~1.1% SPX-0DTE spread. All gains are measured **over `entry_ask`** (conservative). The profit-cap is also reported with a **flat limit fill** (books exactly the threshold, no gap bonus) as a pessimistic floor.

**Counterfactual validity.** The variants trade the **full fire→EOD path**, including bars *after* the system's real structural exit — correct, because a different exit rule would not have closed at structural invalidation, so it would have experienced the rest of the day.

### Peak sanity — and a finding
The brief expected `path peak ≈ best_mark`. It does **not** match: median `max(close)/best_mark = 1.24`, and **31/43 fires' fire→EOD close-peak exceeds `best_mark` by >5%.** This is not a data error — **`best_mark` is the peak *while the play was open*; the system exits (structural invalidation) before the option's true intraday peak.** Where a play ran to EOD the two match (17/43 within ±15–20%); where it exited early, the path ran higher afterward. *This truncation is itself evidence of the leak.* (Worked example 182 below: system closed at 15.50 = its peak-while-open; the option then ran to 20.40.)

### Threshold reach-rates (how much was on the table)
On a 1-min close, fire→EOD, fraction of the 43 fires that reached each gain over `entry_ask`:

| +30% | +40% | +45% | +50% | +60% | +100% |
|------|------|------|------|------|-------|
| 74% (32/43) | 67% (29/43) | 65% (28/43) | 58% (25/43) | 56% (24/43) | 37% (16/43) |

Two-thirds of fires **offered +40–45%** intraday. The system books ~0% of it. That gap is the entire study.

---

## 2. Pre-registered exit grid

- **X0 ACTUAL** — recorded `close_mark` (what the system really did). Baseline.
- **X1 SCALE-OUT** — ⅓ @ +30%, ⅓ @ +60%, final ⅓ trails 25% giveback (armed +60%), EOD flat. *No downside stop.*
- **X2 SCALE-OUT-WIDER** — ⅓ @ +50%, ⅓ @ +100%, final ⅓ trails gb30 (armed +100%), EOD flat.
- **X3 FIXED +50%** — sell 100% at +50% if touched; **else keep the structural exit** (= X0's close).
- **X4 FAST +40 / HARD STOP −30** — sell 100% at first +40%; hard stop −30%; else EOD.
- **X5 PEAK-CAPTURE** (reference, not tradeable) — % of the peak each variant captured.
- *(sensitivity, not pre-registered but motivated by the worked example)* **X3b/X3c** = the X3 family with the cap at **+40% / +45%** instead of +50%.

Trail logic matches the repo convention (`ladder_runner.mjs`): stop when `(1+g) ≤ (1+peak)·(1−gb)`.

---

## 3. Results — ALL 43 real fires

Buy @ entry_ask; exits @ mid−0.55%; returns over entry_ask. `cap%` = mean(realized)/mean(peak) as ratio-of-means (stable). `leak` = mean gap to the best single-exit net (path close-peak).

| Variant | mean/trade | median | TOTAL (Σ43) | win% | cap% vs path-peak | cap% vs best_mark | leak vs path-peak |
|--------|-----------:|-------:|------------:|-----:|------:|------:|------:|
| **X0 actual** | **−1.6%** | −1.9% | **−68.8%** | 49% | −2% | −4% | 93.1% |
| X1 scale 30/60/tr25 | +1.8% | +40.2% | +78.9% | 58% | +2% | +5% | 89.7% |
| X2 scale 50/100/tr30 | −1.5% | +14.1% | −63.8% | 51% | −2% | −4% | 93.0% |
| **X3 cap +50** | **+16.2%** | +51.6% | **+694.6%** | 65% | +18% | +44% | 75.4% |
| X4 fast+40 / stop−30 | −0.2% | −31.0% | −7.0% | 40% | −0% | −0% | 91.7% |
| X3b cap +40 | +15.9% | +41.9% | +685.6% | 70% | +17% | +44% | 75.6% |
| **X3c cap +45** | **+18.3%** | +45.4% | **+787.9%** | 70% | +20% | +50% | 73.2% |
| *PK\* best single-exit (ref)* | *+91.5%* | *+70.9%* | *+3936%* | — | *100%* | — | *0%* |

**Conservative check (limit fill = flat threshold, no gap bonus):** cap@45 = **+11.8%/trade, +508% total, 70% win**; cap@40 = +9.4%; cap@50 = +9.3%. So the honest range for the +45 cap is **+11.8% (pessimistic) to +18.3% (bar-close) per trade**, vs actual −1.6%.

**Reading it.** X0 captures essentially none of the move. X3/X3b/X3c — a **full-position profit cap on top of the existing structural exit** — flip the book strongly positive and are a **flat plateau across +40…+50** (not knife-edge). The **scale-outs (X1/X2) do not**; see why below.

---

## 4. By pattern

### reverse_rug (calls), n=29
| Variant | mean | median | TOTAL | win% |
|--------|-----:|-------:|------:|-----:|
| X0 actual | −0.5% | +0.7% | −14.3% | 52% |
| **X1 scale** | **−5.1%** | +26.7% | **−147.0%** | 52% |
| X2 scale | −8.9% | −17.7% | −257.4% | 48% |
| **X3 cap+50** | **+14.0%** | +50.3% | **+407.4%** | 62% |
| X4 fast/stop | −4.1% | −31.2% | −118.0% | 34% |
| X3c cap+45 | +14.6% | +44.7% | +424.8% | 66% |

### rug_setup (puts), n=12
| Variant | mean | median | TOTAL | win% |
|--------|-----:|-------:|------:|-----:|
| **X0 actual** | **−7.4%** | −24.9% | **−88.7%** | 42% |
| X1 scale | +20.6% | +46.7% | +247.2% | 75% |
| X2 scale | +17.9% | +65.5% | +214.9% | 58% |
| X3 cap+50 | +21.2% | +54.9% | +254.3% | 75% |
| X4 fast/stop | +3.3% | +4.9% | +39.4% | 50% |
| **X3c cap+45** | **+27.5%** | +46.4% | **+330.2%** | 83% |

(*other puts, trapdoor+vanna, n=2: X0 +17.1%, X3c +16.5%, X4 +35.7% — too small to weigh.*)

**Why X1/X2 fail on calls but the cap wins.** The scale-outs replace the structural exit with "partial profits + hold-to-EOD, no stop." A call that ticks +30% (books ⅓) then rolls over rides the other ⅔ to ~0 by EOD → **X1 = −5.1%/trade on calls, worse than doing nothing.** The **cap (X3/X3c) keeps the structural exit as the downside** and only *adds* an upper rail, so it never introduces that hold-to-EOD bleed — it is **purely additive.** For the puts (the disaster-prone side, X0 = −7.4%/trade), *any* profit-harvest helps, and the +45 cap is best (−89% → +330%, 42%→83% win).

---

## 5. The 7/15 worked examples

### Play 180 — SPXW `rug_setup` P7535, entry_ask 9.10 (the −98% disaster)
Peaked **+46%** intraday (best_mark 13.15), then rugged to −99% by EOD. `best_mark_ts` 16:40, but the system did not close until **18:43** — it *held through the entire 2-hour giveback* (structural invalidation fired late).

| X0 | X1 | X2 | X3 (+50) | X4 | **X3c (+45)** |
|---:|---:|---:|---:|---:|---:|
| **−97.5%** | −54.2% | −99.5% | −97.5% | +45.4% | **+45.4%** |

- X0 held it to −98%. **X3 (+50) does NOT save it** (peak +46% never reached +50 → fell back to the structural disaster). **X4 and X3c (+45) DO save it** (+45%) — the +46% peak clears a +45 cap by a hair. *This single fire is the whole argument for +45 over +50.*
- X1's ⅓@+30 banked +36% but the other ⅔ rode to −99% → −54%.

### Play 182 — SPXW `reverse_rug` C7555, entry_ask 6.50 (the +138% winner)
Path peaked **+211%** (close 20.20). The system exited at 15.50 = its peak-while-open (`best_mark_ts` = `close_ts` = 17:53); the option ran higher afterward.

| **X0** | X1 | X2 | X3 (+50) | X4 | X3c (+45) |
|---:|---:|---:|---:|---:|---:|
| **+137.2%** | +75.4% | +89.2% | +68.3% | +68.3% | +68.3% |

- Here the actual structural exit **nailed it** (+137%); the profit-caps **clip** it to +68% and the scale-out to +75%. **This is the cost of the cap: it shaves the fat-tail winners.**

**The book-level trade-off (X3c vs X0):** the cap **rescues 22 faded fires (+1120 pts)** and **clips 4 monster winners (−267 pts)** → **net +857 pts.** The 4 clipped winners (plays 185 +197→+50, 182 +137→+68, 144 +86→+48, 178 +58→+45) still bank +45–68%. Giving up upside on 4 to save 22 is a 4:1 win. It fixes the −98% put **without turning the +138% call into a loss** (it becomes +68%).

---

## 6. Peak-capture (X5) — is the peak illusory?

Partly yes, and that is the honest bound. Mean **path-peak = +91.5%** — but that is a spiky high-tick that reverses fast; **no rule catches it.** Realistic capture:

| | vs true path-peak (+91.5%) | vs tracked best_mark (+36.4%) |
|---|---:|---:|
| X0 actual | −2% | −4% |
| X3c cap+45 | **+20%** | **+50%** |

So "capture the +91% peak" is illusory (the paths are too spiky), **but the system currently captures ≈ 0% and a simple +45 cap captures ~20% of the path-peak / half of best_mark — and that alone flips −1.6%/trade to +12…+18%/trade.** The edge is not in catching the spike; it is in *not giving the whole thing back.*

---

## 7. Robustness (and what does NOT work)

- **Drop the single biggest winner:** X3c +18.3→**+16.2%/trade** (still strong); X0 −1.6→**−6.3%/trade** (the actual exit is *tail-dependent and fragile* — it worsens without its lucky winners; the cap does not).
- **Every day:** X3c ≥ X0 on all 5 days — 7/09 +48 vs +32, 7/10 +17 vs −10, 7/13 +11 vs −14, 7/14 −1.3 vs −1.8, 7/15 +26 vs +11. No day where the cap hurt.
- **Naive scale-out (X1/X2):** does not reliably turn positive; negative on calls. **A profit *cap* beats both the structural exit AND the scale-out.**
- **Naive hard stop (X4, −30%):** a **net dud** (−0.2%/trade, 40% win) — the −30% stop churns out of calls that dip-then-recover. Downside is *not* fixed by a naive fixed stop.
- **Residual losers (unsolved):** 9 fires still finish < −40% under the cap (e.g., 181, 170, 168, 164, 151) — all "**straight-down**" fires whose peak never exceeded +17%. There is no profit to cap; these inherit the structural downside. **That is an entry-quality / smarter-stop problem, out of scope for a profit-take rule.** The cap does not make the book bullet-proof; it stops the *give-backs*.

---

## 8. VERDICT

**(a) Which exit turns the real fires positive?** A **full-position profit-take (cap) layered on top of the existing structural exit** — X3 (+50) / X3b (+40) / X3c (+45). Best point: **X3c +45%** → **+11.8% to +18.3%/trade** (conservative→bar-close), +508%→+788% total, 70% win, vs actual **−1.6%/trade, −68.8%, 49%**.

**(b) How much of the +37% avg peak does each capture?** The system ≈ 0%; the +45 cap ~20% of the true path-peak / ~50% of best_mark. The rest is genuinely uncatchable (spiky).

**(c) Does profit-taking beat both structural AND "hold to target"?** Yes — it beats X0 (structural) and X1/X2 (scale-out/hold). The winning move is a *cap that keeps the structural downside*, not a scale-out that discards it.

**(d) Does it fix the disaster without killing the winner?** Yes for +45 (saves the −98% put → +45%; the +138% call becomes +68%, still a large win). +50 leaves that specific put unsaved.

### Single recommended exit config (proposal — not shipped)

> **Add one rule and change nothing else:** *"If the mid reaches +45% over your entry (ask) cost, sell the full position. Otherwise, the existing structural-invalidation exit stands as the downside/fallback. EOD flat."*

- **Purely additive** — does not touch entries or the structural stop; just installs an upper profit rail that harvests the +45%+ spikes the system currently gives back. Consistent with Clause 0 (this is a proposal).
- **Treat the band, not the exact number, as the result:** +40…+50 is a flat plateau. +45 is the point pick only because it clears the +46% peak of the 7/15 put disaster with a hair to spare — the +45-vs-+50 distinction rests on that one fire.
- **Known gap it does NOT close:** the ~9 straight-down fires (entry/hard-stop problem). A naive −30% stop is not the answer (X4 proved it hurts). That is the next study.

### Caveats (LEAN)
n=43, 5 days, single regime; not walk-forward; per-fire fills modeled with a flat 0.55% exit haircut (live latency/slippage/partial-fills not fully modeled); `best_mark` truncates the intraday move so the counterfactual assumes we would actually hold past the structural point. Directional evidence for a concrete, additive fix — not a backtest-grade edge.

---

## Appendix — per-fire detail (all 43, deduped, ex-7/08)

Columns: entryASK cost; peakClose = max 1-min close gain over entry (fire→EOD); best_mk = tracked `best_mark`; then realized % per variant (buy@ask, exits@mid−0.55%). X3c = +45 cap.

| id | day | tkr | pattern | opt | entryASK | peakClose | best_mk | X0 | X1 | X2 | X3(+50) | X4 | X3c(+45) |
|----|-----|-----|---------|-----|---------|-----------|---------|----|----|----|--------|----|---------|
| 144 | 07-09 | QQQ | reverse_rug | C717 | 3.16 | +129% | 5.96 | +86% | +44% | +64% | +60% | +48% | +48% |
| 145 | 07-09 | SPY | reverse_rug | C749 | 1.39 | +119% | 1.50 | -7% | +54% | +67% | +57% | -31% | +46% |
| 146 | 07-09 | QQQ | reverse_rug | C715 | 3.11 | +196% | 4.91 | +42% | +92% | +111% | +54% | +54% | +54% |
| 147 | 07-09 | SPY | reverse_rug | C750 | 1.07 | +92% | 1.25 | +17% | +45% | +55% | +51% | +44% | +47% |
| 148 | 07-09 | SPY | reverse_rug | C751 | 0.70 | +69% | 1.10 | +24% | +40% | +14% | +52% | +46% | +46% |
| 149 | 07-10 | QQQ | reverse_rug | C722 | 2.94 | +46% | 3.39 | -25% | +27% | +25% | -25% | -41% | +45% |
| 150 | 07-10 | SPY | reverse_rug | C753 | 1.23 | +91% | 1.31 | +1% | +54% | +67% | +62% | -33% | +62% |
| 151 | 07-10 | SPY | rug_setup | P749 | 1.35 | -17% | 0.91 | -81% | -99% | -99% | -81% | -31% | -81% |
| 153 | 07-10 | QQQ | trapdoor | P720 | 2.00 | +17% | 2.08 | -73% | -100% | -100% | -73% | -34% | -73% |
| 152 | 07-10 | SPXW | reverse_rug | C7520 | 26.00 | +131% | 36.80 | +30% | +69% | +85% | +50% | +42% | +45% |
| 154 | 07-10 | QQQ | reverse_rug | C721 | 2.72 | +95% | 3.01 | +4% | +59% | +70% | +55% | -33% | +55% |
| 155 | 07-10 | SPY | reverse_rug | C753 | 1.04 | +126% | 1.17 | +1% | +64% | +85% | +53% | -33% | +44% |
| 156 | 07-10 | QQQ | reverse_rug | C724 | 1.49 | +64% | 1.99 | -7% | +36% | +33% | +56% | +39% | +48% |
| 157 | 07-10 | SPY | reverse_rug | C754 | 0.58 | +131% | 1.19 | +82% | +65% | +80% | +92% | +92% | +92% |
| 158 | 07-10 | QQQ | reverse_rug | C726 | 0.89 | +2% | 0.90 | -54% | -92% | -92% | -54% | -39% | -54% |
| 159 | 07-10 | QQQ | reverse_rug | C726 | 0.42 | +31% | 0.56 | +8% | -46% | -83% | +8% | -31% | +8% |
| 160 | 07-13 | SPY | reverse_rug | C753 | 1.10 | +45% | 1.69 | +26% | -53% | -99% | +26% | +45% | +45% |
| 161 | 07-13 | SPXW | vanna_persistent_bear | P7555 | 10.30 | +346% | 24.15 | +107% | +78% | +78% | +106% | +106% | +106% |
| 162 | 07-13 | SPY | rug_setup | P752 | 1.62 | +138% | 1.90 | -19% | +53% | +76% | +57% | -40% | +49% |
| 163 | 07-13 | SPXW | rug_setup | P7555 | 12.80 | +259% | 22.05 | +38% | +35% | +86% | +61% | +45% | +45% |
| 164 | 07-13 | SPY | reverse_rug | C753 | 1.11 | -7% | 1.10 | -87% | -99% | -99% | -87% | -32% | -87% |
| 165 | 07-13 | QQQ | rug_setup | P717 | 1.91 | +250% | 2.75 | -38% | +66% | +83% | +52% | +43% | +45% |
| 166 | 07-13 | SPXW | reverse_rug | C7550 | 10.00 | +31% | 10.55 | -4% | -57% | -100% | -4% | -33% | -4% |
| 167 | 07-13 | SPXW | rug_setup | P7550 | 10.80 | +297% | 17.05 | +30% | +76% | +89% | +54% | +43% | +54% |
| 168 | 07-13 | QQQ | reverse_rug | C718 | 1.73 | -1% | 1.75 | -90% | -99% | -99% | -90% | -31% | -90% |
| 169 | 07-13 | SPXW | reverse_rug | C7545 | 9.50 | +12% | 10.65 | -69% | -99% | -99% | -69% | -41% | -69% |
| 170 | 07-13 | QQQ | reverse_rug | C714 | 1.27 | +0% | 1.32 | -94% | -99% | -99% | -94% | -32% | -94% |
| 171 | 07-13 | QQQ | rug_setup | P713 | 1.33 | +114% | 1.90 | +18% | +48% | +68% | +64% | -33% | +64% |
| 172 | 07-13 | SPXW | rug_setup | P7520 | 7.60 | +75% | 8.80 | -52% | +43% | -7% | +56% | -44% | +47% |
| 173 | 07-13 | SPY | rug_setup | P749 | 0.51 | +100% | 0.94 | +41% | +48% | +63% | +72% | +46% | +46% |
| 174 | 07-14 | SPXW | reverse_rug | C7530 | 20.20 | +43% | 22.30 | +2% | -5% | -29% | +2% | -33% | +2% |
| 175 | 07-14 | QQQ | reverse_rug | C720 | 2.45 | +14% | 2.12 | -63% | -94% | -94% | -63% | -31% | -63% |
| 177 | 07-14 | QQQ | reverse_rug | C720 | 1.58 | +27% | 1.54 | -37% | -91% | -91% | -37% | -33% | -37% |
| 176 | 07-14 | SPXW | reverse_rug | C7540 | 9.40 | +52% | 13.80 | +31% | -25% | -18% | +52% | -31% | +47% |
| 178 | 07-14 | QQQ | reverse_rug | C720 | 0.64 | +72% | 1.10 | +58% | +41% | -34% | +55% | +41% | +45% |
| 179 | 07-15 | SPXW | reverse_rug | C7570 | 14.50 | +25% | 15.00 | -2% | -85% | -85% | -2% | -37% | -2% |
| 180 | 07-15 | SPXW | rug_setup | P7535 | 9.10 | +46% | 13.15 | -98% | -54% | -99% | -98% | +45% | +45% |
| 181 | 07-15 | QQQ | rug_setup | P711 | 1.69 | -2% | 1.67 | -96% | -99% | -99% | -96% | -42% | -96% |
| 182 | 07-15 | SPXW | reverse_rug | C7555 | 6.50 | +211% | 15.50 | +137% | +75% | +89% | +68% | +68% | +68% |
| 183 | 07-15 | QQQ | rug_setup | P717 | 1.11 | +83% | 1.08 | -31% | +45% | -44% | +63% | -34% | +63% |
| 184 | 07-15 | QQQ | reverse_rug | C718 | 0.85 | +40% | 1.12 | -13% | -50% | -92% | -13% | -31% | -13% |
| 185 | 07-15 | QQQ | rug_setup | P718 | 0.80 | +262% | 2.92 | +197% | +85% | +98% | +50% | +40% | +50% |
| 186 | 07-15 | SPXW | reverse_rug | C7560 | 5.30 | +130% | 5.45 | -11% | +83% | +110% | +92% | -31% | +92% |

*Method/scripts: fires from `gexester.db:tracked_plays`; real option paths from UW `option-contract/{OCC}/intraday`; sim in scratchpad `exitfix.py` (buy@ask, exits@mid−0.55%, gains over entry_ask, causal per-minute-close triggers). Research artifact only — no live-code change.*
