# Asgard — the resource vault (Sky community drop, curated)

One organized place for the best trading/vol/orderflow/quant resources shared in the Skylit community (Jack [SKY] + others, Jul–Aug 2026). Grouped by use, with a **what's-actionable-for-our-0DTE-agent** note per cluster. Links are external — most need a browser/login/download and can't be auto-fetched by the agent; the ones already distilled into our own knowledge docs are marked ✅.

---

## ⭐ Actionable NOW (folded into the agent)
1. **SPX leads VIX, not vice versa** — *aligrithm: "Chicken and Egg: Use the SPX to Time the VIX, Not Vice Versa"* (Rob Hanna study). Empirics 2007–2023: SPX-oversold predicts VIX futures at **profit factor 1.41**; VIX-predicting-SPX is **1.14 (≈noise)**; long-term VIX filters on SPX score CAR/MDD **0.11–0.13 vs 0.14 buy&hold** (no edge), while SPX filters score **0.32**. → **VIX is the reaction, not the anticipator.** Directly validates our **#2 doctrine fix** (don't fade a confirmed price trend on VIX-tilt alone). Now cited in the agent doctrine: *read PRICE for direction; use VIX for REGIME + sizing, never as a standalone counter-trend trigger.*
   https://aligrithm.com/chicken-and-egg-use-the-spx-to-time-the-vix-not-vice-versa/
2. **Volatility Primer** ✅ — already distilled → `knowledge/VOLATILITY_PRIMER.md` (VIX regimes, term structure, spot-vol correlation, VIX1D/9D/3M/VXN, IV expansion/crush).
3. **IV Expansion into earnings** ✅ — already distilled → `knowledge/IV_EXPANSION_STRATEGY.md`. Source doc: https://docs.google.com/document/d/1w9TJ5lF5IkY7UplTb02d23mabnx4LJwdeTfx7ZNUAok/edit
4. **Expected move = ATM straddle** — live in the agent (`expected_move` sense). The whole IV-crush game reduces to *realized move vs implied move*.

---

## 1. Skylit / GEX / Greeks doctrine (core to what we're building)
- **The Greeks Bible — Skylit Edition** (Notion textbook: Greeks, dealer microstructure, trading Heatseeker GEX/VEX maps) — *highest-value read for our system; worth a deep pass.*
  https://alpine-source-9ed.notion.site/The-Greeks-Bible-Skylit-Edition-2a503ffa0822800faf81fc9ca0965e62
- **Options Analysis** (Notion: OI, open interest mechanics, positioning) — https://petalite-aries-0c4.notion.site/Options-Analysis-32f34ad2634780c3b91bd4c17f3f6935
- **Architect VIX Pivot FAQ** — the pivot-line / 2-candle-confirmation method (already in VOLATILITY_PRIMER §1 + our `vix_pivot.json` override hook).
- **Flowseeker suggested settings** + *"Not all Flow is equal"* (FlowSeidon) — flow-quality filtering; maps to our whale-flow / multileg-check discipline.
- **Skylit signup** (Glitch's platform): https://whop.com/heatseeker/heatseeker
- *What's actionable:* the Greeks Bible + Options Analysis are the theory backbone for our GEX/VEX reads. Nothing to auto-ingest, but these are the canonical references when a doctrine question comes up.

## 2. The people (YouTube — Skylit inner circle + vol/quant educators)
**Skylit circle:** skylit cat (SPX/SPY/QQQ on Skylit data) · Glitch Trades (founder of Skylit, reversal/asymmetric R:R) · Nicog8 (chart-fundamentals + Heatseeker recaps) · John Wicks (Glitch bootcamp, TA + Heatseeker) · Garma (OrderFlow + Skylit).
**Vol / convexity:** Leonardo Valencia / gammaoptimizer (convexity & vol — closest to our edge thesis) · tastylive (vol/premium, 10+ hrs/day) · atypicalquant.
**Orderflow / AMT / micro:** Rizzo Trades (Auction Market Theory 101) · Reflexive Research/orderxfilled (orderflow terms) · Eric Hunsader/Nanex (microstructure, flash-crash research) · neurotrader (data-driven systems/indicators) · datamlistic · QuantScience.
**Macro/quant-life:** Ben Felix (evidence investing) · Defiant Gatekeeper (credit/PE) · Lit Nomad (ex-HF quant).
- *What's actionable:* Leonardo Valencia (convexity) + Glitch (reversal/asymmetry) + Rizzo (AMT) map most directly to our discretionary-charts-first + convexity-not-index edge.

## 3. Volatility & options books (PDFs / drives)
- volatility-trading (2nd ed., Sinclair) · volatility-surface-and-term-structure (high-profit options strategies) · volatility-and-correlation (Rebonato) · "volatility bias" · **Practitioner's Guide to Modern Markets** (13MB, flagged "really good") · *Possibly EVERY Trading Book* (Notion) · market_makers_matrix.pdf.
- Book drives: Google Drive folders (1b6PkMe7…, 1DyYukPlnZc8…) · mega.nz folders (ZIxBXKKQ, K1gXmSYQ) · Anna's Archive (annas-archive.li — LibGen/Sci-Hub/Z-Lib mirror).
- *What's actionable:* Sinclair *Volatility Trading* + Rebonato *Vol & Correlation* are the rigorous backbone for the vol senses we're adding. Reference, not ingest.

## 4. Orderflow & Auction Market Theory
- **AMT & Market Profile Overview** (Notion) — https://charming-daffodil-01a.notion.site/AMT-Market-Profile-Overview-21b7f084821c80c38b97caaf34b9c6dc
- Limbo Futures Orderflow + Limbo Heatmap (Notion) · orderflow mega drives (s1FRmagL, p8JxXIrD, OChAEQaT) · MTH9879 Market Microstructure Models (GitHub, gjimzhou) · Nanex ongoing research.
- *What's actionable:* AMT (value area, auction rotation, acceptance/rejection) is a strong lens for our node-terrain / wall-vs-escalator work — where does price accept vs reject around a GEX node.

## 5. Quant papers & aggregators
- **Paleologo** linktree (Giuseppe Paleologo — portfolio/risk) · **Turnleaf** "Hundreds of Quant Papers from #QuantLinkADay 2023" · quantocracy (mashup) · quantnet · openquant · quantvps.
- arXiv (Jack flagged "some are actually really good"):
  - **SPX, VIX and scale-invariant LSV** (2302.08819) — local-stochastic-vol calibration, SPX/VIX joint — *directly on our SPX↔VIX theme.*
  - **Systemic risk from implied vs realized volatility** (2307.05719) — IVRVSRI indicator.
  - Generative AI end-to-end LOB modelling (2309.00638) · Earnings prediction w/ RNNs (2311.10756) · FLAIR / LVR in AMMs (2306.09421) · 2302.03694 · SSRN 4432608.
- *What's actionable:* the scale-invariant LSV paper is the theory pair to the aligrithm SPX→VIX finding — both say the SPX/VIX relationship has structure worth respecting but VIX isn't the leading directional variable.

## 6. Tools
- gexstream.com (GEX) · godelterminal.com (terminal) · vixcentral.com (VIX term structure — in VOLATILITY_PRIMER) · warp.dev (terminal) · quantvps.com (VPS for algos) · the community Greeks Google Sheet · github.com/akfuster.

## 7. Learning / macro
- trendfollowing.com/resources · scikit-learn supervised learning · Khan Academy finance · Dimensional Market Theory (mediafire) · robotwealth.com · The Hedge Fund Journal ("trading volatility as an asset class").

---
*Curated 2026-08-04 from the Sky community "best resources" drop. Update this file as new links land — it's the single Asgard index. The four ⭐ items are the ones already wired into or validated against the falcon-copier agent; everything else is reference depth for when a specific question needs it.*
