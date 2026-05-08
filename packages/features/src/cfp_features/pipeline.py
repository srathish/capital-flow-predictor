"""End-to-end feature pipeline: long-format DB rows -> cross-asset + sector feature DataFrames.

Pure computation. The cfp_jobs.features module wires this up to the database.
"""

from __future__ import annotations

import pandas as pd

from cfp_features import cross_asset, panel, sector


def build(
    prices_long: pd.DataFrame,
    macro_long: pd.DataFrame,
    target_symbols: list[str],
    *,
    benchmark: str = "SPY",
    calendar_symbol: str = "SPY",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Run the full feature pipeline.

    Returns (cross_asset_df, sector_df):
      - cross_asset_df: indexed by ts, one row per date, columns are feature names
      - sector_df:      long-format with ts, symbol, and one column per feature
    """
    prices_wide = panel.prices_to_wide(
        prices_long, calendar_symbol=calendar_symbol, value_col="close"
    )
    volumes_wide = panel.prices_to_wide(
        prices_long, calendar_symbol=calendar_symbol, value_col="volume"
    )
    macro_wide = panel.macro_to_wide(macro_long)
    macro_aligned = panel.align_macro(macro_wide, prices_wide.index)

    cross_df = cross_asset.compute(prices_wide, macro_aligned)
    sector_df = sector.compute(
        prices_wide, volumes_wide, target_symbols, benchmark=benchmark
    )
    return cross_df, sector_df
