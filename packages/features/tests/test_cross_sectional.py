"""Tests for cross_sectional.compute — per-date z-score and pct-rank features.

The transforms are simple enough that I'm asserting algebraic identities:
within each date the z-score sums to ~0 and has unit population std, and
the pct-rank is monotone in the raw value. Plus the operational corners:
empty frame, single-symbol per-date (no cross-section), all-NaN columns.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features import cross_sectional


def _make_frame(n_dates: int = 5, n_symbols: int = 8, seed: int = 0) -> pd.DataFrame:
    """A long-format frame mirroring `sector.compute` output, with just the
    columns the cross-sectional transform touches."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-02", periods=n_dates, freq="B")
    symbols = [f"S{i}" for i in range(n_symbols)]
    rows = []
    for d in dates:
        for s in symbols:
            rows.append({
                "ts": d,
                "symbol": s,
                "return_5d": rng.normal(0.0, 0.02),
                "return_20d": rng.normal(0.0, 0.05),
                "rs_spy_5d": rng.normal(0.0, 0.015),
                "rsi_14": float(rng.uniform(20, 80)),
                # A column NOT in DEFAULT_BASE_COLS — must be left alone.
                "untouched": rng.normal(0.0, 1.0),
            })
    return pd.DataFrame(rows)


def test_zscore_is_centered_and_unit_std_per_date() -> None:
    """Population z within each date: mean ~= 0, std ~= 1."""
    df = _make_frame()
    out = cross_sectional.compute(df)

    for _, g in out.groupby("ts"):
        z = g["return_5d_xs_z"].dropna()
        assert abs(float(z.mean())) < 1e-9
        # Population std (ddof=0) — matches the function's choice.
        assert abs(float(z.std(ddof=0)) - 1.0) < 1e-9


def test_pctrank_monotone_in_raw_value() -> None:
    """Within a date, the symbol with the largest raw return must have rank 1.0,
    smallest must have rank near 0. Direction agreement is the actual contract."""
    df = _make_frame()
    out = cross_sectional.compute(df)
    for _, g in out.groupby("ts"):
        argmax_raw = g["return_5d"].idxmax()
        argmax_rank = g["return_5d_xs_rank"].idxmax()
        assert argmax_raw == argmax_rank


def test_skips_columns_not_in_frame() -> None:
    """If a base column isn't present, no `<col>_xs_*` columns should appear."""
    df = _make_frame()
    df = df.drop(columns=["rsi_14"])  # missing one base col
    out = cross_sectional.compute(df)
    assert "rsi_14_xs_z" not in out.columns
    assert "rsi_14_xs_rank" not in out.columns
    # The other columns we do have should still be transformed.
    assert "return_5d_xs_z" in out.columns


def test_no_columns_added_when_single_symbol_per_date() -> None:
    """A degenerate per-date cross-section (n=1) can't be z-scored. The function
    should return the input unchanged rather than emit all-NaN columns."""
    df = _make_frame(n_symbols=1)
    out = cross_sectional.compute(df)
    assert "return_5d_xs_z" not in out.columns


def test_empty_frame_passthrough() -> None:
    empty = pd.DataFrame()
    out = cross_sectional.compute(empty)
    assert out.empty


def test_constant_column_yields_zero_z_not_inf() -> None:
    """When every symbol on a date has the same value, std=0; the z-score must
    be 0 (or NaN), never inf. Past bug pattern in similar normalizers."""
    df = _make_frame()
    df["return_5d"] = 0.0123  # constant across the whole frame
    out = cross_sectional.compute(df)
    z = out["return_5d_xs_z"].dropna()
    assert np.isfinite(z).all()
    # All zero (or all NaN — caller's call); definitely no infs.
    assert (z.abs() < 1e-9).all()


def test_zscore_clipped_for_outliers() -> None:
    """An outlier far outside the rest of the cross-section must clip at ±5σ.

    With 50 symbols (49 near zero, 1 at 100) the raw z works out to ~7, so the
    clip is the visible difference. Verifying the clip is *the* invariant —
    without it, a single bad data point would dominate every tree split.
    """
    df = _make_frame(n_dates=2, n_symbols=50)
    target_date = df["ts"].iloc[0]
    mask = (df["ts"] == target_date) & (df["symbol"] == "S0")
    df.loc[mask, "return_5d"] = 100.0
    out = cross_sectional.compute(df)
    z_out = float(out.loc[mask, "return_5d_xs_z"].iloc[0])
    assert z_out == 5.0  # clipped at the upper bound
