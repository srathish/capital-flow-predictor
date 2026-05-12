"""Market-dispersion features — per-date cross-sectional spread across the universe.

The single most useful regime signal for a sector-rotation strategy: when
sector dispersion is low, all 26 ETFs move together and no rotation strategy
can extract alpha. When dispersion is high, the cross-section spreads out
and ranking has real predictive value.

We emit four time-series (indexed by ts, one row per date):
  xs_std_ret_5d    : cross-sectional std of 5d returns across the universe
  xs_std_ret_20d   : ditto, 20d
  xs_dispersion_z  : z-score of xs_std_ret_5d against its trailing 60d
                     distribution. Positive = wider than usual; negative =
                     tighter than usual. Stationary by construction so the
                     ranker can use it without retraining as vol regimes drift.
  xs_dispersion_regime : −1 / 0 / +1 tag from xs_dispersion_z thresholds.

Plus two breadth proxies (also cross-sectional, computed per ts):
  xs_pct_positive_ret_5d : fraction of ETFs with positive 5d return
  xs_pct_above_ma50      : fraction with close > 50d MA (needs `dist_ma50`
                           in the input frame; computed if present)

These are intended as cross-asset features (same value broadcast to every
symbol on the date), so they live at the panel level — the ranker sees them
as scalar regime features per date, and the synthesizer / forward-call route
uses `xs_dispersion_z` / `xs_dispersion_regime` to gate conviction.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Thresholds for the discretized regime tag. Calibrated to roughly tercile-
# split a typical year: |z| > 0.5 captures the more decisive ~30% of days,
# leaving ~40% in the neutral middle band. Tunable later if the live
# distribution shifts.
_REGIME_HIGH = 0.5
_REGIME_LOW = -0.5


def _xs_std(returns_per_date: pd.Series) -> float:
    """Population std of the cross-section. Returns NaN if <4 valid points."""
    v = returns_per_date.dropna()
    if len(v) < 4:
        return float("nan")
    return float(v.std(ddof=0))


def compute(
    sector_long: pd.DataFrame,
    *,
    rolling_z_window: int = 60,
) -> pd.DataFrame:
    """Compute dispersion + breadth time-series from a long-format sector frame.

    Expects columns: ts, symbol, return_5d, return_20d. `dist_ma50` is used
    when present (for the breadth proxy) and skipped otherwise.

    Returns a wide DataFrame indexed by ts with the columns documented above.
    Empty frame on empty input.
    """
    if sector_long.empty or "ts" not in sector_long.columns:
        return pd.DataFrame()

    grouped = sector_long.groupby("ts", sort=True)

    # Cross-sectional std of multi-day returns.
    out = pd.DataFrame(index=grouped.size().index)
    if "return_5d" in sector_long.columns:
        out["xs_std_ret_5d"] = grouped["return_5d"].apply(_xs_std)
    if "return_20d" in sector_long.columns:
        out["xs_std_ret_20d"] = grouped["return_20d"].apply(_xs_std)

    # Rolling z-score of the 5d-dispersion measure against its own trailing
    # distribution. Population std on the rolling window (ddof=0) for the
    # same reason as in cross_sectional.py — we want the actual realized
    # spread, not a sample estimator.
    if "xs_std_ret_5d" in out.columns:
        base = out["xs_std_ret_5d"]
        mu = base.rolling(rolling_z_window, min_periods=rolling_z_window // 2).mean()
        sd = base.rolling(rolling_z_window, min_periods=rolling_z_window // 2).std(ddof=0)
        z = (base - mu) / sd.replace(0.0, np.nan)
        out["xs_dispersion_z"] = z.clip(-5.0, 5.0)
        out["xs_dispersion_regime"] = np.where(
            out["xs_dispersion_z"] > _REGIME_HIGH, 1,
            np.where(out["xs_dispersion_z"] < _REGIME_LOW, -1, 0),
        ).astype(float)  # float so JSONB upsert doesn't choke on numpy ints
        # Where z is NaN (warmup), regime should also be NaN, not 0.
        out.loc[out["xs_dispersion_z"].isna(), "xs_dispersion_regime"] = np.nan

    # Breadth proxies — same date, what fraction of the universe is "up"?
    if "return_5d" in sector_long.columns:
        out["xs_pct_positive_ret_5d"] = grouped["return_5d"].apply(
            lambda s: float((s.dropna() > 0).mean()) if s.notna().any() else float("nan")
        )
    if "dist_ma50" in sector_long.columns:
        out["xs_pct_above_ma50"] = grouped["dist_ma50"].apply(
            lambda s: float((s.dropna() > 0).mean()) if s.notna().any() else float("nan")
        )

    out.index.name = "ts"
    return out


def regime_label(z: float | None) -> str:
    """Convert an `xs_dispersion_z` value to a human-readable regime tag.

    Used by the forward-call API to expose the regime in responses. Returns
    'unknown' for None / NaN so the UI can render it without special-casing.
    """
    if z is None or not np.isfinite(z):
        return "unknown"
    if z > _REGIME_HIGH:
        return "high_dispersion"
    if z < _REGIME_LOW:
        return "low_dispersion"
    return "normal_dispersion"
