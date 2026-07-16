# Entry-Timing × Exit Fix — SPX Gamma-Released Reversal

**RESEARCH ONLY (Clause 0).** No live-code / system changes. Artifacts under
`apps/gex/research/entry-exit-fix/`. All P&L is on **real UW option bid/ask fills**.

## TL;DR — lead with the money

- **Baseline (current system = E3-CONFIRM × X1-TIGHT): expectancy −12%/trade** (win 26%, avgW +38%, avgL −29%), negative in **both** walk-forward halves (−8% / −14%), day-block bootstrap **P(mean>0) = 0.00**.
- **Best cell (E2-FIRSTTICK × X1-TIGHT): expectancy −10%/trade.** Better than baseline by ~2%/trade — **but still negative, still not robust** (both halves negative, P>0 = 0.00). It is the *least-bad* cell, not a winning one.
- **The setup does not beat random-timing entry** on the same contracts/days: random × X1 = −13%/trade vs the reversal's −10% to −13%. On the primary gate the "gamma-released reversal" trigger carries **no measurable edge over a coin-flip entry** after real fills.
- **Neither proposed fix rescues it.** Earlier entry improves entry-quality (eq 0.73→0.80) but **not** the P&L; looser exits raise win-rate but blow avg-loss to −90% (0DTE decays to zero on losers held to EOD) — net worse.
- **The one real nugget:** under the **strict gate (near-spot gamma ≤ 0)** with the tight exit, the confirmed reversal (E3×X1) prints **−6%/trade vs random's −15%** — a ~9%/trade *separation* from random and the only P>0 above 0.10 (0.15). Still negative in absolute terms, so **not** tradeable as-is, but it is where the signal lives.

**Verdict: both leaks are real, but fixing them does not make this setup profitable. The raw 0.25% gamma-released reversal on ATM 0DTE is a null-to-negative edge on true bid/ask; the confirmation "chase" is not the problem, and loosening exits actively hurts. The only place structure separates from noise is the strict ≤0 gamma gate + tight exit.**

---

## Pre-registered method (fixed before scoring)

**Setup (held constant across all 9 cells).** SPXW only, all 44 backfill days
(`research/velocity-capture/backfill/<date>/SPXW.jsonl.gz`, 1-min). Per minute, net
near-spot gamma = Σ gamma for strikes within 0.5% of spot. **Gate:** near-spot γ ≤ +40M
(primary) / ≤ 0 (strict tier). **Reversal:** recent swing high over trailing 20 min; a
down-swing ≥ 0.25% arms a **CALL** reversal (mirror: up-swing ≥0.25% arms a **PUT**).
After 10:00 ET, ≤6/day, 5-min cooldown, entry cap 15:40 ET, **EOD flat 15:45 ET**.

**Entry variants (isolate WHEN — same event, same contract):**
- **E1 ANTICIPATE** — enter at the arm bar (the 0.25%-drop bar itself), no confirmation.
- **E2 FIRST-TICK** — enter on the first reversing 1-min close after the arm.
- **E3 CONFIRM (baseline = current behavior)** — enter on 2 consecutive reversing closes.

**Exit variants (isolate HOW):**
- **X1 TIGHT (baseline)** — structural-invalidation stop (underlying close beyond the
  swing pivot by 0.05%) + 12-min stall (no new mark-high) + EOD.
- **X2 LADDER** — bank ⅓ at +50%, ⅓ at +100%, trail final ⅓ at giveback-40% (armed
  at +50%); unsold rides to EOD (no structural stop).
- **X3 RUNNER** — whole position, giveback-50% trail armed at +50%, else EOD (no stop).

**Controlled comparison.** One contract per event = **ATM at the arm bar** (round spot/5),
used for all three entries so only the *entry minute* changes. An event enters the grid
only if E3 confirms within 20 min (so all 3 cells have the identical event set). Only 7 of
128 arms failed to confirm → the confirmation requirement biases the set by <6%.

**Fill model (real bid/ask).** UW `option-contract/{occ}/intraday` (1-min), ATM 0DTE.
Rules trigger on the **close** (mark); fills realize at **ASK on entry / BID on exit**.
Spread each minute = `max( observed ask/bid width, max(3% of price, $0.10) )` centered on
the close — width taken from `premium_ask_side/volume_ask_side − premium_bid_side/volume_bid_side`
when sane, else the dollar-floored spread (the $0.10 floor dominates cheap contracts, as
required; flat-3% would be too generous). A handful of reused live-fire contracts are
mark-only → dollar-floored spread. 99/99 contracts returned data; 120/121 events fillable.

**eq (entry-quality):** `(swing_origin − entry) / (swing_origin − extreme)` clamped [0,1];
1 = filled at the favorable extreme, 0 = chased all the way back to the swing origin.
**Knife-catch:** fraction of entries where the underlying continued ≥0.3% *against* the
entry before recovering past it. **MAE:** worst option drawdown in the first 15 min (the
entry-timing-relevant window; MAE-to-EOD is meaningless here — 0DTE theta drags every
path toward −90% near expiry). **MFE:** peak mark available to EOD.

**Controls:** real bid/ask; chronological walk-forward halves (split 2026-06-17, 46/74
trades); day-block bootstrap (3000×, resample whole days) for P(mean>0); random-timing
entry on the same contract/day as a null. **n = 44 days / 120 events → LEAN.**

---

## Data & event yield

- 44 SPXW days, 17,070 minutes. Gate ≤+40M & post-10:00 covers **42%** of minutes.
- 128 arms → **121 confirmed** (95% confirm rate) → **120 fillable** events.
- Direction mix: **64 CALL / 57 PUT** (58 events on the strict ≤0 gate).
- 29 days carry ≥1 event, median 5/day.

---

## The 9-cell grid — GATE ≤ +40M (primary), n=120/cell

eq = entry-quality · MAE = median early (≤15m) option drawdown · win/avgW/avgL/E on real fills · tot = summed P&L (units of premium) · knife = adverse-continuation rate · WF = expectancy per walk-forward half · P>0 = day-block bootstrap.

| Entry × Exit | eq | MAE₁₅ | win | avgW | avgL | **E/trade** | tot | knife | WF h1\|h2 | P>0 |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 × X1 | 0.80 | −24% | 22% | +41% | −28% | **−13%** | −1558% | 12% | −7% \| −17% | 0.00 |
| E2 × X1 | 0.77 | −23% | 23% | +50% | −28% | **−10%** ← best | −1186% | 8% | −7% \| −11% | 0.00 |
| **E3 × X1** (baseline) | 0.73 | −22% | 26% | +38% | −29% | **−12%** | −1397% | 8% | −8% \| −14% | 0.00 |
| E1 × X2 | 0.80 | −24% | 49% | +55% | −90% | **−19%** | −2230% | 12% | −10% \| −24% | 0.03 |
| E2 × X2 | 0.77 | −23% | 55% | +52% | −88% | **−11%** | −1312% | 8% | +2% \| −19% | 0.11 |
| E3 × X2 | 0.73 | −22% | 54% | +54% | −93% | **−13%** | −1583% | 8% | −3% \| −20% | 0.09 |
| E1 × X3 | 0.80 | −24% | 49% | +46% | −90% | **−23%** | −2795% | 12% | −16% \| −28% | 0.01 |
| E2 × X3 | 0.77 | −23% | 55% | +46% | −88% | **−14%** | −1727% | 8% | +1% \| −24% | 0.06 |
| E3 × X3 | 0.73 | −22% | 54% | +52% | −93% | **−14%** | −1734% | 8% | +3% \| −25% | 0.08 |
| *random × X1* | — | — | 21% | — | — | **−13%** | −1542% | — | — | — |
| *random × X2* | — | — | 49% | — | — | **−12%** | −1462% | — | — | — |
| *random × X3* | — | — | 48% | — | — | **−12%** | −1477% | — | — | — |

**Every cell is negative. No cell is positive in both walk-forward halves. Every bootstrap P(mean>0) ≤ 0.11.**

---

## (a) ENTRY-TIMING — does earlier beat confirmation?

**On the eq metric, the fix works exactly as predicted:** eq climbs monotonically
E3 0.73 → E2 0.77 → **E1 0.80**, and the early-MAE deepens as you enter earlier
(E3 −22% → E1 −24%), i.e. E1 really does buy lower/earlier. Knife-catch rate rises
E3/E2 8% → **E1 12%** — anticipating catches 50% more falling knives, as expected.

**On the money, the fix does not follow:**

| | E1 ANTICIPATE | E2 FIRST-TICK | E3 CONFIRM (base) |
|---|---|---|---|
| eq | 0.80 | 0.77 | 0.73 |
| knife-catch | **12%** | 8% | 8% |
| E/trade × X1 | −13% | **−10%** | −12% |

- **Earlier entry pays only as far as E2, then reverses.** E2 (first reversing tick)
  is the least-bad entry at every exit. Going all the way to **E1 (anticipate) is the
  worst** entry — the extra knife-catches (12%) and deeper drawdowns eat the better fill.
- The E2 edge over the confirmed baseline is **~2%/trade and not robust** (both WF halves
  negative, P>0 = 0.00). It is directional, not bankable.
- **So the premise "well-timed entries win 3× more" fails on real fills.** Better eq did
  **not** convert to better P&L. The confirmation "chase" (E3) is **not** the leak — E3 is
  statistically indistinguishable from E2 and *better* than E1. **Waiting for 2 candles is
  roughly the price of safety, and it is a fair price; anticipating the extreme is a net
  loser.** The best available move is a mild one: take the *first* tick, not the second —
  don't anticipate.

---

## (b) EXIT — do X2/X3 capture more of the winner, and what do they give back?

Holding entry constant (E3), median winner **available** was MFE ≈ **+54%**:

| Exit | win-rate | avgW (captured) | avgL (given back) | **E/trade** |
|---|---|---|---|---|
| **X1 TIGHT** | 26% | **+38%** | **−29%** | **−12%** |
| X2 LADDER | 54% | +54% | **−93%** | −13% |
| X3 RUNNER | 54% | +52% | **−93%** | −14% |

- **Looser exits do capture more winner and win far more often:** win-rate doubles
  26% → 54%, and avgW rises +38% → +54% (X2/X3 bank essentially the full +54% median MFE
  vs X1's +38%). This is the "we strangle winners" leak, confirmed — X1 leaves ~⅓ of the
  median winner on the table.
- **But the losers give it *all* back.** avgL collapses −29% → **−90%+**: an ATM 0DTE held
  to EOD without a structural stop decays to near-zero. X3 routinely turns a −30% scratch
  into −100% (verified in trade traces).
- **NET: loosening loses.** The extra +16pts of winner-capture cannot pay for −60pts of
  extra loser-giveback at a ~50% loss rate. **X1 (tight) is the least-bad exit at every
  entry.** The winner-strangling is real but cheap relative to the theta bleed you eat by
  holding losers.
- (X2/X3 show a positive *first* half at E2/E3 — +2%/+3% — but −19% to −25% in the second
  half; that is a couple of big-trend days in H1, not a stable property.)

---

## (c) BEST COMBO, robustness, and the strict-gate nugget

- **Best cell = E2 × X1 (−10%/trade).** Beats baseline E3×X1 (−12%) and random×X1 (−13%),
  but is **negative and not robust** (WF −7% / −11%, P>0 = 0.00). It is the answer to
  "which cell is least-bad," not "which cell is profitable."
- **vs random-timing entry:** on the primary gate the whole grid sits on top of the random
  null (−12% to −13%). The reversal trigger, at the ≤+40M gate, **is not adding edge.**

**GATE ≤ 0 (strict) — n=57/cell, X1 column:**

| | E1×X1 | E2×X1 | **E3×X1** | random×X1 |
|---|---|---|---|---|
| E/trade | −10% | −7% | **−6%** | **−15%** |
| P>0 | 0.01 | 0.08 | **0.15** | — |
| WF h1\|h2 | −5 \| −15 | −5 \| −9 | **−2 \| −9** | — |

- Under the **strict ≤0 gamma gate with the tight exit**, the confirmed reversal prints
  **−6%/trade vs random's −15%** — a **~9%/trade separation from noise**, the highest
  bootstrap P>0 in the study (0.15), and the shallowest walk-forward decay. **This is the
  only configuration where the setup demonstrably beats random.**
- Note the gate interacts with the exit the *opposite* way for X2/X3: on strict-gamma days
  the swings are bigger, so held-to-EOD losers punish harder (E×X2/X3 at ≤0 run −17% to
  −31%). Strict gate helps *only* the tight exit.
- It is still **negative in absolute terms** (−6%), so not tradeable without another edge
  layer — but it says the structure is real and lives in the **strict-gamma / tight-exit**
  corner, consistent with the program's standing result that the raw trigger needs the
  gate + node/structure to matter.

---

## Honest verdict on both fixes

1. **ENTRY leak — real but not the money leak.** eq is genuinely poor at E3 (0.73, chased)
   and the fix improves it to 0.80 at E1. But P&L is flat-to-worse: E2 ≈ E3 within noise,
   E1 is a clear net loser to knife-catches. **The confirmation lag is worth its cost.**
   The only defensible tweak is E2 (first tick vs second) — a ~2%/trade nudge that is not
   statistically robust here. Do **not** move to anticipation (E1).

2. **EXIT leak — real, and loosening makes it worse.** X2/X3 capture the full median
   winner (+54% vs +38%) and win 2× as often, but avgL explodes to −90% because 0DTE
   losers held to EOD go to zero. **Tight (X1) is the least-bad exit everywhere.** The
   "strangle winners at +140%" complaint is true, but the cure (looser exits) costs more
   than the disease on real fills. If exits are to improve, the lever is a *structural
   loser stop that also lets the final third run* — a giveback-trail **with** a hard 0DTE
   stop — not an unconditional loosen.

3. **The setup itself is the binding constraint.** On the primary gate it does not beat a
   random entry. Tuning entry timing and exit style *within* it cannot manufacture an edge
   that the trigger does not carry. The signal only separates from noise under the strict
   **near-spot γ ≤ 0** gate with the tight exit (−6% vs random −15%). That corner — not the
   entry-candle count, not the exit ladder — is where any future work should go.

---

## Caveats

- **LEAN:** 44 days / 120 events (57 on the strict gate). All P>0 and WF splits are
  underpowered; treat every 2–9%/trade difference as directional, not proven.
- Contract held constant at **arm-bar ATM** to isolate entry timing; a live system re-picking
  ATM at E3 would differ by ≤1 strike on most events.
- 0DTE only, SPXW only, EOD-flat — by construction theta-hostile; a non-0DTE version of the
  same reversal is out of scope here and could behave differently.
- Fills use minute VWAP-derived spreads floored at max(3%, $0.10); genuine touch-the-ask/bid
  slippage on fast 1-min bars could be modestly worse.

## Artifacts
- `detect.py` → `events.json`, `contracts.json`, `spotpaths.json`, `detect_stats.json`
- `pull.mjs` → `optcache/` (99 SPXW ATM 0DTE intraday, real bid/ask)
- `score.py` → `scored.json`, `random.json` · `aggregate.py` → `report_data.json`
- `entryfix_events.jsonl` — 120 rows for the best cell (**E2-FIRSTTICK × X1-TIGHT**):
  day, ticker, minute (UTC), strike:spot@entry, kind:"fix", implied up/down, exit_minute,
  outcome, pnl_pct (28 win / 92 loss, mean −9.9%).
