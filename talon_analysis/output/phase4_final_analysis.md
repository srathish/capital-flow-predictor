# Talon Phase 4 — Universe Scan (504 tickers)
## Full buildout with GEX + Dark Pool overlay, 2026-05-28 → predictions for week of 2026-06-01

**Universe:** 504 tickers (your full Bellwether-style list).
**Data coverage:** 500/504 with GEX timeseries, 467/504 with dark pool snapshot.
**Grade buckets:** **105 actionable (≥70)** · 230 watchlist (55-69) · 165 skip (<55).

**Gates used:**
- **G1 delta_buildup** — rank-based, Phase 3 r=0.485, p=0.0006 (validated strong)
- **G2 vanna_band** — sweet spot 0.65-1.05, peak 0.85, Phase 3 ρ=-0.510, p=0.0003 (validated, sign-corrected from Phase 2)
- **G3 theme_coherence** — mean Spearman corr with theme peers, largest Phase 3 coefficient
- **Call dominance** anchor (above/below 50%) for direction

**NEW in Phase 4 — Dark Pool overlay (display only, no grade weight yet):**
- **DP_skew** — (DP volume-weighted avg price − session midline) / midline. **Positive** = institutions paid above market = bullish. **Negative** = institutions sold into rally = bearish red flag.
- **DP_share %** — DP volume / (DP + regular). High share (>70%) = stealth accumulation/distribution.

---

## Top 25 Actionable Setups (week of June 1)

| Ticker | Grade | Theme | Call Dom | Δ Buildup | Vanna 5d | Theme Coh | DP Skew | DP % |
|---|---|---|---|---|---|---|---|---|
| **ENPH** | **87.0** | clean_energy | 90% | +724% | 0.93 | 0.50 | **+0.22%** ✓ | 55% |
| **RGTI** | **85.7** | quantum | 82% | +151% | 1.01 | 0.69 | −0.36% ⚠ | 55% |
| **FSLR** | **84.9** | clean_energy | 90% | +68% | 0.81 | 0.55 | −0.04% | 59% |
| **ASTS** | 84.7 | satellite_space | 93% | +102% | 0.64 | 0.44 | **−0.42%** ⚠ | 60% |
| **KTOS** | 84.4 | drones_defense | 75% | +354% | 0.78 | 0.51 | −0.01% | 57% |
| **CLSK** | 83.9 | crypto_miners | 90% | +39% | 0.87 | 0.62 | 0.00% | 64% |
| **BLDP** | 83.7 | clean_energy | 98% | +422% | 0.84 | 0.20 | +0.03% | 60% |
| **RDW** | 83.6 | satellite_space | 96% | +71% | 0.70 | 0.56 | +0.03% | **84% stealth** |
| **SEDG** | 83.3 | clean_energy | 94% | +124% | 0.81 | 0.35 | −0.11% | 55% |
| **HIVE** | 81.7 | crypto_miners | 97% | +156% | 0.95 | 0.28 | 0.00% | **78%** |
| **SMCI** | 81.2 | semis | 79% | +35% | 0.84 | 0.59 | — | — |
| **QBTS** | 80.5 | quantum | 87% | +24% | 1.14 | 0.74 | **+0.15%** ✓ | **73%** |
| **LMT** | 80.3 | drones_defense | 61% | +388% | 1.03 | 0.52 | −0.01% | **83%** |
| **CIFR** | 79.2 | crypto_miners | 89% | +7% | 0.81 | 0.72 | +0.05% | 58% |
| **HYLN** | 78.6 | ev_autos | 98% | +312% | 0.66 | 0.15 | **−0.30%** ⚠ | **78%** |
| **AMPG** | 78.4 | satellite_space | 97% | **+962%** | 1.37 | 0.50 | **+0.21%** ✓ | 70% |
| **F** | 78.3 | ev_autos | 90% | +689% | 0.57 | 0.19 | −0.04% | **86%** |
| **RKLB** | 78.1 | satellite_space | 92% | +25% | 1.00 | 0.57 | −0.22% ⚠ | 56% |
| **CAKE** | 78.0 | unthemed | 87% | +292% | 0.84 | — | **+0.25%** ✓ | 40% |
| **VST** | 77.7 | nuclear | 56% | +86% | 0.87 | 0.37 | +0.01% | **82%** |
| **ABBV** | 77.5 | healthcare | 66% | **+2082%** | 0.93 | 0.16 | −0.01% | **82%** |
| **IREN** | 77.0 | crypto_miners | 89% | +3% | 0.80 | 0.70 | +0.03% | 59% |
| **FIVE** | 76.9 | retail | 71% | +435% | 1.13 | 0.20 | −0.04% | 38% |
| **BTDR** | 76.7 | crypto_miners | 90% | +5% | 1.11 | 0.69 | **−1.08%** ⚠⚠ | 60% |
| **WW** | 76.6 | unthemed | 95% | +146% | 0.77 | — | **−0.60%** ⚠ | 60% |

Legend: ✓ = bullish DP confirmation (skew ≥ +0.10%) · ⚠ = bearish DP conflict (skew ≤ −0.20%) · stealth = DP share ≥ 70%.

---

## Theme Rollup (sorted by mean grade)

The biggest signal in the universe scan is **theme concentration**. 5 themes own the high-grade tier:

| Theme | n | Actionable | Mean Grade | Mean Call Dom | Mean Δ Buildup | Mean DP Skew | Bull % |
|---|---|---|---|---|---|---|---|
| **quantum** | 3 | 3 | **79.9** | 85% | +60% | −0.04% | 100% |
| **clean_energy** | 7 | 6 | **79.0** | 91% | +199% | +0.02% | 100% |
| **crypto_miners** | 10 | 10 | **77.4** | 91% | +22% | −0.08% | 100% |
| **drones_defense** | 6 | 6 | **77.0** | 62% | +190% | −0.03% | 67% |
| **satellite_space** | 8 | 6 | **76.0** | 94% | +146% | −0.06% | 100% |
| ev_autos | 4 | 3 | 74.5 | 85% | +270% | −0.13% | 100% |
| retail | 4 | 4 | 72.7 | 72% | +129% | −0.02% | 75% |
| consumer_travel | 5 | 4 | 72.2 | 70% | +30% | +0.01% | 80% |
| nuclear_uranium | 3 | 2 | 72.0 | 60% | +55% | −0.01% | 67% |
| semis | 12 | 7 | 71.7 | 86% | +5% | 0.00% | 100% |
| vol_hedge | 2 | 2 | 71.5 | 69% | +65% | 0.00% | 100% |
| energy | 3 | 2 | 70.8 | 75% | −4% | −0.02% | 100% |
| healthcare | 6 | 2 | 70.1 | 71% | +390% | −0.07% | 100% |
| metals | 3 | 1 | 69.8 | 80% | −7% | +0.02% | 100% |
| fintech | 2 | 1 | 69.3 | 58% | +83% | **−0.30%** | 50% |
| **ai_cloud** | 6 | 1 | **68.5** | 75% | +75% | −0.04% | 83% |
| ai_compute_infra | 3 | 1 | 68.4 | 87% | −4% | −0.11% | 100% |
| **crypto_tokens** | 1 | 0 | **66.8** | 79% | **−31%** | **−0.38%** | 100% |

**Notable takeaways:**

1. **Hard-asset / picks-and-shovels themes dominate the top:** clean_energy, crypto_miners, drones_defense, satellite_space, quantum. These are the AI/energy-transition plays with dealer positioning behind them.
2. **AI-cloud mega-caps are middle-of-the-pack** (G=68.5). The Phase 2 story about ENPH/MU outperforming MSFT is now visible at theme scale — the high-call-flow signal has shifted from mega-cap tech to specialized energy/defense names.
3. **crypto_tokens (MSTR/IBIT/ETHA) confirmed weakest** at G=66.8 with **DP skew −0.38%** and **delta_buildup −31%**. Exactly the divergence from miners that Phase 2 found — and the gap is widening, not narrowing.
4. **fintech** very thin (n=2 of expected 6) — most fintech names lack the GEX signature; HOOD only one with a clean read.

---

## Dark Pool Conflict Signals (bullish thesis vs. distributing institutions)

These are setups where the **options flow says bull** but the **dark pool says institutions are selling into the rally**. Treat as warning — the smart money may be exiting while retail call buying drives the move.

| Ticker | Grade | Theme | DP Skew | DP % | Read |
|---|---|---|---|---|---|
| **BTDR** | 76.7 | crypto_miners | **−1.08%** | 60% | Severe DP distribution — flag against the grade |
| **WW** | 76.6 | unthemed | −0.60% | 60% | Watch high call flow + DP exit |
| **SPCE** | 72.0 | unthemed | −0.53% | **87%** | Heavy stealth distribution — institutions actively exiting |
| **LPTH** | 74.6 | unthemed | −0.50% | 42% | Standard distribution warning |
| **SHOP** | 66.4 | unthemed | −0.49% | 47% | Echoes Phase 2 SHOP target-miss story |
| **HPE** | 67.1 | unthemed | −0.42% | **75%** | Stealth DP distribution at meaningful scale |
| **ASTS** | 84.7 | satellite_space | −0.42% | 60% | High-grade name with bearish DP cross — caution |
| **SIDU** | 76.1 | unthemed | −0.37% | **79%** | Stealth distribution at high call_dom |
| **RGTI** | 85.7 | quantum | −0.36% | 55% | #2 actionable but DP says caution |
| **HYLN** | 78.6 | ev_autos | −0.30% | **78%** | Bull thesis intact but DP is cooling |

**Action:** when GEX-driven grade is high but DP_skew is sharply negative, the setup is leveraging late-cycle retail call buying. Tighter risk control / take profits earlier.

---

## Dark Pool Confirmation (bullish thesis + bullish DP)

Setups where both signals agree:

| Ticker | Grade | Theme | DP Skew | DP % | Read |
|---|---|---|---|---|---|
| **ENPH** | 87.0 | clean_energy | **+0.22%** | 55% | Clean #1 — flow and institutions both bullish |
| **AMPG** | 78.4 | satellite_space | +0.21% | 70% | Confirmed at scale |
| **CAKE** | 78.0 | unthemed | +0.25% | 40% | Unusual confirmed setup |
| **QBTS** | 80.5 | quantum | +0.15% | **73%** | Top quantum + stealth accumulation |
| **RIOT** | 74.5 | crypto_miners | +0.28% | 65% | Miner basket bull confirmation |
| **TE** | 74.1 | unthemed | +0.13% | **88%** | Heavy stealth bullish |
| **FLY** | 72.7 | unthemed | **+1.13%** | 50% | Outlier — massive DP buying |
| **GTLB** | 72.5 | unthemed | +0.45% | 47% | Confirmed software bid |
| **OKTA** | 71.9 | unthemed | +0.16% | 55% | Confirmed |
| **ARM** | 71.7 | semis | +0.34% | 64% | Best DP-confirmed semis name |
| **AMAT** | 69.4 | semis | +0.12% | 42% | Mild confirm |
| **MU** | 68.5 | semis | +0.11% | 65% | Phase 2 MU still confirming |

These are the **highest-conviction setups** — both options flow and institutional flow point the same direction.

---

## Stealth Accumulation Candidates (DP share > 70%)

When **most of a ticker's volume trades off-exchange**, institutions are positioning quietly. High DP share + bullish grade = aggressive accumulation pattern.

| Ticker | Grade | Theme | DP % | DP Skew | Read |
|---|---|---|---|---|---|
| **RDW** | 83.6 | satellite_space | **84%** | +0.03% | Heavy stealth bid, neutral skew = solid accumulation |
| **HIVE** | 81.7 | crypto_miners | 78% | 0.00% | Massive stealth, neutral skew |
| **QBTS** | 80.5 | quantum | 73% | +0.15% | Stealth + bullish skew = high conviction |
| **LMT** | 80.3 | drones_defense | 83% | −0.01% | Defense institutional accumulation |
| **F** | 78.3 | ev_autos | **86%** | −0.04% | Auto sector stealth bid |
| **VST** | 77.7 | nuclear | 82% | +0.01% | Power-grid bull confirmed |
| **ABBV** | 77.5 | healthcare | 82% | −0.01% | Pharma stealth accumulation |
| **RTX** | 76.5 | drones_defense | 86% | −0.02% | Defense complex |
| **VOYG** | 76.0 | unthemed | **87%** | +0.04% | Off-screen stealth bull |
| **OXY** | 75.5 | energy | 71% | −0.02% | Energy sector accumulation |

**Action:** these are not pure options-flow plays — they're institutional positioning plays. Hold longer than the typical 5-day GEX window; use VEX targets and weekly close levels.

---

## Surprises and Counter-Examples

Three findings the data surfaces that are worth flagging specifically:

### 1. ABBV — the "no theme" pharma at +2082% delta buildup
ABBV (G=77.5, theme=healthcare) shows the **single largest delta_buildup in the universe at +2082%**. Plus DP share 82% (stealth). The Phase 2 study didn't cover ABBV at all. This is exactly the kind of "ungraded mystery" the original Talon scan would have missed — looks like a major institutional positioning event in progress.

### 2. RGTI — top-3 actionable with sharply negative DP
RGTI (G=85.7) is the #2 ranked setup overall, beating FSLR. But DP_skew is **−0.36%** — institutions are selling into the call-flow rally. Either retail momentum drives short-term continuation OR institutions are leading and call buyers will hold the bag. **Watch the DP_skew trend for direction.**

### 3. crypto_tokens at the bottom — Phase 2 finding got worse, not better
Theme rollup confirms crypto_tokens at G=66.8, mean DP_skew −0.38%, mean delta_buildup −31%. The miners-vs-tokens divergence from Phase 2 has **widened** by another month. If you're holding MSTR / IBIT / ETHA on a "crypto exposure" thesis, the data says they're worse than the miners by every flow metric we can measure.

---

## Caveats

- **Dark pool data is single-session** (today only). Trend would require multi-day DP — not implemented yet.
- **Dark pool is display-only**, not weighted in grade. Validating its predictive power requires re-running Phase 3-style regression with DP data added to the 48-ticker historical sample. Phase 5 candidate.
- **n=500/504** — 4 tickers had no GEX data or insufficient days. Mostly tiny names (ALMU, MGTN, DRAM, etc.) — coverage will be 100% with longer history.
- **Theme labels are hand-coded** — they reflect the user's Bellwether universe, not a canonical taxonomy. "unthemed" = 91 tickers (18%) that didn't fit a labeled theme. These ranked normally but lose the theme_coherence boost.
- **Same-day scan only** — gates measure positioning at this moment. Tomorrow's scan reads tomorrow's positioning. Re-run daily.

---

## Files

- [scan_2026-05-29.json](scan_2026-05-29.json) — full scan output (UI-consumable)
- [phase4_top25.csv](phase4_top25.csv) — top 25 actionable
- [phase4_theme_rollup.csv](phase4_theme_rollup.csv) — per-theme aggregate
- [phase4_dp_conflicts.csv](phase4_dp_conflicts.csv) — bull setups with bearish DP
- [phase4_dp_confirms.csv](phase4_dp_confirms.csv) — bull setups with bullish DP
- [phase4_stealth.csv](phase4_stealth.csv) — high DP-share names

Next step is to refactor `talon_scanner.py` to call UW live via `UWClient` so this runs on Railway without the disk cache.
