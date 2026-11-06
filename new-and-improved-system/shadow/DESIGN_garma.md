# Garma test: node CHANGE + 2-of-3 index agreement on FRONT-expiration maps, and his IB golden-zone entry (locked 2026-11-05, before any result)

Source: Garma's own Discord text (about 1,000 entries), his 414 chart screenshots (vision ledgers
community/dumps/garma_vision_batch*.jsonl), his Oct 17 agent video, and the KBs.

His screenshots show this setup:
- Skylit 3-up SPXW/SPY/QQQ, 3-minute candles, the **Front (0DTE) expiration only**, P20 nodes (≥ 20% of the King).
- IB30 high/low.
- An IB fib with a 0.618–0.786 golden zone, its side set automatically by where the IB closes.

His rules:
- "Ceilings rolling down → bearish."
- "Downside nodes growing while upside decreasing" → hold shorts.
- 2 of 3 (or 3 of 3) indices must agree, otherwise sit out.
- No trades before 10:00.

## Data

- **Boards:** .cache/garma_boards/<day>.json, built by shadow/garma/extract_boards.py from the Skylit Trinity replay.
  - g0 = the front (0DTE) expiration only. Frames whose first column isn't that day are excluded.
  - gA = the 5-expiration sum, i.e. what all our earlier tests used. It is the comparison board.
- **Prices:** SPY 1-minute bars (UW m1 cache). Frame m reflects the candle that closes at m.
- **Options:** SPY 0DTE ATM prices from .cache/uwopt_intraday (UW minute closes), with $0.02 per side slippage.
- **Build:** 2025-12-15 → 2026-02-27. **Holdout: March 2026, sealed**, run once.

## Garma Map Direction (GMD) at frame t, per index, front board

- **Nodes:** strikes within ±1.5% of spot with |g| ≥ 0.20 × |King| (the King is the max |g| in that window).
- **(a) Growth skew:**
  - U = Σ|g_t| − Σ|g_{t−20}| over the strikes above spot at t; D = the same over strikes below.
  - Both are scaled by |King_t|.
  - a = +1 if U − D ≥ 0.10, −1 if D − U ≥ 0.10, else 0. Upside growing is bullish; downside growing is bearish.
- **(b) Roll:**
  - Ceiling = the largest node above spot; floor = the largest node below spot.
  - Compare their strikes at t and at t−20.
  - Ceiling lower → −1, higher → +1. Floor higher → +1, lower → −1.
  - b = sign of the sum.
- **Vote:** v = sign(a + b), in {−1, 0, +1}.
- **GMD:** +1 if at least 2 of SPXW/SPY/QQQ have v = +1 and none has v = −1; −1 for the mirror case; else 0 (sit out).
- Also computed on the gA boards (GMD_A) and for SPY alone (v_SPY) as controls.

## H1: does GMD call the next hour?

At t = 10:00, 10:15, …, 14:30, take every t with GMD ≠ 0.
- Outcome: GMD × (SPY close at t+60 / SPY close at t − 1), in bps.
- Means are taken within each day first, then a t-statistic across days.
- Also report the hit rate.
- Controls: GMD_A and v_SPY on the same timestamps.

## H2: his IB golden-zone trade, gated by GMD (SPY, 0DTE options)

- **IB:** the high H and low L of the 09:30–09:59 1-minute bars. R = H − L.
- **Fib side (auto, as in his settings):**
  - If the 09:59 close is in the upper half of the IB, the bias is long. The zone is [H − 0.786·R, H − 0.618·R], and he
    buys the pullback.
  - If the close is in the lower half, the bias is short. The zone is [L + 0.618·R, L + 0.786·R].
- **Entry:** the first 1-minute bar from 10:00 to 13:30 whose range touches the zone, provided all hold:
  - a front-board P20 SPY node lies within ±$0.50 of the zone;
  - GMD at the latest frame ≤ entry equals the bias.
  - Enter at the zone edge nearest the IB extreme: H − 0.618·R for a long, L + 0.618·R for a short.
- **Stop:** 0.10·R beyond the 0.786 line (the zone fails).
- **Target:** the IB extreme plus 0.5·R extension, i.e. H + 0.5R for a long or L − 0.5R for a short. This is his
  IBSniper target.
- **Otherwise:** exit at the 15:55 close. One trade per day.
- **Option:** ATM 0DTE in the bias direction, bought at the entry-minute close + $0.02, sold at the exit-minute close
  − $0.02.
- **Controls:**
  - the same entries with no GMD gate;
  - the same entries gated by GMD_A (5-expiration boards).

## Tests (holdout = March; BH q = 0.10 across H1, H2)

| Test | Pass condition |
|---|---|
| H1 | front-board GMD mean signed 60-minute return > 0 and day-clustered t ≥ 2 |
| H2 | GMD-gated IB trade mean option return > 0, with day-clustered t |

- A pass also requires the build period to agree in sign, and the gate to beat its ungated control in both periods.
- **Also reported:**
  - trade counts;
  - win rate;
  - underlying R;
  - GMD frequency (how often 2-of-3 agreement exists);
  - per-month results.
- **If anything passes:** an independent audit before believing it.

## Amendment 1 (2026-11-05, after build results and BEFORE March was touched)

**Build results:**

| Test | Build result |
|---|---|
| H1, front GMD | 667 calls, −0.2 bps, t −0.20, 48.3% right |
| H1, 5-expiration GMD | −0.1 bps |
| H1, SPY alone | −0.2 bps |
| H2, gated by front GMD | 19 trades, −8.4%, t −0.62 |
| H2, gated by 5-expiration GMD | 19 trades, −5.0% |
| Ungated control | 27 trades, +22.6%, t 1.25, +1.21R underlying |

- H1 and H2 fail the build-agreement requirement; the March run will be reported for completeness.
- **Added H3:** the ungated IB golden-zone trade exactly as coded (the front-board SPY P20 node near the zone still
  required, no GMD gate).
- **H3 pass:** March mean option return > 0 with one-sided day-clustered t passing BH q = 0.10 across H1, H2, H3. The
  build sign (+) already agrees.
- Its build evidence is weak (t 1.25), and it was chosen after seeing the build, so a March pass would still need an
  audit and forward testing.
