# Does the dealer gamma regime predict how big the day's move is? — locked design (2026-10-09, before code)

**Idea (dealer hedging):** when dealers are net long gamma they sell rallies and buy dips (moves damped, pinned
days); when net short gamma they chase (moves amplified). So lower / negative net gamma should mean a **wider day**.
This tests *size of move*, not direction. The bar is high on purpose: volatility clusters and VIX already forecasts
range, so gamma must add information **beyond** recent realized range and VIX.

## Data
- UW daily greek exposure by strike (all expiries), `apps/gex/research/exit-study/walkforward/cache/{SPY,QQQ,IWM}_gex_<d>.json`
  (`gex` = call_gex + put_gex per strike), 2025-07-10 → 2026-07-10, and UW daily OHLC `{SPY,QQQ,IWM}_ohlc.json`.
- VIX daily close: FRED VIXCLS (cached to `.cache/vix_fred.json`).
- **No look-ahead:** the gamma used for day d is the file for the previous trading day (d−1); VIX is the d−1 close.

## Variables
- **Outcome** y = ln(range_d / close_{d−1}), range = high − low of day d.
- **Gamma balance (primary predictor)** B = Σ gex / Σ |gex| over all strikes of the d−1 file (−1 = all short gamma,
  +1 = all long). Hypothesis: coefficient on B is **negative** (less long gamma → wider day).
- **Controls:** ln(range_{d−1}/close_{d−2}), ln(mean of range/prior close over days d−20 … d−1), ln(VIX_{d−1}).
- Days need all of: d−1 gamma file, 20 prior days of OHLC, VIX_{d−1}.

## Primary test
Pooled OLS, SPY + QQQ stacked with a symbol fixed effect: y ~ B + controls. Standard errors Driscoll–Kraay
(Newey–West on date-summed scores, lag 5).
**PASS** only if all hold:
1. pooled coefficient on B < 0 with t ≤ −2;
2. coefficient on B < 0 in SPY alone and in QQQ alone (each with the same controls, Newey–West lag 5);
3. pooled coefficient on B < 0 in 2025-07 → 2025-12 and in 2026-01 → 2026-07 separately.

## Secondary (reported, not used for the verdict)
- the same regression without controls (shows how much is just volatility clustering);
- R² with controls only vs controls + B;
- sign dummy (Σ gex < 0) instead of B; local balance using only strikes within ±2% of the d−1 close;
- IWM alone;
- size in plain terms: day range ÷ prior-20-day average range in the lowest vs highest third of B;
- "do short-gamma days trend?": |close − open| / range regressed on B with the same controls;
- Skylit intraday check: 0DTE net gamma balance on the 09:35 board (`apps/gex/data/skylit-archive/intraday`, 13:35 UTC)
  vs the 09:35 → 16:00 range from 1-min bars (`apps/gex/research/exit-study/cache_underlying`), SPY + QQQ, same
  controls, about 63 days.

## Run discipline
Independent audit before the single run; fixes logged below. Output `shadow/results_gamma_range/`. Research only.

## Amendments
**Amendment 1 (2026-10-09, after the independent audit, before the run).**
- IWM secondary dropped: the cached IWM daily file has close only (no high/low). Rows with a non-finite range are skipped.
- The 20-day warm-up means the sample starts 2025-08-08; the first half is 2025-08-08 → 2025-12-31.
- Local balance is missing (row skipped for that secondary only) if no strike lies within ±2%.
- Half days (2025-11-28, 2025-12-24) stay in, as the design allows. The audit confirmed no look-ahead: each UW file
  is priced at that day's close and is used only for the next day.
