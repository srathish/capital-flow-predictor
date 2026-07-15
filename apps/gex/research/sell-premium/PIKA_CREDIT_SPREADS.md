# PIKA CREDIT SPREADS — high-hit-rate premium SELLING at pika walls

**RESEARCH ONLY (Clause 0).** No system/live-code changes. Paper backtest on archived surfaces + real
UW option marks. Author: research subagent. Date: 2026-07-14/15.

## Thesis under test
Strong **pika** nodes (gamma>0 walls) are where dealers pin price. So a 0DTE **credit spread** sold
**just beyond** a strong pika should win most of the time (price rarely closes through the wall). This
flips theta in our favor and only needs the pin to hold — no directional forecast. Target: is the win
rate ≥65-70% **with positive expectancy after real costs**, and does selling-at-pika **beat selling at a
random location** (the whole test)?

---

## PRE-REGISTRATION (locked in `structure.mjs` before any P&L was computed)

- **Data:** `apps/gex/research/velocity-capture/backfill/<date>/{SPXW,SPY,QQQ}.jsonl.gz`, 36 sessions
  2026-05-21 → 2026-07-14, 1-min Skylit surfaces (gamma/vanna per strike).
- **Node / relSig:** `relSig = |gamma| / Σ|gamma|` (mirrors `src/domain/significance.js`). gamma>0 = pika.
- **Entry:** fixed **10:00 ET (14:00Z)**, causal frame at/before (no minute-picking look-ahead). Robustness
  exits also evaluated.
- **Pika universe:** strikes gamma>0 within **|K−spot|/spot ≤ 1%**.
- **REAL filter:** pika |gamma| at t ≥ 0.90× its value 5m **and** 15m earlier (growing or stable, not shrinking).
- **Dominant pika** = strongest relSig among REAL pikas within 1%. (0 sessions dropped — every day had one.)
- **Grid / width:** SPXW 5, SPY 1, QQQ 1. Spread width = 1 grid.
- **Side:** `sign(pika − spot)`. Pika **above** spot = ceiling → sell **call spread** (bet no close above it).
  Pika **below** = floor → sell **put spread** (bet no close below it).
- **Construction (a) VERTICAL** (matches the pin thesis): short = pika + 1 grid *beyond* the pika (away
  from spot), long = pika + 2 grids. We lose only if price breaches the wall past our short.
- **Construction (b) IRON CONDOR:** strongest REAL ceiling pika + strongest REAL floor pika; bear-call
  beyond the ceiling **and** bull-put beyond the floor. Wins if price stays boxed.
- **Exits:** EOD settle (intrinsic at the session's last spot) / 50%-TP (buy back when spread mark ≤ ½ credit)
  / 2-min STOP (spot closes beyond the short strike for 2 consecutive min) / STOP+TP.
- **Pricing:** real UW `option-contract/<OCC>/intraday` per-minute marks for **both legs**. Credit =
  short_entry − long_entry. Cost = **3% round-trip per leg** = 0.03·(short_entry+long_entry), applied once.
  P&L per 1 contract = (credit − exitValue − cost)·100 USD. `frac` = P&L pts / width (per unit of risk).
  If a leg has no print → trade dropped (logged).
- **Controls (mandatory):** (1) pooled + deduped; (2) **LOCATION MIRROR** — same-width spread at the phantom
  `2·spot − pika` (matched distance, opposite side, no pika) **and** a RANDOM ladder at fixed offsets; (3)
  weak-pika; (4) +gamma vs −gamma regime; (5) walk-forward halves + day-block bootstrap; (6) full P&L tail.

### Data coverage / honesty flag — **SUBSET LEAN**
UW leg-price fetch (1,638 contracts) was still running at the reporting cutoff. Scored on real marks:
- **SPXW — COMPLETE: all 36 sessions**, both regimes (29 +gamma / 7 −gamma). *This is the primary sample
  and drives the verdict; it exceeds the ≥12-day both-regime bar on its own.*
- **SPY — 21 sessions** (partial, fetch in progress) — used for the pooled/dedup robustness.
- **QQQ — 0 sessions** (fetch had not reached QQQ contracts). Pending; does not change the verdict, as QQQ is
  ~0.95 correlated to SPX and cannot rescue a structurally negative payoff.

---

## HEADLINE — PRIMARY sample (SPXW, all 36 sessions, both regimes)

Win rate / expectancy per construction × exit, per 1 contract:

| construction | exit | n | **win%** | avg $ | avg frac | PF | total $ |
|---|---|--:|--:|--:|--:|--:|--:|
| **pika (a)** | **EOD** | 36 | **80.6%** | **−$32** | **−6.4%** | 0.58 | −$1,154 |
| pika (a) | 50%-TP | 36 | 80.6% | −$2 | −0.3% | 0.91 | −$63 |
| pika (a) | 2m-STOP | 36 | 72.2% | −$15 | −3.0% | 0.71 | −$543 |
| pika (a) | STOP+TP | 36 | 69.4% | −$20 | −3.9% | 0.42 | −$707 |
| **condor (b)** | EOD | 35 | 57.1% | −$89 | −17.9% | 0.41 | −$3,124 |
| mirror (ctrl) | EOD | 36 | 80.6% | −$40 | −8.0% | 0.52 | −$1,438 |
| weak (ctrl) | EOD | 34 | 91.2% | −$9 | −1.7% | 0.71 | −$297 |
| random (ctrl) | EOD | 36 | 63.9% | −$21 | −4.3% | 0.48 | −$772 |

**The thesis got the win rate right (76-81%) and the money wrong.** Every construction and every exit is
**net negative after costs**. The best exit (50%-TP) only pulls pika to ≈breakeven (−0.3%, PF 0.91), never
positive.

Pooled robustness (SPXW 36 + SPY 21 = 57 pika trades): pika EOD **77.2% win, −8.0% frac, −$24, PF 0.57**,
net −$1,376 — identical picture.

---

## CONTROL 1 — DEDUP (pooled vs 1 obs/day) — *lead number*

| construction | POOLED win / frac / P(mean>0) | DEDUP (1/day) win / frac / P(mean>0) |
|---|---|---|
| **pika (SPXW-36)** | 80.6% / −6.4% / **0.146** | 80.6% / −6.4% / **0.146** |
| pika (SPXW+SPY-57) | 77.2% / −8.0% / **0.085** | — |
| condor | 57.1% / −17.9% / 0.010 | 57.1% / −17.9% / 0.007 |
| random | 63.9% / −4.3% / 0.047 | 63.9% / −4.3% / 0.050 |
| mirror | 80.6% / −8.0% / 0.105 | 80.6% / −8.0% / 0.107 |

Deduped, **P(mean pika P&L > 0) ≈ 0.15** — an ~85% chance the true expectancy is negative. Not a coin flip
in our favor; a coin flip against us.

---

## CONTROL 2 — LOCATION MIRROR / RANDOM (the whole test)

The pika edge is real **only if** selling-at-pika beats selling-at-random on win rate **and** expectancy.

| comparison (EOD, paired by day-ticker) | pika frac | control frac | diff | P(pika > control) |
|---|--:|--:|--:|--:|
| pika vs **random** (SPXW-36) | −6.4% | −4.3% | **−2.1%** | **0.342** |
| pika vs **mirror** (SPXW-36) | −6.4% | −8.0% | +1.6% | 0.571 |
| pika vs random (SPXW+SPY-57) | −8.0% | −4.7% | **−3.2%** | **0.253** |
| pika vs mirror (SPXW+SPY-57) | −8.0% | −5.0% | −3.0% | 0.352 |

Win-rate: pika **80.6%** vs random **63.9%** — pika wins *more often* (the pin is faintly real) **but its
expectancy is no better, and slightly worse**, because the pika short strike sits closer to spot (bigger
credit, but also more/ larger breaches). At **matched distance** (mirror), pika is a statistical tie
(P≈0.57). **Selling at the pika confers no expectancy edge over selling anywhere else. Control 2 FAILS.**

---

## CONTROL 3 — Node strength (SPXW-36)

Dominant vs weak pika (paired): dom −7.2% vs weak −1.7%, P(dom>weak)=0.222. relSig terciles (EOD frac):
weak 2-8% → **−15.2%**, mid 9-13% → −2.5%, strong 13-27% → **−1.5%**. Stronger nodes breach a little less,
but even the **strongest tercile is still negative** (−1.5%, n=12). Strength does not manufacture positive
expectancy. **No.**

---

## CONTROL 4 — Regime split (SPXW-36)

| regime | n | win% | frac | PF | settle-breach |
|---|--:|--:|--:|--:|--:|
| **+gamma (pin)** | 29 | 82.8% | **−4.3%** | 0.67 | 20.7% |
| **−gamma (trend)** | 7 | 71.4% | **−15.0%** | 0.39 | 28.6% |
| condor +gamma | 28 | 57.1% | −18.4% | 0.39 | 46.4% |
| condor −gamma | 7 | 57.1% | −15.5% | 0.50 | 42.9% |

Direction matches the thesis — pins hold better on +gamma days, breaches cluster on −gamma days — **but the
favorable +gamma regime is still net negative (−4.3%).** The pin holding "more often" is not worth the tail.
(−gamma n=7 is thin; period was pin-dominated 29:7.)

---

## CONTROL 5 — Walk-forward + day-block bootstrap (SPXW-36, pika EOD)

WF split 2026-06-17: train (n=18) 72.2% win / **−13.9%**; test (n=18) 88.9% win / **+1.0%**. The lone
positive half is a late calm/pinned stretch, not a stable edge. **Day-block bootstrap mean frac
CI95[−19.2%, +5.1%], P(mean>0)=0.144.** Random control day-block P(mean>0)=0.051.

---

## CONTROL 6 — TAIL HONESTY (SPXW-36, pika EOD) — *the way it dies*

Full P&L distribution ($/contract): min **−$444** · p5 −$432 · p25 +$16 · median **+$38** · p75 +$66 ·
p95 +$115 · max +$130.

- **settle-breach rate 22.2%** · losers 19.4%.
- **avg winner +$56 · avg loser −$395** — a **1 : 7 payoff**. At an ~$56 credit against ~$440 of width-risk
  you need **≈89% wins to break even**; 80.6% is not enough. Total: wins +$1,612 vs losses −$2,766 = **net
  −$1,154.**
- Worst 6 (all −gamma / trend sessions): SPX 06-09 −$444, 06-04 −$436, 06-10 −$432, 06-17 −$417, 06-12 −$417,
  06-11 −$377.
- **2-min STOP** caps the worst single loss (−$444 → −$280) and cuts total bleed (−$1,154 → −$543) but is
  still net negative and drops the win rate to 72%.
- **Condor is worse**: 45.7% breach, avg loser −$353, net −$3,124, P(mean>0)=0.010 — double-sided doubles the
  breach exposure in a one-way tape.

This is exactly the failure mode flagged in the brief: **the credits are too small to cover the breach tail.**

---

## VERDICT — NO. Falsified.

1. **Win rate: YES (76-81%).** GEX does reliably mark *where price stalls* — pins are faintly real (pika
   breaches 22% vs the wall being a coin-flip). The one thing GEX predicts held up.
2. **Positive expectancy after costs: NO.** Every construction/exit is net negative. Deduped P(mean>0)≈0.15.
   The 1:7 winner:loser payoff needs ~89% wins; 80% doesn't clear it. Best case (50%-TP) is a bleeding
   breakeven, not an edge.
3. **Beats selling at random (the whole test): NO.** pika vs random P(pika>random)=0.25-0.34; at matched
   distance (mirror) it's a tie. The pika **location carries no expectancy edge.** Higher win rate, no more
   money.
4. **Regime-limited?** Even the favorable +gamma regime is −4.3%. Strength doesn't rescue it (best tercile
   −1.5%). Nothing turns it positive.

**Bottom line:** selling premium at pika walls is a **high-hit-rate, negative-expectancy** strategy — the
canonical way premium-selling dies. The pin is real enough to win 4 of 5 trades but not real enough to make
the 1-in-5 breach affordable at the credit the market pays. This does **not** advance a high-hit-rate *and*
profitable 0DTE system. **Recommend: do not pursue pika credit spreads. Add to the killed-hypotheses ledger.**

*(The `50%-TP` breakeven and the "stronger-pika-breaches-less" hint are the only faint positives; neither
beats random, so neither is actionable.)*

---

### Artifacts
- `structure.mjs` — surface geometry → design + needed contracts (causal, pre-registered).
- `fetch_legs.mjs` — real UW per-minute leg marks → `cache_ladder/`.
- `simulate.mjs` — pricing, exits, all 6 controls, tail. (`TICKERS=SPXW` reproduces the primary sample.)
- `sell_premium_events.jsonl` — per-trade log (pika + condor, EOD), schema:
  `day,ticker,minute,strike(short),kind,side,exit_minute,outcome,pnl_dollars,credit,construction,exit,pnl_frac,width,regime`.
- Reproduce primary: `cd apps/gex && TICKERS=SPXW node research/sell-premium/simulate.mjs`
