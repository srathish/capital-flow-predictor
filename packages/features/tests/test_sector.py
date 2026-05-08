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
