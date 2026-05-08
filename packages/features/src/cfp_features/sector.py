"""Per-ETF sector-target features (DESIGN.md §6.2)."""

from __future__ import annotations

import numpy as np
import pandas as pd


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi.replace([np.inf, -np.inf], np.nan)


def compute_for_symbol(
    close: pd.Series,
    volume: pd.Series | None,
    spy: pd.Series | None,
) -> pd.DataFrame:
    """Compute per-symbol features for a single close-price series.

    Returns DataFrame indexed by ts with feature columns. All windows are
    point-in-time (`.rolling(min_periods=window)`).
    """
    out = pd.DataFrame(index=close.index)

    # --- Returns ---
    for n in (1, 5, 10, 20, 60):
        out[f"return_{n}d"] = close.pct_change(n)

    # --- Relative strength vs SPY ---
    if spy is not None:
        for n in (5, 20):
            out[f"rs_spy_{n}d"] = close.pct_change(n) - spy.pct_change(n)

    # --- Distance from MAs ---
    ma50 = close.rolling(50, min_periods=50).mean()
    ma200 = close.rolling(200, min_periods=200).mean()
    out["dist_ma50"] = (close - ma50) / ma50
    out["dist_ma200"] = (close - ma200) / ma200

    # --- 14d RSI ---
    out["rsi_14"] = _rsi(close, 14)

    # --- 20d realized vol (annualized) ---
    log_ret = np.log(close / close.shift(1))
    out["realized_vol_20d"] = (
        log_ret.rolling(20, min_periods=20).std() * np.sqrt(252)
    )

    # --- Volume z-score (20d) ---
    if volume is not None:
        v_mean = volume.rolling(20, min_periods=20).mean()
        v_std = volume.rolling(20, min_periods=20).std()
        z = (volume - v_mean) / v_std
        out["volume_zscore_20d"] = z.replace([np.inf, -np.inf], np.nan)

    # --- 52w distance from high ---
    high_252 = close.rolling(252, min_periods=63).max()
    out["dist_52w_high"] = (close / high_252) - 1.0

    return out.replace([np.inf, -np.inf], np.nan)


def compute(
    prices_wide: pd.DataFrame,
    volumes_wide: pd.DataFrame | None,
    target_symbols: list[str],
    benchmark: str = "SPY",
) -> pd.DataFrame:
    """Compute features for every target symbol; return long-format DataFrame.

    Columns: ts, symbol, plus one column per feature.
    """
    spy = prices_wide.get(benchmark)
    pieces: list[pd.DataFrame] = []
    for sym in target_symbols:
        if sym not in prices_wide.columns:
            continue
        vol = volumes_wide[sym] if volumes_wide is not None and sym in volumes_wide.columns else None
        feats = compute_for_symbol(prices_wide[sym], vol, spy)
        feats = feats.reset_index().rename(columns={"index": "ts"})
        feats["symbol"] = sym
        pieces.append(feats)
    if not pieces:
        return pd.DataFrame()
    return pd.concat(pieces, ignore_index=True)
