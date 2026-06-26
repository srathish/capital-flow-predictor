# SPY Breakout + Retest Playbook (the "Glitch-style" trade)

The validated SPY-only 0DTE strategy from [validation/backtest_retest.py](validation/backtest_retest.py).

## The mechanic in 6 steps

1. **Mark the floor at 09:25 ET.**
   Pull Skylit Trinity → identify the *largest positive-gamma strike below spot*. That's your floor.

2. **Wait for SPY to break the floor.**
   A 1-minute candle body closes below the floor strike. Wicks don't count.

3. **Wait for the retest.**
   Price almost always comes back to within ~0.20 pts of the broken floor. This is the "kiss" of the level.

4. **Wait for the hold.**
   3 consecutive 1-minute bars stay *below* the floor after the retest. This is what filters false breakouts — if price closes back above within 3 bars, the retest failed and you do not enter.

5. **Enter puts on the hold confirmation.**
   At the close of the 3rd hold bar. Strike: ATM 0DTE puts.

6. **Manage:**
   - **Stop:** 0.50 pts above the floor strike (gives 1m wobble room)
   - **Take profit:** +1.0 pts below entry → close 50% (or 100%)
   - **If holding runners:** trail with the 1m 8 EMA per [02-ema-stack.md](02-ema-stack.md)

## Validated performance (71 days, Dec 2025 → May 2026)

| Metric | Value |
|---|---:|
| Setups that triggered a floor-break | 20 |
| Setups that survived retest + hold | 20 (in this dataset, all triggered did → see note below) |
| Win rate | **55.0 %** |
| Stop-out rate | 40.0 % |
| Avg P&L per trade | +0.21 pts |
| Median P&L | **+1.03 pts** |
| Avg max favorable per trade | +0.83 pts |
| **Total P&L over 5 months** | **+4.2 pts** |
| Best single trade | +2.06 pts |
| Worst | −1.88 pts |

**The median trade hits the take-profit target.** That's the strongest signal — most trades pay if you take profits at +1.0 pt.

## Why the call side is harder

In the same backtest, calls (ceiling break + retest + hold) only hit 43.5 % and lost 5.3 pts total. Likely cause: my structure code defines "ceiling" as `max |gamma| above spot` — which mixes positive (pin) and negative (gatekeeper) gamma nodes. These behave differently:

- A **positive ceiling** broken = trapped shorts cover, slow grind up
- A **negative ceiling** broken = dealer trapdoor amplifies, fast move

For SPY calls, the right "ceiling" is probably the largest *negative* gamma node above (the gatekeeper). That's a future patch — for now the puts side is the validated trade.

## How this differs from the naive breakout

| | Naive breakout | This (retest + hold) |
|---|---|---|
| Entry timing | First 1m close past level | After 3-bar hold confirmation |
| Stop | Tight (level itself) | 0.50 pts beyond level |
| TP | Run to vacuum | +1.0 pt locked |
| Win rate | 71 % | 55 % |
| Avg P&L | +0.95 pts | +0.21 pts |
| **Why use this?** | Catches every move | Avoids the bad fills + false breakouts that bleed real account capital |

The naive backtest is a *simulation*; the retest version is closer to how you actually trade. Slightly lower win rate but better entry quality.

## The full daily workflow

```
09:25 ET — Pull Skylit Trinity. Note SPY floor + ceiling.
09:30 ET — Open. Don't trade. Watch the levels.
09:30 – 15:30 — Wait at the levels.

IF spot breaks below floor (1m body close):
  1. Confirm break — body, not wick
  2. Wait for retest (within 0.20 pts of floor)
  3. Wait for HOLD — 3 bars staying below floor
  4. ENTER ATM 0DTE puts (or 1DTE on lower-conviction days)
  5. Stop: 0.50 above floor; TP: +1.0 below entry
  6. Move on. One trade per direction per day.

IF spot breaks above ceiling: same mechanic mirrored — but the call side
is less validated. Half size until structure-derivation is improved.

12:00 – 15:30 ET:
  If no breakout fired and SPY is sitting near King → premium-selling
  window opens (54 % pin rate on SPY, 66 % on QQQ).
```

## Reproducibility

```bash
cd "/Users/saiyeeshrathish/the final plan"
uv run python sniper/validation/backtest_retest.py
```

Outputs `sniper/validation/retest_backtest.json` with per-day entry/exit details.

## What's still open

- Improve the call side: separate positive ceilings from negative gatekeepers
- Test with the 1m 8 EMA as a trailing stop instead of fixed +1.0 pt TP
- Add EMA stack confirmation as a score modifier (currently the retest-only filter is the entry mechanic)
- Test on QQQ — preliminary numbers from `backtest_brief.py` suggest QQQ breakout below floor is also profitable (+47.3 pts on naive)
