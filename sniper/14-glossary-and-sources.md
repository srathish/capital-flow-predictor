# 14 — Glossary & Research Sources

## Glossary

Acronyms and terms used across this folder, alphabetical.

| Term | Definition |
|---|---|
| **0DTE** | Zero days to expiration — options expiring today. |
| **1DTE / 2DTE** | Options expiring 1 or 2 trading days out. |
| **ADD** | NYSE Advance-Decline line; advancing stocks minus declining stocks, cumulative through the session. |
| **Anchored VWAP** | VWAP starting from a specific point (yesterday's close, FOMC release, etc.) rather than 09:30. |
| **Archetype** | One of the seven day types: Trend, Double-Distribution, Normal, Normal Variation, Neutral, Non-Trend, P/b-shape. |
| **ATM** | At-the-money option (strike ≈ spot). |
| **Body close** | The close price of a candle, ignoring wicks. Sniper uses body close to confirm rung breaks/reclaims. |
| **Break-confirm** | The rung beyond `TARGET_1` that validates the breakout (e.g., 740.8 above 740). |
| **CHEX** | Charm exposure — ∂Δ/∂t at the dealer-aggregate level. Used as 1 PM 0DTE drift signal. |
| **DEX** | Delta exposure at the dealer-aggregate level. |
| **Double Distribution** | Day type where two balances stack with a thin neck between. |
| **EMA** | Exponential moving average. Used at 8 / 13 / 21 across 1m / 5m / 15m. |
| **Failure trigger** | Bear-side entry rung below the pivot. |
| **Four-Greek confluence** | GEX + DEX + VEX + CHEX all aligned. The A++ setup. |
| **Gamma flip** | The price at which net dealer gamma crosses zero. Sniper's regime boundary. |
| **GEX** | Gamma exposure — ∂Δ/∂S at the dealer-aggregate level. |
| **IB** | Initial Balance — the price range of the first 30–60 minutes of RTH. |
| **IV** | Implied volatility. |
| **Ladder** | The 8-rung structure of pivot + bull/bear targets/extensions decoded from a Rapid post. |
| **Max pain** | Strike at which total option open interest is least valuable to holders. Acts as expiry magnet. |
| **NBBO** | National Best Bid and Offer. |
| **Non-Trend Day** | Day type with very narrow range and no clean breakouts. Skip. |
| **OPEX** | Options expiration (typically third Friday). |
| **ORB** | Opening Range Breakout — breakout of the first N-minute range. |
| **P-shape / b-shape** | Profile shapes denoting accumulation (P) or distribution (b). |
| **Pivot** | The hold/lose axis of the day from the Rapid post. |
| **POC** | Point of Control — most-traded price in a profile. |
| **Quad-witch** | Quarterly OPEX where stock options, index options, stock futures, and index futures all expire. |
| **Reclaim** | Price returns above a lost level and closes above it. |
| **Retest hold** | Price returns to a broken level and bounces or rejects from it (instead of failing). |
| **Rung** | A single level in the ladder. |
| **Stack** | The set of three EMAs (1m, 5m, 15m) and whether they're aligned. |
| **Sweep** | Price wicks below a known liquidity level to trigger stops, then often reverses. |
| **Talon** | Your existing flow-scanner app. |
| **TICK** | NYSE Tick Index — uptick stocks minus downtick stocks, instantaneous. |
| **TF** | Timeframe. |
| **TP1 / TP2 / TP3** | Take-profit ladder: first / second / third target. |
| **Trend Day** | One-sided day with minimal pullback. Sniper's best day. |
| **VAH / VAL** | Value Area High / Low — boundaries of yesterday's value area (~70 % of volume traded). |
| **Vanna** | ∂Δ/∂σ — second-order Greek; how delta moves with IV. |
| **VEX** | Vanna exposure at dealer-aggregate level. |
| **VOLD** | Volume Advance-Decline — net volume of advancing stocks minus declining stocks. |
| **VWAP** | Volume-Weighted Average Price; daily intraday benchmark. |
| **Wall** | Highest gamma strike in calls (call wall) or puts (put wall) within a price range. Acts as magnet/barrier. |

## Research sources used in this iteration

The system in this folder synthesizes several established practitioner
frameworks. None of these is the *whole* system, but each contributes
specific rules or thresholds.

### 0DTE & GEX / VEX

- [FlashAlpha — 0DTE SPY Complete Intraday Playbook](https://flashalpha.com/articles/0dte-spy-complete-intraday-playbook-same-day-options) — source for the intraday clock (theta multipliers by window), positive/negative GEX regime rules, opening range / lunch reversal / power hour setups, and the post-FOMC vanna rally setup.
- [FlashAlpha — GEX Trading Guide 2026](https://flashalpha.com/articles/gex-trading-guide-gamma-exposure-api-spy-tsla) — source for the four-Greek confluence framework (GEX + DEX + VEX + CHEX), critical mistakes to avoid (expiration filter, wall-as-zone), gamma flip behavior.
- [FlashAlpha — Vanna & Charm Second-Order Greeks](https://flashalpha.com/articles/vanna-charm-second-order-greeks-guide) — vanna and charm mechanics.
- [Skylit — VEX Trading: Vanna Flows & Vol Regimes](https://www.skylit.ai/learn/vex-trading) — source for the +VEX / −VEX × above/below-spot 2×2 trade matrix, the "breakout paradox" rule (only buy +VEX resistance breakouts when IV is already falling), cross-expiry (0DTE vs 7+ DTE) vanna integration.
- [TradeEdgePro — 0DTE Gamma Exposure 2026](https://tradeedgepro.net/0dte-gamma-exposure-2026/) — gamma flip as hard regime boundary near expiry.
- [SpotGamma — Gamma Exposure (GEX)](https://spotgamma.com/gamma-exposure-gex/) — canonical GEX definition.
- [MenthorQ — Understanding 0DTE Gamma Exposure Guide](https://menthorq.com/guide/understanding-0dte-gamma-exposure/) — 0DTE-specific gamma behavior.
- [Unusual Whales — SPY GEX, DEX, Vanna & Charm Exposure](https://unusualwhales.com/stock/SPY/greek-exposure) — the actual UW data surface you'd plumb into `apps/gex`.

### EMA strategy

- [HowToTrade — 8/13/21 EMA Strategy for Intraday](https://howtotrade.com/trading-strategies/8-13-21-ema/) — source for the 8 → 13 → 21 EMA system (crossover entries, 13 EMA as trailing stop, 1.5R/2R/3R exits, higher-timeframe trend filter rule).
- [Trading Direction — 8 EMA / 20 EMA Scalping](https://www.tradingdirection.in/blog/mastering-scalping-strategy-how-to-use-8-ema-and-20-ema-for-high-profit-trades) — alternate 8/20 pairing.
- [OpoFinance — 7 Proven EMA Scalping Strategies](https://blog.opofinance.com/en/ema-scalping-strategies/) — multi-TF alignment principles.

### Market internals

- [United Daytraders — Market Internals: TICK, ADD, VOLD](https://united-daytraders.com/blog/market-internals-trading) — source for the 3-pillar check, TICK +800/-800 thresholds, ADD divergence signal, VOLD-as-tiebreaker rule, FOMC override on internals.
- [Pro Trader Dashboard — Market Internals for Day Trading](https://protraderdashboard.com/blog/market-internals-trading/) — complementary internals framework.

### Market Profile / day types

- [SlidePlayer — Eight Market Profile Day Types](https://slideplayer.com/slide/11074005/) — canonical day-type taxonomy.
- [Trading Balance — Market Profile and Day Types](https://tradingbalance.co.uk/market-profile-and-understanding-different-day-types/) — practical day-type identification.
- [MarketCalls — Market Profile Day Types](https://www.marketcalls.in/market-profile/market-profile-different-types-of-profile-days.html) — Double-Distribution Trend Day pattern, P/b shapes.
- [TradeFundrr — Market Profile Trading Guide](https://tradefundrr.com/market-profile/) — IB extension thresholds.

### ORB

- [Option Alpha — 0DTE Opening Range Breakout Strategy](https://optionalpha.com/blog/opening-range-breakout-0dte-options-trading-strategy-explained) — source for the 60-minute ORB / credit spread numbers (89.4 % win rate, 1.44 profit factor) used as benchmark in the backtest spec, and the no-entries-after-12pm rule.
- [QuantifiedStrategies — ORB Backtest](https://www.quantifiedstrategies.com/opening-range-breakout-strategy/) — 5-min ORB beating 15-min on SPY (nearly 2× returns, ~half drawdown).
- [Trade That Swing — ORB Strategy](https://tradethatswing.com/opening-range-breakout-strategy-up-400-this-year/) — strict-rule ORB implementation example.

### Gap fill statistics

- [Trade That Swing — SPY Gap Fill Statistics](https://tradethatswing.com/sp-500-spy-es-gap-fill-strategy-and-statistics/) — source for the gap-size → fill-rate table (92 % at 0.15 %, 69 % at 0.35 %, etc.), Monday gap-down "no fade" rule, Wednesday gap-up continuation.
- [SharePlanner — Fading the Gap on SPY/QQQ](https://www.shareplanner.com/blog/strategies-for-trading/fading-the-gap-how-large-overnight-moves-in-spy-and-qqq-play-out-during-the-trading-day.html) — large overnight gap behavior.
- [QuantifiedStrategies — Gap Fill Backtest](https://www.quantifiedstrategies.com/gap-fill-trading-strategies/) — fill-by-noon statistic.

### VWAP

- [TheVWAP — VWAP Strategy Guide](https://thevwap.com/vwap-strategy/) — bands, anchored VWAP.
- [TradeStation — Intraday VWAP Support / Resistance PDF](https://cdn.tradestation.com/uploads/Intraday-VWAP-Indicator-with-RadarScreen.pdf) — VWAP as institutional benchmark.

### Sweep-reclaim / break-and-retest

- [FXOpen — Break-and-Retest Strategy](https://fxopen.com/blog/en/how-can-you-use-a-break-and-retest-strategy-in-trading/) — generic confirmation pattern.

## What's *not* sourced (and should be honest about it)

Several things in this folder are reasoned heuristics, not sourced
from research:

- The exact 1×/1.5×/2× sizing rules — these are calibrated to options
  bankroll risk tolerance and need backtest validation.
- The 5-input → 6-input score weights — these are intuition-weighted
  and require ablation testing per `13-backtest-spec.md`.
- The −40 % premium stop — borrowed from common options-management
  practice; should be checked against actual stop distribution in the
  backtest.
- The "second snipe opposite direction = Neutral day" heuristic — my
  synthesis of the Neutral day type pattern; needs empirical check.
- The "skip the day" rule on Non-Trend — defensible from theory but
  should be tested (maybe a tiny amount of edge survives).

Everything load-bearing should survive the Phase 4 backtest, or be
removed.
