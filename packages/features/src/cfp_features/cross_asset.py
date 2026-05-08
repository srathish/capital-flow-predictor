"""Cross-asset features (DESIGN.md §6.1).

Market-wide features computed once per date, not per prediction-target.
All operations are point-in-time: rolling windows use only past observations.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _zscore(series: pd.Series, window: int) -> pd.Series:
    mean = series.rolling(window, min_periods=window).mean()
    std = series.rolling(window, min_periods=window).std()
    z = (series - mean) / std
    return z.replace([np.inf, -np.inf], np.nan)


def compute(prices_wide: pd.DataFrame, macro_wide_aligned: pd.DataFrame) -> pd.DataFrame:
    """Compute cross-asset features. Returns DataFrame indexed by ts.

    Args:
        prices_wide: business-day index, columns include cross-asset symbols
            (DX-Y.NYB, GLD, USO, HG=F, HYG, LQD, ^VIX, ^VIX3M, BTC-USD, SPY)
        macro_wide_aligned: same index as prices_wide (already reindexed/ffilled),
            columns include FRED series ids (DGS10, DGS2, ...)
    """
    feats = pd.DataFrame(index=prices_wide.index)
    px = prices_wide
    macro = macro_wide_aligned

    # --- DXY (Yahoo: DX-Y.NYB) ---
    dxy = px.get("DX-Y.NYB")
    if dxy is not None and dxy.notna().any():
        feats["dxy_1d_return"] = dxy.pct_change(1)
        feats["dxy_5d_return"] = dxy.pct_change(5)
        feats["dxy_20d_return"] = dxy.pct_change(20)
        feats["dxy_20d_zscore"] = _zscore(dxy.pct_change(20), 60)

    # --- 10Y / 2Y yields (FRED, in percent) ---
    if "DGS10" in macro.columns:
        ten = macro["DGS10"]
        feats["ten_y_level"] = ten
        feats["ten_y_1d_delta"] = ten.diff(1)
        feats["ten_y_20d_delta"] = ten.diff(20)
    if "T10Y2Y" in macro.columns:
        feats["yield_curve_2s10s"] = macro["T10Y2Y"]
    if "BAMLH0A0HYM2" in macro.columns:
        feats["hy_oas"] = macro["BAMLH0A0HYM2"]
        feats["hy_oas_5d_change"] = macro["BAMLH0A0HYM2"].diff(5)

    # --- Copper / Gold ---
    copper = px.get("HG=F")
    gold = px.get("GLD")
    if copper is not None and gold is not None:
        ratio = copper / gold
        feats["copper_gold_ratio"] = ratio
        feats["copper_gold_1d_change"] = ratio.diff(1)

    # --- Oil ---
    uso = px.get("USO")
    if uso is not None:
        feats["oil_5d_return"] = uso.pct_change(5)

    # --- Credit (HYG/LQD ratio is rough proxy for HY-IG spread) ---
    hyg = px.get("HYG")
    lqd = px.get("LQD")
    if hyg is not None and lqd is not None:
        ratio = hyg / lqd
        feats["hyg_lqd_ratio"] = ratio
        feats["hyg_lqd_5d_change"] = ratio.diff(5)

    # --- VIX & term structure ---
    vix = px.get("^VIX")
    vix3m = px.get("^VIX3M")
    if vix is not None:
        feats["vix_level"] = vix
        feats["vix_5d_change"] = vix.diff(5)
        if vix3m is not None:
            feats["vix_term_structure"] = vix - vix3m  # negative = backwardation

    # --- BTC ---
    btc = px.get("BTC-USD")
    spy = px.get("SPY")
    if btc is not None:
        feats["btc_5d_return"] = btc.pct_change(5)
        feats["btc_20d_return"] = btc.pct_change(20)
        if spy is not None:
            btc_ret = btc.pct_change(1)
            spy_ret = spy.pct_change(1)
            feats["btc_spy_corr_20d"] = btc_ret.rolling(20, min_periods=20).corr(spy_ret)

    return feats
