# Gate × Exit interaction: is STOP-30 still worth it once the bull-tape gate is armed?

**Date:** 2026-07-13 · **Mode:** RESEARCH ONLY (Clause 0 — no live-code changes)
**Question:** The −30% hard stop beats structure-invalidation by ~+17% *measured on ALL plays*, including the counter-trend bulls the incoming bull-tape gate would kill. Once the gate removes that bull tail, does STOP-30 still add value on the survivors, or is it redundant with the gate?

**Answer up front:** STOP-30 is **still clearly additive (verdict i)**. The double-counting worry is **refuted** — the survivor deep-loss tail is carried by **bears**, which the gate never touches. Gate and stop cut *different* tails and are complementary, not redundant.

---

## Data & method

- Source: `apps/gex/data/gexester.db` → `tracked_plays`, 173 legs / 67 distinct fires, 4 days (2026-07-08 → 07-13).
- **Gate rule applied:** a `BULL_REVERSE` (call) fire is BLOCKED if at fire time SPY **and** QQQ **and** SPX were all below prior-session close. Bears never blocked. Tape from UW 1m stock candles (`/api/stock/{t}/ohlc/1m`), prior close = prior day's last regular bar.
  - SPX index intraday is not permitted on this key → **SPX proxied by SPY** (same basket intraday). *Immaterial here:* every one of the 16 blocks already has SPY red **and** QQQ red, and every survivor has SPY or QQQ green — so SPX≈SPY never flips a decision. Validated against SPXW `spot_at_fire` on the 7 SPXW bull fires.
- **Option paths:** UW `/api/option-contract/{sym}/intraday?date=` (1m; needs `User-Agent` or it 403s). All 101 survivor+blocked contracts returned data.
- **Current-exit realized** = `(close_mark − entry_mark)/entry_mark` from the tracker's own recorded close (3 null closes reconstructed from last regular option bar).
- **STOP-30 realized:** walk minute *closes* from fire→current-exit close; if any ≤ `entry×0.70`, realize **−30%** (assumed fill at the stop); else keep the current-exit outcome. `low`-based touch reported as sensitivity.

## Gate outcome on bull fires

**16 of 34 bull fires blocked** (40 legs). **All 6 of the 7/13 fires blocked** — the gate targets exactly the day whose counter-trend bulls were the −87/−90/−68/−64% disasters. 

## Headline table (STOP-30 vs current exit)

| Bucket | n | avg CURRENT | avg STOP-30 | Δ pts | deep-loss <−50% (cur→stop) | winners kept / cut |
|---|---:|---:|---:|---:|---:|---:|
| ALL plays (pre-gate, method check) | 173 | −21.0% | −9.1% | +11.9 | 73 → 0 | 24 / 17 |
| Gate-BLOCKED bulls (removed) | 40 | **+45.7%** | +19.8% | −25.9 | 9 → 0 | 9 / 11 |
| **GATE-SURVIVORS (KEY)** | **133** | **−41.0%** | **−17.7%** | **+23.3** | **64 → 0** | **15 / 6** |
| — survivors: bears only | 99 | −49.6% | −21.6% | +28.0 | 56 → 0 | 8 / 5 |
| — survivors: surviving bulls | 34 | −16.2% | −6.5% | +9.7 | 8 → 0 | 7 / 1 |

*(ALL-plays −21.0%→−9.1% reproduces the exit-study's −21% current and the direction of its ~+17 claim; my +11.9 is smaller because I fill exactly at −30% on minute-close rather than last-price. Low-based sensitivity moves the survivor STOP-30 avg only −17.7%→−18.3% — robust.)*

## Marginal value of STOP-30 GIVEN the gate is armed

- The concern was that STOP-30's edge double-counts the bull tail the gate removes. **It does not.** Among the 133 gate-survivors there are **still 64 deep losses (<−50%)** under the current exit — composition **56 bears + 8 residual bulls**. The gate removes *bulls*; the survivor tail is *bears*, which the gate cannot reach.
- STOP-30 cuts **all 64** survivor deep losses to −30%, at a cost of only **6 winners** clipped (dipped −30% then recovered). 91 of 133 survivors get stopped.
- The stop's improvement is **larger** on survivors (+23.3 pts) than on all plays (+11.9), because survivors are bear-heavy and bears had a brutal −49.6% current-exit average with a fat left tail. The gate and the stop are attacking **independent** tails.

## VERDICT

**(i) STOP-30 is still clearly additive with the gate ON.** Not redundant. The gate truncates the *counter-trend-bull* tail; the stop truncates the (larger, untouched) *bear-decay* tail plus any residual bull risk. Keep both.

## Caveats (honest about tiny n)
- **Tiny sample, one dominant day.** 4 days / 67 fires; 7/08 supplies 143 of 173 legs and drives the blocked-bull bucket.
- Option paths use **trade-price minute closes as a mark proxy** (the intraday endpoint has no bid/ask mid); entry is the tracker's mid. On penny contracts (0.01–0.05) % swings are noisy. Stop fill assumed exactly at −30% (optimistic vs slippage); low-touch sensitivity is negligible (−0.6 pt).
- Bear current-exit realized (−49.6% avg) is the system's own recorded P&L over a chop window — it dominates the survivor result. If bear entry quality improves, the stop's marginal value shrinks proportionally.

## DECISIONS NEEDED (out of scope of the stop question, flag only)
- **The gate itself removed a net-POSITIVE bull bucket over this window (+45.7% avg current-exit).** Broken out by day: 7/08 **+65.8%** (incl. a +432% leg), 7/10 +18.6%, 7/13 **−52.4%**. The all-red-tape bulls that bounced on 7/08 are exactly what the gate would kill. The gate correctly removes the 7/13 disasters but its own EV is **day-dependent and not settled by 4 days** — the +45.7% is an artifact of 7/08. This is a separate question from the stop and should be validated on more sessions before treating the gate as unambiguously additive. **Recommendation:** arm gate + STOP-30 together (stop protects survivors regardless), and re-run gate-EV once ≥15 sessions of bull fires exist.
