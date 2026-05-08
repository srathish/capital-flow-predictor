"""Panel construction: long-format DB rows -> wide DataFrames for feature computation.

We align everything to a chosen calendar symbol's trading days (default SPY).
This avoids weekend BTC bars muddying correlations and ensures a single tradeable
business-day index.
"""

from __future__ import annotations

import pandas as pd


def prices_to_wide(
    prices_long: pd.DataFrame,
    calendar_symbol: str = "SPY",
    value_col: str = "close",
) -> pd.DataFrame:
    """Pivot prices_daily long rows to wide DataFrame.

    Index = ts (sorted ascending), columns = symbol, values = `value_col`.
    Restricted to dates where `calendar_symbol` traded.
    """
    if not {"ts", "symbol", value_col}.issubset(prices_long.columns):
        raise ValueError(f"prices_long missing required columns: {prices_long.columns!r}")

    df = prices_long.pivot(index="ts", columns="symbol", values=value_col).sort_index()
    if calendar_symbol in df.columns:
        df = df.loc[df[calendar_symbol].notna()]
    return df


def macro_to_wide(macro_long: pd.DataFrame) -> pd.DataFrame:
    """Pivot macro_daily long rows to wide DataFrame indexed by ts, columns = series_id."""
    if not {"ts", "series_id", "value"}.issubset(macro_long.columns):
        raise ValueError(f"macro_long missing required columns: {macro_long.columns!r}")
    return macro_long.pivot(index="ts", columns="series_id", values="value").sort_index()


def align_macro(macro_wide: pd.DataFrame, calendar_index: pd.Index) -> pd.DataFrame:
    """Align macro series to the equity calendar via reindex + forward-fill.

    FRED publishes some series with 1-day lag; ffill is the conservative
    point-in-time choice (use last-known value).
    """
    return macro_wide.reindex(calendar_index).ffill()
