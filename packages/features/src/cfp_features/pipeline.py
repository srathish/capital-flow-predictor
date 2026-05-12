"""End-to-end feature pipeline: long-format DB rows -> cross-asset + sector feature DataFrames.

Pure computation. The cfp_jobs.features module wires this up to the database.
"""

from __future__ import annotations

import pandas as pd

from cfp_features import cross_asset, cross_sectional, dispersion, panel, sector


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
    # Open / High / Low pulled through so sector.compute can layer the
    # Alpha158-port K-line + rolling features on top of the originals.
    open_wide = panel.prices_to_wide(
        prices_long, calendar_symbol=calendar_symbol, value_col="open"
    )
    high_wide = panel.prices_to_wide(
        prices_long, calendar_symbol=calendar_symbol, value_col="high"
    )
    low_wide = panel.prices_to_wide(
        prices_long, calendar_symbol=calendar_symbol, value_col="low"
    )
    macro_wide = panel.macro_to_wide(macro_long)
    macro_aligned = panel.align_macro(macro_wide, prices_wide.index)

    # Macro factor inputs for the per-sector sensitivity features. Naming is
    # the canonical key used inside sector._factor_innovations; the underlying
    # series can be FRED (DGS10, T10Y2Y, DCOILWTICO, BAMLH0A0HYM2) or Yahoo
    # (DX-Y.NYB, ^VIX) — sector.py is source-agnostic.
    def _col(df: pd.DataFrame, name: str):
        return df[name] if name in df.columns else None

    macro_factors: dict[str, pd.Series] = {}
    for key, series in (
        ("DGS10",  _col(macro_aligned, "DGS10")),
        ("T10Y2Y", _col(macro_aligned, "T10Y2Y")),
        ("WTI",    _col(macro_aligned, "DCOILWTICO")),
        ("HY_OAS", _col(macro_aligned, "BAMLH0A0HYM2")),
        ("DXY",    _col(prices_wide,   "DX-Y.NYB")),
        ("VIX",    _col(prices_wide,   "^VIX")),
    ):
        if series is not None:
            macro_factors[key] = series

    cross_df = cross_asset.compute(prices_wide, macro_aligned)
    sector_df = sector.compute(
        prices_wide,
        volumes_wide,
        target_symbols,
        benchmark=benchmark,
        open_wide=open_wide,
        high_wide=high_wide,
        low_wide=low_wide,
        macro_factors=macro_factors,
    )

    # Cross-sectional transforms — per-date z-score and pct-rank of the
    # high-signal momentum / trend / RS-vs-SPY columns. Appended in place so
    # downstream persistence treats them as additional sector_v1 features.
    sector_df = cross_sectional.compute(sector_df)

    # Market dispersion / breadth — same value broadcast to every symbol on
    # the date, so they live at the cross-asset (per-ts) level. The ranker
    # sees them as scalar regime features, and the forward-call API uses
    # `xs_dispersion_z` to gate conviction when dispersion is low.
    disp_df = dispersion.compute(sector_df)
    if not disp_df.empty:
        # Avoid clobbering existing cross-asset columns if a future refactor
        # introduces a name collision; suffix='_disp' keeps the audit clean.
        cross_df = cross_df.join(disp_df, how="outer", rsuffix="_disp")

    return cross_df, sector_df
