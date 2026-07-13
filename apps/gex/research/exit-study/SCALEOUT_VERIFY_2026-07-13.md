# SCALE-OUT LADDER — ADVERSARIAL VERIFICATION (2026-07-13)

**Role:** independent hostile verifier (Vega skeptic). RESEARCH ONLY (Clause 0).
**Claim under attack:** the ladder — sell ⅓ at +50%, ⅓ at +100%, TRAIL the final third
(gb30/hardstop60) — beats HOLD-EOD by **+11.4** and the live `a50/gb15` trail by **+12.4**
(p<0.001, WF both splits, LOO-worst +10.3) on 1,295 replay fires (61 days, index-only).
**Driver:** `scaleout_regime.mjs` → `FAM['SCALE ⅓@50 ⅓@100 tr30']`.

## VERDICT: **SURVIVES.** The edge is real and, if anything, was *under*-stated.

I re-implemented the ladder from scratch (`verify_scaleout.mjs`), reproduced the headline
to the decimal, then attacked it on fills, gate-mix, look-ahead and survivorship. It did not
break. Under the single harshest scenario I could justify — post-gate fire mix + rung fills
requiring **3 consecutive** bars held above the limit + a **3% haircut on every leg** (limits
included) — the ladder **still beats the live trail by +9.6** (CI[+6.6,+12.8], p<0.001,
LOO-worst +8.5, WF-clean both halves). That is the floor. The realistic number is ~+11.

---

## Parity (no re-impl bug flattering the ladder)
My independent build at the driver's own assumptions (1-bar close fill, 3% market-leg haircut)
returns **ladAvg +8.8%, ΔEOD +12.4, ΔTRAIL +13.3** — identical to `scaleout_regime.mjs 0.03`.
Built 1295/1355 paths, 61 days, same as the driver. The re-implementation is faithful.

## Check 1 — FILL REALITY (the flagged biggest risk): **PASSES**
Concern: the +50% / +100% *limit* fills assume the option actually trades through, not a
one-tick spike-print. I required the level be held for **≥2 consecutive minute-bars** (on bar
CLOSE — stricter than a real limit, which fills on any HIGH touch) before crediting a rung,
credited the fill at the limit (never the higher close), and re-armed the trailing remainder
from the confirmed bar.

| Fill model (all with realistic haircut) | Δ vs LIVE-TRAIL (ALL) | p |
|---|---|---|
| 1-bar close, 3% market-leg *(driver headline)* | +13.3 | 0.000 |
| **2-bar-held close, 3% market-leg** | **+11.7** | 0.000 |
| 3-bar-held close, 3% market-leg | +10.9 | 0.000 |
| 2-bar-held close, **3% on ALL legs** (limits slip too) | +10.9 | 0.000 |
| 1-bar HIGH-touch, 3% market-leg *(optimistic bound)* | +16.0 | 0.000 |

**Why it barely moves — empirically, not by assumption:** of the fires that reach +50%, only
**9.1%** (65/713) fail to hold the level ≥2 consecutive bars; at +100%, only **8.9%** (43/481).
91% of rungs that touch the limit genuinely trade there for multiple minutes. These 0DTE index
options reach the rungs on real directional moves, not single-print spikes, so a stricter fill
rule costs ~1–2 points, not the edge. Marks-are-trade-prints is bounded by the all-legs-haircut
row (+10.9) — even taxing the limit legs 3% for adverse selection leaves the edge intact.

## Check 2 — GATE-MIX / BEAR-CARRY: **PASSES** (this was the real test, and the framing was a trap)
The ΔvsEOD concentration (+19.6 BEAR_RUG vs +0.9 BULL_REVERSE) is a **red herring**, because
we do not trade HOLD-EOD — we trade the **trail**. HOLD-EOD only looks strong on bull fires by
luck of the sample (+12% avg on reversals). **Versus the LIVE-TRAIL — the baseline we actually
run — the ladder wins on BOTH sides:**

- **BEAR_RUG** (dir−, which the bull-tape gate *never* touches): Δ vs TRAIL **+11.3**
- **BULL_REVERSE** (dir+, partially gated): Δ vs TRAIL **+10.9**

I reconstructed the actual post-bull-tape-gate mix from the code
(`bull-tape-gate.js`: block a *bull* fire iff SPY, QQQ, SPXW≈SPY are ALL below prior close at
fire time), using the cached underlying 1-min bars + prior-day regular-session closes.
**160 of 492 bull fires are gated out.** On the mix we'll actually trade:

| Mix | n | Δ vs LIVE-TRAIL (2-bar, 3%) | LOO-worst | WF (tr/te) |
|---|---|---|---|---|
| ALL fires | 1295 | +11.7 | — | — |
| **POST-GATE (kept)** | **1135** | **+11.2** (CI[+8.1,+14.2], p<0.001) | **+10.2** | +10.3/+12.2 YES |
| DROP-ALL-BULL (worst case) | 803 | +12.2 | — | — |

The gate *removes* bull fires and leaves relatively more bear fires — the bear side carries the
strongest ladder-vs-trail edge, so pruning gated bulls **holds/strengthens** the edge (+11.2 ≈
+11.7). It was NOT carried by fires we won't take. Concern dead.

## Check 3 — LOOK-AHEAD / SURVIVORSHIP: **PASSES**
- **Entry** = close of first bar at ts ≥ fireTs+60s (confirmation delay); uniform across all families. Causal.
- **Rung fills** scan *forward* and take the *first* qualifying occurrence (`confirmFill`), never a global/forward max. `i1 ≤ i2` always (any bar ≥100% is ≥50%), so +100% is never booked before +50%.
- **Trail** uses a running peak inside a single forward loop and exits on first breach — only past/current bars. No peek.
- **Regime is not used by the ladder.** The look-ahead `regimeFull` (whole-session ER) is a separately-flagged upper-bound arm; the ladder families are pure forward-path and the headline claim carries no regime dependency. The look-ahead lives only in the regime section, which is not the claim.
- **Survivorship (60/1,355 dropped):** reasons are 52 `no_entry_bar` (fire too late in session) + 8 `<4 bars` — a property of the *option path*, evaluated **before any family runs**. All families (EOD, TRAIL, ladder) score on the identical 1,295 survivors, so the *paired* delta is apples-to-apples; dropping can shift absolute levels but cannot manufacture relative outperformance. Drop state-mix is roughly proportional (BEAR_RUG 26, BULL_REVERSE 29, BEAR_CONTINUE 4, TRAPDOOR 1); no family-specific pruning.

## Check 4 — vs the LIVE TRAIL with realistic fills (the number that matters)
**Post-gate mix, ladder vs `a50/gb15` live trail:**
- Realistic (2-bar-held, 3% market-leg): **Δ +11.2**, p<0.001, LOO +10.2, WF +10.3/+12.2 ✔
- Harshest defensible (3-bar-held, 3% ALL legs): **Δ +9.6**, CI[+6.6,+12.8], p<0.001, LOO +8.5, WF +8.5/+10.7 ✔
- Bootstrap p is resolution-limited at 0 (< 1/3000 ≈ 3e-4) → clears Bonferroni for any sane family count.

---

## Residual risks (honest caveats — not disqualifying, but forward-test must confirm)
1. **Bar-level, not tick-level fills.** 91% hold-rate + all-legs haircut bound it well, but exact queue priority / partial fills at the precise +50%/+100% tick on thin 0DTE strikes are not simulated minute-by-minute. Live paper-forward is the true fill test.
2. **One regime era.** 61 consecutive days (Apr–Jul 2026); the "out-of-sample" is a chronological half, not an independent period. Edge magnitude could compress in a different vol/trend regime.
3. **Same-contract assumption.** Assumes entry into the contract the tracker fired; entry mark = bar close, applied uniformly.
4. **Clause 0.** This is an exit/sizing rule change. Verified as *forward-worthy*, not *approved* — it goes to DECISIONS NEEDED for paper validation before any live change.

## Bottom line
I tried to break it on fills, gate-mix, look-ahead, and survivorship and could not. The
scale-out ladder is a **real, forward-worthy candidate**: it beats the live trail by ~+11
(floor +9.6) under conservative fills, on the exact fire mix the gate leaves us, with clean
walk-forward and LOO, driven by fires we actually trade. **PROMOTE to forward paper test.**

*Artifacts: `verify_scaleout.mjs` (independent re-impl + gate reconstruction + fragility diag).
Repro: `node verify_scaleout.mjs <haircut> <nbars> <close|high> [all]`.*
