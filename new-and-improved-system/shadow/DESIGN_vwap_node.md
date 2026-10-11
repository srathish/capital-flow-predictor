# VWAP-band × gamma-node rejections (the "Flow VWAP × GEX orb" idea) — locked 2026-10-11, before any engine

**Idea (community post):** fade rejections at the ±1σ / ±2σ VWAP bands only when a large gamma strike sits on the band;
entries are rare and the risk/reward is good; "more puts would have done 3–4× better". Standard volume-weighted VWAP is
used (the post's "Flow VWAP" may be premium-weighted — not available historically; stated as a limit).

## Data
UW 1-minute bars with volume, SPY / QQQ / IWM / DIA (`.cache/uw/m1/`, missing minutes filled, bad-print wicks clipped —
same preprocessing as the trade factory). Gamma nodes from UW daily greek exposure of day d−1 (`.cache/uwgreeks/`):
strong nodes = strikes with |net gamma| ≥ 50% of that day's largest, within ±3% of the d−1 close.
Period 2023-11-09 → 2026-10-02. **Build** to 2025-03-31, **holdout** 2025-04-01 → (untouched).

## Bands and trigger
- VWAP and σ from 09:30 (σ = volume-weighted standard deviation of typical price around VWAP); bands VWAP ± kσ,
  k ∈ {1, 2}; usable from 09:45; entries until 15:30; one trade per rule per symbol per day.
- **Rejection at the upper band (short / puts):** a bar's high reaches the band (previous close below it) and within 5
  minutes a 1-minute bar closes back below the band → enter short at that close. Stop = highest high since the touch +
  0.03%. Mirror for the lower band (long / calls).
- **Confluence:** at the touch bar a strong node lies within 0.10% of the band.
- Targets: `VW` = VWAP (exit 0.0033% before it; skip if < 1R) or `T2` = 2R; otherwise exit 15:55. Stop first if both are
  touched in one bar. Cost $0.01 per share per side.

## Rules (12, registered "mean R > 0")
k ∈ {1σ, 2σ} × side ∈ {short only, long only, both} × target ∈ {VW, T2}, all WITH confluence.
**Controls (not rules):** the same rule on band touches WITHOUT a node within 0.10% ("no-node twin"), and on 20
random-level twins (bands shifted by ±0.15–0.60%).

## Validation
Holdout: Benjamini–Hochberg q = 0.10 across the 12 (one-sided, ≥ 30 trades) AND holdout mean R above the no-node twin's
(difference t ≥ 1.65, day-clustered) AND beats ≥ 19 of 20 random-level twins. Build reported. The "puts do 3–4× better"
claim is judged by short-only vs long-only rows (registered here, not chosen afterwards).

## Run discipline
Engine `vwap_node.mjs`, smoke-tested and self-checked against the trade-factory audit list; single run. Research only.

## Amendments
(none yet)
