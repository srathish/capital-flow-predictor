# Charts-First 0DTE — SPXW 2026-06-04 (session cf0604, BLIND)

Discretionary charts-first, GEX-confirm only, paper (RESEARCH / Clause 0). 1-min causal harness,
decide-then-reveal. Scoring: real UW option-contract 1-min closes at my decision minutes;
net = exit*0.985 / (entry*1.015) − 1. All times UTC (ET = UTC−4, June/EDT).

## Day character
A low-range **positive-gamma escalator / pin day**. Cash opened 7553.68, flushed to 7525.57 in the
first candle, then ground slowly higher to close ~7591 (+0.5%). The move was NOT a tradeable 0DTE
thrust — it was a slow pin that kept migrating its king up (7550 → 7575 → 7590 → 7600), with net
near-spot gamma inflating from +40M in the morning to a colossal **+500-590M** into the close. Total
day range ~70 pts, most of it in the first 30 minutes. There was one semi-active window (~10:25-11:52
ET) with two brief negative-gamma flips; everything after ~12:00 ET was an untradeable, ever-tightening
pin. Charts-first kept me flat for ~90% of the session, including the entire mega-gamma afternoon.

## Trades

### T1 — LONG (7555C) · entry 10:25 ET (14:25 UTC) · exit 10:32 ET (14:32 UTC) · LOSS −22.98%
- **Chart thesis:** Pin break to a new day high 7556.88 (100% of range) on two strong green 5-min
  candles (10:20/10:25), momentum accelerating (5m +0.13% / 15m +0.20%), above VWAP.
- **GEX confirm:** 7550 king flipped from overhead resistance to a pika FLOOR beneath price (+21M);
  no wall until 7575 (+15.6M) → ~18 pts of air. Read as the transition OUT of the pin.
- **What happened:** Breakout failed to follow through — stalled at 7556, momentum collapsed to +0.01%
  within 4 min, 10:30 printed red back to the 7550 king. Positive-gamma pin re-asserted. Cut fast (~7 min).
- **Real P&L:** 7555C 12.60 → 10.00 (option genuinely fell as spot went 7556.88 → 7551.66). **net −22.98%.**
- **Verdict:** The entry was the mistake — chasing a marginal poke above a king in a **positive-gamma**
  regime is exactly the trap the method warns about. The fast cut was correct discipline (holding into
  the re-asserting pin would have been worse). A real, deserved loss.

### T2 — LONG (7570C) · entry 11:11 ET (15:11 UTC) · exit 11:18 ET (15:18 UTC) · LOSS −2.96%
- **Chart thesis:** Established, accelerating uptrend — four green 5-min candles (7555→7561→7568→7569),
  new HOD, above VWAP, 15m +0.20%.
- **GEX confirm:** Regime **flipped positive → NEGATIVE gamma** (net −11M) = trend fuel, levels break,
  neutralizing the 7575 king as resistance; 7550 floor refilling beneath. The pin→trend transition the
  method explicitly targets.
- **What happened:** Price ran to 7573.89 HOD but the 7575 king grew aggressively (+22M → +27M, dealers
  defending) while the negative-gamma fuel faded (−11M → −6M). Banked it into that opposing node per the
  cap-0DTE-winners rule.
- **Real P&L:** 7570C 10.00 → 10.00 at my exact decision minutes → **net −2.96%** (friction only). The
  option DID spike to 11.90/11.70 at 15:16-15:17 (the actual HOD prints) and round-tripped back to 10.00
  by 15:18. My exit landed **one minute after the option's peak.**
- **Verdict:** Thesis and structure read were both correct (right direction, right node to bank into).
  The lesson is timing: 0DTE ATM options round-trip in 1-2 minutes — exit ON the spike, not one candle
  later. On peak-minute prints this was a +~15% winner; on exact-minute scoring it's a scratch.

### T3 — SHORT (7565P) · entry 11:45 ET (15:45 UTC) · exit 11:52 ET (15:52 UTC) · LOSS −6.59%
- **Chart thesis:** 7575 rejected all morning; the coil under it broke down, momentum turned negative
  both TFs, two down closes (7568.6 → 7567.2).
- **GEX confirm:** Ceiling rejection (proven +31M 7575 king) + floor giving way (7570 dissolved, nearest
  floor down at 7550, shrinking) + NEGATIVE gamma (−9M) = downside fuel. Structure briefly collapsed
  further (king flipped to a 7535 barney −30M). Flagged at entry as countertrend / above-VWAP = weakest setup.
- **What happened:** Breakdown stalled after only ~3 pts; regime **flipped back to POSITIVE gamma** (+3M)
  and the 7550 floor re-formed. Exited on the confirming-regime-flip rule; price immediately bounced to 7567.68.
- **Real P&L:** 7565P 8.00 → 7.70 → **net −6.59%.** The put ran to 9.80 at 15:50 (spot low) then collapsed
  as price bounced. Entry (8.00) was the *high* of the 15:45 minute (a local put-price high), which hurt.
- **Verdict:** The regime-flip exit was correct — it got me out right before the bounce. But this was the
  lowest-quality setup (countertrend fade of a bullish pin day), the entry timing was poor (bought the put
  spike), and the reward never materialized. Should probably have been a no-trade.

## Totals
| # | Dir | Contract | Entry→Exit (UTC) | Option px | net |
|---|-----|----------|------------------|-----------|-----|
| T1 | LONG  | 7555C | 14:25 → 14:32 | 12.60 → 10.00 | −22.98% |
| T2 | LONG  | 7570C | 15:11 → 15:18 | 10.00 → 10.00 | −2.96% |
| T3 | SHORT | 7565P | 15:45 → 15:52 | 8.00 → 7.70   | −6.59% |

**Total (sum of per-trade %): −32.53%.** 3 trades, 0 wins / 3 losses on exact-minute scoring.

## Self-assessment
- **Did charts-first catch the day's move?** There was no move to catch. This was a slow +0.5%
  positive-gamma escalator with no sustained 0DTE-tradeable thrust and a tiny range. The method's biggest
  win here was **defensive**: it correctly diagnosed the pin and kept me flat through the entire +500M-gamma
  afternoon (12:00-15:45), where a mechanical GEX-long signal would have been repeatedly chopped up on the
  escalator. Standing down was the right call ~90% of the day.
- **Where I lost:** I over-traded the one semi-active window (3 trades vs. a cleaner 0-1). T1 was a genuine
  error — chasing a positive-gamma breakout poke, the exact trap I'm warned about. T2 and T3 were defensible
  reads (correct direction on T2, correct exit-trigger on both) that scored as scratches/small-losses because
  0DTE ATM options round-trip within 1-2 minutes and my exact-minute exits landed just after the favorable spike.
- **The transferable lesson:** On a positive-gamma pin day, the only edge is (a) not trading the pin, and
  (b) if you engage the brief negative-gamma flips, exit ON the option spike — treat the 1-2 minute round-trip
  as the real risk. Capping winners "into the opposing node" is right in principle, but on 0DTE it must be
  faster than one 5-min candle. Net: correct macro read (pin day, stay mostly flat), poor micro-timing on
  the two thesis-right trades, one deserved loss on the one thesis-wrong trade.
