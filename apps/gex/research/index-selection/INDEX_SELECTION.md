# INDEX SELECTION — does "trade whichever index is most tradeable" beat always-SPX?

**Research only (Clause 0). No system/live-code changes.** Closes the last open multi-index thread.
Author: research subagent · Date: 2026-07-15 · Data: `research/velocity-capture/backfill/<date>/{SPXW,SPY,QQQ}.jsonl.gz`, 42 all-3-index days (2026-04-20 … 2026-07-14; 2026-05-21 dropped — broken surface).

## TL;DR VERDICT — NO.

Picking the "most tradeable" index each day does **not** beat always trading SPXW, and it is **worse than picking a random index** in every configuration tested — i.e. the ranker has **zero-to-negative skill**. Trading all three every day is strictly worse (more bets × a negative-edge setup), even after deduping the ~0.9-correlated same-minute signals. It does **not** rescue the days SPX is dead: on the quietest-SPX tercile every arm bleeds. **The multi-index thread is closed.**

The one honest nuance: on dead-SPX days, "pick the mover" does lift the share of days with *a* positive opportunity (0% → 27%), but the extra winners don't cover the extra losers — per-day expectancy stays deeply negative.

> Context caveat: this canonical mechanical reversal setup is **net-negative on its own** (it has NO tape gate — per the structure-program finding, the bull tape gate absorbs most of the entry edge). So the result is a *relative* one: **index selection adds nothing on top of SPX, and "pick the mover" is actively backwards.** The same P&L engine is applied identically to all arms, so the relative verdict is invariant to the P&L model (confirmed below).

---

## Pre-registration (fixed before looking at P&L)

**Setup (constant, mechanical, per index):**
- Net near-spot gamma = Σ gamma for strikes within **0.5%** of that index's spot, per 1-min surface snapshot.
- **RELEASED** minute — two variants (gamma SCALE differs across indices, so no fixed $ threshold):
  - `p40` = netg ≤ that index's **own daily 40th-percentile** of netg (scale-free — **primary**).
  - `neg` = netg ≤ 0 (sign-based; rare — near-spot gamma is almost always positive in this long-gamma regime).
- **Reversal**: rolling anchor extreme; a down-swing ≥ **0.25%** off the anchor high that then **reclaims** (bounces ≥ **0.10%** off the swing low) → CALL; mirror (up-swing then ≥0.10% reject off the high) → PUT.
- Enter on the first reclaim tick; ATM strike = round(spot@entry) (SPX→5, SPY/QQQ→1). Only minutes **after 10:00 ET**, only when that minute is RELEASED. **≤ 4 fires / index / day**; anchor resets after each fire.

**P&L (single consistent model across all arms/indices):**
- Enter on the bar **after** the fire minute (`fireTs+60s` — can't fill the close you detect on).
- **ENTRY at ASK / EXIT at BID** via a dollar-floored spread on the option CLOSE path (primary, stated):
  `spreadFrac(px) = max(3%, $0.10/px)`; `entry_ask = close·(1+sf/2)`, `exit_bid(c) = c·(1−sf(c)/2)`.
  (Real `premium_ask_side/bid_side` per-minute VWAPs exist but are noisy/often-missing at low volume; used as a robustness pass below — verdict unchanged.)
- **Ladder** = ⅓ @ +50%, ⅓ @ +100%, trail rest give-back 40% (arm at the rung), EOD flat, no hard stop (faithful to the task's scale-out ladder; = exit-study `scaleThirds` with gb=0.40).

**Arms** (same days, real option prints):
- **(a) ALWAYS-SPX** — trade only SPXW.
- **(b) PICK-THE-MOVER** — each day trade ONLY the one index the ranker flags. Two rankers tested & stated:
  - `amRange` (**primary**): largest **9:30–10:00 realized % range** — literally "the mover," fully causal by 10:00.
  - `netg`: most-released net near-spot gamma at 10:00, normalized by each index's own mean (scale-free).
- **(c) TRADE-ALL-3** — trade all three every day; reported **raw** and **DEDUPED** (collapse same day+minute+direction across indices to one bet = mean outcome, since the 3 are ~1 bet).

**Controls:** vs random-index selection, day-block bootstrap (5000), walk-forward halves, SPX-pinned tercile split.

Fire counts (priced): **p40 → 398** (SPXW 115 / SPY 127 / QQQ 156); **neg → 210**. Drops (unpriceable/too-late): p40 10, neg 4.

---

## HEADLINE — variant `p40`, ranker `amRange`, P&L `spread`

| arm | N | days w/sig | win% | exp/trade | total | **exp/day** | **%days +opp** |
|---|---|---|---|---|---|---|---|
| **(a) ALWAYS-SPX** | 115 | 41 | 46% | −14.1% | −1622% | **−38.6%** | **36%** |
| **(b) PICK-MOVER** | 155 | 42 | 54% | −11.1% | −1723% | **−41.0%** | **33%** |
| (c) TRADE-ALL-3 raw | 398 | 42 | 51% | −10.8% | −4286% | **−102.0%** | 36% |
| (c) TRADE-ALL-3 **DEDUPED** | 338 | 42 | 51% | −10.2% | −3464% | **−82.5%** | 33% |
| ref · SPY only | 127 | 42 | 53% | −4.8% | −612% | **−14.6%** | 40% |
| ref · QQQ only | 156 | 42 | 53% | −13.2% | −2052% | **−48.9%** | 33% |
| **random-index (avg of 3)** | | | | | | **−34.0%** | |

**Δ exp/day vs (a):** (b) **−2.4%** · (c-raw) −63.4% · (c-dedup) −43.8%.
**(b) PICK-MOVER vs RANDOM:** **−7.0%/day — the ranker is WORSE than random.**

**Day-block bootstrap (5000), Δ exp/day vs (a):**
- (b) PICK-MOVER: Δ −2.4% · CI[−53.4%, +49.6%] · p(Δ≤0)=**0.55** (indistinguishable from 0)
- (c) raw: Δ −63.4% · CI[−156%, +34%] · p=0.90 · (c) dedup: Δ −43.8% · CI[−114%, +31%] · p=0.87

**Walk-forward halves (exp/day):** (a) −39.5% / −37.8%; (b) −22.1% / **−59.9%**; (c-dedup) −32.7% / −132%. No arm beats (a) in **both** halves.

### Why "pick the mover" is backwards
The `amRange` ranker picks **QQQ on 40 of 42 days** — because QQQ's realized range (avg **1.97%/day**) is ~2× SPX/SPY (**1.11%** each; SPXW≈SPY, same underlying, ~0.99 corr). So "trade the biggest mover" collapses to "**always trade QQQ**," and QQQ is the **worst** single index (−48.9%/day). The *best* single index was **SPY** (−14.6%/day) — the **lowest-vol** one. On ~0.9-correlated indices the highest-range name is the **choppiest**, not the cleanest-trending: selecting for range selects for whipsaw.

### SPX-pinned split — does multi-index rescue dead-SPX days? NO.
Terciles of SPX realized range: **DEAD ≤ 0.84% < MID ≤ 1.21% < ACTIVE**.

| bucket | arm | N | days | exp/day | exp/trade | %days +opp |
|---|---|---|---|---|---|---|
| **DEAD** | (a) SPX | 28 | 15 | **−104.1%** | −55.8% | **0%** |
| **DEAD** | (b) MOVER | 54 | 15 | −97.5% | −27.1% | **27%** |
| **DEAD** | (c) dedup | 106 | 15 | −221.5% | −31.3% | 13% |
| MID | (a) SPX | 40 | 14 | −44.4% | −15.6% | 43% |
| MID | (b) MOVER | 51 | 14 | −49.4% | −13.6% | 29% |
| ACTIVE | (a) SPX | 47 | 13 | **+43.2%** | +11.9% | **69%** |
| ACTIVE | (b) MOVER | 50 | 13 | +33.2% | +8.6% | 46% |
| ACTIVE | (c) dedup | 125 | 13 | +92.1% | +9.6% | 54% |

- On **DEAD** SPX days, "pick the mover" lifts the share of days with *a* positive opportunity **0% → 27%** and halves the per-trade loss (−55.8% → −27.1%) — but it takes ~2× the trades, so **per-day it still bleeds −97.5%**. No rescue.
- The only edge in the whole setup lives on **ACTIVE** days — where **SPX alone is already best** (+43.2 vs +33.2 for the mover). Selection *hurts* exactly where the setup works.

---

## Robustness (all point the same way)

| config | (a) SPX exp/day | (b) MOVER exp/day | Δ (b−a) | (b) vs random | ranker skill? |
|---|---|---|---|---|---|
| **p40 / amRange / spread** (headline) | −38.6% | −41.0% | −2.4% (p=.55) | **−7.0%** | none |
| p40 / **netg** ranker / spread | −38.6% | −35.4% | +3.2% (p=.45) | **−1.4%** | none |
| **neg** variant / amRange / spread | **−2.7%** | −30.0% | −27.3% (p=.95) | **−14.1%** | none |
| p40 / amRange / **real** bid-ask | −39.0% | −29.3% | +9.7% (pt) | **−2.8%** | none |

- **`netg` ranker** spreads picks (SPXW 16 / SPY 11 / QQQ 15 of 42) and gets closer to SPX, but its +3.2% edge vs SPX is pure noise (p=0.45) and it is **still below random** (−1.4%). No skill.
- **`neg` variant**: SPX-only is nearly breakeven (−2.7%/day — the best single arm anywhere, because the neg gate is very selective). Adding index selection **destroys** it (−30.0%/day). Selection is most harmful exactly when the base SPX arm is cleanest.
- **Real per-minute bid/ask** lifts all absolute numbers (less bleed) but the ordering is intact: (b) beats SPX on points yet remains **below random** and is dominated by SPY-always (−2.6%/day). The relative verdict is P&L-model-invariant, as expected.

---

## Answers to the brief

- **Does picking the tradeable index beat always-SPX (deduped)?** **No.** Point Δ straddles zero (−2.4% / +3.2% / −27.3% across configs), never significant, and in every config the mover-pick is **worse than random-index selection** → the ranker has no skill. TRADE-ALL-3, raw or deduped, is strictly worse (a negative-edge bet × more bets; the ~0.9 correlation means the "diversification" is illusory — deduping removes ~15% of all-3 signals as duplicates and the arm is still −82.5%/day).
- **Does picking the mover raise the share of days with a clean move?** Marginally, and only on dead-SPX days (%positive-days 0%→27%), but not to profitability — the extra clean moves don't outweigh the extra chop.
- **Does it help MOST on days SPX is dead (April-type)?** **No.** Dead-SPX days are the worst for *every* arm; the setup's only positive expectancy is on ACTIVE days, where plain SPX already wins.
- **Root cause:** on 3 names that are ~0.9 correlated, "most tradeable = biggest mover" resolves to "always QQQ" (2× the range), and the highest-range index is the choppiest, not the cleanest. The genuinely-better index (SPY, lowest vol) is the *opposite* of what a mover-ranker picks — and you couldn't know it ex-ante anyway. **SPX is already the right default; multi-index selection adds nothing.**

## Files
- `detect_fires.mjs` — gamma-released reversal detector (surface → fires, both release variants) → `fires_all.json`, `day_features.json`, `need_symbols.json`
- `pull_options.mjs` — UW option-contract intraday marks (470 contracts, 100% withData; reuses exit-study cache) → `cache/`
- `analyze.mjs` — P&L ladder + 3-arm comparison + controls (args: `<variant> <ranker> <pmodel>`) → `result_*.json`
- Reproduce headline: `node analyze.mjs p40 amRange spread`
