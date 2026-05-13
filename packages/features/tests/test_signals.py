"""Tests for insider, dark-pool, and reddit-velocity feature builders."""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features.signals import (
    dark_pool_volume_ratio,
    insider_net_buy_30d,
    reddit_mention_velocity,
)


def test_insider_net_buy_signs_correctly() -> None:
    txns = pd.DataFrame(
        {
            "transaction_date": pd.to_datetime(["2024-01-10", "2024-01-15", "2024-01-20"]),
            "ticker": ["NVDA", "NVDA", "NVDA"],
            "transaction_code": ["P", "S", "P"],
            "amount": [1000, 500, 200],
            "price": [100.0, 110.0, 120.0],
        }
    )
    out = insider_net_buy_30d(txns)
    # 1000*100 - 500*110 + 200*120 = 100000 - 55000 + 24000 = 69000
    last = out["NVDA"].iloc[-1]
    assert abs(last - 69000.0) < 1e-6


def test_insider_empty_returns_empty() -> None:
    assert insider_net_buy_30d(pd.DataFrame()).empty


def test_dark_pool_ratio_bounds_0_1() -> None:
    idx = pd.date_range("2024-01-01", periods=10, freq="D")
    prints = pd.DataFrame(
        {
            "ts": np.tile(idx, 1),
            "ticker": ["NVDA"] * 10,
            "dark_pool_dollars": [50.0] * 10,
        }
    )
    total = pd.DataFrame({"NVDA": [100.0] * 10}, index=idx)
    out = dark_pool_volume_ratio(prints, total)
    assert out["NVDA"].dropna().between(0.0, 1.0).all()
    # 5d rolling mean of 0.5/0.5/... == 0.5
    assert abs(out["NVDA"].dropna().iloc[-1] - 0.5) < 1e-6


def test_reddit_velocity_detects_uptrend() -> None:
    idx = pd.date_range("2024-01-01", periods=14, freq="D")
    counts = np.arange(1, 15)  # 1,2,...,14 — strictly increasing
    df = pd.DataFrame({"ts": idx, "ticker": ["NVDA"] * 14, "count": counts})
    out = reddit_mention_velocity(df, window=7)
    # Slope of 1..14 over any 7-day window with x_centered = -3..3 == 1.0
    last = out["NVDA"].iloc[-1]
    assert last > 0.5  # strong positive slope


def test_reddit_velocity_zero_for_flat() -> None:
    idx = pd.date_range("2024-01-01", periods=14, freq="D")
    df = pd.DataFrame({"ts": idx, "ticker": ["NVDA"] * 14, "count": [5] * 14})
    out = reddit_mention_velocity(df, window=7)
    assert abs(out["NVDA"].iloc[-1]) < 1e-9
