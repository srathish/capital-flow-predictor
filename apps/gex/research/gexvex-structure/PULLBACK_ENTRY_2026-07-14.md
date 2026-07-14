# Pullback Entry — 2026-07-14

**RESEARCH ONLY (Clause 0). No live-code change proposed. VERDICT: KILL.**

Script: `research/gexvex-structure/pullback_entry.mjs` (reproduce: `node pullback_entry.mjs 0.03`)
Data: `research/exit-study/fires_index.json` + per-minute UW option marks (`exit-study/cache/`).
1,295 fires with a usable option path (of 1,355), 61 days, 2026-04-10 → 2026-07-10.

---

## Verdict

**Pullback entry does NOT improve the system. It is an adverse-selection machine.**

The rule gets filled precisely on the fires that fail, and misses the fires that work. Every
trade it takes *is* better (entry gain +6 to +14pt of system P&L, MAE improves from −95% to −69%,
win rate 33% → 53%, profit factor 0.35 → 0.80). But the trades it takes are, even after that large
improvement, **worse than the average baseline trade in 12 of 12 (X,W) cells**. Against the correct
control — a volume-matched *random* skip — it loses in **12/12 cells on the full set** and **10/12
on the out-of-sample half**; the two positive test cells have day-block bootstrap p = 0.62 and 0.97.

The pre-registered "system delta" metric is **confounded** and I do not rely on it (see §3).

---

## 1. The premise partly replicates — but not the strongest claim

On the 1,295-fire replay set, measured from the signal price E (= option close at fire + 60s):

| Fact | Live (n=35, 4 days) | Replay (n=1,295, 61 days) |
|---|---|---|
| Median 30-min drawdown from signal | −41% | **−31.7%** ✅ |
| Share dropping >20% within 30 min | 71% | **65.9%** ✅ |
| Share never green within 30 min | 57% | **15.2%** ❌ |

The drawdown fact is real and replicates. The "57% go straight down" figure does **not** — on the
big sample only 15% never tick green within 30 minutes. That number was a small-sample artifact of
the last 4 days. The mechanism story ("we buy the exhaustion of the impulse") survives; the extreme
version of it does not.

Also note the baseline itself: **entering at the signal and exiting on the live trail (arm 0.50,
giveback 0.15) to EOD averages −6.8% per fire on the unfiltered replay set.** The raw signal set is
negative-EV under a trail exit. This is the fact that poisons the pre-registered metric.

## 2. Method

- **Signal price E** = option close at first candle ≥ fireTs + 60s (same confirmation delay as every
  prior study in this program).
- **Treatment**: resting limit buy at `L = E·(1−X)`. Triggered when a candle **close** in
  `(signalTs, signalTs + W]` is ≤ L. **Fill at L, not at the close** — the close is often well below
  L, and filling at the close would be an optimistic look-ahead. If no close ≤ L inside W → **no trade**.
- **Exit is RE-SIMULATED from the new entry.** The live trail (arm 0.50, giveback 0.15; exit when
  `(1+g) ≤ (1+peak)·(1−gb)`) is recomputed on gains measured from the *new* entry price, running to EOD.
  The old exit is *not* reused (that was the flaw in the crude 5-fire sim).
  - **Stated limitation**: the live *structure* exit cannot be re-simulated from a 5-min surface archive
    at scale. The **trail is used as the exit for BOTH arms**, so the comparison is apples-to-apples.
- **Fill haircut** 3% on entry *and* exit, both arms: `realized = (exit·0.97)/(entry·1.03) − 1`.
  Re-run at 2% — identical conclusion.
- **System P&L** = per-signal mean with **skipped fires counted as 0**. Trades-taken average is also
  reported but is *not* the verdict metric.
- Walk-forward: chronological halves, split at 2026-05-22 (train 660 fires / test 635).

## 3. The confound that kills the pre-registered metric

The pre-registered "system delta" (per-signal mean, skipped = 0) says four cells look good:

| X | W | fill % | SYSTEM base | SYSTEM treat | raw delta |
|---|---|---|---|---|---|
| 30% | 15m | 34.9% | −6.8% | −2.9% | **+3.9pt** |
| 40% | 15m | 20.2% | −6.8% | −2.5% | **+4.3pt** |
| 40% | 30m | 37.1% | −6.8% | −3.4% | **+3.4pt** |
| 20% | 15m | 51.3% | −6.8% | −5.9% | +0.9pt |

**These are an artifact of trading less.** Baseline P&L is −6.8% per signal. Skipping 80% of a losing
system pushes the per-signal mean toward zero *for free*: a **random** 20.2% skip scores
`0.202 × (−6.8%) = −1.4%`, i.e. **+5.4pt** — *better than the +4.3pt the pullback rule achieves at the
same volume.* The rule underperforms doing nothing intelligent at all.

The confound-free metric is therefore **vs a volume-matched random skip**:

```
system_treat − system_random(f)  =  f · [ mean(P&L of trades TAKEN) − mean(P&L of ALL baseline trades) ]
```

The rule adds value **only if the trades it takes beat the average baseline trade.** They never do:

| X | W | f (fill) | per-trade of TAKEN | avg baseline trade | **vs RANDOM-skip @ f** |
|---|---|---|---|---|---|
| 10% | 15m | 72.0% | −12.2% | −6.8% | **−3.9pt** |
| 10% | 30m | 81.4% | −12.0% | −6.8% | **−4.2pt** |
| 10% | 60m | 86.9% | −12.6% | −6.8% | **−5.1pt** |
| 20% | 15m | 51.3% | −11.6% | −6.8% | **−2.4pt** |
| 20% | 30m | 65.8% | −14.0% | −6.8% | **−4.8pt** |
| 20% | 60m | 76.3% | −13.0% | −6.8% | **−4.7pt** |
| 30% | 15m | 34.9% | −8.3% | −6.8% | **−0.5pt** |
| 30% | 30m | 51.7% | −13.7% | −6.8% | **−3.6pt** |
| 30% | 60m | 65.0% | −14.5% | −6.8% | **−5.0pt** |
| 40% | 15m | 20.2% | −12.5% | −6.8% | **−1.1pt** |
| 40% | 30m | 37.1% | −9.1% | −6.8% | **−0.8pt** |
| 40% | 60m | 54.8% | −12.8% | −6.8% | **−3.3pt** |

**0 of 12 cells beat a coin-flip skip.** Per-trade-of-taken is worse than the average baseline trade in
every single cell, despite a +6 to +14pt entry improvement on those same fires.

## 4. Decomposition — where the money goes

```
raw system delta  =  ENTRY GAIN  −  FOREGONE
                     (better fill      (baseline P&L of the
                      on fires taken)   fires we skip)
```

| X | W | ENTRY GAIN | FOREGONE | raw delta |
|---|---|---|---|---|
| 20% | 30m | +10.3pt | **−12.7pt** | −2.4pt |
| 30% | 30m | +11.7pt | **−11.9pt** | −0.3pt |
| 30% | 60m | +11.7pt | **−14.3pt** | −2.6pt |
| 40% | 60m | +14.1pt | **−14.3pt** | −0.2pt |
| 40% | 15m | +6.1pt | −1.8pt | +4.3pt *(← the "gain" is just the 80% skip)* |

The entry gain is large and real. The foregone P&L is **larger**. And in the cells where foregone is
small (40%/15m), it is small only because volume collapsed to 20% — and there the "gain" is entirely
the volume-reduction artifact.

## 5. WHY — the retracement is a failure signal

The fires that pull back are the fires that fail. Fill rate by baseline-P&L decile (X=20%, W=30m):

```
D1(worst) D2   D3   D4   D5   D6   D7   D8   D9   D10(best)
  96%     92%  92%  78%  64%  47%  47%  51%  40%   51%
```

The rule fills **96% of the worst decile** and ~45% of the best. Of the top-10% baseline winners
(mean +155%), only **51% ever offer a 20% pullback within 30 minutes**. The big trend winners go
straight up from the signal and never come back — they are exactly the ones you cannot buy on a dip.

Skipped fires under the baseline:

| X | W | skipped n | their baseline P&L | their win % | their PF |
|---|---|---|---|---|---|
| 20% | 30m | 443 | **+37.2%** | 84.9% | 4.51 |
| 30% | 60m | 453 | **+41.0%** | 86.3% | 5.56 |
| 10% | 60m | 170 | **+64.7%** | 96.5% | 46.8 |

You are systematically discarding a set of trades with an 85–96% win rate and a 4–47 profit factor,
in exchange for better entries on a set that is losing anyway.

## 6. Walk-forward + multiple comparisons

Best-in-TRAIN cell = X=40%, W=15m. Its honest OOS result:
- Raw system delta: train +3.3pt → test **+5.3pt** (bootstrap p = 0.099; **Bonferroni-adjusted across
  K=12 cells: p = 1.000**) — and this is the confounded metric anyway.
- **vs random-skip**: train −1.9pt → test **−0.3pt** (day-block bootstrap p = 0.880).

Cells positive on the TEST half:
- Raw (confounded) system delta: **6/12** — exactly what a coin flip predicts.
- vs volume-matched random skip: **2/12** (30%/15m: +1.1pt, p=0.62; 40%/30m: +0.1pt, p=0.97). Noise.

No cell survives the multiple-comparisons discount on either metric.

## 7. Direction split — symmetry claim holds, and it is symmetric *nullity*

Calls (BULL_REVERSE, n=492) baseline −2.5%; puts (BEAR_*, n=803) baseline −9.5%.

Raw system delta looks positive on the put side (X=40/15m: **+8.6pt**; X=30/15m: +7.2pt) and negative
on the call side (−2.7pt, −1.6pt). **This is entirely the volume confound again**: the put baseline is
much more negative (−9.5%), so skipping ~79% of put fires buys a bigger free "gain". The mechanism is
identical on both sides — the pullback fires that fill are the losers, in calls and in puts alike. The
symmetry claim is true; what is symmetric is that the rule fails both ways.

## 8. What the rule *does* deliver (and why it is not enough)

On the trades it actually takes, versus those *same fires* entered at the signal:

| X | W | median MAE base → pullback | win % base → pullback | PF base → pullback | median wait |
|---|---|---|---|---|---|
| 20% | 30m | −88.8% → **−72.6%** | 39.8% → **50.1%** | 0.43 → **0.68** | 7m |
| 30% | 15m | −95.0% → **−68.9%** | 33.4% → **53.1%** | 0.35 → **0.80** | 8m |
| 40% | 15m | −96.8% → **−76.2%** | 28.6% → **45.8%** | 0.31 → **0.73** | 9m |

Every metric improves. MAE improves by 16–26 points. Win rate jumps ~15–20 points. PF roughly doubles.
**And the profit factor is still below 1.0 in every cell.** A better entry on a structurally losing
trade is still a losing trade. This is the whole finding in one line.

## 9. Robustness

- **Haircut 2% instead of 3%**: identical conclusion — 12/12 cells lose to the volume-matched random skip.
- **Optimistic fill variant** (fill at the bar *close*, which is below L, instead of at L): raw system
  P&L improves ~3–5pt across the board (e.g. X=40/30m goes −3.4% → +0.7%). This is a **look-ahead
  artifact** and is reported only to show the result is not fragile in the *conservative* direction —
  the honest limit-fill assumption is the one used for the verdict. Even under the optimistic fill, no
  cell's per-trade-of-taken beats the average baseline trade by enough to clear the random-skip control.

## 10. Limitations (stated honestly)

1. **Exit fidelity.** The live *structure* exit cannot be re-simulated from a 5-min surface archive at
   scale. The trail (0.50/0.15) stands in for it on **both** arms. If the structure exit interacts with
   entry price in some way the trail does not, this study would miss it — but there is no mechanism by
   which that would flip an adverse-selection result of this magnitude.
2. **Unfiltered fire set.** This runs on all 1,295 replay fires, where the baseline is −6.8%/fire. The
   live system trades a **gate-filtered** subset (bull tape gate + n-flags), on which the baseline is
   positive. The *adverse-selection mechanism* is a property of the option path (fires that retrace are
   fires that fail) and should carry over, but **the study has not been re-run on gate-survivors only**.
   That is the one remaining test that could, in principle, resurrect this. I would not bet on it, and
   it should not be run as a fishing expedition — the decile chart in §5 is the whole story.
3. Intra-bar touches are invisible at 1-min granularity; the close-based trigger is conservative and
   understates fill rate slightly. This biases *against* the rule only in volume, not in selection.

## 11. Conclusion

**KILL.** The measured fact ("we enter at the top") is real. The proposed fix does not work, because the
drawdown and the outcome are the *same variable*: a fire that retraces is a fire that is failing. Waiting
for the pullback is waiting for confirmation that the trade is bad, and then buying it cheaper. The
non-retracing trend winners — 85–96% win rate, PF 4 to 47 — are precisely the ones the rule cannot buy,
and losing them costs more than the better entries gain.

**The entry problem is real and remains open.** The right direction is not a *price* condition on the
option, which is endogenous to the outcome. It is an *exogenous* condition — one that separates
impulse-exhaustion fires from trend-continuation fires **at signal time**, using information other than
the subsequent option price. (The wall-vs-escalator work is the live candidate for that.)

### DECISIONS NEEDED
None. No live-code change proposed. Recommend closing the pullback-entry line of inquiry.
