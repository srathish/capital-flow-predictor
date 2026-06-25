# Worked Examples

Three example trades using the SPY ladder from your prompt. Each walks
through the full checklist so you can see the system in motion.

```
PIVOT 737.9
Bull: 738.9 (reclaim) → 740 (target) → 740.8 (break confirm) → 741.88–742.9 (ext)
Bear: 736.83 (failure) → 735.9 (target) → 735–734 → 732.8 (ext)
```

Assume morning GEX read:

- SPY spot 738.20, gamma flip 737.10, net GEX **−2.4B (TRENDING)**
- Largest call wall: **740 (3.1B)**, then 745 (1.2B)
- Largest put wall: **735 (2.8B)**, then 730 (0.9B)
- Vanna: negative, IV climbing slightly → calls expand on rallies

---

## Example 1 — Clean A+ long: reclaim 738.9 → 740

**Setup:** 10:08 ET. SPY tested pivot 737.9 at 09:48, held with a wick
to 737.78, bounced. 1m chart now printing 738.95 close after the
prior bar closed 738.92. 1m 8 EMA at 738.55. 5m 8 EMA above 5m 21
EMA, both rising. 15m 8 above 21.

**Run the checklist:**

| Check | Result |
|---|---|
| Body close above 738.9 reclaim trigger | ✅ |
| Retest hold (prior bar already wicked, current holding) | ✅ |
| 1m 8 EMA in direction (price above 738.55) | ✅ +1 |
| 5m stack aligned long | ✅ +1 (total stack: +2) |
| GEX regime supports long (TRENDING, neg GEX) | ✅ +1 |
| Wall at 740 just past target | ✅ +1 |
| Time-of-day OK (10:08 ET) | ✅ |

**Score: 5/5.** A+ snipe.

**Execution:**

- DTE: 0DTE (high conviction, narrow distance to TP1).
- Strike: 738 call ATM (delta ~0.55), premium ~$1.20.
- Size: 1.5 % bankroll (score 5 multiplier).
- Invalidation: 1m body close back below 738.9 *or* 1m 8 EMA flip
  below price.
- TP1: SPY 740 — sell 50 %.
- TP2: SPY 740.8 — sell 25 %, trail rest with 1m 8 EMA.
- TP3: SPY 741.88 — sell remaining 25 %.
- Time stop: 10:30 ET if not in profit.

**What plays out (hypothetical):**

- 10:14 — SPY 739.95. TP1 partial fires at 740 for ~$2.10 on the call
  → +75 %. Half off.
- 10:22 — SPY 740.82. TP2 fires for ~$2.85 → +138 %. 25 % off.
- 10:35 — SPY pauses at 741.05, 1m 8 EMA still rising. Hold.
- 10:48 — SPY 741.92. TP3 fires at ~$4.05 → +237 %. Flat.

Net: ~+135 % blended on the call. ~+1.5 R on the 1.5×-sized snipe.

---

## Example 2 — B-grade trade you should NOT take: 740 break alone

**Setup:** 11:38 ET. SPY tags 740 from below for the third time today.
Prints 740.12 close on 1m. 1m 8 EMA at 739.85. 5m 8 EMA flattening,
barely above 5m 21 EMA.

**Run the checklist:**

| Check | Result |
|---|---|
| Body close above 740 break level | ✅ |
| Retest hold | **TBD — only one bar so far** |
| 1m 8 EMA in direction | ✅ +1 |
| 5m stack aligned (flattening) | borderline, count as no | +0 |
| GEX regime supports? (TRENDING ok, but…) | ✅ +1 |
| Wall at 740 — *we're trying to break THE wall* | ❌ wall is target, not beyond |
| Time-of-day OK | 11:38 ET — last 7 min before lunch black-out |

**Score: 2/5 (and wall is *against* us, not for us).**

**Decision: skip.**

Why this is a trap: the level *did* print a close above 740. Without
the checklist, you would snipe it. But:

- The 5m stack is flattening — momentum dying into lunch.
- The biggest call wall *is* 740. Above it, there's nothing until
  745. The dealers will absorb price right here.
- Lunch black-out is 7 minutes away. Even if it works, the move
  decays through chop.

**What actually plays out:** SPY tags 740.18 max, drifts back to
739.40 by 12:00, flat through lunch. The "skipped" trade would have
hit −40 % stop. Skipping was the right call.

---

## Example 3 — Failure short: pivot lost, snipe 736.83 → 735.9

**Setup:** 13:45 ET. SPY rolled off 740 earlier, dribbled lower
through lunch. 1m bar closes at 736.75 — first body close below
the failure trigger 736.83. Prior bar wicked to 736.55, recovered.
This bar confirms.

1m 8 EMA at 737.05 — price below. 5m 8 EMA crossed below 5m 21 EMA
at 13:30, both rolling. 15m 8 still above 21 (no full bear day, just
intraday weakness). Net GEX flipped to −1.1B intraday with pinning
weakening. Put wall at 735 (2.8B).

**Run the checklist:**

| Check | Result |
|---|---|
| Body close below 736.83 failure trigger | ✅ |
| Retest hold (prior bar was the wick low) | ✅ |
| 1m 8 EMA in direction (price below 737.05) | ✅ +1 |
| 5m stack aligned short | ✅ +1 (total stack: +2) |
| GEX regime supportive (neg GEX, room to put wall) | ✅ +1 |
| Wall at 735 just past 735.9 target | ✅ +1 |
| Time-of-day OK (13:45) | ✅ |

**Score: 5/5.** But: **15m macro is still bullish** (15m 8 > 21).
Apply size discount → trade at 0.75× rather than 1.5×.

**Execution:**

- DTE: 0DTE (4 hours to close — still safe).
- Strike: 737 put ATM (delta ~−0.50).
- Size: 0.75 % bankroll.
- Invalidation: 1m body close back above 736.83.
- TP1: SPY 735.9 — sell 50 %.
- TP2: SPY 735 — sell 25 % (mechanical at the put wall).
- TP3: extension to 734 — sell remaining 25 %, but trail with 1m 8 EMA.
- Time stop: 14:45 ET if not at TP1.

**Why the macro discount matters:** 15m bullish means a snap-back bid
is more likely than on a fully bearish day. You take the trade
because the local stack is clean, but you cap the size because the
broader trend is fighting you. If SPY snaps back, you lose less. If
it bleeds out as the local stack predicts, you still win — just at
0.75× rather than 1.5×.

---

## What these examples teach

| Example | Lesson |
|---|---|
| #1 — A+ long | When everything aligns, follow the ladder mechanically. The wins are 1.5–3 R. |
| #2 — B-grade skip | The checklist is most valuable when it tells you *not* to trade. |
| #3 — Conflict | Local stack and macro stack can disagree. Local wins, but macro sizes you down. |

If you can read your trades back and see which example each one
matched, the system is working. If your trades look like none of
these — they're probably impulses, not snipes.
