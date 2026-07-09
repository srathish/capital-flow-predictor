# Loss Study — 2026-07-08 (Final System, 19 plays, 10 losers)

Method: for each losing play, reconstruct the Skylit surface at fire time and through the hold from the local archive (5-min frames, all strikes, GEX+VEX), classify the failure mode, then test each mode across all 64 archived days to separate systematic leaks from healthy variance. **Rule of the study: a loss is only a "mistake" if the pattern that produced it loses money in aggregate.** Otherwise it's the cost of being in the game.

---

## The losers, classified

| Play | P&L | Failure mode |
|---|---|---|
| 11:42 SPXW 7430P | **−$1,348** | ① Direction flip-flop |
| 14:02 SPXW 7475P | −$135 | ① Direction flip-flop |
| 14:16 SPXW 7475C | −$40 | ① Direction flip-flop |
| 09:30 SPXW 7460P | −$350 | ② Opening churn (variance, not a leak) |
| 09:30 QQQ 706P | −$108 | ② Opening churn (variance, not a leak) |
| 14:51 SPXW 7480C | −$215 | ③ Late-chop residue |
| 13:32 SPY 746C | −$75 | ③ Pin-chop residue (exit cut −84% vs −100%) |
| 12:40 QQQ 708P | −$101 | ③ Chop residue (anchor exit cut it) |
| 12:11 SPY 742P | −$52 | ③ Pin-chop residue (pin exit cut −37%) |
| 13:41 SPY 745P | −$35 | ③ Chop residue |

## Mode ① — Direction flip-flop (THE real leak; fixed)

**The autopsy of −$1,348.** At 11:36 the machine correctly fired BULL_REVERSE (SPXW 7435C → +$2,148). Six minutes later it flipped to BEAR_RUG and bought the 7430P. The surface at that minute:

- Barney fuel **above** spot: $12M · below spot: $2M — a **6:1 bullish skew** (dealers short gamma overhead = forced buyers on any bounce)
- A +$14-17M pika at $7,430 (10-13% of the whole surface) sitting directly under spot — a hardening floor
- By 12:10 spot had rallied $11 and the put was dead

Both rug and reverse-rug pattern conditions can technically coexist near a turn; the state machine flipped on whichever scored last, and the second fire fought the first — and fought the fuel. The 14:02→14:16 pair is the same disease in miniature (PUT then CALL 14 minutes apart in the closing pin).

**64-day evidence this is systematic, not today-specific:** fires within 20 minutes of an opposite-direction fire on the same ticker ran **45% win, +6% opt EV** vs **57% win, +23% EV** for everything else (n=78 vs 463).

**Fix shipped:** 20-minute opposite-direction cooldown per ticker (`flip_flop_cooldown` in the gate). Effect on today: blocks the −$1,348, −$135, −$40 (and one +$135 winner) → **today improves from +$2,762 to ~+$4,150**. Effect on 64 days: +113bps net on 14% fewer plays, EV/play 21%→23%.

## Mode ② — Opening churn (hypothesis TESTED and REJECTED — do not "fix")

Both 9:30 fires lost today, and the obvious "fix" is a warm-up period. The 64-day data says the opposite: **fires in 9:30-9:40 are the single best bucket in the system — +51% opt EV (n=107)** vs +13% after 9:40. Opening fires monetize the opening trend; today they lost because today V-reversed, which is variance. Blocking them would delete the most profitable window to avoid two bad trades. **No change.** This is the study's most important negative result: the instinct to patch every visible loss is how systems get overfit to yesterday.

## Mode ③ — Chop/pin residue (working as designed)

Six small losses, −$35 to −$215, all in the SPY 744-746 / SPXW 7475-7480 afternoon pin. In every case an exit rule cut the loss well before max pain: the 12:11 put exited at −37% (pin detection), the 13:32 call at −84% instead of −100%, the QQQ put at −51% (anchor hardening). The pin-on-spot *entry* filter was already tested in the main validation and **rejected** (those entries win 59% overall). These losses are the premium the system pays to be present when the pin breaks — and the winners (10:02 put +106%, 11:36 call +137%) are what it pays for.

## What we learned, in one paragraph

Today's losses had one systematic cause and two cosmetic ones. The systematic one — the state machine fighting its own six-minute-old signal, against a 6:1 fuel skew — is now blocked by the flip-flop cooldown, validated on 64 days. The cosmetic ones (opening variance, pin-chop residue) are the survivable losses of a positively-skewed book: 10 losers averaging −$246 against 8 winners averaging +$653. The discipline this study enforces: **every proposed fix must beat the 64-day replay, not just repair yesterday's chart.** Two of my three hypotheses failed that test today (opening warm-up, and last week's pin entry filter) and were discarded.

## Final system after this study

1. ATM-only, one contract per fire
2. One live play per ticker+direction (dedupe)
3. **20-min flip-flop cooldown** ← new
4. G7-PC gate: bears need spot < prior close · bulls free · nothing after 15:15 ET
5. Full-surface structural exits + trail stop

64-day (points basis): ~+2,050bps, 57% win, ~+23% opt EV/play, ~7 plays/day.
Today (option dollars): ~+$4,150 on ~$12,700 capital ≈ **+33%**, vs +0.8% old system.

---

## Correction (same evening) — flip-flop fix REVERTED after failing the dollar test

The 20-min flip-flop cooldown shipped on the points-based evidence above, then failed its first option-dollar replay: on 7/08 itself it blocked the **+$1,980** 10:02 SPXW put (fired 10 min after the 9:52 call — a real regime flip, not noise) alongside the −$1,348 loser, dropping the day from +$2,762 to +$925. Root issue: the flip-flop bucket is 45%-win but **+6% option EV — weaker, not negative**. Blocking positive-EV trades is variance reduction purchased with expectancy.

A fuel-skew veto (block fires opposing a ≥2:1/3:1/4:1 barney skew — the signature of the 11:42 loser) was then tested as the surgical alternative: **also rejected**. Vetoed fires ran +14% to +24% opt EV at every threshold; at 2:1 they *outperformed* the allowed set.

Verdict: the −$1,348 was a loss, not a leak. Mode ① is downgraded from "systematic leak" to "watchlist" — revisit with 2+ weeks of live 1-min data. The cooldown remains in the code behind `FLIP_FLOP_COOLDOWN_MIN` (default 0 = off). Final system for 2026-07-09 is: ATM-only + dedupe + G7-PC gate + full-surface exits + trail. Today under exactly that: **+$2,762 on $15,175 (+18.2%), 19 plays.**
