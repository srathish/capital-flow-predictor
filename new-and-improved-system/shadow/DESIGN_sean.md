# Sean (SRxTrades) breakout swing system — locked test design (2026-10-05, before any results)

Source: "How to make money in stocks (full guide)" by @SRxTrades (Qullamaggie-style). Tested in **shares** on daily bars
(`.cache/wdaily`, ~1,000 names, UW, 0 Skylit credits). The 5-minute "sniper" entry cannot be tested on daily data.

## Rules (fixed — no tuning on any period)

Signal day **t** (all inputs known at t's close):

1. **Market gate:** SPY close > EMA8, EMA21 and EMA50 (SPY daily).
2. **Scan (his TradingView screen):** close > $3; volume_t > 500k; change_t > 0; ADR20 (mean of high/low − 1, 20 sessions to t−1) > 2%;
   close > EMA8, EMA21, EMA50. Market cap > $300M is implied by the universe (all ≥ that size).
3. **Setup (staircase / tight base):**
   - base = the 15 sessions t−15 … t−1;
   - tight: (max high − min low) / min low of the base ≤ 3 × ADR20;
   - prior advance ("large move higher" first): close at base start ≥ 1.20 × min low of the 40 sessions before the base;
   - volume dries up: mean volume in base < mean volume of the 20 sessions before the base;
   - setting up above the MAs: close at t−1 > EMA21 at t−1.
4. **Trigger:** close_t > max high of the base, and volume_t ≥ 1.5 × mean volume of the 20 sessions to t−1.
5. **Entry:** next session open (t+1). Stop = low of day t. If the t+1 open ≤ stop the trade is skipped.
   One open trade per ticker at a time.
6. **Management (quarters):**
   - stop hit (low ≤ stop) → exit everything left at the stop (or at the open if it gaps through);
   - trim 1: ¼ at entry + 3R (R = entry − initial stop), then stop → breakeven;
   - trim 2: ¼ at next open after the first close < EMA8;
   - trim 3: ¼ at next open after the first close < EMA21;
   - final: rest at next open after the first close < EMA50;
   - still open at data end → marked at the last close (counted, flagged).
7. **Costs:** 0.10% round trip.

## Measures

Per trade: % return on the position and R-multiple. Also: win rate, mean/median, t-stat, top-5 share of total P&L, per-year,
excess vs SPY over the same holding dates.

## Controls

- **Random-entry control (main):** for each real trade, a random stock from the same day's scan list (steps 1–2 pass, step 3–4
  not required), entered and managed with the identical rules (stop = its day-t low). 200 draws → distribution of mean returns.
- **No market gate** variant (does the SPY filter add anything?).
- Excess vs SPY on the same dates.

## Periods

- Development: signals 2023-01-01 → 2024-12-31 (data starts 2022-10; EMA50 warm-up).
- Holdout: signals 2025-01-01 → 2026-09-30. **Run once.**

## Pass (holdout) — all three

1. Mean return per trade > 0 with t ≥ 2.
2. Mean beats the 95th percentile of the random-entry control means.
3. Mean excess vs SPY over the same dates > 0.

If it passes, it goes into the live paper scorecard. If not, it is logged as failed.

## Known biases (stated before running)

- Survivorship: the universe is today's ~1,000 largest companies. This flatters every variant and the control equally; the
  control comparison is the honest one.
- Regime: 2023–2026 was mostly a bull market. The holdout includes the 2025 spring drawdown.
- Daily bars only: intraday entries, and stops checked against the daily low.
