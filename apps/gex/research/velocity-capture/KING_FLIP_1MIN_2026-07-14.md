# King-Flip & Node-Velocity Characterization — 1-minute GEX/VEX, 2026-07-14

**RESEARCH ONLY (Clause 0). n = 1 day. No edge claims. No shipping recommendation.**
This is an exploratory characterization of the *first* day for which 1-minute Skylit surfaces
are available at the resolution the live system actually trades. Everything below is descriptive.
The reusable pipeline (`pipeline/`) and the pre-registration block at the end are the durable
deliverables; the P&L figures are illustrative single-day anecdotes, not evidence.

---

## 0. Data & method

| Input | Path | Shape |
|---|---|---|
| 1-min surfaces | `research/velocity-capture/backfill/2026-07-14/{SPXW,SPY,QQQ}.jsonl.gz` | 391 frames each, 09:30–16:00 ET (13:30–20:00 UTC), ~200 strikes/frame |
| 5-min surfaces | `data/skylit-archive/intraday/2026-07-14/{…}.jsonl.gz` | 79 frames each |
| Option prices | UW `option-contract/{occ}/intraday?date=2026-07-14` | 1-min OHLC + side-premium prints |
| Live fires | `data/gexester.db tracked_plays` (trading_day=2026-07-14) | 5 fires |

**Definitions used throughout.**
- `relSig(strike) = |gamma| / Σ|gamma|` over the frame (computed locally; the backfill dropped the field).
- **King** = strike of max `|gamma|` in the frame. `king_share` = its relSig.
- **Sign**: `pika` = gamma > 0, `barney` = gamma < 0.
- **Side**: `above` / `below` = King strike vs spot.
- **Category** = sign×side ∈ {pika-above, pika-below, barney-above, barney-below}.
- **Migration** = King strike changes. **Sign-flip** / **side-flip** = those components change.
- **Composite BULLISH flip** = category `barney-above → pika-below` (ceiling dissolves, floor builds below).
  **Composite BEARISH flip** = mirror `pika-below → barney-above`.
- Trail sim = live rule `TRAIL_ARM_MIN_GAIN=0.50 / TRAIL_GIVEBACK_PCT=0.15` (`src/tracker/plays.js:146`),
  applied close-to-close on UW 1-min prints (close = last print of the minute ≈ polled mid).

---

## 1. King-track ledgers (1-min) — summary

| Ticker | frames | King-share mean / min / max | migrations | sign-flips | side-flips | category-changes | King dwell (top strikes, min) |
|---|---|---|---|---|---|---|---|
| **SPXW** | 391 | 0.173 / 0.072 / 0.566 | **66** | 29 | 55 | **64** | 7550 (151), 7545 (78), 7585 (38), 7520 (36) |
| **SPY** | 391 | 0.230 / 0.111 / 0.474 | 17 | 1 | 2 | **3** | 753 (203), 754 (139), 748 (26), 755 (21) |
| **QQQ** | 391 | 0.209 / 0.104 / 0.372 | 32 | 8 | 32 | **38** | 722 (132), 720 (107), 723 (93), 719 (38) |

Category-change class breakdown:

| Ticker | BULLISH_comp | BEARISH_comp | sign-only | side-only | both-other |
|---|---|---|---|---|---|
| SPXW | 5 | 8 | 9 | 35 | 7 |
| SPY  | 0 | 0 | 1 | 2 | 0 |
| QQQ  | 0 | 1 (16:00 EOD) | 6 | 30 | 1 |

**Regime read (n=1):**
- **SPY was a pin day** — King parked on a **753/754 pika** all session (share ~0.23, the highest of the three);
  only 3 category changes, zero composite flips. Stable positive-gamma floor/pin. The tracker fired nothing on SPY.
- **QQQ was a pika-pin day** — King was a **720/722 pika** essentially all day; 30 of its 32 side-flips are the
  crown mechanically toggling above/below as spot ticked across the 720 pin. **No genuine bullish composite flip all day.**
  This is the same `720 pika` that the live system logged as `opposing_pika_$720_hardened` when it killed the QQQ longs.
- **SPXW was the only ticker with real regime action**, and *all* of it clustered at noon (the 5 bullish + the noon
  bearish reversals). Away from noon, SPXW's 64 category-changes are dominated by **side-only flicker** (35/64) as spot
  oscillated across the 7550 barney pin.

---

## 2. Composite flip events (1-min) — full table

All 5 BULLISH composites are one noon cluster (flip → flicker → re-flip). BEARISH composites are the noon reversals
plus open/late artifacts — **no clean tradeable bearish flip occurred today.**

| # | Time ET | Ticker | From → To | King strike | spot | Class | Notes |
|---|---|---|---|---|---|---|---|
| 1 | 09:31 | SPXW | pika-below@7500 → barney-above@7575 | 7500→7575 | 7530 | BEAR | **opening-auction artifact** (first frame after 09:30) |
| 2 | 10:49 | SPXW | pika-below@7500 → barney-above@7560 | 7500→7560 | 7537 | BEAR | inside 10:44–10:58 flicker cluster (not clean) |
| 3 | 10:53 | SPXW | pika-below@7500 → barney-above@7560 | 7500→7560 | 7536 | BEAR | same cluster |
| 4 | **12:03** | **SPXW** | **barney-above@7550 → pika-below@7520** | **7550→7520** | **7529.66** | **BULL** | **noon flip — first crossing** |
| 5 | 12:06 | SPXW | pika-below@7520 → barney-above@7550 | 7520→7550 | 7529.81 | BEAR | flicker back |
| 6 | 12:08 | SPXW | barney-above@7550 → pika-below@7520 | 7550→7520 | 7528.88 | BULL | flicker |
| 7 | 12:10 | SPXW | pika-below@7520 → barney-above@7550 | 7520→7550 | 7531.16 | BEAR | flicker back |
| 8 | **12:11** | **SPXW** | **barney-above@7550 → pika-below@7520** | **7550→7520** | **7528.51** | **BULL** | **decisive settle — holds to 12:31** |
| 9 | 12:32 | SPXW | pika-below@7520 → barney-above@7550 | 7520→7550 | 7536.25 | BEAR | 1-min blip |
| 10 | 12:33 | SPXW | barney-above@7550 → pika-below@7520 | 7550→7520 | 7534.39 | BULL | re-flip, holds to 12:36 |
| 11 | 12:37 | SPXW | pika-below@7520 → barney-above@7550 | 7520→7550 | 7538.60 | BEAR | price climbing back toward the ceiling |
| 12 | 12:47 | SPXW | barney-above@7550 → pika-below@7520 | 7550→7520 | 7538.61 | BULL | second genuine bullish window (holds to 12:52) |
| 13 | 12:53 | SPXW | pika-below@7520 → barney-above@7545 | 7520→7545 | 7541.40 | BEAR | ceiling reasserts as price pins 7545–7550 |
| — | 16:00 | QQQ | pika-below@720 → barney-above@730 | 720→730 | 719.65 | BEAR | **final-frame EOD artifact** (share collapse) |

Lead-time and hypothetical P&L for the tradeable ones are in §5–6.

---

## 3. Ground-truth: the noon SPX event

**Operator's 5-min read:** SPX King flipped from a 7550/7560 barney ceiling to a 7520 pika floor ~12:05;
price ran 7529 → 7549 (~+118% on the ATM call).

**1-min truth:**

1. **Exact flip minute: 12:03 ET** — the first minute `|gamma₇₅₂₀| > |gamma₇₅₅₀|` and King prints `pika-below@7520`
   at spot 7529.66.
2. **It was NOT a clean single transition — it flickered.** The crown changed **5 times in 8 minutes**
   (12:03 BULL, 12:06 BEAR, 12:08 BULL, 12:10 BEAR, 12:11 BULL) while the two nodes were within noise of each other
   (7520 pika ≈ 20–21M vs 7550 barney ≈ 20–22M). It only **settled decisively at 12:11** and held pika-below through 12:31.
3. Minute-by-minute crossover ledger (|gamma|, thousands):

   ```
   time   spot     |g7520|pika  |g7550|barney   King
   11:48  7545.34   16,717       32,675         barney-above@7550   ← barney PEAK, gap = 16.0M
   11:52  7537.89   19,247       26,713         barney-above@7550
   11:55  7536.77   20,169       26,445         barney-above@7550
   11:58  7534.39   21,105       23,981         barney-above@7550   ← gap closing fast
   12:02  7530.00   19,576       22,225         barney-above@7550
   12:03  7529.66   20,624       20,117         pika-below@7520     ← CROSSOVER (crown changes)
   12:05  7529.31   20,743       20,176         pika-below@7520
   12:06  7529.81   21,263       21,762         barney-above@7550   ← flicker
   12:08  7528.88   21,183       19,073         pika-below@7520
   12:11  7528.51   22,815       18,610         pika-below@7520     ← decisive; barney draining out
   12:12  7529.58   23,237       18,094         pika-below@7520
   ```

4. **Price path after the flip:** spot chopped 7528–7534 until ~12:27, then climbed to **7549 by ~13:23** and
   tagged **7550+ into 14:00–14:15**. The ATM **7530C** went 10.10 (12:03) → intraday high **24.2 at 14:15** (**+140%**);
   the operator's "+118%" corresponds to a mid-afternoon exit. So the operator's directional read was **correct**;
   only the *timing* differs (true first flip 12:03, not 12:05) and the *cleanliness* was overstated (it flickered for 8 min).

5. **What 5-min showed vs 1-min truth (aliasing):** the 5-min archive sampled `pika-below@7520` at **12:05**,
   `barney-above@7550` again at **12:10**, then `pika-below@7520` at **12:15** onward. So the 5-min tape rendered the
   event as *flip → un-flip → re-flip* — but the "un-flip" at 12:10 is **an artifact of sampling a flickering coin-flip
   regime at the wrong phase**, not a real reversal. 5-min got the ~12:05 timing roughly right by luck; it could just as
   easily have sampled the barney phase and shown the flip 10 min late.

---

## 4. Per-node velocity ledger — top build / drain events

`v(t) = Δ|gamma| per minute`, sustained runs ≥5 min with ≥70% monotonicity. (Units: |gamma|/min.)

**SPXW — fastest sustained builds**

| window | strike | v (/min) | |g| start→end | spot | context |
|---|---|---|---|---|---|
| 15:27–15:32 | 7545 | +13.96M | 17.2M→87.0M | 7551→7546 | EOD pin hardening at 7545 |
| 15:45–15:50 | 7550 | +11.51M | 3.7M→61.2M | 7549→7551 | EOD pin |
| 15:42–15:47 | 7555 | +7.55M | 52.6M→90.4M | 7547→7549 | EOD |
| 13:13–13:18 | 7540 | +3.39M | 6.0M→22.9M | 7548→7544 | during the noon-run pullbacks |
| **11:33→12:03** | **7520** | **~+0.25M** (30-min build) | 12.2M→20.6M | 7550→7530 | **the noon floor building — see §5** |

**SPXW — fastest sustained drains**

| window | strike | v (/min) | |g| start→end | spot | context |
|---|---|---|---|---|---|
| 15:50–15:55 | 7550 | −10.79M | 61.2M→7.3M | 7551→7547 | EOD churn |
| 14:37–14:42 | 7550 | −6.60M | 59.1M→26.1M | 7552→7546 | pin loosening |
| 12:44–12:49 | 7550 | −3.26M | 33.5M→17.2M | 7544→7537 | **noon ceiling draining as price pushed up** |
| **11:48→12:03** | **7550** | **~−0.84M** (15-min drain) | 32.7M→20.1M | 7545→7530 | **the noon ceiling dissolving — see §5** |

**QQQ** — builds/drains all centered on the **720/722 pika pin** (e.g. 15:48–15:53 k=722 +25.1M/min; 15:26–15:31
k=722 −19.8M/min). No node ever displaced the 720 pika as a *directional* floor-below; the mass just breathed around the pin.

**SPY** — enormous absolute velocities on the **753 pika** into the close (15:41–15:46 k=753 +97.9M/min) but all pin
consolidation, spot glued to 752. No directional node handoff.

*Descriptive note:* the largest velocity events by magnitude are almost all **end-of-day pin hardening** (positive-gamma
mass piling onto the closing strike), which is mechanically distinct from the **directional node handoff** at noon.
A future rule must not confuse "biggest |v|" with "regime change" — the biggest |v| of the day was an EOD pin, not a flip.

---

## 5. Handoff / lead-lag — did velocity divergence LEAD the flip?

For the one clean handoff (noon SPX), **yes, clearly, on this day.**

- **Successor build (7520 pika):** began a sustained climb from **~11:33** (13.3M) → 20.6M at the 12:03 crossover.
  → build signal led the crown change by **~30 min**.
- **Incumbent drain (7550 barney):** the *decisive* drain began at its **11:48 peak (32.7M)** and fell to 20.1M by 12:03.
  → drain signal led by **~15 min**.
- **Convergence:** the |gamma| gap between the two nodes closed from **16.0M at 11:48 → crossover at 12:03**, i.e. a clean,
  monotone "scissors" over ~15 minutes. Both legs of the divergence (drain of incumbent + build of successor) were
  simultaneously present for the full 11:48→12:03 window.

**Lead-time per composite event** (successor rising AND incumbent falling over a trailing window):

| Event | Class | incumbent→successor | measured lead |
|---|---|---|---|
| 12:03 | BULL | 7550→7520 | ≥15 min (divergence present across entire lookback; build onset ~30 min) |
| 12:33 | BULL | 7550→7520 | ~13 min |
| 12:47 | BULL | 7550→7520 | ~5 min |
| 10:49 / 10:53 | BEAR | 7500→7560 | ~15 min (but inside a flicker cluster — low confidence) |
| 09:31, 12:06, 12:10 | BEAR | — | none (flicker reversals / open artifact) |

**Verdict (n=1):** the operator's "velocity divergence leads the flip" hypothesis **held for the noon event with a
~15-minute lead** (30 min if you count successor-build onset). It did **not** hold for the flicker reversals — those had
no divergence, they were coin-flips between near-equal nodes. This is exactly the signal/noise split the pre-registration
below is designed to separate. **One clean instance is not evidence; it is a reason to pre-register.**

---

## 6. Flip-signal scoring (descriptive) — hypothetical trades

ATM call = nearest strike to spot at the flip minute; exit via live trail (arm 0.50 / gb 0.15) to EOD. Prices = UW 1-min close prints.

**Noon SPX bullish flip — ATM 7530C:**

| Entry basis | Entry ET | Entry | Peak (trail) | Peak ET | Trail exit | Exit ET | **P&L** |
|---|---|---|---|---|---|---|---|
| Raw first flip | 12:03 | 10.10 | 16.50 (+63%) | 12:43 | 13.60 | 12:46 | **+35%** |
| Decisive settle | 12:11 | 10.60 | 16.50 (+56%) | 12:43 | 13.60 | 12:46 | **+28%** |
| Debounced (≥3-min, confirmed 12:13) | 12:13 | 11.10 | 19.60 (+77%) | 13:10 | 16.40 | 13:15 | **+48%** |

All three are **positive and directionally correct**, but the tight `gb 0.15` trail on a **choppy** up-day clipped the
trade at 12:46 / 13:15 — the option ran on to **24.2 (+140% from the 12:03 entry) by 14:15**, and a naive hold-to-EOD
would have booked **+44%**. So on this path the flip *direction* was right and the *trail* left most of the move on the
table. (Descriptive only — the opposite is equally likely on a clean-trend day; that's what more days will tell us.)

**Mirror bearish:** no clean bearish composite flip occurred today (all were flicker/open/EOD artifacts), so nothing to score.

**Would the flip signal have avoided/improved the two QQQ losers?** — **Yes, avoided both.**

| Live fire | Fired ET | DB outcome | Bullish flip present? |
|---|---|---|---|
| QQQ 720C | 09:45 | closed `opposing_pika_$720_hardened`, best +? then −13% | **No** — QQQ King was a 720 *pika pin*, never barney-above→pika-below |
| QQQ 720C | 11:51 | closed `opposing_pika_$720_hardened`, −2% | **No** — same pin |
| QQQ 720C | 15:11 | +60% (winner) | No composite flip either — this was a pin-break, not a flip |

A **flip-gated** long would have **stood aside on QQQ all day** (no bullish composite ever formed), so it avoids the 09:45
and 11:51 losers by construction. Note it would *also* have skipped the 15:11 winner — the flip gate is a **different,
more selective signal**, not a strictly-better version of the live rule. And the flip signal *agrees* with the live
structural-exit logic: both identified the 720 pika as an opposing pin, not a floor.

For reference, the SPXW fires under the same close-to-close trail sim: 09:30 7530C → the sim holds to a −26% EOD
(the live system correctly closed it at 09:43 via `state_clear` at +3%, so the DB is authoritative); 11:51 7540C → +26%
(DB: best +47.6%, structural exit +32.6%). The point of these is calibration, not comparison.

---

## 7. 1-min vs 5-min aliasing — quantification

| Ticker | category-changes @1-min | @5-min | **invisible at 5-min** | composite flips @1-min | @5-min |
|---|---|---|---|---|---|
| SPXW | 64 | 24 | **40 (63%)** | 13 | 8 (mistimed) |
| SPY  | 3  | 3  | 0 | 0 | 0 |
| QQQ  | 38 | 18 | **20 (53%)** | 1 (EOD) | 1 (EOD) |

**~55–63% of all crown-changes are invisible at 5-min.** For the noon SPX flip specifically, 5-min got the timing
roughly right (12:05 vs true 12:03) but **rendered a spurious un-flip at 12:10** by sampling the flicker at the wrong
phase. The replay program's reliance on 5-min data means (a) it under-counted King activity by ~2× and (b) any flip it
*did* see was timestamped with ±2–3 min error and could show phantom reversals. This is the aliasing tax the whole
replay suffered — now measurable.

---

## 8. Noise check — how jittery is the 1-min King, and how much debounce?

**Flicker (crown-change that round-trips back within k minutes):**

| Ticker | total category-changes | round-trip ≤1min | ≤2min | ≤3min | **flicker share (≤3min)** |
|---|---|---|---|---|---|
| SPXW | 64 | 19 | 10 | 5 | **34/64 = 53%** |
| QQQ  | 38 | 14 | 7 | 3 | **24/38 = 63%** |
| SPY  | 3  | 0 | 0 | 0 | 0% |

**Over half of raw crown-changes are flicker.** Two mechanisms:
1. **Side-flicker (dominant):** the King strike sits *at/near spot* (QQQ 720, SPXW 7550) and `side` toggles every time
   spot ticks across it. Pure spot noise, same node — 30/38 of QQQ's changes and 35/64 of SPXW's are this.
2. **Near-equal sign-flicker:** two comparable nodes trade the crown when their |gamma| is within noise (the noon
   7520-pika / 7550-barney coin-flip).

**Debounce simulation** — require the new category to persist ≥ P consecutive 1-min frames before accepting it:

| P (min) | SPXW accepts | QQQ accepts | SPY accepts |
|---|---|---|---|
| 1 (raw) | 64 | 38 | 3 |
| 2 | 30 | 16 | 2 |
| **3** | **16** | **9** | **2** |
| 4 | 16 | 8 | 2 |
| 5 | 14 | 5 | 2 |

**Recommendation: P = 3-minute persistence, plus a spot dead-band and a dominance margin** (below). P=3 removes
~75% of SPXW and ~76% of QQQ crown-changes — almost all of them flicker — while still retaining the noon flip
(confirmed at 12:13, 2 min after the decisive 12:11 settle). P=2 is too loose (retains the 12:06/12:10 coin-flips);
P≥4 buys little extra and adds lag.

---

## 9. PRE-REGISTRATION — "KingFlip-v0" (test once ≥10 one-min days exist)

*Frozen before more data arrives, so it can't be tuned to today. Today contributes n=1 (one clean bullish flip).*

**Signal construction (per 1-min frame, per ticker):**
1. King = argmax |gamma|; `sign` (pika/barney); `king_share` = relSig.
2. **Side dead-band:** classify `side` (above/below) only when `|King_strike − spot| ≥ max(1 strike increment, 0.05% of spot)`;
   inside the band, `side = at` and **no side-flip is emitted** (kills mechanism-1 flicker).
3. **Category** = sign×side.

**Confirmed flip (debounced):** a category change A→B is CONFIRMED at the first minute where **all** hold:
- B has persisted **≥ 3 consecutive 1-min frames** (P=3);
- **dominance margin:** at confirmation, `king_share(B) − king_share(A_last) ≥ 0.01` *or* `share_ratio ≥ 1.10`
  (kills mechanism-2 coin-flips);
- **BULLISH** = confirmed `barney-above → pika-below`; **BEARISH** = confirmed `pika-below → barney-above`.

**Velocity precondition (the hypothesis to TEST, not assume):** in the 15 min pre-confirmation,
`slope(|gamma_incumbent|) < 0` (draining) AND `slope(|gamma_successor|) > 0` (building), gap monotonically closing.
Pre-register the comparison: **flip-alone vs flip+velocity-precondition** — does the precondition raise hit-rate / lead-time / PnL?

**Hypothetical execution (paper):** at confirmation minute, buy ATM call (BULL) / put (BEAR), nearest strike to spot;
exit via live trail `arm 0.50 / gb 0.15` to EOD.

**Pre-registered metrics (per flip, aggregated across ≥10 days):**
- hit rate (fraction with positive trailed P&L) and mean/median trailed P&L;
- **lead-time distribution** of velocity divergence before confirmation (test: is it reliably >0?);
- **flicker-survival rate** (confirmed flips that don't reverse within 10 min) at P ∈ {2,3,4} and margins {0.005, 0.01, 0.02} — pick the debounce that maximizes flicker-survival without dropping true events;
- **EOD-pin false-positive rate** (confirmed flips in the last 20 min that are just closing-strike pin hardening — exclude or flag);
- **5-min alias delta:** per day, count flips visible at 1-min but missed/mistimed at 5-min (today: SPXW 40 crown-changes and ≥2 min timing error).

**Falsifiable priors from today (n=1, to be confirmed or killed):**
- H1: composite bullish flips are *rare* (0–1/ticker/day) and concentrate in the midday session, not the open/close.
- H2: velocity divergence leads the confirmed flip by ~15 min (successor-build onset ~30 min).
- H3: pika-pinned tickers (SPY/QQQ today) produce **no** bullish composite flip and a flip-gate correctly stands aside.
- H4: with P=3 + dead-band + margin, ≥70% of the 53–63% raw flicker is removed while the one clean daily flip survives.
- H5: the `gb 0.15` trail under-monetizes a confirmed flip on choppy trend paths (today captured +35–48% of a +140% peak move).

---

## 10. Reusable pipeline (deliverable b)

`research/velocity-capture/pipeline/`:
- `king.py` — loads a `{TICKER}.jsonl.gz`, builds the minute King ledger, counts migrations/sign/side/category changes, classifies composites. Self-contained on the gz surfaces.
- `velocity.py` — per-node velocity ledger (build/drain events), lead-lag divergence, noon zoom, flicker stats + debounce simulation, 1-min vs 5-min alias comparison. (`from king import ...`)
- `fetch_prices.py` — pulls UW `option-contract/{occ}/intraday` for a contract list, caches to `prices.json` keyed by ET minute. Reads the key from repo `.env`; sends the required `User-Agent`.
- `trail.py` — applies the live `arm 0.50 / gb 0.15` trail (close-to-close) to any (contract, entry-minute) pair.

Validated end-to-end on 2026-07-14 (three tickers × 391 frames + 3 contracts). Re-runnable on any future backfill day by
pointing `ONEMIN`/`FIVEMIN` at that date's folders.

---

*Author: Bellwether research subagent. n=1 characterization. Nothing here changes live code or trading rules.*
