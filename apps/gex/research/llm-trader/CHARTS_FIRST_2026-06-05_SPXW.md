# CHARTS-FIRST DISCRETIONARY 0DTE — SPXW 2026-06-05 (paper, RESEARCH)

Session `cf05`. Charts-first, GEX-confirm. Read only harness output (decide-then-reveal).
Real P&L scored from Unusual Whales 1-min option intraday closes.
`net = exit*0.985 / (entry*1.015) − 1` (buy +1.5% slip, sell −1.5% slip).

Day shape: gap-down open (7584 → 7499 by 10:00), then a **relentless slow grind lower under an
extreme positive-gamma pin** (net gamma +140M to +305M all day) that whipsawed every directional
break, followed by an **afternoon gamma collapse → negative-gamma cascade** (7459 → 7370, −2.7%)
where directional trades finally worked. Total underlying range ~2.7% down.

---

## Trades

### T1 — LONG 7520C · 10:18 → 10:24 · **−25.5%** (LOSS)
- **Chart:** Uptrend reasserting off the 7497 low — HH/HL, reclaimed VWAP (7517), 10:15 candle
  closed at its high 7520.2, 5m +0.16% & 15m +0.17% both accelerating up.
- **GEX confirm:** 7520 king flipping resistance→growing pika floor beneath price (1mΔ+2.0), clean
  air pocket to the 7550 barney, net gamma thinning to +71M.
- **Result:** Failed breakout. 7520 rejected the push (10:20 poked 7522.9, closed 7513.1), floor
  collapsed back to 7480, gamma re-thickened to +100M. Exited at my risk line. Option $14.20→$10.90.
- **Verdict:** Chasing a breakout INTO the king in a pin regime. Wrong regime read (positive gamma
  = mean-reversion, not breakout-following). Disciplined exit kept the underlying loss small (−0.1%)
  but 0DTE theta made the option loss −25%.

### T2 — SHORT 7480P · 11:41 → 11:44 · **−7.8%** (LOSS)
- **Chart:** Relentless late-morning downtrend, broke the day's key support 7480 to a fresh low,
  momentum accelerating down.
- **GEX confirm:** 7480 king-floor failed→resistance; floor relocated to 7450 = 30pt air pocket.
- **Result:** Positive-gamma snap-back. Price sliced 7477.5 then reclaimed 7482.6 in one candle;
  7480 reformed as a growing floor (+38M). Exited at 7482 risk line. Option $14.00→$13.30.
- **Verdict:** A "break" trade in a +175M pin — the fakeout I should have expected.

### T3 — SHORT 7465P · 12:11 → 12:12 · **+0.4%** (scratch/win)
- **Chart:** Re-accelerating downtrend, sold into resistance under the freshly-flipped 7465 king.
- **GEX confirm:** 7465 growing king-resistance overhead; floors relocating lower.
- **Result:** Entered the sell-the-rip too early — 7465 rebuilt as a growing floor (+51.7M, 1mΔ+4.4)
  and price bounced. Exited immediately at the 7468 risk line. Effectively a scratch. Option $11.70→$12.10.
- **Verdict:** Right idea (sell-the-rip), wrong timing (before the bounce topped). Fast exit saved it.

### T4 — SHORT 7445P · 12:43 → 12:52 · **−33.4%** (LOSS)
- **Chart:** Decisive breakdown — 12:40 candle flushed 7454→7445.9, closed at its low; strongest
  15m down-thrust so far (−0.26%).
- **GEX confirm:** 7450 floor failed, relocated 20pts to 7430; net gamma decaying (206→158M).
- **Result:** Even my best-conviction morning short retraced fully — 7438→7449 bounce reclaimed 7450,
  gamma reasserted to +142M. Held ~9 min through the bounce → the put decayed hard. Option $15.30→$10.50.
- **Verdict:** The definitive proof it was an untradeable pin day. Held slightly too long into the
  snap-back; the −33% is the price of that. **This was the turning point — I stood down after it.**

### T5 — SHORT 7430P · 14:19 → 14:32 · **+39.9%** (WIN)
- **Chart:** The all-day pin finally broke — sharp accelerating breakdown 7459→7428 (~31pts/19min),
  new session low, 15m −0.30%.
- **GEX confirm:** Net gamma **collapsed** +305M→+141M (pin dissolved); 7430 floor failed→7400;
  huge −64M **barney** at 7415 = negative-gamma fuel that *accelerates* the decline (opposite of the
  positive floors that bounced every earlier short).
- **Result:** Rode 7428→7420, banked at the stall when gamma re-thickened and the 7415 magnet failed
  to pull lower. Option $12.00→$17.30.
- **Verdict:** First genuinely different structure of the day (gamma collapse + barney). Banked the
  core rather than round-trip it. Correct.

### T6 — SHORT 7415P · 14:44 → 14:50 · **+37.5%** (WIN)
- **Chart:** Relentless downtrend, fresh new low 7413.57, −2.25%, below the 7415 barney.
- **GEX confirm:** Genuine **regime flip** — net gamma went NEGATIVE (−13M), regime "trending/violent,
  levels break"; ~38pt air pocket to the 7375 floor. The one condition absent all day.
- **Result:** Price flushed 7413→7399 (peak +0.20% underlying); trailed the stop and banked +0.07%
  underlying when it snapped back 9pts. Option $11.93→$16.90.
- **Verdict:** Highest-EV setup of the day; acting on the regime change was responding to new
  information, not greed. Trailed and banked before the reversion — right call (a violent +27pt
  bounce followed, which would have wrecked a held short).

**After T6 I stood down** — the big air pocket had closed, the cascade to 7370 kept happening inside
my holds, and the move was extended (−2.7%). Preserved the two winners into the 15:45 auto-flat
rather than chase a stretched, oscillating tape or a counter-trend bounce in the final minutes.

---

## Totals

| Metric | Value |
|---|---|
| Trades | 6 (2 wins, 3 losses, 1 scratch-win) |
| Sum of per-trade net% (equal risk) | **+11.0%** |
| Average per trade | +1.84% |
| Equal 1-contract dollar P&L | **−$53** (essentially flat) |
| Compounded (single bankroll rolled) | −11.7% |

The honest headline: **a wash / marginal**. Four small-to-moderate chop losses in the morning pin
were roughly offset (or slightly outweighed, depending on sizing) by the two large afternoon
directional winners. On equal per-trade risk it's +11%; on equal contracts it's about flat.

---

## Self-assessment

**Did charts-first catch the day's move?** Partially — and only in the afternoon.

- **Direction read: correct all day.** I identified the downtrend from the open and never fought it
  with a long after 10:00. The chart thesis was right; SPXW fell ~2.7%.
- **Morning execution: poor.** I traded *breaks/momentum* inside an **extreme positive-gamma pin**
  (+140–305M). That regime rewards mean-reversion (fade the box edges), not breakout-following, so
  every break of every level (7520/7480/7465/7450) snapped back and chopped me. Four attempts, four
  non-winners. The lesson crystallized at T4: on a max-pin day, **flat is the trade** until gamma
  moves.
- **The one real skill shown: regime recognition.** The genuine edge came from reading the **gamma
  regime change** — the midday pin *decaying* (T5: +305→+141M) and then *inverting to negative gamma*
  (T6: net −13M, barney fuel below). Those are structurally different tapes where directional trades
  run, and I caught both legs and banked them before the reversion. That's the charts-first + GEX-
  confirm method working as intended.
- **Biggest cost: over-caution mid-move.** After banking T5/T6 I repeatedly stood down and the
  cascade (7413→7370) kept unfolding *inside my holds*. Protecting two winners was defensible, but a
  more decisive trader rides a confirmed negative-gamma trend harder. I left the back half of the
  down-leg on the table.
- **What went right:** ruthless risk discipline (every loss was capped at a pre-stated line; no
  hoping), refusing to revenge-trade the pin, and distinguishing "chase a break" (lost) from "act on
  a regime change" (won).

**One-line takeaway:** Correct direction, wrong regime tool in the morning (should've been flat),
saved by reading the afternoon gamma collapse/negative-gamma flip and banking the two legs it freed.
