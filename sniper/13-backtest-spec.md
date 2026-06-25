# 13 — Backtest Specification

The sniper system survives or dies on backtest validation. This file
is the concrete spec for the Phase 4 build referenced in
`07-automation.md`. Hand this to anyone (yourself in 2 weeks, a
contractor, or a Claude agent) and it should be unambiguous.

## Goal

Quantify, across ≥ 12 months of SPY (and ideally QQQ) intraday data:

1. **Hit rate by signal-stack score** — does score 5 > 4 > 3?
2. **R-multiple distribution** by score, by rung type, by archetype.
3. **Edge of each input** — what does each of the 6 inputs add?
4. **Calendar buckets** — when does the system print, when does it
   stall?
5. **Cost honesty** — slippage, spread, fees included.

A pass requires:
- Hit rate monotone in score (5 > 4 > 3)
- Expected R per trade ≥ 1.5R at score 4+
- Max drawdown ≤ 8 % of bankroll at default sizing
- Win-rate variance reasonable across calendar buckets (no one-month
  miracle)

If any fail, the sizing in `05` and `06` is tuned down, or specific
inputs are reweighted, before live deployment.

## Data inputs

### Required

| Data | Source | Granularity | Why |
|---|---|---|---|
| SPY 1m OHLCV | Polygon.io or Databento | 1m bars, 12+ months | Trigger TF, EMA calc, candle confirmations |
| SPY 5m, 15m derived | from 1m | resampled | EMA stacks |
| QQQ same | same | same | Cross-validation |
| Daily GEX snapshots (SPY, QQQ) | `apps/gex` historic, or reconstruct from UW historic_chains | 1 per session at 09:25 ET, refreshed 12:00 and 14:30 | Regime, walls, gamma flip |
| VEX / CHEX snapshots | UW greek_exposure_by_strike | same cadence | Vol-flow overlay |
| NYSE TICK 1m | Polygon, Tradier | 1m | Internals input |
| NYSE ADD 1m | same | 1m | Internals input |
| NYSE VOLD 1m | same | 1m | Internals input |
| Calendar events | manual CSV | per-event | Black-out logic |

### Optional

- Historic Rapid posts — best effort. Hand-label first 3 months;
  derive a heuristic parser from there; use synthetic ladder
  (`09-rapid-trading-methodology.md`) for the rest.
- Option chains (SPY/QQQ 0DTE/1DTE) — for *realized* P&L sim. If too
  expensive, simulate option P&L analytically from delta tables in
  `10-zero-dte-mechanics.md`.

## Architecture

Reuse `apps/backtester` infra. Create `apps/backtester/sniper/`:

```
apps/backtester/sniper/
  data/
    bars.py            # 1m bar loader, multi-TF resampler
    gex_snapshots.py   # historic GEX snapshot loader
    internals.py       # TICK/ADD/VOLD loader
    ladder.py          # ladder loader (parsed + synthetic)
  engine/
    ema_stack.py       # 1m/5m/15m EMA state at each tick
    signal_score.py    # 6-input scoring per rung touch
    archetype.py       # archetype classifier per session
    veto.py            # time-of-day + calendar vetoes
  simulator/
    entry.py           # rung-touch detection + confirmation
    option_pnl.py      # analytical or chain-priced option P&L
    exit.py            # 50/25/25 ladder, 8 EMA trail, time stop
    sizing.py          # 1×/1.5×/0.5× rules per archetype + score
  reports/
    by_score.py        # hit rate, expected R, distribution
    by_rung.py         # reclaim vs break vs failure vs rejection
    by_archetype.py    # Trend Day vs Normal vs Neutral etc.
    by_calendar.py     # FOMC, CPI, OPEX, day-of-week
    by_input.py        # ablation: remove each input, measure delta
    drawdown.py        # equity curve + worst streaks
```

## Simulation loop (one trading day)

```
Inputs: date D, SPY 1m bars, GEX snapshots, internals, ladder for D

State:
  session = SessionState(D)
  open_positions = []
  ladder = ladder.load_for(D)
  archetype = None

For each minute bar b at time t in 09:30..16:00:
  session.update(b)
  session.update_emas(b)
  session.update_internals(t)
  session.update_gex(t)        # uses snapshot nearest to t

  if t == 10:30:
    archetype = archetype.classify(session)

  # Manage existing positions
  for pos in open_positions:
    pnl = pos.tick(b, session)
    if pos.exit_triggered(b, session):
      session.close(pos, exit_reason)

  # Check for new entry
  for rung in ladder.rungs:
    if rung.is_being_tested(b):
      if rung.confirmed(session.last_2_bars):
        score = signal_score.compute(session, rung, archetype)
        if veto.allows(t, calendar, score):
          if score >= threshold_for_dte(session):
            entry = entry.build(rung, session, archetype, score)
            session.open(entry)
```

## Signal score implementation (must match `04-signal-stack.md`)

```
score = 0

# (1) Rung confirmed
if rung.body_close_past and rung.retest_held:
  score += 1

# (2-3) EMA stack
if session.ema_1m_8_in_direction(rung.direction):
  score += 1
if session.ema_5m_stack_aligned(rung.direction):
  score += 1

# (4) GEX regime
if session.gex_regime_supports(rung.direction):
  score += 1
elif session.gex_regime_opposes_strongly(rung.direction):
  score -= 1

# (5) Wall target
if session.wall_target_exists_near(rung.next_target):
  score += 1

# (6) Internals 3-pillar
internals = session.internals_pillars(rung.direction)
if internals == 3:
  score += 1
elif internals == 0:
  score = -999   # veto

# VWAP bonus (≤ 0.20 SPY pts)
if session.vwap_near(rung.price):
  score += 0.5
```

`threshold_for_dte`:
- score >= 4 → allow 0DTE
- score >= 3 → allow 1–2DTE only
- else → no trade

## Position sizing (must match `05-execution.md` + `12-day-archetypes.md`)

```
base = 0.01 * bankroll
mult = 1.0
if score >= 5: mult = 1.5
if score >= 6: mult = 2.0           # the A++ four-greek setup
if score == 3: mult = 0.5
if 15m_macro_opposes: mult *= 0.5
if archetype in [TREND, DOUBLE_DIST]: mult *= 1.0   # already aggressive baseline
if archetype == NORMAL: mult *= 0.7
if archetype == NEUTRAL: mult *= 0.0 if rung_index >= 2 else 0.5
if archetype == NON_TREND: mult *= 0.0
if calendar.is_opex_friday(): mult *= 0.25
if calendar.is_quad_witch(): mult *= 0.0 if dte == 0 else 0.25
```

## Option P&L simulation

Two modes:

**Mode A — analytical (cheaper)**
Approximate option P&L from underlying movement using the delta /
gamma table in `10-zero-dte-mechanics.md`. Reasonable for sniper
because moves are short and small (< 2 SPY pts, < 30 min hold).

```
def simulate_option_pnl(entry_underlying, exit_underlying, dte,
                        strike, side, entry_premium):
    delta_at_entry = delta_lookup(strike, entry_underlying, dte)
    # First-order approximation
    delta_move = abs(exit_underlying - entry_underlying) * delta_at_entry
    # Gamma boost for 0DTE
    gamma_boost = 0.3 * (exit_underlying - entry_underlying) ** 2 / 1.0
    # Theta drag
    theta_drag = theta_table[hour] * minutes_held
    new_premium = entry_premium + delta_move + gamma_boost - theta_drag
    return new_premium - entry_premium
```

Validate by spot-checking against ~20 historic real fills.

**Mode B — chain-priced (gold standard)**
Subscribe to Polygon options trade & quote feed (or use UW historic
chains). For each simulated entry, look up actual NBBO at that
minute and the realized fill for the strike. Cleaner P&L but
expensive.

Start with Mode A. Upgrade to Mode B before going live.

## Cost model (don't skip this)

- **Commission**: $0.65 per contract, both legs (Tradier, IBKR, TDA).
- **Slippage**: 1 tick on entry (assume mid + $0.05 fill), 1 tick on
  exit. For 0DTE that's typically $0.10 round trip per contract.
- **Spread tax**: when the spread is > $0.15 at entry, model fill at
  bid + 30 % of spread. Realistic.

Without these, every backtest looks great. With them, marginal
trades become losers — which is the point.

## Reports — the must-haves

### Per-score table

```
score | trades | win_rate | avg_R | total_R | max_dd | sharpe
3     |   142  |  41%     |  0.4  |  +56R   | -3.2R  | 0.8
4     |   89   |  58%     |  1.1  |  +98R   | -2.4R  | 1.6
5     |   31   |  72%     |  1.8  |  +56R   | -1.1R  | 2.2
6     |   8    |  88%     |  2.6  |  +21R   | -0.4R  | 3.1
```

Acceptance: monotone increase across all columns.

### Per-archetype table

```
archetype       | trades | win_rate | avg_R | notes
TREND           |   62   |  68%     |  1.9  | extension hits common
DOUBLE_DIST     |   28   |  64%     |  1.7  | pyramid trades drive R
NORMAL          |   84   |  55%     |  0.9  | TP1 only mostly
NORMAL_VAR      |   41   |  52%     |  1.0  | mid
NEUTRAL         |    8   |  37%     |  0.2  | should approach zero
NON_TREND       |    0   |  -       |   -   | system skipped correctly
```

Acceptance: NEUTRAL and NON_TREND should have *very few* trades. If
they don't, the archetype classifier is leaking.

### Per-input ablation

Remove each input one at a time and re-run. Each row shows what the
input contributes:

```
removed_input   | hit_rate_delta | avg_R_delta
none            | +0.0           | +0.0
EMA stack       | -12.0%         | -0.7
GEX regime      | -4.0%          | -0.3
Wall target     | -2.0%          | -0.2
Internals       | -6.0%          | -0.4
VWAP bonus      | -1.0%          | -0.1
Archetype       | -8.0%          | -0.6
```

Inputs whose removal drops hit-rate / R by < 1 % can be cut. The
strategy is *better* with fewer inputs if any are noise.

### Calendar bucket table

```
bucket          | trades/day | hit_rate | avg_R
Monday          |   2.1      |  54%     |  1.0
Tues/Wed/Thu    |   2.4      |  60%     |  1.3
Friday OPEX     |   0.8      |  48%     |  0.7
FOMC day        |   0.6      |  62%     |  1.5  (post-2pm only)
CPI day         |   1.1      |  58%     |  1.4
Week of XMAS    |   0.0      |   -      |   -
```

Acceptance: no single bucket should drive > 40 % of total P&L. If
FOMC days alone drive half of returns, the rest of the system is
underperforming and needs scrutiny.

## Walk-forward validation

The single biggest mistake in 0DTE backtests is **overfitting**.

Run walk-forward: train on months 1–9, test on months 10–12. Then
roll forward by 1 month and repeat. The system passes only if
**out-of-sample hit rate is within 1 standard deviation of in-
sample**. If out-of-sample drops > 5 % hit rate, retreat.

`apps/backtester` has walk-forward infra already
(`FINAL_STRATEGY_v5.pine` used it). Reuse the same harness.

## Sanity tests (cheap and brutal)

Before publishing any result, run:

- **Random rungs test**: replace ladder rungs with random levels of
  the same density. The system should produce significantly worse
  results. If it doesn't, your "rungs" aren't doing work.
- **Random score test**: replace score with `random.choice([3,4,5])`.
  If hit rate by random score still rises with the score, your score
  isn't doing work.
- **Shifted-day test**: shift all internals by 1 day. System should
  fall apart. If it doesn't, the internals aren't doing work.
- **No-trade days test**: confirm that NON_TREND days produce 0 trades.

## Deliverable

A Jupyter notebook `apps/backtester/sniper/report_v1.ipynb` that:

1. Loads all the data.
2. Runs the simulator end-to-end.
3. Produces every table above + equity curve plot + drawdown plot.
4. Renders the ablation matrix.
5. Outputs PASS / FAIL per acceptance criterion at the top.

Plus a one-paragraph "should we ship" summary at the bottom.

## What we do with PASS / FAIL

- **PASS** → enable Phase 5 (autonomous monitor) with conservative
  size (0.5 % bankroll per snipe, half the spec default) for the
  first 30 live trades. Then ramp to spec.
- **FAIL** → identify the lowest-edge input, remove it, re-run. If
  ablation shows no input is carrying weight, the system itself is
  the issue, not the implementation.

Either way, the backtest is the gate, not a vanity exercise. The
honest version of this is more valuable than the flattering version.
