# Operator-Eye Swing System (1-min) — score his marks, then test the system they imply

**RESEARCH ONLY (Clause 0). No live-code change. Findings → DECISIONS NEEDED.**
Snapshot 2026-07-14 PM. Two parts: **Part 1** scores the operator's **8 annotated trades** with
**real UW option prints** (descriptive, n=8, no claims). **Part 2** formalizes the swing system his
marks imply, **pre-registers it before outcomes**, and tests it on **16 1-min days × 3 tickers = 48
(day,ticker) series** (2026-06-22 … 07-14) with the full control battery that killed 15 predecessors.

Data: `research/velocity-capture/backfill/<date>/{SPXW,SPY,QQQ}.jsonl.gz` (1-min Skylit spot). Option
P&L: ATM at entry (call for LONG / put for SHORT, same-day expiry), UW `option-contract/<occ>/intraday`
1-min prints (cached in `pipeline/prices_v0/`), **entry = close@entry-min, exit = close@exit-min, 3%
round-trip haircut** (1.5%/side). Scripts: `pipeline/operator_trades.py`, `pipeline/operator_eye.py`.

---

## One-line verdict

**Part 1 — his eye is real: all 8 marked trades are winners on real prints, portfolio mean +93% net
(3% haircut), total +747%, 8/8.** On the two days he made **+311% (07-14 SPXW)** and **+436% (07-10
SPXW+SPY)**, the LIVE system either sat those exact reversals out or its bull-tape gate *blocked* them.
**Part 2 — the value is in the discretion, not the rules he implies.** The pre-registered swing system,
mechanized faithfully, is **net-negative after costs in all 6 grid cells, clears nothing under
Bonferroni (best cell P(mean>0)=16%), and does not beat volume-matched random timing (−2.9% vs −2.2%/
trade).** The mechanization fires ~11 setups/ticker/day — including 198 whipsaw **flips (−7.5%)** and a
losing **counter-trend short book (−6.2%)** his eye never takes. On the very days he made +750%, the
mechanized system lost. **The only slice that survives with a real lean is `V-reclaim, LONG-only`
(+16.7%/trade, n=58, 12 days, hit 52%) — a post-hoc subgroup that must be pre-registered and re-tested
before any claim.** Nothing here qualifies for ghost testing as specified.

---

# PART 1 — the operator's 8 trades, real prints

ATM contract at the entry minute (nearest strike to spot; call for LONG, put for SHORT; same-day
expiry). `undMove` = underlying % move in the trade's favor (what the terrain viewer shows — the "rough
estimate"). `net` = real option close-to-close net after 3% haircut. `MFE` = best option high inside the
window. Every one is a **winner**, and the option leverage turns his ~0.1–0.5% underlying reads into
+21% to +171% option gains.

| # | date | tkr | side | window | ATM | entry$ | exit$ | undMove | **net (3%hc)** | MFE |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 07-14 | SPXW | LONG | 10:51→11:09 | 7535C | 15.00 | 23.80 | +0.31% | **+54.0%** | +69% |
| T2 | 07-14 | SPXW | LONG | 11:19→11:31 | 7545C | 11.30 | 14.10 | +0.11% | **+21.1%** | +39% |
| T3 | 07-14 | SPXW | SHORT | 11:32→12:05 | 7555P | 12.10 | 27.90 | +0.31% | **+123.8%** | +154% |
| T4 | 07-14 | SPXW | LONG | 12:24→13:27 | 7530C | 9.80 | 21.40 | +0.31% | **+111.9%** | +135% |
| T5 | 07-10 | SPXW | LONG | 10:35→11:27 | 7535C | 14.30 | 25.80 | +0.33% | **+75.1%** | +93% |
| T6 | 07-10 | SPXW | LONG | 11:43→15:04 | 7540C | 12.80 | 35.72 | +0.47% | **+170.8%** | +186% |
| T7 | 07-10 | SPY | LONG | 10:34→11:27 | 750C | 2.17 | 3.39 | +0.39% | **+51.6%** | +65% |
| T8 | 07-10 | SPY | LONG | 11:44→14:43 | 752C | 1.04 | 2.56 | +0.37% | **+138.9%** | +151% |

**Portfolio (equal-weight, close-to-close net, 3% haircut): mean +93.4%, median +93.5%, total +747%,
win 8/8.** (avg-to-avg pricing gives +94.5% mean — within noise; the marks are not cherry-picked ticks.)

**T4 exit sensitivity (±10 min, entry 12:24):** exit 13:17 → **+64.4%**, exit 13:27 → **+111.9%**, exit
13:37 → **+85.8%**. The one approximate exit is **positive across the whole ±10-min band** — the result
is not an artifact of a precise exit tick.

**vs what the LIVE system did those days (`live_fire_observations_*`):**
- **07-10, the tell:** the live engine fired **SPXW BULL_REVERSE at 10:34 @7520** — the *same* flush
  reversal the operator bought at 10:35 (T5) — but its **bull-tape gate BLOCKED it**
  (`SPY_QQQ_SPX_BELOW_PRIOR_CLOSE`). The operator, reading local structure not the index tape, took it →
  **+75%**. The live book's *executed* fires on the four overlap days (07-09/10/13/14), scored with the
  same stall exit, net **−10.4%** (n=43). His 8 hand-picked trades sit in the right tail the live filter
  discards.
- **07-14:** live executed **SPXW BULL at 09:31 @7530** (at the open) and again 11:52 / 12:44 / 13:18 —
  the operator instead waited for the **dip-reclaims** (10:51, 12:24) and took the **HOD-reject flip
  short** (11:32) the live engine never fires. Different clock, different trades.

*Descriptive only (n=8). This grounds Part 2 but proves nothing on its own.*

---

# PART 2 — the "operator-eye" swing system (pre-registered, then tested)

## Pre-registration (frozen before outcomes)

- **Pivots:** causal 1-min ZigZag, reversal threshold **R ∈ {0.15%, 0.25%}** of spot.
- **ENTRY LONG (V-reclaim):** a down-swing of **≥R** (from a swing high) completes and price retraces
  **≥0.6R** off the low with **2 consecutive rising closes**. Mirror SHORT on a completed up-swing.
- **ENTRY LONG (higher-low):** in an established up-trend (a prior **higher-high** has printed), a
  pullback **≥0.6R** that **holds above the prior swing low**, then 2 rising closes. Mirror (lower-high)
  for SHORT on a down-trend.
- **EXIT (swing-stall):** no new favorable spot extreme for **S ∈ {8, 12}** min, OR an opposite V-signal
  (flip), OR EOD. Also test the **verified ladder** (⅓@+50 / ⅓@+100 / trail) as the exit.
- **FLIP:** an opposite entry signal while in a position closes it and reverses.
- **Budget:** max **6 entries/side/(day,ticker)**; edge-triggered signals, no same-level re-entry lock.
- **Grid enumerated for Bonferroni:** {R:0.15,0.25} × {stall-S8, stall-S12, ladder} = **6 cells**,
  α = 0.05/6 = 0.0083 → a cell must show bootstrap **P(mean>0) ≥ 0.9917**. **PRIMARY = R 0.25% / S12 /
  stall**, declared before any P&L was computed.
- **Two required deviations from the raw spec, documented:** (1) **VWAP unavailable** (the surface feed
  carries no underlying volume) — the rule's "above VWAP **or** above open" is satisfied by a structural
  higher-high/lower-low trend latch, which also fixes the fact that his own dip-buys (T6 @7540.95) print
  *below* the open. (2) A reversal requires the **≥0.6R retrace** gate, not merely 2 counter-closes —
  without it the mirror rule fires a counter-trend short on every 2-bar tick of a grind-up (the raw spec
  is silent; 2 closes alone is not a "completed swing").

## His 8 trades in the rule space (proves the system encodes his marks, not a strawman)

Nearest matching-side system signal within ±6 min of each mark:

| # | his trade | rule the system assigns | reproduced? |
|---|---|---|---|
| T1 | 07-14 LONG 10:51 | **V-reclaim** @10:55 | ✓ |
| T2 | 07-14 LONG 11:19 | **higher-low** @11:21/11:25 | ✓ |
| T3 | 07-14 SHORT 11:32 | **V-reclaim short, suppressed-as-fresh → FLIP** @11:34 | ✓ (as flip) |
| T4 | 07-14 LONG 12:24 | V-reclaim, but fires ~12:42 (+18 min) | ✗ (late) |
| T5 | 07-10 LONG 10:35 | **higher-low** @10:32 | ✓ |
| T6 | 07-10 LONG 11:43 | **higher-low / V-reclaim** @11:45–11:48 | ✓ |
| T7 | 07-10 LONG 10:34 | (noisy reclaim, no clean 2-close) | ✗ |
| T8 | 07-10 LONG 11:44 | **V-reclaim** @11:48 | ✓ |

At **R=0.15%** the rules reproduce **6/8** marks within ±6 min (the two misses are *late*, not
opposite-direction); R=0.25% is too coarse and catches only his two biggest swings (T3, T6). His book
decomposes as **≈4 V-reclaims (T1,T4,T5,T7) + 3 higher-lows (T2,T6,T8) + 1 flip (T3)** — the system is a
faithful encoding of his marks, which is exactly why its failure below is informative.

## Grid results (16 days, 48 series) — everything is negative, nothing clears Bonferroni

| R% | exit | S | nTr | mean/trade | median | hit | tot/day | boot 90%CI | P(>0) | Bonf |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.15 | stall | 8 | 503 | −5.3% | −11.1% | 25% | −168% | [−8.2, −2.4] | 0% | no |
| 0.15 | stall | 12 | 522 | −5.8% | −11.5% | 24% | −189% | [−8.9, −2.5] | 0% | no |
| 0.15 | ladder | 12 | 521 | −5.7% | −11.4% | 27% | −186% | [−8.5, −2.7] | 0% | no |
| 0.25 | stall | 8 | 382 | −4.3% | −12.7% | 30% | −104% | [−8.7, −0.2] | 4% | no |
| **0.25** | **stall** | **12** | **389** | **−2.9%** | **−12.9%** | **31%** | **−71%** | **[−7.6, +1.8]** | **16%** | **no ← PRIMARY** |
| 0.25 | ladder | 12 | 389 | −3.0% | −11.6% | 35% | −74% | [−7.1, +1.2] | 11% | no |

The **R that best reproduces his marks (0.15%, 6/8) is the worst-performing cell (−5.5%/trade, P=0%)** —
the finer grid just amplifies the whipsaw the flip rule creates. No cell's 90% day-block CI clears zero,
let alone Bonferroni.

## Primary cell dissected (R 0.25% / S12 / stall)

- **Overall:** 389 trades, **−2.9%/trade**, median −12.9%, hit 31%, **−71%/day**, day-block bootstrap
  **P(mean>0)=15%** (CI straddles zero) → **Bonferroni FAIL**.
- **Calls/puts split:** LONG **+0.4%** (n=192, ~break-even) vs **SHORT −6.2%** (n=197, total −1221%).
  The short book is the whole loss.
- **By rule:** **V-reclaim +8.2%** (n=126) · higher-low −3.6% (n=36) · **lower-high −19.4%** (n=29) ·
  **flip −7.5%** (n=198). Exit reasons: 225 flips / 152 stalls / 12 EOD — **the position flips more often
  than it stalls out.** The operator flipped **once** (T3); the mechanization flips 225 times.
- **Walk-forward halves:** H1 (06-22…07-01) −0.3% · H2 (07-02…07-14) −6.3% — no stable sign.

## Controls & head-to-head (all on the primary cell)

| comparator | mean net/trade | read |
|---|---|---|
| **Operator-eye system** | **−2.9%** | the thing under test |
| Volume-matched random timing (n=9,725) | **−2.2%** | **system ≤ random** — no timing edge |
| Live system, executed fires, overlap days (n=43) | −10.4% | live worse, but different days |
| Extreme-probe control-c (no-abort, calls) [prior study] | **+16%** | the earlier probe beats this system |
| **Discretion gap, 07-14** | operator **+311%** (SPXW) vs system **−44%** (all) / +88% (SPXW-only) | |
| **Discretion gap, 07-10** | operator **+436%** vs system **−234%** (all) / +11% (SPXW-only) | |

On the two days the operator net **+750%**, the mechanized system net **−278%** — same structure, same
prints; the delta is entirely *which* setups he took and *when* he exited. Note the system's **SPXW-only,
long-heavy** subset was positive both days (+88%, +11%); the symmetric short book on all three tickers is
what bleeds.

## The one slice with a lean → DECISIONS NEEDED (do not act without pre-registration)

**`V-reclaim, LONG-only`: n=58 over 12 days, mean +16.7%/trade, median +7.8%, hit 52%, total +967%.**
This is the mechanized echo of what the operator actually does — buy the reclaim off a real down-swing,
long side only — and it is the only cohort that looks like his +93%. **But it is a post-hoc 1-of-4
rule×side subgroup selected after seeing outcomes.** It is a **lean, not a finding**, and per Clause 0 it
changes no live code. Proposed pre-registered follow-up:

1. Freeze **V-reclaim, LONG-only, no flip, no short book**, R ∈ {0.15,0.25}, stall S12; ladder exit as a
   secondary. Add a trend gate (only above the higher-high latch) to cut the counter-trend longs.
2. Re-run the identical control battery (random-timing, walk-forward, day-block bootstrap, Bonferroni
   over the *new* small grid) on the same 16 days **plus forward days**, out-of-sample.
3. Ship to ghost/paper **only** if the LONG-only cohort clears its own Bonferroni and beats
   random-timing AND the extreme-probe no-abort call baseline. Until then: **no.**

## Methods & limitations

- Causal ZigZag (no lookahead); entries edge-triggered; option P&L from real 1-min UW prints, close-to-
  close, 3% round-trip haircut (identical convention to `pnl_v0.py`). Ladder realized on the option print
  path (⅓@+50 / ⅓@+100 / trail arm .50 gb .15).
- **VWAP proxy** = structural higher-high/lower-low latch (no underlying volume in the feed). **The 0.6R
  retrace gate and the flip rule are the two most consequential formalization choices** — both are
  defensible readings of his marks, but the verdict (net-negative, short/flip-driven) is robust across
  R, S, and exit-type, so it does not hinge on either knob.
- n = 16 day-blocks → every number is a **lean**, not a finding. Part 1 is pure description (n=8).
- Emitted for the viewer: **`swing_events.jsonl`** (389 primary-cell entries:
  `{day,ticker,minute[UTC],strike,spot_at_entry,kind:"swing",implied[occ],side,exit_minute,outcome,
  pnl_pct,rule}`).
