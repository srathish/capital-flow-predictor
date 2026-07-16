# Dark-Pool Levels as Directional Support/Resistance — Mirror-Controlled Study

**Program:** Bellwether 0DTE / GEX-VEX structure program
**Scope:** SPXW (SPX index) 0-DTE, 1-minute. **RESEARCH ONLY (Clause 0 — no live-code changes.)**
**Sample:** 12 trading days, 2026-06-29 → 2026-07-15 (all days with dark-pool coverage).
**Author:** research subagent · **Date:** 2026-07-15

> **The hypothesis (operator's lead).** Large SPY dark-pool prints (mapped to SPX) act as *directional*
> support/resistance: institutions accumulate size at a level and *defend* it, so price bounces off it with a
> directional bias — unlike bare GEX nodes, which failed the mirror test because they have no side. The decisive
> test is the **mirror**: does price reverse at *real* dark-pool levels more than at an *equidistant phantom* level
> with no print? GEX nodes failed. Does dark-pool pass?

---

## TL;DR — VERDICT: dark-pool levels FAIL the mirror test. Another magnet-not-predictor (if anything, weaker).

- **Mirror (headline).** Real DP levels reverse at **0.463** vs mirror phantoms **0.390** — a +0.07 gap whose
  day-block bootstrap **CI90 = (−0.019, +0.158) straddles zero**. Mean 30-min bounce-drift is **−2.4 bps at real
  levels** (price drifts *through*, not off) vs −1.9 bps at phantoms (drift-diff CI90 = (−4.7, +3.2), straddles zero).
  A **randomly-placed** phantom reverses **more** than the real level (0.579).
- **Direction.** No rejection edge. In the bull tape both real and phantom levels get overrun to the upside. The
  only non-null glimmer is **mega (>$2B) supports**: dip-into-level then bounce, **+2.57 bps over its own mirror**,
  but **CI90 = (−2.9, +8.0)** — not distinguishable from zero, and driven largely by one level.
- **Monetize (modeled).** The DP setup **loses money and loses *more* than every control**: real −14.95%/trade vs
  random-timing −7.04%, random-level −1.8%, mirror −11.0%. It is an anti-edge, not an edge.
- **Confluence.** DP∩GEX-wall 0.475 ≈ DP-alone 0.435 ≈ GEX-wall-alone 0.50 — all coin-flip/negative. No confluence lift.
- **The anchor was a mapping artifact.** The real SPX/SPY ratio is **~10.033**, not the ~10.01 in the brief. Under
  the correct ratio the 7/15 "$6B at 751.8" level maps to **SPX 7543**, 16 pts *above* the day's actual 7527 low —
  price passed *through* it. The apparent "V-bottom on the level" only appears under the wrong ~10.013 mapping, and
  even there **the equidistant mirror bounces more (0.633 vs 0.574)**. It is generic mean-reversion at the day's low,
  not dark-pool defense.

**Bottom line:** dark-pool levels are **not** the program's first directional edge. On this sample they behave like
GEX nodes — a location price visits, with no reliable side — and the naive "bounce off the dark-pool print" story
does not survive the mirror, random, or ratio-correction controls.

---

## 1. Pre-registration (design frozen before computing outcomes)

Data-prep performed before any outcome was computed: (a) per-day SPX/SPY ratio calibration from real daily OHLC;
(b) a feasibility probe of the option tape. Neither looked at touch/reversal outcomes. Everything below was fixed first.

**Mapping SPY → SPX.** `SPX_level = SPY_price × ratio_d`, `ratio_d = median{O,H,L,C}(SPX_d)/{O,H,L,C}(SPY_d)`
from UW daily bars. Measured range **10.033–10.039**, intraday-consistent (open/high/low/close ratios agree to
±0.03%). *Primary* mapping = per-day empirical ratio. *Sensitivity* = naive 10.013 (reproduces the operator's
as-displayed overlay).

**Levels.** Greedy-by-notional clustering of all prints: seed with the largest unassigned print, absorb all prints
within **±0.15%** (SPY price), level price = notional-weighted centroid, level strength = summed notional,
first-seen = earliest member date. A level is **active on day d** if `first_seen ≤ d` (persists forward as reference
S/R; task definition). *Robustness:* strictly-prior-day (`first_seen < d`, look-ahead-safe) and ±0.10% band.

**Touch.** Band **±0.05%** of spot. A touch *event* fires when 1-min spot enters the band while "armed"; the level
disarms until spot moves >0.10% away, then re-arms (dedupes lingering). Approach side = sign(last clearly-outside
spot within 15 min): +1 from above → **support** test; −1 from below → **resistance** test.

**Outcome.** `fwd = (spot_{t+H} − spot_t)/spot_t`, H ∈ {15, 30} min. **Bounce-drift** = `+fwd` for support,
`−fwd` for resistance → **positive = level defended**. **Reversal rate** = P(bounce-drift₃₀ > 0). Only full-horizon
touches (t+30 ≤ EOD) enter reversal/drift stats.

**Mirror (headline control).** For every real level active on day d, a phantom `P = 2·open_d − L` (reflection across
the day open; equidistant, no print). Identical touch/outcome pipeline. **Random control:** each level shifted by
U(0.30%,0.80%)·spot (random sign), rejecting placements within 0.15% of any real level.

**Directional bias.** Support vs resistance mean fwd-drift by notional tier: **mega >$2B**, **mid $500M–$2B**,
**small <$500M**.

**Monetize.** Support-touch + 2-min reclaim → buy ATM call; resistance-touch + 2-min reject → buy ATM put.
Exit: profit target spot ±0.25%, structural stop (2 consecutive min beyond level by >0.10% against the trade),
30-min time stop, or EOD. Compare real vs random-timing, random-level, and mirror.

**Confluence.** DP level within **0.1%** of a strong GEX wall (a top-6 abs-gamma strike that is a local |gamma| max)
vs DP-alone vs GEX-wall-alone.

**Controls.** Mirror (mandatory), random-timing, random-level, walk-forward halves, 2000× day-block bootstrap,
notional-tier split, ratio sensitivity, look-ahead-safe. **n is small (12 days) → read everything as a LEAN.**

**Two honest limitations, stated up front:**
1. **Ratio correction changes the operator's anchor** (see §8). Handled by making the empirical ratio primary and
   reporting the naive ratio as sensitivity.
2. **Real intraday option prints were not retrievable.** `get_option_trades` returns empty for historical intraday
   windows on past dates (probed SPXW & SPX, two windows on 2026-07-14). **Test 4 P&L is therefore MODELED**:
   Black-Scholes ATM 0-DTE on the *real* 1-min spot path, day IV = SPX `volatility_30`, entered at modeled **ask**
   / exited at modeled **bid** using a **dollar-floored** half-spread `max($0.15, 0.5%·premium)` — deliberately *not*
   a flat 3% (per the operator's note that flat-3% is too generous on cheap contracts; the dollar floor makes the
   round-trip a large % on cheap late-day contracts). Absolute magnitudes are model-dependent; the **real-vs-control
   ranking is robust** because all arms use identical pricing.

---

## 2. Levels (clustering output)

9 levels from 34 prints. All ≥ $0.70B → **the "small <$500M" tier is empty**; tier contrast is mega vs mid only.

| SPY | SPX (≈, 7/15) | Notional | tier | first seen | print-days |
|----:|----:|----:|:--|:--|:--|
| 751.51 | 7543 | **$9.05B** | mega | 07-06 | 06,09,10,14,15 |
| 745.51 | 7481 | **$7.86B** | mega | 07-01 | 01,02,08 |
| 754.76 | 7574 | **$4.26B** | mega | 07-10 | 10,15 |
| 741.72 | 7444 | **$3.90B** | mega | 06-29 | 29,30,02 |
| 746.98 | 7496 | **$3.64B** | mega | 06-30 | 30,07 |
| 748.98 | 7515 | $1.59B | mid | 07-13 | 13,14 |
| 732.59 | 7351 | $0.90B | mid | 06-29 | 29 |
| 741.00 | 7435 | $0.76B | mid | 06-29 | 29 |
| 738.79 | 7413 | $0.70B | mid | 06-29 | 29 |

The 751.5 cluster (~$9B) is the operator's "$6B at 751.8" plus the 750.9–751.3 prints; it is the strongest and most
persistent level in the window.

---

## 3. Test 1 — Interaction (per-level touch / reversal, notional-ordered)

| SPY level | Notional | touches | full-horizon | reversal rate | mean bounce-drift₃₀ | active days |
|----:|----:|----:|----:|----:|----:|----:|
| 751.51 | $9.05B | 23 | 20 | 0.500 | +0.7 bps | 6 |
| 745.51 | $7.86B | 20 | 13 | **0.769** | **+5.2 bps** | 6 |
| 754.76 | $4.26B | 5 | 2 | 0.000 | −2.9 bps | 3 |
| 741.72 | $3.90B | 9 | 9 | 0.333 | −6.0 bps | 3 |
| 746.98 | $3.64B | 20 | 17 | 0.294 | −6.6 bps | 5 |
| 748.98 | $1.59B | 6 | 4 | 0.750 | +1.5 bps | 2 |
| 741.00 | $0.76B | 12 | 11 | 0.364 | −6.8 bps | 4 |
| 738.79 | $0.70B | 6 | 6 | 0.500 | −5.8 bps | 1 |

**Read.** No monotonic "bigger = bounces harder." The strongest level ($9B) is a **coin flip** (0.50, ~0 drift);
the second ($7.86B) is the sample's one genuine bouncer (0.77) — but it is a *single* level (n=13) that was also a
persistent support in that window (classic overfit-to-one-level, which the mirror exists to defeat). The $3.64B
level is a strong *pass-through* (0.29). Aggregate signal is a wash before any control.

---

## 4. Test 2 — THE MIRROR (headline, real vs phantom vs random)

Full-horizon touches, empirical per-day ratio, same-day-inclusive levels.

| Level set | touches (all / full) | reversal rate | bounce-drift₃₀ | bounce-drift₁₅ |
|:--|----:|----:|----:|----:|
| **Real DP** | 102 / 82 | **0.463** | **−2.37 bps** | −1.68 bps |
| **Mirror phantom** (2·open − L) | 73 / 59 | 0.390 | −1.95 bps | −0.67 bps |
| **Random phantom** (±0.3–0.8%) | 59 / 57 | **0.579** | **+1.99 bps** | +0.18 bps |

**Day-block bootstrap (2000×), real − mirror:**
- reversal-rate diff: **mean +0.070, CI90 (−0.019, +0.158)** → **straddles zero.**
- bounce-drift₃₀ diff: **mean −0.51 bps, CI90 (−4.70, +3.19)** → **straddles zero.**

**Read — this is the decisive result.**
1. Real reversal rate (0.463) is **below 0.5** — a touched real level is slightly *more* likely to be passed through
   than to reverse. Mean bounce-drift is **negative**: no defensive bounce in aggregate.
2. Real barely edges the mirror on reversal (0.463 vs 0.390) but the difference is **inside the noise** (CI straddles
   zero) and the *drift* difference is essentially zero.
3. A **randomly-placed** level reverses **more** than the real dark-pool level (0.579 vs 0.463). If dark-pool prints
   marked defended levels, this could not happen.

GEX nodes failed the mirror. **Dark-pool levels fail it too** — and the random control is arguably worse news than
GEX got.

---

## 5. Test 3 — Directional bias by notional tier

Bounce-drift convention (**positive = defended**: support bounced up / resistance rejected down). Mega = >$2B, mid =
$500M–$2B (small tier empty).

| Tier | role | real bounce-drift₃₀ | n | mirror | n | real − mirror (boot CI90) |
|:--|:--|----:|--:|----:|--:|:--|
| **mega** | support | **+2.82 bps** | 29 | +0.27 | 23 | **+2.57 bps (−2.9, +8.0)** |
| **mega** | resistance | −5.38 bps | 32 | −1.15 | 23 | −4.31 bps (−10.3, +0.14) |
| mid | support | −12.10 bps | 11 | −11.43 | 6 | ≈ phantom (both break down) |
| mid | resistance | +2.95 bps | 10 | −3.77 | 7 | thin (n≈8) |

**Read.**
- **Mega support** is the *only* place the sign points the operator's way: dip into a >$2B level → +2.82 bps bounce,
  vs +0.27 at its own mirror. But the bootstrap **CI90 (−2.9, +8.0) includes zero**, and most of it is the buy-the-dip
  reflex in a bull tape (mid-tier supports and mirrors also get bought where the tape allows).
- **Mega resistance does the opposite of the thesis:** price drifts *up through* real resistances (−5.38 bounce-drift)
  *more* than through phantoms (−1.15). Big dark-pool levels above spot did **not** cap price; the bull tape ran them.
- No tier shows a *rejection* edge. "Bigger bounces harder" is only weakly true for **supports** and only vs a near-zero
  phantom — not a directional structure you can lean on.

---

## 6. Test 4 — Monetization (modeled; real vs controls)

ATM 0-DTE, entry at modeled ask / exit at modeled bid, dollar-floored spread (see §1 limitation 2). All arms priced
identically, so the **ranking** is the signal; the absolute bleed is 0-DTE theta + spread and is expected.

| Arm | n | win rate | exp / trade | total |
|:--|--:|--:|--:|--:|
| **Real DP setup** | 76 | 0.316 | **−14.95%** | −1136% |
| Mirror-level setup | 53 | 0.302 | −10.96% | −581% |
| **Random-timing** (matched count) | 76 | 0.382 | **−7.04%** | −535% |
| **Random-level** setup | 55 | 0.436 | **−1.80%** | −99% |
| — real, calls only | 35 | 0.429 | −13.37% | −468% |
| — real, puts only | 41 | 0.220 | −16.30% | −668% |
| — real, mega levels | 58 | 0.362 | −12.15% | −705% |
| — real, mid levels | 18 | 0.167 | −23.99% | −432% |

**Read.** The DP entry filter is **actively harmful**: it loses *more* than firing at random minutes (−14.95% vs
−7.04%) and far more than at random price levels (−1.80%). The 2-min-reclaim/reject confirmation does not rescue it.
Puts (fading resistance) are the worst arm (win 0.22) — consistent with §5's "resistances get overrun in a bull tape."
No tier or side monetizes.

*(dp_events.jsonl logs all 76 real-DP trades for the terrain viewer: day, entry minute UTC, `strike:spot@entry`,
implied up/down, exit minute, win/loss, pnl_pct.)*

---

## 7. Test 5 — Confluence (DP × GEX wall)

Strong GEX wall = a strike within 0.1% of the level that is a top-6 abs-gamma strike **and** a local |gamma| maximum
in that minute's snapshot.

| Bucket | n | reversal rate | bounce-drift₃₀ |
|:--|--:|--:|--:|
| DP ∩ GEX-wall | 59 | 0.475 | −2.13 bps |
| DP alone | 23 | 0.435 | −2.97 bps |
| GEX-wall alone | 6 | 0.500 | −3.75 bps |

**Read.** Confluence buys **+0.04 reversal rate** over DP-alone — inside the noise, and both remain coin-flip with
negative drift. Stacking a dark-pool level on a gamma wall does not manufacture a bounce. The confluence thesis is
**not supported** on this sample (n small; lean).

---

## 8. Controls & robustness

**Ratio sensitivity (the anchor's fate).** Real vs mirror reversal rate under each mapping:

| Mapping | real (rev, n, drift) | mirror (rev, n, drift) |
|:--|:--|:--|
| **Empirical ~10.033 (primary)** | 0.465, 86, −1.2 bps | 0.453, 64, −0.5 bps |
| Naive 10.013 (operator overlay) | 0.574, 68, +6.3 bps | **0.633**, 49, +6.6 bps |

Under the naive overlay, reversal looks high (0.574) and drift positive — *but the mirror is higher still (0.633)*.
The naive ratio shifts every level ~20 SPX pts lower, parking them near intraday lows where price mean-reverts
regardless of whether a print is there. **The "bounce" is a property of the location (day low), not the dark-pool
print** — the phantom at the mirror location reverts more. This is exactly why the 7/15 anchor *looked* clean:
751.8 × 10.013 = 7528 ≈ the 7527 low, and lows V-recover. With the correct ratio (751.8 → 7543) the level sat 16 pts
above the low and was **passed through** on the way down and again on the way up.

**Look-ahead-safe (prior-day levels only, first_seen < d).** real 0.443 (n=61, −2.6 bps) vs mirror 0.379 (n=58,
−2.1 bps). Same picture as same-day-inclusive — the result is not an artifact of same-day print timing.

**Walk-forward halves.**

| Half | real (rev, n, drift) | mirror (rev, n, drift) |
|:--|:--|:--|
| H1 06-29→07-08 | 0.479, 48, −2.5 bps | 0.438, 32, −4.2 bps |
| H2 07-09→07-15 | 0.441, 34, −2.1 bps | 0.333, 27, +0.7 bps |

Both halves: real ≈ 0.44–0.48, mirror ≈ 0.33–0.44, drift ~0 to negative. No half shows a real bounce edge; the small
real-over-mirror reversal gap is stable but small and never accompanied by positive drift. Nothing strengthens
out-of-sample.

**Mirror gets fewer touches (73 vs 102).** Expected — real levels sit where institutions traded, i.e., near the price
range, so they are visited more. All comparisons are *rate-conditional-on-touch*, so this does not bias reversal rate;
it does mean phantom stats are noisier (smaller n), reinforcing "lean, not proof."

---

## 9. Honest verdict

**Dark-pool levels are not a directional edge on this 12-day sample. They fail the mirror test the same way GEX nodes
did — arguably more clearly, because a randomly-placed level reverses *more* than the real one and the monetized DP
setup loses *more* than random timing.**

- Reversal at real ≈ reversal at phantom (bootstrap CI on the difference straddles zero); mean bounce-drift ~0 to
  negative → **no defensive bounce.**
- No rejection side (resistances get overrun in the bull tape); the one directional glimmer — **mega-support dip-bounce,
  +2.6 bps over its mirror** — is inside the noise and not monetizable after theta + spread.
- No confluence lift with GEX walls.
- The operator's headline 7/15 anchor is a **SPX/SPY ratio artifact**: it only looks like a level-bounce under the
  wrong ~10.013 mapping, which coincidentally lands the level on the day's low; correct the ratio and price passed
  straight through, and even the wrong mapping's mirror bounces more.

**What this rules out / suggests next.**
- Rules out (at this sample size) the simple "buy the touch of a big dark-pool level" as a standalone directional play.
- The mega-support faint tilt is the *only* thread worth a bigger sample — but it is indistinguishable from
  "buy-the-dip in a bull tape," so any future test **must** hold the tape gate fixed and keep the mirror as the bar to
  clear. Given the program's prior that the bull tape gate already absorbs most entry rules, dark-pool levels look
  like another rule the gate would swallow.
- Dark-pool prints remain useful as a **map of where price may travel** (magnet, like GEX), **not** as a signed,
  defendable S/R with predictive direction. Same category as GEX: structure, not forecast.

*Caveats: n = 12 days; modeled option P&L (real intraday tape unavailable); levels dominated by a few mega clusters;
single bull-drift regime (SPX 7440→7572). Treat all magnitudes as leans and re-run on a larger, regime-mixed sample
before any decision.*
