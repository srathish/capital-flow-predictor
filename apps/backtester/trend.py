"""Trend classification — pivot-based HH/HL detection.

Pine has ta.pivothigh/ta.pivotlow. We replicate with a rolling-window approach.

A pivot HIGH at index i = high[i] is the max of [i-N, i+N] (so confirmed N bars later).
A pivot LOW is symmetric.

Trend states:
  STRONG_UP   — last 2 pivot highs ascending AND last 2 pivot lows ascending
  WEAK_UP     — most recent pivot is higher than the one before but inconsistent
  STRONG_DOWN — last 2 pivot highs descending AND last 2 pivot lows descending
  WEAK_DOWN   — symmetric
  SIDEWAYS    — pivots oscillating in a range, no clear direction

Trend duration tagged in bars since the most recent trend state change.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def find_pivots(s: pd.Series, left: int = 5, right: int = 5, is_high: bool = True) -> pd.Series:
    """Return a series with pivot values at confirmed pivot bars, NaN elsewhere.

    A pivot at index i is confirmed at bar i+right (we shift the value forward).
    """
    window = left + right + 1
    if is_high:
        rolled = s.rolling(window, center=True).max()
    else:
        rolled = s.rolling(window, center=True).min()
    is_pivot = s == rolled
    # Shift so the pivot value appears `right` bars after the pivot bar
    # (matches Pine's confirmation timing)
    pivot_vals = s.where(is_pivot).shift(right)
    return pivot_vals


def classify_trend(df: pd.DataFrame, pivot_left: int = 5, pivot_right: int = 5) -> pd.DataFrame:
    """Add columns: pivot_high, pivot_low, last_ph, last_ph_prev, last_pl,
    last_pl_prev, trend_state, bars_in_trend.
    """
    out = df.copy()
    out["pivot_high"] = find_pivots(out["high"], pivot_left, pivot_right, is_high=True)
    out["pivot_low"] = find_pivots(out["low"], pivot_left, pivot_right, is_high=False)

    # Forward-fill last two pivot highs and lows
    out["last_ph"] = out["pivot_high"].ffill()
    out["last_ph_prev"] = out["pivot_high"].ffill().shift(1).where(out["pivot_high"].notna()).ffill()
    out["last_pl"] = out["pivot_low"].ffill()
    out["last_pl_prev"] = out["pivot_low"].ffill().shift(1).where(out["pivot_low"].notna()).ffill()

    # Trend classification — needs both PH and PL data
    hh = out["last_ph"] > out["last_ph_prev"]  # higher high
    lh = out["last_ph"] < out["last_ph_prev"]  # lower high
    hl = out["last_pl"] > out["last_pl_prev"]  # higher low
    ll = out["last_pl"] < out["last_pl_prev"]  # lower low

    out["trend_state"] = "SIDEWAYS"
    out.loc[hh & hl, "trend_state"] = "STRONG_UP"
    out.loc[lh & ll, "trend_state"] = "STRONG_DOWN"
    out.loc[hh & ~hl & ~ll, "trend_state"] = "WEAK_UP"
    out.loc[lh & ~hl & ~ll, "trend_state"] = "WEAK_DOWN"

    # Bars in current trend state
    changes = out["trend_state"] != out["trend_state"].shift(1)
    group = changes.cumsum()
    out["bars_in_trend"] = out.groupby(group).cumcount() + 1

    return out


if __name__ == "__main__":
    # Smoke test
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent))
    from data import load_ohlcv

    df = load_ohlcv("NVDA", period="2y")
    df = classify_trend(df, pivot_left=5, pivot_right=5)
    print(df[["close", "pivot_high", "pivot_low", "trend_state", "bars_in_trend"]].tail(30))
    print("\nTrend state distribution:")
    print(df["trend_state"].value_counts())
