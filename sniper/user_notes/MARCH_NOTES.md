# March 2026 SPY — combined review notes

The user's spoken notes on each reviewed day, put next to the board facts (Skylit replay) and what the engine did (0DTE
options at real UW prices, per-trade %). Per-day files hold the full quotes. Not reviewed yet: 3/2, 3/6, 3/19, QQQ; 3/12
skipped (chart bug, now fixed).

## Day by day

| Day | Open → close (H / L) | Kings (longest) | Engine trades | Day | What the user saw |
|---|---|---|---|---|---|
| 3/3 | 675.1 → 680.3 (682.6 @14:46 / 669.7 @10:27) | 680 226m, 670 66m, 676 55m — 41 changes | 10:10 672C −19% · 10:26 670P −35% · 13:39 681C −57% | −111% | 680 king kept popping up all day: holding the 672C would have made about +305%. The 681C was bought near high of day on top of a pinned king. |
| 3/4 | 681.6 → 685.3 (687.1 / 679.6 @09:45) | 686 248m, 685 124m, 681 17m | 09:48 681C +54% · 10:30 686C −26% | +28% | 681 was a negative king at the open, so puts right away. 685 grew fast and became king, so calls were the right call, with an exit on touching 685. No trade past the king; 685–687 was a box, so stand aside. |
| 3/5 | 682.1 → 681.4 (685.5 @10:00 / 675.6 @14:32) | 680 319m, 685 68m | 10:08 684P +94% · 10:20 683P +99% · 10:31 680P −39% · 14:33 676P −43% | +111% | 676 was hit twice and held, so it acted as a floor and bounced back toward the 680 king. Why puts there? 682 became king late. |
| 3/9 | 666.4 → 678.4 (679.9 @15:38 / 662.4 @10:11) | 660 340m, 678 20m | 13:20 670P −64% | −64% | 660 was king most of the day, so puts made sense. A sudden 15:00 rally with nodes growing above: was it news? |
| 3/10 | 677.7 → 677.0 (683.4 @13:28 / 674.8 @10:09) | 678 146m, 679 112m, 675 111m — 39 changes | 10:37 679C +67% · 13:49 682C −50% | +17% | The engine bought at a king. 681 and 675 kept growing under price, "raising the floor", and 675 became king. |
| 3/11 | 677.6 → 676.3 (680.1 @10:01 / 673.3 @13:38) | 675 312m, 677 33m, 681 25m | 10:10 678C −12% · 11:31 674P −57% | −69% | The king flipped between 681 and 675 while 681 shrank. The engine buys late, on the side opposite the coming move. Price flirted with the king, then broke late to 677. |
| 3/12 | 671.1 → 666.0 (671.7 / 665.9 @15:59) | 660 194m, 670 166m | 10:29 669P −44% · 12:10 668P −29% | −73% | Skipped: the king was off the chart, a display bug that is now fixed. |
| 3/13 | 669.3 → 662.3 (672.3 @09:46 / 661.4 @15:43) | 660 387m — 4 changes | 10:04 670P +254% · 10:51 667C −30% · 10:52 667P +104% | +328% | 660 was far below and kept growing, and price drifted toward it all day. Puts were right. |
| 3/17 | 672.4 → 670.8 (674.4 / 669.9 @12:07) | 674 218m, 672 123m — 47 changes | 10:18 672P −31% | −31% | The king went 672 → 675, then 674 dominated. Study request: does a longer king tenure change price? |
| 3/18 | 668.4 → 661.6 (669.7 / 661.2 @15:59) | 670 192m, 669 90m, 665 56m — 41 changes | 10:13 668P +124% · 10:27 666P −35% | +89% | Why puts under a king flipping 670/669? 675 became the new king late. News? |
| 3/20 | 656.5 → 648.4 (656.7 @09:45 / 644.7 @15:38) | 653 266m, 645 86m, 660 22m — 6 changes | 10:01 653P −31% | −31% | King 660 → 653, and the engine bought puts at the king. Price chopped around 653, then broke through 651 into the close. Buy later, when premium is cheaper. |

Engine total on these 11 days: 26 trades, sum +194% per trade (3/13 alone +328%).

**The 3/20 premium point, checked:** the 653P cost $2.27 at 10:01. It traded at $1.25–1.50 between 12:00 and 13:00, still
before the break, and ran to $5.75 at 15:30 (peak $8.17 at 15:38). The engine stopped out at $1.56.

## Recurring themes

1. **The king is where price goes, not something to fade.** This is the user's core read. On 3/3, 3/13 and 3/20 price went
   to (or stayed at) the persistent king. Trades toward the king worked; trades past it or against it lost.
2. **Exit at the king; never trade past it.** 3/3 681C, 3/4 686C and 3/5 680P were all bought through or beyond a king, and
   all lost.
3. **A growing node is a floor, a ceiling or the next king.** Examples: 3/4 (685 grew fast and became king), 3/5 (676 held
   twice), 3/10 (681 and 675 "raising the floor"), 3/13 (660 kept growing and was reached).
4. **A flipping king means chop: stand aside.** On 3/3, 3/10, 3/11, 3/17 and 3/18 the king changed 39–47 times and most
   engine trades lost. On the cleaner days (3/4 with 7 changes, 3/13 with 4, 3/20 with 6) the king was stable.
5. **The engine is late or on the wrong side.** 3/11 and 3/3: it bought after the move, right before the reversal.
6. **Entry timing and premium.** 3/20: the same contract was much cheaper by midday, and the move came at the close.
7. **Questions to look up:**
   - Was there news on 3/9 (15:00 rally), on 3/18 and on every reviewed day?
   - Does king tenure affect price (3/17)?

## Candidate rules (U1–U8, untested)

U1–U6 are in CANDIDATES.md. New from these notes:

- **U7, the king-flip filter:** no trades while the king has changed often in the last N minutes (3/3, 3/11, 3/17, 3/18).
- **U8, late entry:** if the king thesis is still valid after midday, enter then rather than at the open, to buy cheaper
  0DTE premium (3/20).
  - Caveat: the premium is cheaper because less time is left, not because it's mispriced. The test is whether late entries
    toward the king beat early ones after the cheaper price.

## Already tested, to keep in mind

- **Persistent king as a destination:** reached 22–25% of the time vs 27–28% for a mirror level (not confirmed).
- **King pins price near it:** confirmed (50–60% vs 20–33%).
- **King-pin fly** (sell premium at the king): Mar–May +104%, now on the forward paper ledger.
