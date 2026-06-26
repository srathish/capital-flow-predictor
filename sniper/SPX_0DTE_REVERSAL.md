# SPX / SPY 0DTE Reversal-at-Floor Playbook

*Decoded from a 0DTE-sniping masterclass video by the Skylit team. This is the
canonical SPX/SPY 0DTE strategy — distinct from the breakout-retest playbook
in [SPY_BREAKOUT_RETEST.md](SPY_BREAKOUT_RETEST.md) which captures the back-
half of the same move.*

## Core thesis

**0DTE is not directional prediction. It is exploiting dealer reflex.**

Dealers must hedge to stay delta-neutral. Their hedging is mechanical and
predictable. The trade is to front-run that mechanical hedging.

The single best front-run opportunity intraday is the **V-bounce at a negative
gamma pit**.

## The mechanism (why it works)

1. Spot drifts DOWN toward a negative-gamma king node (say, 6640 on SPX).
2. Put-holders watch their contracts go in / near the money.
3. They cash in — they sell their puts (typical 0DTE behavior: nobody holds
   to expiration).
4. Dealers who were short the underlying to hedge those puts no longer need
   to be short.
5. Dealers **cover** — they buy back the shares.
6. V-shaped reversal up.

If you placed a limit-lowball BUY on calls into 6640, you're now sitting on
+30 to +200% premium expansion within minutes.

## The 6 hard rules

### 1. Time gate — 10:00 to 11:30 ET sweet spot

**Do not open fresh 0DTE positions in 9:30 – 10:30 ET.** It's a trap.

Reason from the transcript:
- "80% of options selling and dealing happens within the first 30 minutes"
- Dealers are rebalancing overnight delta/gamma exposures
- Whipsaw is structural, not opportunity

Best window: **10:00 – 11:30 ET**. Direction has clarified, fresh order flow
has subsided, dealer hedging is steady-state.

Other windows:
- **11:30 – 14:00 ET**: lunch zone. Thin liquidity → fade the edges, take only
  A+ setups, smaller size.
- **14:00 – 15:30 ET**: dealer-flow window. Robinhood auto-liquidation +
  expiration unwind. If VIX spiking → expect rugpull; if VIX stable → expect
  meltup into close.
- **15:30 – 16:00 ET**: do not open new positions. Close everything.

### 2. Multi-ticker confluence (mandatory)

Pull SPX + SPY + QQQ Trinity. All three must agree on the structural read.

**Disqualifier:** if SPY shows a major node *meaningfully lower* than SPX's
floor, expect SPX to flush through its own floor. Sell loop ensues. Skip the
trade.

This is the empirical "vexx" overlay — when one ticker's structure
contradicts another's, the dealer flows aren't coordinated and the V-bounce
is less reliable.

### 3. Risk-to-reward gate — 3:1 minimum

Math:
```
R:R = distance from spot to upside king / distance from spot to downside king
```

If < 3:1 — skip. If ≥ 5:1 — A+.

The transcript's Friday SPX example:
- Spot 6680, upside king 6700 (ceiling/stop), downside king 6635 (target/floor)
- Risk = 6700 − 6680 = 20 pts
- Reward = 6680 − 6635 = 45 pts
- **R:R = 2.25:1** (call ok, but borderline; transcript called this 5.5:1
  using the actual entry @ 6690 not 6680, so the math is: 10 pt risk / 55
  pt reward = 5.5:1)

Why R:R matters more than win rate: at 3:1 R:R, you can have a 30% win rate
and still be profitable. At 5:1, you can have a 25% win rate. The transcript
claims 80-85% actual win rate but emphasizes that R:R is the moat.

### 4. Limit-LOWBALL entry (do NOT market order)

When spot is approaching the floor:

1. Pull up the SPX call (or SPY call) at-the-money or slightly OTM
2. Note the current bid / ask (e.g., bid $2.30, ask $2.40)
3. **Place limit BUY at bid − $0.10 to −$0.20** (e.g., $2.15 or $2.10)
4. Panic sellers will fill you on the way down

Effect:
- You enter at a cheaper price than market
- Your max drawdown is near zero — the V-bounce immediately puts you green
- "The whole goal is to keep drawdown as little as possible"

If your limit doesn't fill within 2-3 minutes and price reversed without you,
you missed the trade. Don't chase.

### 5. VIX confluence — exhaustion required

Pair the floor approach with the VIX behavior:
- **VIX showing hollow candles / reversal indicator / exhaustion** → BUY signal
- **VIX actively spiking into the floor** → DO NOT BUY → expect overshoot
  through the floor (volatility-controlled regime)

The transcript uses a custom VIX reversal indicator with hollow candles. The
generic version: 5-min VIX is failing to make new highs while spot is making
new lows = bullish divergence = floor is likely to hold.

### 6. Stop = GATEKEEPER above entry zone (NOT the level itself)

The stop is **structural**, not numeric.

After entering calls at the 6640 floor:
- Identify the GATEKEEPER node above (smaller +/- gamma node) — say 6655
- Identify the next GATEKEEPER after that — say 6660
- If price breaks above 6655 → wrong-direction squeeze → exit
- If price breaks above 6660 → you're in a buy loop → exit immediately

The reason: gatekeepers are where put-positions flip to call-positions
mechanically. Once breached against you, the whole dealer-flow stack
unwinds against your position.

## Position management

- **+30 to +50%: take partials.** Aggressive trim is mandatory.
- **+50 to +100%: trim more.** Premium goes from +120% to +30% in minutes on
  whipsaw. Don't get greedy.
- **Runners only with VIX favorable.** Hold final 20-30% only if VIX still
  showing exhaustion.
- **Stop trailing**: after first partial, move stop to breakeven on entry.

## The full workflow

```
09:25 ET — Pre-market: pull SPX + SPY + QQQ Trinity
  Note: upside king, downside king, gatekeepers, current VIX trend
  Compute R:R math
  If ≥ 3:1 → setup is on watch

09:30 – 10:30 ET — MORNING TRAP. Do not enter.
  Watch dealer rebalancing complete.
  Levels established but unreliable.

10:00 – 11:30 ET — SWEET SPOT
  If spot drifting toward floor:
    1. Verify SPX + SPY + QQQ still confluent
    2. Verify VIX exhausted (not spiking)
    3. Place LIMIT BUY on calls at bid − $0.15 (lowball)
    4. Wait for fill
    5. If filled → manage with gatekeeper stop
    6. Trim aggressively at +30%, +50%, +75%

11:30 – 14:00 ET — Lunch zone
  Take only A+ setups, half size
  Pin behavior strongest 12:00 – 14:00 — sell premium plays open here

14:00 – 15:30 ET — Dealer flow window
  VIX spiking: rugpull risk (skip or take puts)
  VIX stable: meltup likely (calls into close)
  Robinhood liquidation at 15:30 starts unwinding hedges

15:30 ET — flat all 0DTE positions
```

## Differences from the breakout-retest playbook

| | Breakout-retest (my v1) | Reversal-at-floor (this) |
|---|---|---|
| **Timing of the trade** | After breakdown confirmed | BEFORE breakdown / on approach |
| **Direction** | Trade WITH the breakdown (puts) | Trade AGAINST the breakdown (calls) |
| **Entry** | Market order on retest hold | Limit-lowball below bid |
| **Stop** | Buffer past level | Gatekeeper above entry zone |
| **Target** | Vacuum below | Upside king node |
| **VIX role** | Not factored | Mandatory exhaustion gate |
| **Multi-ticker** | Single ticker | SPX + SPY + QQQ alignment required |
| **When it triggers** | After the floor fails | Most days, into the floor |

**The two playbooks are NOT in conflict.** They're sequential parts of the
same intraday move:

```
Floor approach → V-bounce (reversal-at-floor pays)
                        ↓
                 Failed bounce: floor breaks
                        ↓
             Breakdown confirmed → vacuum cascade (breakout-retest pays)
                        ↓
             SPX bottoms → reversal back through gatekeepers → upside king
```

The reversal-at-floor trade is the *more common* outcome (V-bounces happen
more often than full floor breaks). The breakout-retest is the *bigger*
outcome (when it works, the cascade goes further).

## What still needs validation

1. **Backtest this exact setup on the 72-day Skylit replay.**
   The negative-king-node-approach trade should validate cleanly. The
   71.4% hit rate on my "breakout below floor" puts was actually testing
   the *fail* case of this trade — when the V-bounce doesn't happen.
2. **VIX intraday data for the same 72 days** — not currently in the
   Skylit replay files. Need to source from a separate feed.
3. **Limit-fill simulation** — my current backtest assumes market fills
   at the close price. Need to simulate the lowball-on-the-bid mechanic
   for realistic P&L.
4. **Gatekeeper detection in `apps/gex/src/domain/structure.js`** — the
   existing structure module computes gatekeepers but I haven't been
   using them for entry/stop placement.

## TL;DR

> Wait until 10:00 ET. Identify a negative gamma king node below spot.
> Verify SPX + SPY + QQQ align. Verify VIX exhausted, not spiking. Place
> limit BUY on calls at bid − $0.15 as spot approaches the level. Stop
> if price breaks above the gatekeeper. Take profits at +30%, +50%, +75%.
> Goal is keep drawdown near zero, R:R ≥ 3:1.

This is the trade.
