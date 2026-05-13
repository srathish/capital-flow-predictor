"""Regime detector behavior tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features.regime import label_regimes


def _make_px(n: int = 300, spy_path: np.ndarray | None = None, vix: float = 15.0) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    if spy_path is None:
        # Rising SPY — ensures 50d and 200d MAs are below price.
        spy_path = np.linspace(400.0, 500.0, n)
    return pd.DataFrame({"SPY": spy_path, "^VIX": np.full(n, vix)}, index=idx)


def test_uptrend_low_vix_labels_bull() -> None:
    df = _make_px(vix=12.0)
    out = label_regimes(df)
    # Need enough history for 200d MA; check the tail.
    last = out.iloc[-1]
    assert last["regime"] == "bull"
    assert last["risk_multiplier"] == 1.0


def test_high_vix_labels_bear() -> None:
    df = _make_px(vix=35.0)
    out = label_regimes(df)
    assert out.iloc[-1]["regime"] == "bear"
    assert out.iloc[-1]["risk_multiplier"] == 0.0


def test_downtrend_labels_bear() -> None:
    n = 300
    # Falling SPY — price below the rising-then-flat 200d MA.
    spy = np.concatenate([np.linspace(400.0, 600.0, 200), np.linspace(600.0, 350.0, n - 200)])
    df = _make_px(n=n, spy_path=spy, vix=15.0)
    out = label_regimes(df)
    assert out.iloc[-1]["regime"] == "bear"


def test_missing_vix_falls_back_to_trend() -> None:
    df = _make_px()
    df = df.drop(columns=["^VIX"])
    out = label_regimes(df)
    # Rising SPY with no VIX info should still resolve to bull (vix_ok defaults True).
    assert out.iloc[-1]["regime"] == "bull"


def test_breadth_below_floor_forces_bear() -> None:
    df = _make_px(vix=15.0)
    breadth = pd.DataFrame({"pct_above_50d": np.full(len(df), 0.10)}, index=df.index)
    out = label_regimes(df, breadth=breadth)
    assert out.iloc[-1]["regime"] == "bear"


def test_requires_spy() -> None:
    df = pd.DataFrame({"QQQ": [1.0, 2.0, 3.0]}, index=pd.date_range("2024-01-01", periods=3))
    try:
        label_regimes(df)
    except ValueError as e:
        assert "SPY" in str(e)
    else:
        raise AssertionError("expected ValueError for missing SPY")
