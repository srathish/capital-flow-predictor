# LLM-TRADER — SPXW 2026-07-14 (paper, RESEARCH / Clause 0)

Discretionary 0DTE index trader applying the **full Skylit doctrine**, one session, via the
causal decide-then-reveal harness (`step.py`). Read only `skylit-academy.md` + harness output.
Scored with real Unusual Whales 1-min option prints.

**Result: 1 trade, +4.69% net. Flat the other ~5h15m of the session.**

---

## Day character (what the surface told me)

A relentless **positive-gamma pin/chop day**. Cash SPXW opened 7515, ran to a 7556 high by
11:09 (+0.5%), then spent the entire rest of the session pinned/chopping in a tightening ~7515–7556
band, migrating from one pin to the next (7534 → 7550 → 7529 → 7546) and finishing glued to a
monster close-pin structure (7545 BARN −77M / 7555 PIKA +52M) at ~7547.

Throughout, the map was a **range framed by strong pika walls** (a floor complex that lived around
7500→7520→7525, and a ceiling that lived around 7565→7585), with a violent **negative-gamma pocket
in the middle** (repeatedly −20M to −60M+ barns at spot) that produced sharp-but-contained
oscillations. Classic Chapter-4 Type-1 range day: *play the extreme ends only; the middle is death.*

---

## Trade log

### Trade 1 — SHORT (ATM puts), the 11:08–11:11 rug

- **Entry:** 11:11 ET, spot 7553.31 → ATM strike **7555**, OCC `SPXW260714P07555000`
- **Exit:** 11:16 ET, spot 7551.94
- **Real prints (1-min close, UTC):** entry 15:11 = **$12.70**, exit 15:16 = **$13.70**
- **Net after slippage** (`13.70·0.985 / 12.70·1.015 − 1`): **+4.69%**

**Doctrine reasoning (entry):** The dominant node all morning was a huge, *still-growing* **7585 PIKA
king ceiling** (+13→+22M). Price made a 2nd failed probe at the highs (7547.9, then 7556.1) and
rejected **below** the pika — textbook positive-gamma "sell the rips," the ceiling rejecting price
before it can even tap. Underneath: the **floor had collapsed** (7500 → +4.4M, 15m −4.8) = open
downside air-pocket, and a **massive barn fuel field** (7560 −23.8M, 7550 −18.7M) sat directly below
spot to accelerate a drop. That is the **Rug** pattern (pika ceiling → rejection → barn-fuelled
acceleration lower). I entered as the overshoot to the day-high stalled (Chapter-6 negative-gamma
"enter at the extreme as the overshoot stalls"). Target node-to-node 7545 → 7535 → 7520/7510; stop
break-and-hold above 7562.

**Doctrine reasoning (exit):** Price pinned for ~6 minutes on the enormous 7550/7560 barn (−21M) with
**no downside follow-through** — the barn produced a *pin*, not the barn-fuelled drop the thesis
needed — while the 7585 ceiling *re-strengthened* (15m +6.6), i.e. dealers redefended and the
sell-rip pressure evaporated. Doctrine: in a positive-gamma/pin, be quick and avoid theta burn. I cut
near what I read as breakeven to preserve capital and re-arm for a cleaner deflection. *(In fact the
put had already ticked to 13.70 = +4.69%; it went on to 16.00 by 11:18 as price drifted to 7548 — I
exited ~2 minutes early.)*

---

## Everything I passed (and why)

- **Calls off the 7520 floor (repeatedly, ~12:00–14:00).** The 7520 pika grew into the day's king
  node (+26M) and price drifted toward it three times (7533, 7529, 7528) — but it **pinned above the
  exact node** each time and never gave a clean 7515–7525 tap. Entering at 7528–7529 failed the **3:1
  R:R gate** (stop below the shelf = ~14pt risk vs ~16pt target ≈ 1:1), and a king this dominant reads
  as an **expiry pin magnet, not a bounce level** (calls would bleed theta — exactly what happened to
  my short). Doctrine-correct pass, but it meant never trading the one node price respected all day.
- **Puts off the barn-wall probes (7543–7556).** Every upside probe rejected at the *barn*, not the
  pika ceiling. Doctrine says never fade a barn (it overshoots/accelerates); the clean fade requires a
  pika tap that never came. Correct pass.
- **The 7555 pika-cloud into the close (+52M).** A gravity-well/pin magnet, not a fade. Correct pass.
- **~5 hours of midpoint chop.** No edge; flat is a position.

---

## Candid self-assessment — did full doctrine beat rules?

**Benchmarks (given): validated rule-system +8% (6 trades) · live tracker −0.7% (5 fires) ·
human operator +311% (4 trades).**

**Honest verdict: No — on this day full-doctrine reasoning did not beat the rules; it roughly
matched at low activity.** My +4.69% (1 trade) **beat the mechanical live tracker (−0.7%)** and
avoided a whole day of theta-bleeding chop, but **trailed the validated rule-system (+8%)** and was
dwarfed by the **human (+311%)**.

What the doctrine did **well:** it kept me out of ~5 hours of pin/chop where a threshold system
churns; it correctly identified the one A+ structure of the day (the 11:08 rug) and the decide-then-
reveal discipline let me read the ceiling-dominance + weak-floor asymmetry and act on it; and the
3:1 / clean-tap gate prevented me from forcing the many marginal midpoint entries.

Where it **limited/misled me:**
1. **Cut the winner early.** I read the 6-minute stall as "the pin is absorbing it" and exited at
   +4.69%; holding to the 7548 drift would have been ~+22%. The doctrine's "be quick in a pin" rule
   fired ~2 minutes too soon.
2. **The exact-tap + 3:1 gate was too rigid for a pin day.** Price *respected* the 7520 king floor all
   afternoon but kept turning a few points above it; a purist waiting for the literal 7515–7525 tap
   never trades it. A more flexible read of "the floor is being defended from a distance" might have
   captured a scalp — though 7520-as-pin-magnet made passing genuinely defensible.
3. **The one entry was slightly forced** (shallow overshoot, no literal pika tap) — it worked only
   because the *structural* read (ceiling dominance + collapsed floor) was directionally right.

The human's +311% almost certainly came from riding directional travel (the morning 7515→7556 drift,
or holding/reloading the short) that strict Skylit deflection-discipline explicitly tells you to pass.
**On a low-volatility pin day, the doctrine's edge is capital preservation, not alpha** — it protected
me from the tracker's loss but couldn't manufacture the directional P&L that rules and a discretionary
human squeezed out. Doctrine helped me *not lose*; it did not help me *win big*.

---

## Totals

| Metric | Value |
|---|---|
| Trades | 1 |
| Winners / Losers | 1 / 0 |
| **Net P&L** | **+4.69%** |
| Time in market | 5 min of 345 |
| vs rule-system (+8%) | behind |
| vs live tracker (−0.7%) | ahead |
| vs human (+311%) | far behind |
