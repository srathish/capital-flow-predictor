# 7-random-stock options walk-forward — findings (UNCOMMITTED research)

**Mandate:** pick 7 random stocks, go as far back as GEX data allows, walk-forward "which
option we'd enter and how it does," then learn for the overall system. No overfitting.

**Setup:** 7 seeded-random liquid-optionable stocks — **HIMS MU MARA AAPL WMT PYPL BMNR** —
× 39 weeks (Nov 2025–Aug 2026, all regimes: 12 UP / 19 FLAT / 8 DOWN). Structure from Skylit
replay (full 9mo for all 7). Options priced Black-Scholes on the real underlying path,
**validated against real prices** (`get_historic_chains`) in the recent window.

## Model validation (the honesty check)
68 real contracts: **BS mean +6.4% vs REAL mean −3.3%** (Δ +9.7pt). Realized-vol IV (62%)
UNDER-prices real IV (67%). So the BS backtest is ~10pt optimistic per trade for BUYERS, and
CONSERVATIVE (understated credit) for SELLERS. Model tracks direction well; just rosy.

## 1. Underlying R-multiples are ARTIFACT GARBAGE
The 35-name underlying backtest showed trend +1.37R "positive every regime" — but median
+0.04, and driven by impossible tails (COIN short +408R) from structural stops landing ~0.1%
from entry (tiny-risk denominator). p=0.36 vs long_all. **Never judge this system in
structural R; judge in option P&L.**

## 2. BUYING options on GEX/VEX signals — NO EDGE
- Direction rules (option P&L, BS): long_all, trend, and **proper GEX** (king-migration,
  gexvex, gex+trend) — NONE beat long_all significantly (permutation p = 0.22–0.40).
- Every config: **negative median** on fixed holds; positive mean is 100% tail — ex-top-5% ≈ 0,
  ex-top-10% negative. Winners are moonshots the signal didn't predict (WMT +716%, PYPL short
  +805%); per-stock it's *whichever name mooned* (MU +45%) vs losers (BMNR −18%).
- After the −10pt real-IV haircut: **buyers are net negative** (validation: −3.3% real).
- ⇒ Theta + rich IV kill directional option buying. GEX/VEX direction adds nothing.

## 3. SELLING premium — positive expectancy (but not from GEX)
Iron condors, short strikes at gamma walls, defined risk, real-calibrated IV:
- IVx1.08 (real ATM): **mean +1.6%, median +10.1%, win 59%**, ex-top5 −5% (far less
  tail-dependent than buying). IVx1.15 (real+skew): +4.3% / +13.1% / 60%.
- **GEX walls vs arbitrary ±4% strikes: nearly IDENTICAL** (+1.6% vs +1.6%; +4.3% vs +4.3%).
  GEX only helps median/win by ~1–2pt. **The edge is the VARIANCE RISK PREMIUM, not GEX.**
- Risk: short the upside — UP weeks −13%, DOWN/chop +25%. Regime-vulnerable (bleeds a
  sustained bull); this bull-leaning sample is still net-positive on real IV, which is the
  encouraging part.

## Learning for the overall system
- **GEX/VEX is NOT a directional alpha source.** Proven three ways now: OOS selection null
  (p>0.25), king-migration p>0.2, per-expiry noise. Stop trying to pick direction with it.
- **Do not run this as a directional option BUYER** — it's a theta/IV loser on random names.
- **If there's money, it's SELLING the overpriced options** (variance premium). GEX walls are
  a reasonable-but-not-special strike guide (+1–2pt). This aligns with the repo's existing
  `apps/gex/research/sell-premium/` direction.
- **GEX's real remaining jobs:** (a) marginal strike placement, (b) REGIME/RISK context —
  don't sell premium into a structure screaming a big directional move; skew the seller with
  the trend to dodge the up-week bleed (next test).

## 4. The one robust edge: DIRECTIONAL premium selling (with the trend)
Skewing the seller by trend (sell put-spreads in uptrends, call-spreads in downtrends):
- **put-spread-only (IVx1.08): mean +3.9%, median +11.0%, win 69%, ex-top5 +0.6%** (NOT
  tail-dependent), positive in ALL regimes (UP +6 / FLAT +1 / DOWN +7). The single most
  robust config found.
- call-spread-only: −4.1% (selling calls into a bull = run over). condor: dragged by the call
  side. trend-skew (adaptive): +1.0%, win 68%, ex-top5 −1.9% — the generalizable version.
- **GEX walls ≈ arbitrary strikes again** (trend-skew pct +1.6% vs gex +1.0%). The edge is
  (a) variance premium, (b) not fighting the trend — NOT GEX.

**⚠️ REGIME TRAP:** put-spread selling looks great because the sample is bull-leaning with NO
real crash (8 DOWN SPY weeks, none a −15% multi-name gap). Selling puts blows up in a crash
even defined-risk (repeated max-loss). The downside tail is UNTESTED. Trend-skew is the
defensible version (sells calls in downtrends, so a bear helps it). Do NOT deploy naked
put-selling on the strength of a bull backtest.

## Bottom line for the overall system
Reframe entirely: this is not a GEX directional system and not an option-BUYING system.
The only positive, non-tail-dependent expectancy is **selling premium with the trend**
(variance premium + momentum), with GEX as a minor strike/risk aid. Must be crash-tested
before it's real.

## 5. SELECTIVITY is the edge (user was right) — vanna-melt-up
Mechanical/aggregate/spray washes out the real edge, which is SELECTIVE per-expiry setups
(the user's push). Evidence:
- **Case study MU/SNDK/NBIS:** before their biggest +38-47% weeks, the per-expiry structure
  showed huge POSITIVE VANNA KINGS above spot (MU 113M@600, 175M@615; SNDK 43M; NBIS squeeze
  at spot). The melt-up magnets were VISIBLE on the specific expiry — blended away in aggregate.
- **Vanna is the one signal with positive evidence:** aggregate corr(vanna, |move|) = +0.11
  (squeeze corr NEGATIVE −0.10 — the mechanical squeeze thesis fails; it's the vanna magnet).
- **Selective call-buying beats spray:** ATM call, 10d — spray mean +14% / median −14%;
  uptrend-only +23%; **HIGH-vanna & uptrend & magnet 3-20% away: mean +69% / median +66% /
  win 66% (n=29)**. Overfit check: spread over 6/7 stocks & 9 months, ex-top3 median still
  +33% → not a single-name/tail mirage. Caveats: MU = 48% (supercycle), AAPL negative (fails
  on calm names), n=29 + 3 tuned filters, bull sample, −10pt real haircut. PROMISING, not proven.

## 6. GENERALIZATION TEST — the selective edge does NOT hold (overfit caught)
Ran the identical "HIGH vanna & uptrend & magnet 3-20%" filter on ALL 39 cached names
(1,482 weeks, the 7 + 32 others = OOS):
- 7-stock: mean +68.7% / median +66.3% / win 66% (n=29).
- **39-name: mean +21.5% / median −11.1% / win 48% (n=208). ex-top3 median −11.4% (negative).**
The +66% was MU's supercycle + a few moonshots in that specific 7-draw. On the broad universe
it's barely above spray (+16%) and tail-driven. **The selective edge was OVERFIT to the 7.**
- What SURVIVES: HIGH-vanna tercile > LOW (mean +28.6% vs +17.0%; corr +0.11) — a WEAK, REAL
  vanna tilt, but not mechanically tradeable (median still negative).

## Reconciliation (the honest bottom line, corrected)
- **Spray GEX mechanically → no edge.** **Select mechanically → still no reliable edge** (the
  +66% didn't generalize). Both agree with the user's own "GEX is a map not a forecast" program.
- **Vanna carries a WEAK real signal** (high-vanna call returns > low, corr +0.11) — GEX/VEX is
  not nothing, but the signal is too weak to overcome theta/IV mechanically.
- **The edge the X callers have is DISCRETIONARY** — selective + per-expiry + CATALYST + skill +
  real-time on names that move (MU=memory story, SNDK=Apple news). The case study confirms the
  setups are VISIBLE (vanna magnets before MU/SNDK/NBIS runs). That's real for a skilled human
  using GEX as CONTEXT; it is NOT a backtest-able mechanical rule.
- **⟹ System role:** GEX/VEX is a MAP/CONTEXT + a SELECTIVE SETUP SCANNER surfacing the few
  vanna-melt-up + catalyst setups for DISCRETIONARY entry — not a mechanical trader, not an
  option-buyer-on-autopilot (theta loses), not a naked seller (caps the tail that is the point).

## Open / next
- Skew the condor by trend/structure (sell put-side in uptrend, call-side in downtrend) to
  kill the UP-week bleed — does GEX/trend context improve the SELLER? (the one way GEX could
  matter here).
- Validate condor CREDIT vs real prices (not just directional calls).
- More stocks / a genuine bear stretch.

Files (uncommitted): collect7 · options_bt · validate_real · condor_bt (+ 35-name collect/
test_strat/analyze). Data: ohlc_cache, struct_cache.
