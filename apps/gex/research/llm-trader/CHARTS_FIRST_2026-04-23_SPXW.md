# Charts-First 0DTE — SPXW 2026-04-23 (blind out-of-sample)

Session `cf0423`. Paper/research (Clause 0). Method: price action makes the thesis, GEX only
confirms; be selective; the strong positive-gamma pin is untradeable, the transition OUT of it is
where 0DTE moves. Scored on real 1-min option closes (ET+4 = UTC), net = exit·0.985 / (entry·1.015) − 1.

## Day shape
Open 7137.9 → morning balance in a tight 7119–7137 band → slow positive-gamma grind up to a new
high 7147 (net gamma peaked +94M, a firm midday PIN 11:00–13:00) → **pin broke ~13:00 and flushed
to 7048 (~90 pts / ~1.2%)** as gamma collapsed and flipped deep-negative → violent whippy
negative-gamma chop 7048–7118 into the close, settling ~7100. One clean directional event (the
midday break-flush) inside an otherwise pin-then-chop tape.

## Trades (6)

| # | Side | OCC | Entry ET | Exit ET | Entry $ | Exit $ | Net | Result |
|---|------|-----|----------|---------|---------|--------|-----|--------|
| 1 | LONG C7130 | SPXW260423C07130000 | 10:25 | 10:29 | 12.17 | 10.70 | **−14.7%** | loss |
| 2 | LONG C7140 | SPXW260423C07140000 | 10:55 | 11:00 | 10.20 | 11.40 | **+8.5%** | win |
| 3 | SHORT P7115 | SPXW260423P07115000 | 13:05 | 13:13 | 12.10 | 23.49 | **+88.4%** | win |
| 4 | SHORT P7075 | SPXW260423P07075000 | 13:41 | 13:44 | 21.80 | 25.40 | **+13.1%** | win |
| 5 | LONG C7100 | SPXW260423C07100000 | 14:02 | 14:04 | 12.70 | 11.80 | **−9.8%** | loss |
| 6 | LONG C7115 | SPXW260423C07115000 | 14:33 | 14:40 | 8.00 | 7.10 | **−13.9%** | loss |

**Total (sum of per-trade %): +71.5% · Avg/trade: +11.9% · Record: 3W–3L** — one trade (T3) made the day.

### T1 — LONG, 10:25→10:29, −14.7%
- **Chart:** range breakout attempt, 3 rising 5-min closes (7126.2>7129.5>7132.3), 5-min momo +0.11%, above VWAP, pushing 70% of range toward the 7137.9 day high.
- **GEX confirm:** pika floor reformed at 7120 under price, no wall overhead, 7155 pika magnet above, positive-gamma.
- **Outcome:** breakout had no follow-through on a balance/chop day (a bull trap). Retraced to VWAP in 4 min; cut fast. Lesson: mid-range breakouts on a tight balance day have no room.

### T2 — LONG, 10:55→11:00, +8.5%
- **Chart:** the **confirmed** breakout I waited for — cleared the 7137.9 day high with two up-closes (7138.4>7138.6) after it had rejected 4× prior; 15-min momo accelerating +0.12%.
- **GEX confirm:** positive-gamma +20M, 7155 pika magnet directly overhead with clear air, floor 7120 below.
- **Outcome:** ran 7138.6→7144.4, stalled as positive gamma re-strengthened (pin reasserting at the new high); capped the green into the stall. Correct 0DTE discipline.

### T3 — SHORT, 13:05→13:13, +88.4% (trade of the day)
- **Chart:** the **transition OUT of the pin** — price sliced through the 7130 floor AND the 7119 day low to 7115.9, strongest down-momentum of the day (5-min −0.23%).
- **GEX confirm:** the +80/94M positive-gamma pin COLLAPSED and flipped negative; nearest floor was all the way down at 7065 (~51-pt air pocket) = fuel.
- **Outcome:** rode the flush 7115.9→7099.6, banked the big winner into extreme −86M gamma rather than chase the last leg. This is the whole method working: stand aside through the untradeable pin (11:00–13:00), then take the break-flush.

### T4 — SHORT, 13:41→13:44, +13.1%
- **Chart:** decisive breakdown of the 7080 base that had held 4×; 5-min momo re-accelerated to −0.30%.
- **GEX confirm:** negative-gamma −83M (levels break), 7080 flipped to overhead resistance, target the strong building 7050 floor.
- **Outcome:** rode 7074.2→7061.1, banked into the strong 7050 floor as gamma eased. Clean continuation leg.

### T5 — LONG, 14:02→14:04, −9.8%
- **Chart:** negative-gamma squeeze appeared to break the 7095 barney (14:00 closed at highs, 15-min +0.73%).
- **GEX confirm (failed):** the "clear air to 7130" reverted within one minute — a 7100 barney re-formed and rejected price.
- **Outcome:** fakeout in violent −112M whippy gamma; cut fast for a small loss. First bite at the treacherous 7100 zone.

### T6 — LONG, 14:33→14:40, −13.9%
- **Chart:** 30-min consolidation above 7100 resolved up (3 higher closes), momo improving, toward the strong 7130 pika magnet with clear air.
- **GEX confirm → flip:** entered on easing gamma (−140M→−83M) + 7130 magnet-king; exited when the confirmation FLIPPED (gamma re-strengthened −18M→−89M, 7130 lost king status). Squeeze stalled at 7118.5.
- **Outcome:** exited ~flat on the underlying (+0.00%), but on the 0DTE call that flat still cost −13.9% (theta + the 1.5%/1.5% slippage haircut). Honest loss, not a "breakeven."

## Self-assessment
- **Did charts-first catch the day's move? Yes.** The defining event was the midday pin-break flush (~7137→7048). Reading price first, I correctly judged the 11:00–13:00 grind as an untradeable strong positive-gamma pin (net gamma to +94M) and stood flat through all of it, then took the break-flush (T3 +88.4%) plus its continuation (T4 +13.1%). Those two trades are the day. A mechanical GEX-signal system would have bled theta long the pin and/or faded the flush.
- **What worked:** patience through the pin; waiting for T2's *confirmed* break instead of chasing (T1 taught me, T2 paid); capping 0DTE winners into stalls/floors rather than reaching for the last leg; fast cuts on every loser (all three losses small: −9.8% to −14.7%).
- **What cost me:** the afternoon negative-gamma chop at 7095–7118. I took two fakeout longs there (T5, T6) — the barney kept re-forming/flickering minute-to-minute and I got baited twice before fully standing down. On a violent whippy tape the honest read was "no clean edge, sit out"; I arrived there one trade late each time. T1 was also an over-eager pre-confirmation breakout.
- **Net:** +71.5% summed (avg +11.9%/trade), 3W–3L, with the loss book kept tiny and one large asymmetric winner — a positive out-of-sample day driven entirely by respecting the pin and trading its resolution. Discipline note for next time: after banking the flush, the afternoon −80M+ whippy chop should have been a hard "flat is the position," not two probing longs.
