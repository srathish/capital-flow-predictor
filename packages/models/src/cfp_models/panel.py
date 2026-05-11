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
    breadth_set: str = "breadth_v1",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split features_daily into (cross_asset_wide, sector_wide).

    cross_asset_wide: indexed by ts, columns = cross-asset feature names
    sector_wide:      long-format, ts + symbol + sector feature columns,
                      with breadth_v1 merged in via per-symbol asof so each
                      sector row carries the most recent constituent-breadth
                      snapshot (refreshed daily, may lag sector ts by minutes).
    """
    if not {"ts", "symbol", "feature_set", "payload"}.issubset(features_long.columns):
        raise ValueError("features_long missing required columns")

    cross = features_long[
        (features_long["symbol"] == market_sentinel)
        & (features_long["feature_set"] == cross_asset_set)
    ]
    sector = features_long[features_long["feature_set"] == sector_set]
    breadth = features_long[features_long["feature_set"] == breadth_set]

    def _expand(df: pd.DataFrame, keep: list[str]) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()
        payload_df = pd.json_normalize(df["payload"])
        payload_df.index = df.index
        return pd.concat([df[keep].reset_index(drop=True), payload_df.reset_index(drop=True)], axis=1)

    cross_wide = _expand(cross, ["ts"]).set_index("ts").sort_index() if not cross.empty else pd.DataFrame()
    sector_wide = (
        _expand(sector, ["ts", "symbol"]).sort_values(["ts", "symbol"]).reset_index(drop=True)
        if not sector.empty else pd.DataFrame()
    )

    if not breadth.empty and not sector_wide.empty:
        breadth_wide = _expand(breadth, ["ts", "symbol"]).sort_values(["ts", "symbol"]).reset_index(drop=True)
        # Normalize ts to a single dtype/timezone so merge_asof matches cleanly.
        sector_wide["ts"] = pd.to_datetime(sector_wide["ts"], utc=True)
        breadth_wide["ts"] = pd.to_datetime(breadth_wide["ts"], utc=True)
        sector_wide = pd.merge_asof(
            sector_wide.sort_values("ts"),
            breadth_wide.sort_values("ts"),
            on="ts",
            by="symbol",
            direction="backward",
        ).sort_values(["ts", "symbol"]).reset_index(drop=True)

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


def build_scoring_panel(
    features_long: pd.DataFrame,
    reference_feature_cols: list[str],
) -> tuple[pd.DataFrame, pd.Timestamp | None]:
    """Build a single-date, target-free panel for live forward prediction.

    Unlike build_panel — which inner-joins targets and therefore drops every row
    where t+N is not yet observed — this returns the latest fully-populated
    feature snapshot per symbol. The caller scores this with a model trained on
    supervised history to produce a forward forecast for ts + horizon.

    Columns are aligned to reference_feature_cols (missing columns filled NaN)
    so the scoring matrix matches what the trained model saw.
    """
    cross_wide, sector_wide = features_long_to_wide(features_long)
    if sector_wide.empty:
        return pd.DataFrame(), None
    panel = sector_wide.merge(cross_wide, how="left", left_on="ts", right_index=True)
    if panel.empty:
        return pd.DataFrame(), None

    latest_ts = panel["ts"].max()
    latest = panel[panel["ts"] == latest_ts].copy()
    if latest.empty:
        return pd.DataFrame(), None

    for c in reference_feature_cols:
        if c not in latest.columns:
            latest[c] = float("nan")

    keep = ["ts", "symbol", *reference_feature_cols]
    return latest[keep].reset_index(drop=True), latest_ts
