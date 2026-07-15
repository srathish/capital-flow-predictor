# Charts-First 0DTE System — Candidate Spec (RESEARCH, Clause 0)

**Status: CANDIDATE / IN-SAMPLE LEAD. Not validated. Paper only.** Built from 8 blind
charts-first days (2026-06-03…07-14), 19 trades. The pin-release gate threshold is
post-hoc-fit to these trades — the *same shape* as leads that dissolved OOS this
program. Do not size real money on it until it survives the OOS battery below.

## The one-line thesis
GEX does not predict direction (18 hypotheses dead). It predicts *tradeability*:
a strong positive-gamma pin is theta-death for a long-option scalp; the money is at
the **transition out of the pin** — the exhaustion reversal / break-retest. So:
**price action picks the trade; gamma-state says whether you're allowed to take it.**

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
