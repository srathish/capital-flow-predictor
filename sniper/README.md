# Sniper — SPY / QQQ Intraday Options Sniping System

A focused playbook for sniping SPY/QQQ 0DTE–2DTE calls/puts off intraday
level ladders (Rapid-Trading style), confirmed by an EMA stack across
timeframes, and gated by the OpenClaw v11 GEX/VEX regime already running
in `apps/gex`.

This is **not** a swing system. It is a small-bullet, high-confluence
sniper. Three to five trades a day, max. Most days, zero trades.

## What this folder contains

**Core system (read in order):**

| File | Purpose |
|---|---|
| `01-level-ladder.md` | How to decode the Rapid-Trading level posts — pivot, reclaim, break, extension. |
| `02-ema-stack.md` | 8 EMA entry trigger, 13 EMA runner trail, 5m/15m direction filters. |
| `03-gex-vex-overlay.md` | Net GEX, gamma flip, walls, vanna regime, 1 PM CHEX drift, 4-Greek A++ setup. |
| `04-signal-stack.md` | 6-point score (with internals). ≥4 fires 0DTE, ≥3 fires 1–2DTE. |
| `05-execution.md` | Strike selection, sizing, scaling, exits. |
| `06-risk-rules.md` | Hard stops, daily cutoffs, calendar awareness. |
| `07-automation.md` | What to wire into `apps/gex` + `apps/web` (`/sniper` tab). |
| `08-pretrade-checklist.md` | The 60-second checklist before every trigger. |

**Depth modules (research-derived):**

| File | Purpose |
|---|---|
| `09-rapid-trading-methodology.md` | Decode of the level-post grammar via Market Profile vocabulary; synthesizing a ladder when no post arrives. |
| `10-zero-dte-mechanics.md` | Greeks math, theta clock, dealer-hedging mechanics, strike-delta cheat sheet. |
| `11-internals-and-vwap.md` | TICK / ADD / VOLD 3-pillar rule and VWAP overlay → 6th signal-stack input. |
| `12-day-archetypes.md` | Seven Market-Profile day types, identification by 10:30 ET, calendar overlay, gap-fill stats. |
| `13-backtest-spec.md` | Concrete spec for Phase 4 — architecture, data, simulator, reports, walk-forward. |
| `14-glossary-and-sources.md` | Vocabulary + every external research source the system synthesizes. |

**Worked examples:**

| File | Purpose |
|---|---|
| `examples.md` | Three trades on the SPY 737.9 ladder: A+ long, B-grade skip, conflict short. |

## Mental model in one paragraph

A Rapid-Trading post gives you a **ladder of decision points**. Each
rung is either a *hold/lose pivot* or a *reclaim/break trigger*. The
rung above and below are the targets. You wait at the rung — when it
**confirms** (body close + retest hold), you check the EMA stack and
GEX/VEX regime. If the stack agrees, you snipe a 0DTE or 1DTE option
toward the next rung. You exit at that rung, or at the EMA on your
trigger timeframe. No level → no trade. No EMA flip → no trade. No GEX
agreement → no trade. **Three independent confirmations or you sit.**

## The published levels (worked example)

From Rapid Trading on SPY:

```
737.9 can hold → push to 738.9 reclaims → look for 740 → breaks → 740.8
   above → room to 741.88 – 742.9 (gap fill)
737.9 unable to hold → drop to 736.83 → breaks → 735.9
   below → room to 735 – 734, then 732.8
```

Decoded as a ladder:

```
         ┌─ EXTENSION  741.88 – 742.9   (gap-fill, take-profit zone)
         │
   BREAK + HOLD  740.8   (confirms 740 break — momentum add)
         │
   TEST          740     (reclaim target / next resistance)
         │
   RECLAIM       738.9   (longs trigger here — body close above)
         │
   ─────  PIVOT 737.9 ─────   (axis: above = bull day, below = bear day)
         │
   FAILURE       736.83  (shorts trigger here — body close below)
         │
   BREAK + HOLD  735.9   (confirms 736.83 loss — momentum add)
         │
   EXTENSION     735 – 734, then 732.8 (gap-fill, take-profit zone)
```

Treat that ladder as the **entire universe of trades for the day**.
You're not predicting — you're waiting for one of those rungs to print
the pattern.

## Why this works

1. **Levels are objective.** You don't guess — the post tells you the
   rung. No discretionary "looks like support."
2. **The EMA stack filters noise.** A rung can be touched and rejected
   ten times. Only one of those touches happens with momentum behind
   it. The 8 EMA tells you which.
3. **GEX tells you whether the day will trend or pin.** Net negative
   GEX + price below gamma flip = the day pays for breakouts. Net
   positive GEX + price near a call wall = the day eats premium and
   pins. Sniper avoids the second regime.
4. **0DTE pays asymmetric on level-to-level moves.** A 1-point SPY move
   from 738.9 → 740 with the right strike is +60–120%. Wrong = -40%.
   So the only thing that matters is **hit rate × R-multiple** — and
   confluence is what drives both.

## What this is not

- Not a swing system (use `apps/backtester` `FINAL_STRATEGY_v5` for that).
- Not a flow-driven system (use Talon for that).
- Not a multi-ticker basket play (use `uw-bullish-screener` for that).
- Not a "buy and pray" — every trade has a printed invalidation level.

## How to use it day-of

1. **08:30 ET** — Paste the morning Rapid-Trading levels into
   `/sniper` (or a text file). Confirm SPY/QQQ direction calls.
2. **09:25 ET** — Open `apps/gex` for SPY + QQQ. Note:
   - Net GEX sign and magnitude
   - Gamma flip price
   - Largest call wall, largest put wall within ±2 % of spot
   - Vanna regime (positive / negative)
3. **09:30 – 10:30 ET** — Watch the levels. Take only the highest-
   confluence rung. **Avoid the first 5 minutes** (open volatility
   makes EMAs unreliable).
4. **10:30 – 14:00 ET** — Mid-session: only take A+ setups (full stack
   alignment + GEX tail wind). Lunchtime chop kills 0DTEs.
5. **14:00 – 15:30 ET** — Power hour. Levels matter most here because
   gamma pinning intensifies. Snipe with shorter contracts.
6. **15:30 ET** — All 0DTE positions flat. No exceptions on Fridays
   (OPEX risk).

Read the rest of the folder in order.

## What changed in this iteration (research pass)

The first draft was the framework. This iteration weaves in concrete
practitioner research and adds the depth modules. Key additions:

- **Internals as a 6th input** (`11`) — TICK/ADD/VOLD 3-pillar rule
  replaces the implicit "watch breadth" hand-wave with a scored
  check. Veto if 0 of 3 align.
- **Day archetypes** (`12`) — by 10:30 ET you can usually identify
  one of 7 day types; archetype determines whether to push extensions,
  take TP1 only, or skip the day entirely. Major sizing modifier.
- **CHEX 1 PM read** (`03` update) — afternoon dealer charm direction
  is a 5-second check that filters or amplifies P.M. snipes.
- **Four-Greek confluence A++ setup** (`03` update) — explicit
  recognition of the rare GEX + DEX + VEX + CHEX alignment with 2×
  sizing carve-out.
- **13 EMA as runner trail** (`02` update) — separates the 8 EMA
  active-stop role from the 13 EMA runner-trail role to avoid
  Trend-Day whipsaws.
- **0DTE Greek mechanics** (`10`) — theta acceleration schedule,
  delta-strike cheat sheet, vanna mechanical bid math.
- **Backtest spec** (`13`) — Phase 4 has a real handoff doc. Walk-
  forward, ablation, calendar buckets, sanity tests, deliverable
  notebook structure.
- **Gap-fill stats baked in** (`12`) — gap-size → fill-rate table,
  Monday-no-fade rule, Wednesday continuation rule, 80 %-by-noon
  reference.

All research sources are listed in [14-glossary-and-sources.md](14-glossary-and-sources.md).

## Validation status

The framework has been **empirically validated on 249 SPY/QQQ trading days** (May 2025 → May 2026). Full report at [validation/REPORT.md](validation/REPORT.md). Headline:

| Claim | Result |
|---|---|
| Net-GEX regime predicts next-day range | ✅ NEG range +38 % (SPY) / +41 % (QQQ) |
| Negative GEX → higher continuation rate | ✅ +6.4 pp on SPY |
| Combined regime predictor beats walk-forward baseline | ✅ 54.0 % (SPY) vs 48.3 % baseline |
| Trend-Day rate higher in NEG regime | ✅ 1.5 × (SPY), **4.4 × (QQQ)** |
| NEG regime carries more volume | ✅ +14 % (SPY), +35 % (QQQ) |
| Small gap-ups fill at ~80 % | ❌ **Failed.** Actually 43 – 44 %. Plan corrected. |

**5 of 6 testable load-bearing claims pass. One was wrong and has been replaced with empirical rates.** The plan is calibrated to real SPY/QQQ behavior, not aspirational claims.

### Skylit intraday validation (the real test)

A second validation run against **11,120 actual Skylit Trinity replay samples** (5-min subsample × 72 trading days, Dec 2025 → May 2026) — both **GEX and VEX** — at [validation/REPORT_SKYLIT.md](validation/REPORT_SKYLIT.md):

| Claim | Result |
|---|---|
| Pin behavior near King (≤ 0.5 SPY pts) | ✅ **+30 pp** edge over baseline — strongest finding |
| Spot mean-reverts toward King from distance | ❌ Coin flip — **rejected**, plan updated |
| GEX × VEX agreement amplifies moves | ✅ +17 % bigger 30-min moves on both tickers |
| Time-of-day pin rates (lunch + afternoon) | ✅ **QQQ pin rate 66 %** in afternoon — tradeable |

**Combined: 6 of 7 load-bearing claims validated on real data.** The two rejected claims are now corrected. The framework that ships is the validated one, not the aspirational one.
