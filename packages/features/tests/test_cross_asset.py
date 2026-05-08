from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features.cross_asset import compute


def _panel(n: int = 250, seed: int = 1) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-02", periods=n, freq="B")

    def walk(start: float, vol: float) -> pd.Series:
        rets = rng.normal(0.0, vol, size=n)
        return pd.Series(start * np.exp(np.cumsum(rets)), index=idx)

    px = pd.DataFrame(
        {
            "DX-Y.NYB": walk(103.0, 0.005),
            "GLD": walk(180.0, 0.008),
            "USO": walk(70.0, 0.018),
            "HG=F": walk(4.0, 0.015),
            "HYG": walk(78.0, 0.005),
            "LQD": walk(110.0, 0.005),
            "^VIX": pd.Series(rng.uniform(12, 24, n), index=idx),
            "^VIX3M": pd.Series(rng.uniform(14, 24, n), index=idx),
            "BTC-USD": walk(45000.0, 0.03),
            "SPY": walk(450.0, 0.01),
        }
    )
    macro = pd.DataFrame(
        {
            "DGS10": pd.Series(rng.uniform(3.5, 5.0, n), index=idx),
            "T10Y2Y": pd.Series(rng.uniform(-0.5, 0.5, n), index=idx),
            "BAMLH0A0HYM2": pd.Series(rng.uniform(2.5, 5.5, n), index=idx),
        }
    )
    return px, macro


def test_compute_produces_expected_columns() -> None:
    px, macro = _panel()
    feats = compute(px, macro)
    expected_subset = {
        "dxy_5d_return",
        "ten_y_level",
        "ten_y_20d_delta",
        "copper_gold_ratio",
        "vix_level",
        "vix_term_structure",
        "btc_5d_return",
        "btc_spy_corr_20d",
        "hyg_lqd_5d_change",
        "hy_oas",
    }
    assert expected_subset.issubset(feats.columns), (
        f"missing: {expected_subset - set(feats.columns)}"
    )


def test_btc_corr_in_unit_interval() -> None:
    px, macro = _panel()
    feats = compute(px, macro)
    corr = feats["btc_spy_corr_20d"].dropna()
    assert (corr >= -1).all() and (corr <= 1).all()


def test_handles_missing_symbols() -> None:
    """Cross-asset must not crash if a symbol is absent."""
    px, macro = _panel()
    # Drop everything except SPY
    feats = compute(px[["SPY"]], macro)
    # No symbol-derived feature should appear; doesn't crash
    assert "dxy_5d_return" not in feats.columns
    assert "vix_level" not in feats.columns
    # And we get an empty-ish frame back
    assert feats.shape[0] == len(px)
