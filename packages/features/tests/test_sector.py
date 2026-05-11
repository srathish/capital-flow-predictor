from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features.sector import _rsi, compute_for_symbol


def _synthetic_close(n_days: int = 300, seed: int = 0) -> pd.Series:
    rng = np.random.default_rng(seed)
    rets = rng.normal(loc=0.0005, scale=0.012, size=n_days)
    prices = 100.0 * np.exp(np.cumsum(rets))
    idx = pd.date_range("2023-01-02", periods=n_days, freq="B")
    return pd.Series(prices, index=idx, name="XLK")


def test_rsi_in_bounds() -> None:
    close = _synthetic_close()
    rsi = _rsi(close, 14)
    valid = rsi.dropna()
    assert (valid >= 0).all() and (valid <= 100).all()


def test_returns_consistent() -> None:
    close = _synthetic_close()
    feats = compute_for_symbol(close, volume=None, spy=None)
    # 5d return must equal cumulative product of 1d returns over 5 days
    expected = close.pct_change(5)
    pd.testing.assert_series_equal(
        feats["return_5d"], expected, check_names=False
    )


def test_realized_vol_positive() -> None:
    close = _synthetic_close()
    feats = compute_for_symbol(close, volume=None, spy=None)
    rv = feats["realized_vol_20d"].dropna()
    assert (rv > 0).all()


def test_dist_52w_high_nonpositive() -> None:
    """dist_52w_high = price/rolling_max - 1; must always be <= 0."""
    close = _synthetic_close()
    feats = compute_for_symbol(close, volume=None, spy=None)
    valid = feats["dist_52w_high"].dropna()
    assert (valid <= 1e-12).all()  # tolerate float noise


def test_no_columns_explode_on_empty() -> None:
    feats = compute_for_symbol(
        pd.Series([], dtype=float, index=pd.DatetimeIndex([])),
        volume=None,
        spy=None,
    )
    assert feats.empty


def test_macro_features_emit_beta_and_impact() -> None:
    """Sanity: when macro factors are passed in, the expected suffixes appear
    and beta values are finite once the 60d window has filled."""
    close = _synthetic_close(n_days=300, seed=1)
    # Construct factors with matching index. Use diff'able level series for
    # rate/credit/vol; pct-changeable level series for DXY/oil. Random walks
    # are fine for the test — we're checking shape + finiteness, not signal.
    rng = np.random.default_rng(42)
    idx = close.index
    factors = {
        "DGS10":  pd.Series(4.0 + np.cumsum(rng.normal(0, 0.01, len(idx))), index=idx),
        "T10Y2Y": pd.Series(0.5 + np.cumsum(rng.normal(0, 0.005, len(idx))), index=idx),
        "DXY":    pd.Series(100 + np.cumsum(rng.normal(0, 0.1, len(idx))), index=idx),
        "WTI":    pd.Series(75 + np.cumsum(rng.normal(0, 0.5, len(idx))), index=idx),
        "HY_OAS": pd.Series(3.5 + np.cumsum(rng.normal(0, 0.02, len(idx))), index=idx),
        "VIX":    pd.Series(18 + np.cumsum(rng.normal(0, 0.3, len(idx))), index=idx),
    }
    feats = compute_for_symbol(close, volume=None, spy=None, macro_factors=factors)

    expected_suffixes = ["dgs10", "twos10s", "dxy", "oil", "hyoas", "vix"]
    for suffix in expected_suffixes:
        assert f"beta_{suffix}_60d" in feats.columns, f"missing beta_{suffix}_60d"
        assert f"impact_{suffix}_5d" in feats.columns, f"missing impact_{suffix}_5d"

    # Once warmup is done (>= 60 obs), at least some beta values must be finite.
    tail = feats.iloc[-50:]
    for suffix in expected_suffixes:
        finite = tail[f"beta_{suffix}_60d"].replace([np.inf, -np.inf], np.nan).dropna()
        assert len(finite) > 0, f"beta_{suffix}_60d all NaN over last 50 rows"


def test_macro_features_skip_when_factor_missing() -> None:
    """If a factor isn't passed in, no beta/impact columns should appear for it."""
    close = _synthetic_close()
    factors = {
        "DGS10": pd.Series(4.0, index=close.index),  # constant -> var=0 -> NaN beta
    }
    feats = compute_for_symbol(close, volume=None, spy=None, macro_factors=factors)
    # Only DGS10 was provided; the other factor columns must not exist.
    for absent in ("twos10s", "dxy", "oil", "hyoas", "vix"):
        assert f"beta_{absent}_60d" not in feats.columns
        assert f"impact_{absent}_5d" not in feats.columns
    # DGS10 columns exist (even if all NaN due to zero variance).
    assert "beta_dgs10_60d" in feats.columns
    assert "impact_dgs10_5d" in feats.columns
