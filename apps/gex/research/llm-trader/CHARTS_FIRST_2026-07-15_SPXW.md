# CHARTS-FIRST 0DTE — SPXW 2026-07-15 (TRUE FORWARD, blind)

Discretionary charts-first paper trading (RESEARCH, Clause 0). Price action = thesis; GEX confirms only.
Firewall respected: read only CF_METHOD.md + step_cf.py harness output. Scored with real UW 1-min option prints.

## Day frame (as revealed by the harness, decide-then-reveal)
Strong **positive-gamma pin day**. Open 7571.68. Slow orderly grind DOWN the pika staircase to the 7528 low
(~12:23-12:46, +200M+ near-spot gamma), then an equally slow grind back UP (7550 → 7560 → 7580) to retest the
opening/day high, rejection off the 7580 wall into the close, settling ~7557. Net day roughly flat (-0.19% at 15:26).
Near-spot gamma ran +39M (open) → +281M (midday pin) → collapsed to +80M twice at the afternoon transitions.
The whole day was untradeable chop EXCEPT one genuine transition: the afternoon 7580-rejection flush.

Note: the live forward capture was sparse/gapped in the first ~2 hrs (only the 09:53 snapshot visible until midday),
forcing coarse fast-forwards early. Afternoon data was ~1-min dense; both trades were placed there.

## Trades

### Trade 1 — LONG (ATM call 7570) — SMALL WIN +1.85%
- **Entry** 13:58 ET (17:58 UTC) @ spot 7568.87 · **Exit** 14:04 ET (18:04 UTC) @ spot 7569.74
- **Chart thesis:** sustained afternoon uptrend off the 7528 exhaustion-V low, 8 green candles, reclaimed to
  day-high zone (7568, -0.04% day), above VWAP 7549, 15-min momentum +0.14%.
- **GEX confirm:** pin RELEASING (net gamma +255M → +183M), 7550 floor shrinking -5/min left 18pt below as support,
  nearest resistance jumped up to 7580 (+34M) = clean AIR POCKET 7568→7580. Long the release, cap at 7580.
- **Management / exit:** thesis broke in 6 min — net gamma RE-strengthened +174M → +195M, the 7565 barney fuel
  vanished, and 7580 hardened into a GROWING +43M king wall (air pocket closed into a ceiling). Price stalled 7569-70,
  momentum faded. Cut fast per "exit-when-regime-flips" rather than round-trip into theta.
- **Real prints:** call close 5.05 → 5.30. **net = 5.30·0.985/(5.05·1.015) − 1 = +1.85%.**

### Trade 2 — SHORT (ATM put 7565) — WIN +33.63%
- **Entry** 14:48 ET (18:48 UTC) @ spot 7563.37 · **Exit** 14:57 ET (18:57 UTC) @ spot 7558.91
- **Chart thesis:** clean rejection off the 7580 day-high wall — 3 red candles 7574→7563, 15-min momentum flipped
  NEGATIVE (-0.15%), breaking back down.
- **GEX confirm (the cleanest transition of the day):** pin COLLAPSING (net gamma +223M → +82M), king flipped to a
  -72M BARNEY at 7565 = negative-gamma FUEL price was falling through, 7580 ceiling rejected. Target = 7550 pika
  floor (~13pt below). This matched the method's short template exactly: ceiling rejection + collapsing pin + barney fuel.
- **Management / exit:** the flush stalled ~7pt short of target as the 7550 floor fortified explosively (1mΔ +21.9/min)
  into a +76M pika fortress (biggest node of the day); price bounced 7557.6→7558.9, 5-min momentum flipped +, barney
  fuel faded (-72M → -60M), net gamma back +121M positive. CAP the winner into the opposing pika node.
- **Real prints:** put close 6.10 → 8.40. **net = 8.40·0.985/(6.10·1.015) − 1 = +33.63%.**

## Result
| # | Side | Contract | Entry→Exit (UTC) | Opt entry→exit | Net |
|---|------|----------|------------------|----------------|-----|
| 1 | LONG call 7570  | SPXW260715C07570000 | 17:58 → 18:04 | 5.05 → 5.30 | **+1.85%** |
| 2 | SHORT put 7565  | SPXW260715P07565000 | 18:48 → 18:57 | 6.10 → 8.40 | **+33.63%** |

**TOTAL: +35.48%** (2 trades, 2 wins).

## Self-assessment
- **Charts-first caught the day's one real move.** The only tradeable event on this strong-pin day was the afternoon
  7580-rejection flush; the discretionary read (rejection off the day-high wall + collapsing pin + a -72M barney as
  negative-gamma fuel) put me short into it for the day's big winner (+33.63%). Real option prices confirmed the read:
  a ~4.5pt underlying drop moved the 0DTE ATM put +38% raw because it happened in the barney/high-gamma zone with ~50m
  to expiry — exactly the amplification the barney signalled.
- **Discipline held through the untradeable pin.** I correctly stood down through ~4 hours of +200M positive-gamma
  chop (morning grind, the fake 7540 break that reverted, the midday cage, the extended bounce into the 7550 king).
  I did NOT chase the long at 7545 into the 7550 wall (it pinned, as expected), and I did NOT force a third trade at
  the ambiguous 7565 barney into the close with <27 min left. "0 trades is the right answer on a strong pin" was obeyed.
- **The long was the weaker trade.** The air-pocket release fizzled within 6 min; I cut it on the regime flip. It netted
  a small +1.85% partly by luck (the call's exit-minute close ticked slightly above entry). The genuine edge was the
  short. If anything, the long entry was a touch late/marginal — a purer read would have stood down there too, but the
  fast exit kept it harmless.
- **Verdict:** On a true blind forward day, charts-first behaved as designed — flat through the pin, selective, and
  present for the single transition. 2/2 wins, +35.48%.
