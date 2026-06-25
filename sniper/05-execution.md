# 05 — Execution

Strike selection, sizing, scaling, exits.

## Strike selection table

Pick the strike based on **distance to next rung**, **DTE**, and
**vanna regime**:

| Distance to next rung (SPY) | DTE | Strike rule |
|---|---|---|
| ≤ 1.0 pt | 0DTE | ATM (delta ~0.50). Cheap-ish, very high gamma. |
| 1.0 – 2.0 pt | 0DTE | ATM or +1 OTM (delta 0.40–0.50). |
| > 2.0 pt | 0DTE | +1 to +2 OTM (delta 0.30–0.40). Pays better on the move. |
| Any | 1DTE | ATM. Cleaner Greeks, more theta but more vega cushion. |
| Any | 2DTE | +1 OTM. Cheaper directional bet. |

For QQQ, scale the "pt" thresholds by ~1.5× (QQQ moves are wider in
points).

**Vanna adjustment:**
- Negative vanna + IV climbing → can go further OTM (extra vega kick).
- Positive vanna + IV falling → stay ATM or ITM (avoid vega drag).

## Position sizing

Base unit: **1 % of options bankroll per snipe** at score 4. Apply
multipliers:

| Multiplier | Condition |
|---|---|
| 1.0× | Score 4, single TF aligned |
| 1.5× | Score 5, 15m macro aligned |
| 0.5× | Score 3 (B snipe), or 15m macro against the trade |
| 0.25× | Friday OPEX day, any score |

Hard cap: **3 % bankroll exposure to options at any one time**, total
across all open sniper positions. If you're at 3 %, new triggers must
wait for an existing position to close.

## Entry mechanics

1. **Use a limit order.** Buy at mid or +$0.05. Never market into
   open spreads — 0DTE spreads can be $0.30 wide on news bars.
2. **Cancel if not filled in 30s.** If price has moved past your
   limit, the setup is already changing — re-score, don't chase.
3. **One trigger = one entry.** No averaging in. If the trigger fails,
   you take the loss; if it succeeds, you pyramid only on the *next*
   confirmation (the break-confirm rung).

## Scaling / pyramiding

You can add **once** per trade, only on the break-confirm rung:

```
Entry:    reclaim 738.9 (or break 740)        → 1.0 unit
Add:      break-confirm 740.8 (or 740 break)  → 0.5 unit
```

Never add at the extension zone — that's exit territory.

## Exit ladder

| Trigger | Action |
|---|---|
| Hit `TARGET_1` (next rung) | Sell **50%**. |
| Hit `BREAK_CONFIRM` | Sell another **25%**. Trail the rest with 1m 8 EMA. |
| Hit `EXTENSION_ZONE` (low end) | Sell remaining **25%**. |
| 1m candle body closes back through 8 EMA against you | Exit **all** remaining at market or limit. No "give it room." |
| Premium down −40 % from entry | Hard stop. Exit. |
| 0DTE clock: 15:30 ET | Flat regardless of score. |
| Stack flips against trade (1m 8 EMA flips, 5m about to cross) | Exit remaining. |

The 50 / 25 / 25 ladder maps cleanly to the level ladder. It means
**you always have a runner** but you've already booked the move's
core. This is what keeps you sane on the days where the runner gives
back half — you already kept 75 % of the win.

## "Hold and pray" is the leak

The single biggest 0DTE leak is holding past `TARGET_1` for the gap
fill without trimming. Premium decay between the first rung and the
extension can eat 30–40 % of the gain if the move pauses to retest.
The 50 % off at `TARGET_1` rule pays for itself within 4–5 trades.

## Stops are price stops, not premium stops (mostly)

- **Primary stop**: price closes back through the rung you traded
  *and* the 1m 8 EMA flips. This is a *price* stop — the chart
  invalidated the setup.
- **Backup stop**: premium down −40 %. This catches news bars and
  IV crushes that move the option without moving the chart enough
  to flip the EMA.

Don't use ATR-based stops or fixed-dollar stops on 0DTE. They're
either too wide (you give back the trade) or too tight (you get
stopped on a wick).

## Order types in practice

- **Entry:** limit at mid + $0.05.
- **TP1 (target 1):** GTC limit immediately after entry fills at the
  expected premium price for a 1-pt SPY move. Use a delta-based
  estimate: ATM 0DTE call gains roughly $0.45–$0.60 per $1 of SPY.
- **TP2 / TP3:** set on the fly after TP1 fires.
- **Stop:** *no resting stop order on the option*. Watch the chart;
  manual close on EMA flip. Resting stops on options get hunted.

## Trade journal — fields per snipe

Log every snipe in a sheet or in `apps/api`:

- Date, time of entry, ticker
- Rung type (reclaim / break / failure / breakdown)
- Score (1–5)
- DTE, strike, delta at entry
- Entry premium, size ($)
- Exits: which rung hit, partial sizes, premium each
- Exit reason (TP / stop / time)
- 1m 8 EMA at entry, 5m stack at entry, GEX regime, wall target
- P&L net of fees
- Notes — anything surprising about the move

You need ~50 trades before any statistics are meaningful. Until then,
the journal is your only feedback loop.

## What you do *not* do

- Buy without a printed rung.
- Hold through `TARGET_1` without trimming.
- Add at the extension.
- Take a 0DTE trade after 15:30 ET.
- Take any trade in the veto windows.
- Pyramid more than once.
- Use market orders on 0DTE.
- Move the stop further away after entry.

Every one of those is a known leak.
