"""Cross-sectional features — per-date z-score and percentile rank across the universe.

The original per-symbol features (returns, RS-vs-SPY, MA distances, RSI, vol)
are all time-series statistics. On any given date they say "XLK was up 1.2%",
but the model can't easily tell whether 1.2% was good or bad RELATIVE to the
other 25 ETFs that day. For a ranker, the cross-sectional view is what
matters — XLK +1.2% on a day when the cross-section ranged [-3%, +2%] is
top-quintile; on a day ranging [0%, +4%] it's near the bottom.

For each base column we emit two transforms:
  <col>_xs_z:    (val − per-date mean) / per-date std   (z-score)
  <col>_xs_rank: per-date pct rank in [0, 1]            (rank)

Both are computed grouped by ts so today's distribution is what the symbol
gets compared against — no time-series contamination, no look-ahead.

Why both: the z-score preserves magnitude of cross-sectional outliers; the
percentile rank is robust to outliers and gives the tree a clean ordinal
split. XGBRanker can use whichever fits the gain at each node.

Base columns are those with the most cross-sectional signal for sector
rotation: momentum at multiple horizons, RS-vs-SPY, trend position, RSI,
realized vol, volume.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DEFAULT_BASE_COLS: tuple[str, ...] = (
    "return_5d",
    "return_10d",
    "return_20d",
    "return_60d",
    "rs_spy_5d",
    "rs_spy_20d",
    "dist_ma50",
    "dist_ma200",
    "dist_52w_high",
    "rsi_14",
    "realized_vol_20d",
    "volume_zscore_20d",
)

# Cap z-scores to keep extreme cross-sectional outliers from dominating
# downstream tree splits. 5σ on a 26-element distribution is well past the
# meaningful range; truncation here matches the clip patterns used elsewhere
# (e.g. xgb_baseline.predict tie-breaker clip).
_Z_CLIP = 5.0


def _xs_zscore(group: pd.Series) -> pd.Series:
    """Z-score within a per-date group. Std uses ddof=0 (population) — we want
    the *current* spread, not an estimator for a wider population, and ddof=1
    on a 26-element group inflates the denominator noticeably."""
    valid = group.dropna()
    if len(valid) < 4:
        return pd.Series(np.nan, index=group.index)
    mu = valid.mean()
    sd = valid.std(ddof=0)
    if sd == 0 or not np.isfinite(sd):
        return pd.Series(0.0, index=group.index).where(group.notna(), np.nan)
    z = (group - mu) / sd
    return z.clip(-_Z_CLIP, _Z_CLIP)


def _xs_pctrank(group: pd.Series) -> pd.Series:
    """Percentile rank within a per-date group, in [0, 1]. Ties get average rank."""
    return group.rank(pct=True, method="average")


def compute(
    sector_long: pd.DataFrame,
    base_cols: tuple[str, ...] = DEFAULT_BASE_COLS,
) -> pd.DataFrame:
    """Append `<col>_xs_z` and `<col>_xs_rank` columns to `sector_long`.

    Input: long-format DataFrame with ts, symbol, and the base columns.
    Output: same frame with the new columns appended; columns that are
    missing from `sector_long` are skipped silently.

    The function is a no-op (returns the input unchanged) if the frame is
    empty or contains <2 symbols per ts (cross-section needs ≥2 points).
    """
    if sector_long.empty or "ts" not in sector_long.columns:
        return sector_long

    out = sector_long.copy()
    present = [c for c in base_cols if c in out.columns]
    if not present:
        return out

    # Confirm there's actually a cross-section to compute over. If every date
    # has 1 symbol, z and rank are degenerate (z=NaN, rank=1.0) and add no
    # signal. Returning early keeps test fixtures clean.
    if out.groupby("ts").size().max() < 2:
        return out

    grouped = out.groupby("ts", sort=False)
    for col in present:
        out[f"{col}_xs_z"] = grouped[col].transform(_xs_zscore)
        out[f"{col}_xs_rank"] = grouped[col].transform(_xs_pctrank)

    return out
