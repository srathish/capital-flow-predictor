"""Tests for dispersion.compute — cross-sectional spread + regime tag.

The regime tag is the operational contract: when the cross-section is tight,
z should be negative; when it widens, z should be positive. We construct two
regimes in one synthetic frame and assert the regime sign flips correctly.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_features import dispersion


def _make_frame(
    n_dates: int,
    n_symbols: int = 12,
    spread_schedule: list[float] | None = None,
    seed: int = 0,
) -> pd.DataFrame:
    """Long-format frame with `ts, symbol, return_5d, return_20d, dist_ma50`.

    `spread_schedule[i]` controls the cross-sectional std of return_5d at
    date i — varying it lets us simulate calm vs choppy regimes.
    """
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-02", periods=n_dates, freq="B")
    symbols = [f"S{i}" for i in range(n_symbols)]
    spread_schedule = spread_schedule or [0.02] * n_dates

    rows = []
    for i, d in enumerate(dates):
        sigma = spread_schedule[i]
        rets5 = rng.normal(0.0, sigma, n_symbols)
        rets20 = rng.normal(0.0, sigma * 2, n_symbols)
        ma_dist = rng.normal(0.0, 0.05, n_symbols)
        for j, s in enumerate(symbols):
            rows.append({
                "ts": d,
                "symbol": s,
                "return_5d": float(rets5[j]),
                "return_20d": float(rets20[j]),
                "dist_ma50": float(ma_dist[j]),
            })
    return pd.DataFrame(rows)


def test_emits_expected_columns() -> None:
    df = _make_frame(n_dates=120)
    out = dispersion.compute(df)
    for col in (
        "xs_std_ret_5d", "xs_std_ret_20d",
        "xs_dispersion_z", "xs_dispersion_regime",
        "xs_pct_positive_ret_5d", "xs_pct_above_ma50",
    ):
        assert col in out.columns, f"missing column {col}"


def test_z_sign_flips_between_calm_and_choppy_regimes() -> None:
    """Build a frame with 80 calm dates followed by 20 wild dates. The z-score
    on the wild dates must end up positive (wider than baseline)."""
    schedule = [0.005] * 80 + [0.05] * 20
    df = _make_frame(n_dates=len(schedule), spread_schedule=schedule)
    out = dispersion.compute(df)
    # Drop warmup (NaN z while the rolling window fills).
    z = out["xs_dispersion_z"].dropna()
    # Last 10 dates are deep in the wild regime; their z should be strongly positive.
    tail = z.iloc[-10:]
    assert tail.mean() > 1.0, f"expected high positive z in choppy tail, got {tail.mean()}"


def test_regime_label_thresholds() -> None:
    assert dispersion.regime_label(1.0) == "high_dispersion"
    assert dispersion.regime_label(0.0) == "normal_dispersion"
    assert dispersion.regime_label(-1.0) == "low_dispersion"
    assert dispersion.regime_label(None) == "unknown"
    assert dispersion.regime_label(float("nan")) == "unknown"


def test_breadth_in_unit_interval() -> None:
    """pct_positive_ret_5d and pct_above_ma50 are fractions in [0, 1]."""
    df = _make_frame(n_dates=30)
    out = dispersion.compute(df)
    for col in ("xs_pct_positive_ret_5d", "xs_pct_above_ma50"):
        vals = out[col].dropna()
        assert ((vals >= 0.0) & (vals <= 1.0)).all()


def test_empty_input_returns_empty_frame() -> None:
    out = dispersion.compute(pd.DataFrame())
    assert out.empty


def test_regime_is_nan_during_warmup_not_zero() -> None:
    """During the rolling-window warmup, regime must be NaN — not 0 (which
    would be falsely labeled 'normal_dispersion' downstream)."""
    df = _make_frame(n_dates=10)  # well below the 60d rolling window
    out = dispersion.compute(df)
    assert out["xs_dispersion_regime"].isna().all()
