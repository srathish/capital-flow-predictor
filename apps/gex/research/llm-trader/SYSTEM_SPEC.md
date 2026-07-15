# Charts-First 0DTE System — Candidate Spec (RESEARCH, Clause 0)

**Status: WEAK LEAD / NOT AN EDGE UNGATED. Not validated. Paper only.** FINAL 12-blind-day
result (2026-05-29…07-14), 30 trades: UNGATED = −0.6%/trade, 46% win (NO edge). Gated
(net gamma ≤ +40M) = +2.2%/trade, 52% win — but the gated number REGRESSED across the
night (+7.9% → +3.3% → +2.2% as days were added; still declining) and the +40M threshold
is post-hoc/in-sample. 6/23 exposed the gate's blind spot: it only catches POSITIVE-gamma
pins; NEGATIVE-gamma barney-WALL chop is equally untradeable and the gate lets it through
(all five 6/23 trades were negative-gamma; 3 lost). The real gate should be "IS A PIN
HOLDING (positive-gamma OR barney-wall)?" not gamma sign. DURABLE QUALITATIVE FINDING
(held all 12 days, every trader independently): money is in the TRANSITION out of a pin
(exhaustion-V, break-flush); losses are all from fighting INSIDE a pin. That principle is
robust; the mechanical pin-detector is what's weak. Do NOT size real money.

## The one-line thesis
GEX does not predict direction (18 hypotheses dead). It predicts *tradeability*:
a strong positive-gamma pin is theta-death for a long-option scalp; the money is at
the **transition out of the pin** — the exhaustion reversal / break-retest. So:
**price action picks the trade; gamma-state says whether you're allowed to take it.**

## OPERATING MODE (operator's "one confident play/day" idea) — 26-BLIND-DAY UPDATE
Across 26 blind days (73 trades), trading EVERY setup = −0.3%/day, 39% win (dead break-even —
the extra trades ARE the drag; DISCIPLINE is the whole edge, unambiguous). Taking only the
FIRST gate-open transition each day, one shot, then stopping, FULLY CAUSAL:
  - gate netg≤40M: 47% win, +3.6%/day (n=21)   gate≤20M: 52% win, +6.2%/day (n=19)   gate≤0: 60% win, +11.1%/day (n=15)
HONEST TRAJECTORY: the one-shot gate≤40 REGRESSED as data grew (+7.0→+5.1→+4.8→+3.6%/day,
win 63%→47%); the tight gate≤0 deflated 100%→72%→66%→60%. The +7%/day was small-sample. BUT:
(1) still POSITIVE at 26 blind days (regressed toward a modest number, not to zero — unlike
every other lead, which hit exactly break-even/negative); (2) the chronological OOS split HELD
a 4th straight time (test half +6.8%/day, 54% win); (3) all-trades immovably break-even proves
the one-shot discipline is the edge. VERDICT: a MODEST, high-variance, real-ish edge (~+3 to
+6%/day at 47-52% win, carried by winners > capped losers, NOT by hit rate). Best operating
point = gate≤20M (52% win / +6.2%/day, stays above coin-flip). The tighter gate≤0 number is
NOT trustworthy (still deflating). GATE BLIND SPOTS confirmed OOS: catches strong +gamma pins,
MISSES near-zero-gamma whipsaw (6/11 −48%) and negative-gamma barney-wall chop (5/22 −40%).
Only the FORWARD test (live, unseen days) can settle where +3-6%/day truly lands.

### CROSS-REGIME (34 blind days, 2 regimes) — THE KEY FINDING: the edge is REGIME-DEPENDENT
- MAY-JUL (26 days, varied regime): one-shot gate≤40 = 47% win, +3.6%/day; gate≤20 = 52% win, +6.2%/day. REAL modest edge.
- APRIL (8 days, persistent positive-gamma pin regime ~7100, gamma peaked +400-817M, everything reverted):
  one-shot = 14-16% win, −0.1%/day (~FLAT). NO edge — but NO blow-up either; it went harmlessly ~flat.
- Combined 34 days: gate≤40 = 39% win, +2.7%/day; gate≤20 = 44% win, +4.7%/day.
INTERPRETATION: the system needs the market to OFFER transitions. April was one long pin with no real
transitions (all "transitions" = fakeouts), so a "trade-the-transition" method had nothing to catch and
went flat. This is consistent with the core thesis (money is in the transition OUT of a pin; no transition
→ no money). IMPLICATION: the daily gamma gate is NOT sufficient — there is a REGIME LAYER above it. The
real system needs a regime detector ("is this period producing tradeable moves, or a dead-pin stretch?")
to STAND DOWN entirely in April-like regimes. With that filter the combined number returns toward the
May-Jul +3.6-6.2%/day. Without it, dead-pin months dilute to ~flat (harmless, not harmful).
NEXT: (1) build/test a regime detector (persistent high +gamma + tight realized range + low transition
count → skip the period); (2) FORWARD test in a live/normal regime — the only test hindsight can't taint.

### (superseded early figures, kept for the regression record)
11 days: 63% win, +7.0%/day. 18 days: 56%, +4.8%/day. 26 days: 47%, +3.6%/day (May-Jul). April diluted
the 34-day combined to 39%, +2.7%/day. The trajectory = small-sample optimism deflating to a modest,
regime-conditional edge.
- **Rule: one trade per day.** The first clean transition (exhaustion-V or break-flush)
  where the gate is open (net near-spot gamma ≤ +40M). Take it, size it, DONE for the day.
- **SIZING:** because it is ONE concentrated +EV shot (~+14%/trade expectancy), size it as a
  real position, not a scalp — largest when conviction is highest (gamma clearly negative +
  textbook setup, e.g. the +43% days). BUT ~1 day in 3 loses and one in ~11 is −50%, and 0DTE
  can go to −100% — so size substantial-but-fractional, never all-in; risk only premium you
  can lose in full. Kelly logic: real edge, high variance → meaningful fraction, not the account.
- CAVEATS: 11 days, in-sample +40M gate, and this INHERITS the reasoning trader's entry
  quality (the rule picks among trades a good discretionary read produced). Needs the forward
  test before real size. The −51% day (6/10) was the first gate-open trade being a bad short —
  one-shot does not avoid every bad day.

## The system, in order

### 1. THE GATE (trade / no-trade) — the one computable edge found
Compute **net near-spot gamma** = Σ gamma of strikes within ±0.5% of spot.
- **net gamma > +40M → STAND DOWN.** Strong positive-gamma pin. Any breakout/fade
  bleeds theta. (In-sample: trades taken here averaged near-zero to negative; the
  gate vetoing them lifted avg/trade +3.3% → +7.9%.)
- **net gamma ≤ +40M (released, flat, or negative) → HUNT.** This is where 0DTE
  moves. Every big win in the sample (+37 to +43%) occurred here.
- Extra credit: net gamma **falling fast** (Δ15m strongly negative) = a pin actively
  collapsing = highest-conviction window.
- NOTE: threshold +40M is in-sample. Re-fit / confirm OOS before trusting the exact number.

### 2. THE SETUP (entry) — price action, confirmed by structure
Only when the gate is open. Two setups carried every winning day:
- **Exhaustion-V reversal:** price flushes into a level, prints a reversal candle
  (higher-low + first opposite-color close), momentum flattens → enter WITH the
  reversal. GEX confirm: a real pika floor/ceiling on the supportive side, clear air
  toward the next node. (7/09 +43%, 6/29 +38%.)
- **Break-retest continuation:** in negative gamma, price breaks a level, retests it
  from the far side and rejects → enter WITH the break. GEX confirm: barney fuel +
  air pocket toward target. (7/10 +43%, 6/24 short +41%.)
- **VETO:** never buy a breakout into a strengthening positive-gamma node (the 6/25
  −17% and 6/24 −39% losses were exactly this — the gate should have blocked them).

### 3. LOCATION — what does NOT work as a filter (tested, negative)
- **Prior-day high/low/close:** real magnet, NO win/loss separation (wins median
  0.45% away, losses 0.32% — losers were closer). Price interacts there; interaction
  ≠ edge. Do not gate on it.
- **GEX node touch / King / supportive-king:** killed 18 ways, OOS-negative.
- Conclusion: there is **no "where" that predicts.** Location tells you where price
  will *interact*, never whether it bounces or breaks. The reasoning read does that.

### 4. EXIT / MANAGEMENT
- **Cap the winner.** 38% of buy-side trades touch +100% then round-trip to zero.
  Bank a big gain (≈ +100% or into the next opposing node); never let a 0DTE winner
  run to EOD (in-sample: let-run-to-EOD = −32%/trade).
- **Exit when the confirming regime flips:** if you're short on negative-gamma fuel
  and gamma flips positive, the thesis is gone — bank it (7/10, 6/25 both did this).
- **Structural stop:** exit fast when the chart thesis breaks (level reclaims against
  you). Losses in the sample were capped ~−20 to −34% by fast exits; no blowups.

### 5. SELECTIVITY / SIZING
- 0–2 trades per day is normal and correct. Flat is a position. On a full-session
  positive-gamma pin, the right answer is **zero trades** (6/03 = flat = correct).
- The edge is concentrated: a few clean catches carry the month; forced trades bleed.

## Scoreboard the spec is built on (blind, real prints)
+43 (7/09) · +43 (7/10) · +34 (6/29) · +11 (6/05) · +2.4 (6/24) · 0 (6/03) ·
−15 (6/25) · −21 (7/02) · −34 (7/14). 8 days, aggregate positive, symmetric (wins
long and short). Trend/transition days green, full-pin days red.

## REQUIRED before any escalation past paper (DECISIONS NEEDED)
1. **Finish the OOS days** (6/10, 6/23, 5/29 pending) — does gate + method stay positive?
2. **Gate OOS test:** does net-gamma≤+40M keep ~doubling expectancy on unseen trades,
   or was +40M curve-fit? Re-fit on a train split, test on a holdout.
3. **Forward test:** run live on days that haven't happened — the only test hindsight
   can't taint (every human benchmark this program was hindsight-inflated).
4. Then, and only then, ghost against the live tracker before any real size.

See [[winrate-vanity-2026-07-14]] and [[gex-not-volatility-forecast]] for why the
mechanical GEX approaches all died and why this one is confined to paper until proven.
