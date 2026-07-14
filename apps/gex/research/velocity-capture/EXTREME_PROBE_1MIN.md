# Extreme-Probe — Asymmetric Quick-Abort Entry at Range Extremes (1-min)

**RESEARCH ONLY (Clause 0). No live-code change. Findings → DECISIONS NEEDED.**
Snapshot 2026-07-14 PM. **10 trading days, 30 (day,ticker) series** of 1-min Skylit surfaces
(2026-06-30, 07-01, -02, -06, -07, -08, -09, -10, -13, -14). Part B (§B) is **pre-registered and frozen
before outcomes**; Part A (§A) is forensic/descriptive. n≈10 day-blocks → **every verdict is a LEAN**, not
a finding. Day-block bootstrap + Bonferroni applied to the primary grid.

---

## One-line verdict

**The abort caps losses exactly as designed — and that is what kills the system.** Expectancy/probe is
**≈ 0 after costs in all four pre-registered cells** (−2% to −4% net; every 90% day-block CI straddles
zero; best cell `A15/G40` all-side **−2%**, P(mean>0)=34%). The asymmetry *does* materialize per-trade —
the fast abort realizes **−19%** (A=15) / **−27%** (A=25), i.e. right at nominal-A + the 3% haircut, with
the worst single abort of all 360 probes only **−67%** (not the −88% MAE the live system sits through) —
and winners are big (+52–58% avg, right-tail to **+732%**). But at a **70–78% abort rate** the many small
aborts and the few big winners net to **zero**. The decisive result is the ablation: **removing the quick
abort *improves* expectancy** (control (c): all +2%, **calls +16%**, median +30%, **P(mean>0)=85%**). The
abort is **net-negative** — on liquid index 0DTE it sells the bottom of the noise and price recovers. The
operator's "enter AT the extreme" half has a small **real** edge (probes beat random-timing matched, whose
CI is entirely negative, and beat the live system's actual fires); the "exit quickly when wrong" half is
**falsified** on this data.

**Salvage:** *extreme-location entry + a normal/loose trail* (no quick abort) is the only variant that
clears break-even, and only on the call side. Nothing qualifies for ghost testing as specified.

---

## §A — Forensics of the extremes (descriptive)

### A.1 What the turns actually paid (idealized hindsight entry AT the extreme minute)

For each series: the day's **true session low** (→ ATM call) and **true session high** (→ ATM put),
entered at the exact extreme minute (perfect hindsight — this is the R:R **ceiling**, not achievable
live). `MFE` = max favorable *underlying* move to EOD. `live` / `loose` = ATM 0DTE net P&L (3% haircut)
under the live trail (arm .50 / gb **.15**) vs a loose runner (arm .50 / gb **.40**). `node` = nearest
strong node (relSig≥0.10 sustained ≥5min) armed by that minute: sign + distance (%spot). `king` = King
share; `appVel` = 5-min approach return into the extreme.

| day | tkr | ext | ET | spot | MFE | live | loose | nearest node | king | appVel |
|---|---|---|---|---|---|---|---|---|---|---|
| 06-30 | SPXW | low | 09:30 | 7440 | 0.9% | 47% | 155% | — | 0.13 | — |
| 06-30 | SPXW | high | 15:18 | 7507 | 0.1% | 51% | -1% | barney 0.03% | 0.27 | 0.04% |
| 06-30 | SPY | low | 09:30 | 741 | 0.9% | 48% | 141% | — | 0.22 | — |
| 06-30 | SPY | high | 15:18 | 748 | 0.2% | 31% | -4% | pika 0.11% | 0.41 | 0.03% |
| 06-30 | QQQ | low | 09:30 | 724 | 1.8% | 28% | 176% | — | 0.12 | — |
| 06-30 | QQQ | high | 15:58 | 737 | 0.2% | 66% | 66% | pika 0.06% | 0.33 | 0.11% |
| 07-01 | SPXW | low | 09:35 | 7452 | 0.9% | 73% | 73% | pika 0.09% | 0.13 | -0.64% |
| 07-01 | SPXW | high | 12:24 | 7522 | 0.5% | 35% | 64% | pika 0.04% | 0.26 | 0.06% |
| 07-01 | SPY | low | 09:35 | 743 | 0.9% | 86% | 92% | barney 0.18% | 0.11 | -0.54% |
| 07-01 | SPY | high | 12:24 | 749 | 0.5% | 84% | 49% | barney 0.05% | 0.41 | 0.06% |
| 07-01 | QQQ | low | 15:58 | 725 | 0.1% | -58% | -58% | pika 0.28% | 0.21 | -0.15% |
| 07-01 | QQQ | high | 09:30 | 736 | 1.5% | 45% | 45% | — | 0.28 | — |
| 07-02 | SPXW | low | 13:59 | 7428 | 0.7% | 71% | 62% | pika 0.03% | 0.28 | -0.09% |
| 07-02 | SPXW | high | 10:14 | 7540 | 1.5% | 92% | 338% | pika 0.20% | 0.17 | 0.10% |
| 07-02 | SPY | low | 13:59 | 740 | 0.7% | 60% | 52% | pika 0.01% | 0.21 | -0.09% |
| 07-02 | SPY | high | 10:14 | 751 | 1.5% | 92% | 355% | barney 0.11% | 0.16 | 0.10% |
| 07-02 | QQQ | low | 13:59 | 708 | 0.8% | 104% | 38% | pika 0.05% | 0.21 | -0.13% |
| 07-02 | QQQ | high | 10:03 | 731 | 3.1% | 24% | 6% | pika 0.21% | 0.16 | 0.21% |
| 07-06 | SPXW | low | 09:30 | 7483 | 0.9% | 31% | 33% | — | 0.10 | — |
| 07-06 | SPXW | high | 15:26 | 7551 | 0.2% | 20% | -16% | pika 0.01% | 0.22 | 0.01% |
| 07-06 | SPY | low | 09:30 | 745 | 1.0% | 26% | 35% | — | 0.16 | — |
| 07-06 | SPY | high | 15:26 | 752 | 0.2% | 126% | 76% | barney 0.04% | 0.34 | 0.01% |
| 07-06 | QQQ | low | 09:30 | 713 | 1.9% | 24% | 15% | — | 0.17 | — |
| 07-06 | QQQ | high | 12:11 | 726 | 0.7% | 57% | 107% | barney 0.14% | 0.13 | 0.07% |
| 07-07 | SPXW | low | 10:42 | 7482 | 0.5% | 100% | 44% | pika 0.29% | 0.13 | -0.12% |
| 07-07 | SPXW | high | 09:30 | 7537 | 0.7% | 20% | 100% | — | 0.09 | — |
| 07-07 | SPY | low | 10:42 | 746 | 0.5% | 41% | 49% | pika 0.06% | 0.31 | -0.12% |
| 07-07 | SPY | high | 09:30 | 751 | 0.8% | 49% | 81% | — | 0.21 | — |
| 07-07 | QQQ | low | 10:42 | 705 | 1.2% | 28% | 83% | pika 0.66% | 0.14 | -0.19% |
| 07-07 | QQQ | high | 09:30 | 723 | 2.4% | 26% | 19% | — | 0.31 | — |
| 07-08 | SPXW | low | 11:28 | 7423 | 0.9% | 98% | 252% | pika 0.09% | 0.15 | -0.12% |
| 07-08 | SPXW | high | 09:30 | 7504 | 1.1% | 26% | -8% | — | 0.32 | — |
| 07-08 | SPY | low | 11:28 | 740 | 0.8% | 95% | 212% | pika 0.04% | 0.24 | -0.12% |
| 07-08 | SPY | high | 09:30 | 748 | 1.1% | 28% | -7% | — | 0.13 | — |
| 07-08 | QQQ | low | 11:28 | 701 | 1.5% | 105% | 270% | pika 1.12% | 0.09 | -0.14% |
| 07-08 | QQQ | high | 15:58 | 712 | 0.1% | 118% | 118% | pika 0.00% | 0.28 | 0.18% |
| 07-09 | SPXW | low | 09:30 | 7483 | 0.9% | 28% | -15% | — | 0.11 | — |
| 07-09 | SPXW | high | 13:48 | 7547 | 0.2% | 32% | 35% | pika 0.02% | 0.52 | 0.03% |
| 07-09 | SPY | low | 09:30 | 745 | 0.9% | 30% | -10% | — | 0.12 | — |
| 07-09 | SPY | high | 13:48 | 752 | 0.2% | 29% | 21% | barney 0.01% | 0.19 | 0.03% |
| 07-09 | QQQ | low | 09:30 | 711 | 1.8% | 29% | -6% | — | 0.16 | — |
| 07-09 | QQQ | high | 13:48 | 724 | 0.3% | 32% | 29% | barney 0.02% | 0.32 | 0.06% |
| 07-10 | SPXW | low | 10:34 | 7522 | 0.8% | 23% | 98% | pika 0.29% | 0.24 | -0.38% |
| 07-10 | SPXW | high | 15:51 | 7579 | 0.1% | 24% | 90% | pika 0.01% | 0.34 | 0.04% |
| 07-10 | SPY | low | 10:34 | 750 | 0.7% | 23% | 128% | pika 0.09% | 0.20 | -0.30% |
| 07-10 | SPY | high | 15:51 | 755 | 0.1% | -16% | -16% | barney 0.05% | 0.28 | 0.04% |
| 07-10 | QQQ | low | 11:06 | 720 | 0.9% | 91% | 10% | pika 0.02% | 0.17 | -0.05% |
| 07-10 | QQQ | high | 15:04 | 726 | 0.1% | 29% | -17% | barney 0.05% | 0.15 | 0.10% |
| 07-13 | SPXW | low | 15:39 | 7507 | 0.2% | 26% | 52% | pika 0.02% | 0.26 | -0.07% |
| 07-13 | SPXW | high | 09:30 | 7575 | 0.9% | 28% | -7% | — | 0.19 | — |
| 07-13 | SPY | low | 15:39 | 748 | 0.2% | 35% | 47% | pika 0.02% | 0.20 | -0.07% |
| 07-13 | SPY | high | 09:30 | 755 | 0.9% | 23% | -10% | — | 0.24 | — |
| 07-13 | QQQ | low | 15:39 | 710 | 0.3% | 51% | 150% | barney 0.11% | 0.12 | -0.13% |
| 07-13 | QQQ | high | 09:30 | 726 | 2.1% | 26% | -12% | — | 0.21 | — |
| 07-14 | SPXW | low | 09:30 | 7515 | 0.5% | -8% | -8% | — | 0.15 | — |
| 07-14 | SPXW | high | 11:09 | 7556 | 0.4% | 56% | 45% | barney 0.05% | 0.13 | 0.20% |
| 07-14 | SPY | low | 09:30 | 749 | 0.5% | -4% | -4% | — | 0.11 | — |
| 07-14 | SPY | high | 11:09 | 753 | 0.4% | 54% | 44% | pika 0.01% | 0.20 | 0.21% |
| 07-14 | QQQ | low | 09:30 | 712 | 1.4% | -8% | -8% | — | 0.16 | — |
| 07-14 | QQQ | high | 11:30 | 722 | 0.6% | 40% | 51% | pika 0.01% | 0.15 | 0.04% |

**Aggregate (n=30 each side):** median true-low MFE **+0.86%** underlying → median ATM **+33%** (live
trail) / **+51%** (loose runner); median true-high MFE **+0.53%** → **+32%** / **+40%**. The loose runner
beats the live trail at the low in **16/30** series (and by a lot on the trend days — 06-30/07-02/07-08
lows paid +155–355% on a runner vs +47–105% on the tight trail). **The reversal wants room.** These are
perfect-hindsight numbers — the *ceiling* the live system leaves on the table, not a live claim.

### A.2 Terrain at the turn vs a non-turn control

Pooled over all true + swing extrema (≥0.25% reversal after), vs all post-10:00 minutes >10 min from any
extreme:

| feature | at real turns | non-turn control | turn / control |
|---|---|---|---|
| approach speed (\|5-min return\|) | **0.00163** (n=112) | 0.00045 (n=9170) | **3.6×** |
| nearest strong-node distance (%spot) | **0.00246** (n=112) | 0.00090 (n=9092) | **2.8× farther** |
| King share | **0.181** (n=137) | 0.220 (n=9170) | **0.82× weaker** |

**There is a recurring — if coarse — signature, and it is the *opposite* of what a node system can grab:**
real reversals happen on **fast approaches (~3.6× faster)**, in **node air-pockets (nearest strong node
~2.8× farther than a typical minute)**, when **no King dominates (share 0.18 vs 0.22)**. Turns occur
precisely where dealer-gamma structure is *weakest and most contested*. Honest caveats: (i) many true highs
print at 09:30 before any node arms (node = "—", excluded from the node stat), which inflates the
turn/control node-distance gap; (ii) n≈10 day-blocks with within-day correlation — treat as descriptive,
not tested. This dovetails with the terrain study's §4 (fast approach → break) and explains §A.3.

### A.3 Why our system misses the turns

Cross-referencing the 60 true session extremes against live `tracked_plays` (fires exist 07-08→07-14;
earlier days the tracker was not live):

- **39 / 60 extremes had NO same-direction live fire at all** — the system was simply not positioned for
  the reversal (most on the pre-live days; even on live days many turns drew no matching fire).
- Of the **21** extremes with a same-direction fire, **9 fired *after* the extreme — median lag 27 min, up
  to 67 min.** This is the measured entry pathology in the raw: the system enters the reversal well after
  price has left the extreme, then sits the drawdown (live: median −31.7% in 30 min / MAE ≈ −88%).
- The **12 "at/before"** matches are almost all 09:30 opening-bell fires (where the "extreme" is the open
  itself) or an unrelated earlier same-direction fire — not a genuine catch of the turn.

**Systematic reason (mechanistic, not bad luck):** the live patterns require *structural confirmation* — a
hardened node, a confirmed King flip, a bull-tape gate — and §A.2 shows that confirmation **does not exist
at the extreme**: the turn is where the node is farthest and the King is weakest. The structure the patterns
key on only *forms after* price leaves the extreme, so the system is **structurally late by construction**.
It cannot enter at the turn because its evidence is a lagging function of the very move it is trying to catch.

---

## §B — Extreme-Probe (PRE-REGISTERED, frozen before outcomes)

### B.1 Rule (frozen)

- **Trigger.** After 10:00 ET, when spot sets a **new session low** (→ call side; new session **high** →
  put side) and then prints its **first 2 consecutive 1-min closes beyond the extreme**, BUY **ATM at the
  next minute's print** (call for new-low, put for new-high, 0DTE, strike nearest spot).
- **ABORT (whichever first).** Exit immediately if spot makes a **new extreme beyond the entry extreme**
  (structural invalidation) **OR** the option mark drops **A%** from entry, A ∈ {**0.15, 0.25**}.
- **WINNER.** Else trail: arm at **+50%**, exit on giveback **G** of peak, G ∈ {**0.25, 0.40**}; else EOD.
- **Throttle.** ≥10-min cooldown between probes per side; **max 6 probes/side/day**.
- **Costs.** 1.5% each side (~3% round-trip) haircut, matching `pnl_v0`. Entry/exit = 1-min close prints.
- **Grid & correction.** 2 aborts × 2 trails = **4 cells**; primary metric = expectancy/probe > 0 after
  costs; **Bonferroni m=4 → α\*=0.0125**. Splits: calls / puts. Controls (a)(b)(c) below.

### B.2 Frequency

**360 probes over 10 days = 36/day** (180 calls, 180 puts); the **6/side/day cap binds on essentially every
(day,ticker)** — the raw trigger is very frequent (a slow index makes many small new-extreme + 2-uptick
sequences), which is exactly the "fire MORE events" design intent. All 360 got a fill (no missing-price
drops).

**⚠️ Timing pathology of the rule as frozen: 99% of probes (357/360) enter in the 10:00–10:59 ET hour;
only 3 enter later.** With a 10-min cooldown and a 6/side cap, the daily budget (≈6 probes × 10 min ≈ 60
min) is **entirely consumed by the first hour's micro-oscillations** — every small dip-and-reclaim after
10:00 spends a slot. Meanwhile **19 of 60 true session extremes (32%) occur at/after 13:00 ET** (e.g.
07-02 13:59, 07-13 15:39, 06-30 15:18 lows) — and the rule has **no ammunition left to probe them.** So the
≈0 expectancy below is measured almost entirely on *morning* probes; the rule as specified **does not
actually attempt the afternoon turns it was designed to catch.** This is a pre-registration artifact (frozen
cap + cooldown), and it is itself a finding: "fire many cheap probes" without a budget-reservation or a
range-breakout gate front-loads all attempts into opening noise. Fixing it (reserve slots, or only probe
extremes that exceed the opening-hour range) is a lever for the follow-up study, not a retune of this one.

### B.3 Primary — full distribution per cell (net, 3% haircut, day-block 90% CI)

| cell (A/G) | side | n | **expectancy** | median | abort% | avg abort | win% | avg win | $/day | 90% CI | P(>0) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **A15/G25** | all | 360 | **−2%** | −19% | 76% | −19% | 24% | +52% | −75% | [−8%, +5%] | 28% |
| | call | 180 | −4% | −20% | 82% | −19% | 18% | +64% | −77% | [−14%, +7%] | 25% |
| | put | 180 | +0% | −19% | 69% | −20% | 31% | +46% | +2% | [−8%, +9%] | 48% |
| **A15/G40** | all | 360 | **−2%** | −19% | 78% | −20% | 22% | +58% | −75% | [−11%, +9%] | 34% |
| | call | 180 | −5% | −20% | 82% | −19% | 18% | +59% | −92% | [−16%, +11%] | 26% |
| | put | 180 | +1% | −19% | 73% | −20% | 27% | +57% | +17% | [−13%, +23%] | 50% |
| **A25/G25** | all | 360 | **−3%** | −28% | 70% | −27% | 30% | +51% | −109% | [−8%, +3%] | 17% |
| | call | 180 | −3% | −29% | 72% | −27% | 28% | +59% | −49% | [−14%, +11%] | 34% |
| | put | 180 | −3% | −28% | 67% | −27% | 33% | +44% | −61% | [−13%, +7%] | 28% |
| **A25/G40** | all | 360 | **−4%** | −28% | 70% | −27% | 30% | +48% | −149% | [−13%, +6%] | 23% |
| | call | 180 | −6% | −29% | 72% | −27% | 28% | +49% | −100% | [−18%, +9%] | 23% |
| | put | 180 | −3% | −28% | 68% | −27% | 32% | +48% | −49% | [−18%, +19%] | 35% |

**Every cell's expectancy CI straddles zero; none is positive even uncorrected, so Bonferroni is moot.**
Best cell is `A15/G40` all-side (−2%, tied with `A15/G25` on mean, chosen on higher P>0 = 34% and the looser
trail that lets caught reversals run). Tighter abort (A=15) beats looser (A=25); looser trail (G=.40) helps
only marginally. **Split:** puts at tight abort are the only cells that go non-negative (+0% / +1%) but
non-significantly (P>0 = 48–50%); calls are negative in every cell — a paradox resolved by control (c) below
(the abort is what hurts calls).

### B.4 Abort economics — does the asymmetry materialize?

- **YES on the loss side — the abort caps near A%.** Realized avg abort cost = **−19%/−20%** (A=15) /
  **−27%** (A=25), i.e. exactly nominal-A plus the 3% haircut and ~1–2pp of close-fill slippage. Median
  abort −20% / −30%. **Worst single abort across all 360 probes = −67%** — bounded, and far from the −88%
  MAE / −96% single losses the live system routinely eats. On liquid index 0DTE the fast abort executes
  cleanly; slippage on fast-moving marks is **tame**, not catastrophic. The mechanism's core assumption holds.
- **The structural stop is nearly redundant.** Only **32–53** of ~250 aborts fire on the *structural*
  new-extreme; the rest (**198–247**) fire on the *option-mark −A%*. The mark craters through −A% **before**
  spot breaks back past the entry extreme, so "invalidation one tick away" is in practice the mark stop.
- **YES on the win side — winners are big.** 22–30% of probes win, avg **+48% to +58%**, right-tail to
  **+412% / +732%**. The small-loss / big-win shape the operator wanted is real *per trade*.
- **NO at the portfolio level — it nets to zero.** 0.76 × (−19%) + 0.24 × (+55%) ≈ **0**. The abort
  frequency is too high: the reversal you're probing usually *doesn't happen on this attempt*, and the abort
  books the −19% before the (frequent) recovery. **The caught reversals fund the misses almost exactly — and
  no more.**

### B.5 Controls

**(a) Random-timing, matched frequency** (same ATM contracts, random entry minute 10:00–15:30, identical
A/G machinery, 20 draws): expectancy **−4% to −6%**, day-block CI **[−7%, −4%] / [−8%, −2%]** — **entirely
negative** (best cell A15/G40 random: P(mean>0)=0.5%). So **entering at the extreme beats random timing**
under identical option exits (the probe cells at ~−2% to −4% sit *above* random's −4% to −6%, clearest at
A=15). The extreme-location signal is **real but small** — it lifts you from clearly-negative to
break-even, not into profit.

**(b) Live `tracked_plays`, same days** (realized mid-to-mid, 3% haircut): all **−23%** (median −35%),
**puts −51%**, calls **+14%**. The live system bled on these days, dragged by failing put fires. Probes
(and especially no-abort probes, below) beat the live *all/call* book handily — the gain is from **entry
location**, not from any exit cleverness.

**(c) Probes WITHOUT the quick abort** (same entries, live trail arm .50 / gb .15, no abort — isolates the
abort's contribution): all **+2%** (median +26%, CI [−10%, +14%], P>0 = 61%), **calls +16%** (median +30%,
CI [−11%, +40%], **P>0 = 85%**), puts **−12%**. **Removing the abort improves expectancy on every side and
beats all four abort cells.** This is the study's sharpest result: **the quick abort is net-negative.** It
converts recoverable noise-dips (which, entered at a genuine extreme, usually V-back) into locked −19%
losses. The operator's "exit quickly when wrong" is the wrong instinct here — *at the extreme*, "wrong for
two minutes" is mostly noise, and the tight sweep sells it.

---

## §C — Synthesis & DECISIONS NEEDED

**What we learned (LEANS, n≈10 day-blocks):**
1. **Expectancy/probe ≈ 0** for the Extreme-Probe as specified; no cell is positive after costs; Bonferroni
   is moot. **KILL the rule as written** (quick-abort variant).
2. **The abort works mechanically but backfires economically.** It caps losses at ~A%+haircut (worst −67%)
   — the asymmetry is real per-trade — but at a 70–78% abort rate the winners only *break even* against the
   aborts, and **ablating the abort (control c) does strictly better** (calls +16%, P>0 = 85%).
3. **The live edge, if any, is *entry location*, not exit design.** Extreme-timing beats random timing
   (control a, negative CI) and beats the live book's all/call side (control b). But it beats them into
   *break-even*, not profit — and only on the call side.
4. **§A explains the live miss:** turns happen on fast approaches, in node air-pockets, when no King
   dominates — where the patterns' structural confirmation cannot yet exist — so the system enters 27 min
   late (or not at all, 39/60).

**DECISIONS NEEDED (no live-code change proposed):**
- **Do NOT ship Extreme-Probe with the A% quick-abort.** It is a null at best and the abort is the
  net-negative component.
- **The one candidate worth a *future* pre-registered study:** *extreme-location entry (new session extreme
  + 2-min reclaim, after 10:00) with a normal/loose trail and NO fast abort*, **call-side only** (control c:
  +16%, median +30%, P>0 = 85% — but CI still includes 0, so a LEAN, not evidence). It must clear its own
  mirror/random control and a walk-forward split before any ghost test. **Redesign the throttle first**
  (§B.2): the frozen cap front-loads 99% of probes into 10:00–10:59 ET and never attempts the afternoon
  turns — a follow-up should reserve budget or gate probes to extremes that break the opening-hour range,
  then re-measure. The put side is a null on this mostly-up sample and should not be pursued without a
  bear-tape day mix.
- **Reconcile with doctrine:** this is *not* a node/terrain rule — §A.2 shows turns are anti-correlated with
  node strength. It is a pure price-structure (session-extreme reclaim) entry. Keep it labeled as such; do
  not attach it to the (mirror-killed) node edge.

---

## §D — Viewer JSONL & reproduce

**`research/velocity-capture/probe_events.jsonl`** — one line per filled probe, **full outcome**, computed
at the **best pre-registered cell `A15/G40`** (A=0.15 sweep, G=0.40 giveback). Emitted for **every** probe
regardless of the negative verdict, so the operator can see all 360 on the map (279 abort · 71 win · 10 eod):

```json
{"day","ticker","minute" (entry, UTC HH:MM),"strike" (session-extreme level probed),"kind":"probe",
 "implied":"up"|"down","exit_minute" (UTC HH:MM),"outcome":"abort"|"win"|"eod","pnl_pct" (net %, haircut)}
```

`outcome` is the **exit mechanism**: `abort` = structural-new-extreme or mark-−A% stop; `win` = armed at
+50% then trailed out; `eod` = held to close. Note `win` is *mechanism*, not sign — under G=0.40 a
trailed-out probe can still print a small net loss on a round-trip; **`pnl_pct` is authoritative** for the
map's color/size. `strike` is the **session-extreme price level probed** (the low for calls / high for
puts), not the option strike, so probes plot at the reversal level. `minute`/`exit_minute` are **UTC** as
requested; the ET-based `terrain_events.jsonl` differs by 4h, so confirm the viewer's timezone before
overlaying the two layers.

```
cd apps/gex/research/velocity-capture/pipeline
python3 extreme_probe.py       # Part A forensics + Part B grid + controls (a)(b)(c) + bootstrap + JSONL
# -> extreme_probe_results.json   (all numbers behind this report)
# -> ../probe_events.jsonl        (360 probe outcomes for the terrain viewer, best-cell A15/G40)
```
Pre-registration (§B.1) is frozen; re-run as the backfill fills (more days landing) to tighten the CIs — do
not retune the grid.

*Author: Bellwether research subagent. RESEARCH ONLY — nothing here changes live code or trading rules.*
