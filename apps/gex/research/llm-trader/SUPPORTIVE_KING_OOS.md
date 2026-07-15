# SUPPORTIVE-KING GATE (G1) — OUT-OF-SAMPLE TEST

**RESEARCH ONLY (Clause 0). Paper. No live-code change. Nothing tuned — the 7/14 config was frozen and run unchanged.**

Decisive out-of-sample test of the one pre-registered config from `HITRATE_70_2026-07-14.md`:
**G1 supportive-king gate + next-node target + 0.05%/1-min structural stop**, run *unchanged*
on **all 35 backfill days except the 2026-07-14 tuning day**, all 3 tickers (SPXW/SPY/QQQ), with
real UW option-contract intraday P&L (ATM at entry, 3% round-trip haircut). Engine: `hitrate_oos.py`
(copies the signal generator, G1 gate, and exit simulator verbatim from `hitrate_sweep.py`).

---

## VERDICT — IT DID NOT REPLICATE. Kill it; do not graduate to ghost testing.

> **Deduped OOS win rate = 36%   vs   Mirror-control win rate = 50%.**

The 73% did not merely fade toward the 52% baseline — it **collapsed through it to 38% (36% deduped)**,
turning a headline +22%/trade edge into **−9.1%/trade** across 510 trades / 34 independent days. The gate
is **worse than random and worse than its own mirror**, negative in **both** regimes and **both** time-halves,
with **P(mean expectancy > 0) = 0.1%**. The pre-registered pass bar (WR ≥ 65%, P(mean>0) ≥ 0.9) is missed by
a mile in the wrong direction. This is exactly the single-day curve-fit that Section 5 of the 7/14 write-up
warned about: a 124-config sweep on one pin day was guaranteed to surface a survivor, and it did — by luck.

**Engine validated:** pointed back at 2026-07-14, `hitrate_oos.py` reproduces the frozen result **exactly**
(N=15, WR=73%, total +337%, every trade matching the doc's trace — SPXW short 10:44 −9%, QQQ 722P +110%,
SPY 44%/55%, …). So the OOS collapse is a property of the strategy, not a code regression.

---

## 1. HEADLINE — G1 + next-node, pooled OOS

| metric | OOS (G1) | 7/14 (tuning) |
|---|--:|--:|
| **N trades** | **510** | 15 |
| **N independent days** | **34** | 1 |
| **WIN RATE** | **38%** | 73% |
| **expectancy / trade** | **−9.1%** | +22% |
| **total P&L** | **−4,639%** | +337% |
| avg win / avg loss | +34% / −35% | +37% / −18% |
| worst loser | **−88%** | −30% |

The ~73% did **not** hold. Out-of-sample the config is a strong, consistent **money-loser**. Note the tail
also failed to replicate: the 7/14 story was "structural stop caps losers at −30%"; OOS the worst loser is −88%
and the average loss (−35%) is *twice* the 7/14 average loss (−18%). The stop did not tame the tail across days.

## 2. EFFECTIVE INDEPENDENCE (deduped) — the real number

SPXW/SPY/QQQ express one correlated move. Collapsing every fire that shares **day + minute + direction** across
tickers into ONE event (event P&L = mean of its legs):

> **Deduped: N = 415 events · WIN RATE = 36% · expectancy = −9.6%/trade.**

510 raw fires → 415 unique events (86 were the same move printed on 2–3 tickers). Deduping does not rescue it —
it makes it marginally worse. **36% is the single most important figure in this report.**

## 3. MIRROR CONTROL — the edge inverted, it did not "fail to survive," it went negative

Identical G1-gated events, **direction FLIPPED** (buy the opposite ATM option, target the next node on the
opposite side, stop reflected to the same distance on the opposite side):

> **Mirror: N = 475 · WIN RATE = 50% · expectancy = +0.1%/trade.**

The mirror is a **coin-flip / breakeven** while the real direction is **−9.1%/trade**. The gate does not just
fail the mirror test in the "both sides win" sense — the *opposite* bet is **9 percentage points of expectancy
better** than the gated bet. G1's directional call ("real growing floor below → buy calls") is, out of sample,
**mildly anti-predictive**: you were, on net, buying calls into floors that broke and puts into ceilings that broke.
There is no supportive-king edge here to keep; if anything the sign is backwards (though the mirror is only
breakeven, so this is a warning, not a tradeable inverse).

## 4. RANDOM CONTROL — G1 does not beat random on what matters

Same G1 contracts, K=30 random entry minutes each, same side + same exit machinery:

> **Random: N = 15,300 · WIN RATE = 31% · expectancy = −7.0%/trade.**

G1 (−9.1%/trade) is **worse than random (−7.0%/trade)** on expectancy. It edges random on raw win rate
(38% vs 31%) only by taking trades that hit the near node slightly more often, then giving it all back with
larger losers (avg loss −35% vs random −23%). A real filter beats random on expectancy by a wide margin; G1
loses to it. **Fails control #4.** (The strongly negative random baseline itself just reflects theta + 3% haircut
on 0DTE ATM buying with no directional edge — the honest null backdrop this strategy lives in.)

## 5. WALK-FORWARD — consistently bad in both halves

| half | days | N | WR | exp/trade | total |
|---|---|--:|--:|--:|--:|
| H1 | 2026-05-21 … 2026-06-15 | 228 | 36% | −10.0% | −2,274% |
| H2 | 2026-06-16 … 2026-07-13 | 282 | 39% | −8.4% | −2,365% |

No period where the config worked. The failure is stable across time — there is no "it stopped working" story;
it never worked off the tuning day.

## 6. DAY-BLOCK BOOTSTRAP — negative with near-certainty

Resample days with replacement (B = 5,000), 34 independent days:

> **P(mean expectancy > 0) = 0.1% · 90% CI = [−13.6%, −4.3%] · median = −9.1%.**

The entire 90% confidence interval is negative. The pre-registered target was P(mean>0) ≥ 0.9; observed is 0.001.

## 7. REGIME SPLIT — not regime-limited; negative in pins AND trends

Each day labeled by the sign of SPXW's session-mean net gamma within 1% of spot (27 +gamma / 8 −gamma days):

| regime | days | N | WR | exp/trade |
|---|---|--:|--:|--:|
| **+gamma (pin/chop)** | 27 | 429 | 37% | **−10.4%** |
| **−gamma (trend)** | 8 | 81 | 43% | **−2.4%** |

This kills the "maybe it only works on pin days like 7/14" rescue. The gate is **worse on +gamma pin days** —
the exact regime it was tuned on — and merely *less bad* (still negative) on trend days. Not a regime-limited
edge; a regime-independent null.

## 8. BASELINE DELTA — the 7/14 "G1 lifts WR and caps the tail" finding reverses

| | WR | exp/trade | worst | N |
|---|--:|--:|--:|--:|
| **7/14:** BASE → G1 | 52% → **73%** | +1% → +22% | −81% → **−30%** | 42 → 15 |
| **OOS:** BASE → G1 | 40% → **38%** | −6.0% → **−9.1%** | −97% → −88% | 1608 → 510 |

Out-of-sample, adding G1 **lowers** win rate (40% → 38%), **worsens** expectancy (−6.0% → −9.1%), and leaves an
uncapped tail (−88%). On 7/14 G1 both lifted WR and cut the worst loss; OOS it does neither. The signature that
made G1 look "principled, not a P&L-selector" on one day is entirely absent across 34 days.

---

## Reading of the result

The 7/14 demonstration was honest about its own fragility (Section 5: "n is tiny and not independent… the
threshold was chosen with hindsight… the sweep guarantees a survivor"). This test confirms the pessimistic
branch: **the supportive-king gate captured one pin day's afternoon short cluster and nothing generalizable.**
"A real, growing dealer node adjacent on the supportive side" does not, out of sample, predict that the node
holds — 0DTE structure at the 1-min scale is not a directional forecast (consistent with the standing finding
that *GEX is a map, not a volatility/direction forecast*). Buying ATM 0DTE premium and paying theta + a 3%
haircut into these setups loses money on average regardless of the structural gloss.

## Method (frozen — nothing tuned here)

- **Universe:** all `velocity-capture/backfill/` days except 2026-07-14. 2026-05-21 SPY & QQQ have empty
  backfill files and are skipped (that day's SPXW is intact) → 34 days with G1 fires.
- **Signal (frozen):** swing-ghost zigzag on 1-min Skylit closes (R=0.25%, CONFIRM=2, one entry/swing/side,
  5-min cooldown). V-reclaim = LONG, rally-reject = SHORT.
- **G1 (frozen, the rule under test):** a *real* dealer node (share ≥5% of |gamma|, gamma>0 on the supportive
  side for longs, growing ≥0.15pp on **both** 5m AND 15m relSig) within 0.15% of entry on the supportive side
  (floor below for longs, node above for shorts). Thresholds frozen: G1_PROX=0.15%, REAL_GROW=0.15pp, NODE_MIN_SHARE=5%.
- **Exit (frozen):** next structural node target + close-beyond-pivot-0.05%-for-1-min stop + EOD flat 15:45 ET;
  conservative tie-break (stop before target within a minute).
- **P&L:** real UW option-contract intraday, ATM at entry, entry = signal-minute close, 3% round-trip haircut.
- **Mirror:** same G1 events, side flipped, opposite ATM option, node target flipped, pivot reflected to the
  opposite side at equal distance (tests whether wins are a direction-blind mechanical artifact).
- **Regime label:** sign of SPXW session-mean net gamma within 1% of spot, one label per day.
- **Data note:** of the contracts required, 54 far-strike/illiquid ATM contracts returned no intraday prints
  (mostly SPXW extremes) and those signals were dropped — identical to the frozen engine's behavior. 1656 raw
  signals scored (48 dropped for missing option data); 510 passed G1.

## Artifacts
- `hitrate_oos.py` — OOS engine (frozen functions copied verbatim from `hitrate_sweep.py`; only the date loop generalized).
- `hitrate70_events_OOS.jsonl` — 510 OOS G1 trades (schema: day, ticker, minute UTC, strike:spot@entry, kind, implied, exit_minute, outcome, pnl_pct).
- `hitrate_oos_summary.json` — machine-readable summary of every control.
