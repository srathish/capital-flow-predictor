"""Assemble the model panel: per (ts, symbol) row, join sector + cross-asset features.

Input: long-format feature rows from features_daily (or precomputed pandas DFs).
Output: wide DataFrame with one row per (ts, symbol), columns = all features + target.
"""

from __future__ import annotations

import pandas as pd


def features_long_to_wide(
    features_long: pd.DataFrame,
    market_sentinel: str = "_MARKET_",
    cross_asset_set: str = "cross_asset_v1",
    sector_set: str = "sector_v1",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split features_daily into (cross_asset_wide, sector_wide).

    cross_asset_wide: indexed by ts, columns = cross-asset feature names
    sector_wide:      long-format, ts + symbol + sector feature columns
    """
    if not {"ts", "symbol", "feature_set", "payload"}.issubset(features_long.columns):
        raise ValueError("features_long missing required columns")

    cross = features_long[
        (features_long["symbol"] == market_sentinel)
        & (features_long["feature_set"] == cross_asset_set)
    ]
    sector = features_long[features_long["feature_set"] == sector_set]

    def _expand(df: pd.DataFrame, keep: list[str]) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()
        payload_df = pd.json_normalize(df["payload"])
        payload_df.index = df.index
        return pd.concat([df[keep].reset_index(drop=True), payload_df.reset_index(drop=True)], axis=1)

    cross_wide = _expand(cross, ["ts"]).set_index("ts").sort_index() if not cross.empty else pd.DataFrame()
    sector_wide = _expand(sector, ["ts", "symbol"]).sort_values(["ts", "symbol"]).reset_index(drop=True) if not sector.empty else pd.DataFrame()
    return cross_wide, sector_wide


def build_panel(
    features_long: pd.DataFrame,
    targets_long: pd.DataFrame,
    horizon: int,
) -> tuple[pd.DataFrame, list[str]]:
    """Build the model panel for a single horizon.

    Returns (panel_df, feature_columns):
      panel_df has columns [ts, symbol, target, <feature_cols...>]
      Rows lacking a target (insufficient future data) are dropped.
    """
    cross_wide, sector_wide = features_long_to_wide(features_long)

    if sector_wide.empty:
        return pd.DataFrame(), []

    panel = sector_wide.merge(cross_wide, how="left", left_on="ts", right_index=True)

    h = targets_long[targets_long["horizon_d"] == horizon][["ts", "symbol", "target"]]
    panel = panel.merge(h, how="inner", on=["ts", "symbol"])
    panel = panel.sort_values(["ts", "symbol"]).reset_index(drop=True)

    feature_cols = [c for c in panel.columns if c not in {"ts", "symbol", "target"}]
    return panel, feature_cols
