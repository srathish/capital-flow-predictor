"""Per-ETF sector-target features (DESIGN.md §6.2).

Three-tier feature set:
  - Original 12 features (returns at multiple horizons, MA dist, RSI, RV, vol z, RS-vs-SPY, 52w-high)
  - Alpha158 port (49 features: 9 K-line + 40 rolling stats × 4 windows)
  - Macro sensitivity (12 features: rolling-60d beta + 5d-impact for 6 factors:
    10Y yield, 2s10s, DXY, WTI crude, HY OAS, VIX)

Total: ~73 per (date, symbol). The macro tier is what turns this from a
pure-momentum model into something that can discriminate sector exposure to
rate/dollar/credit/vol regimes — without it, broadcast macro features sit
constant within a date and are invisible to a rank model.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from cfp_features import alpha158


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi.replace([np.inf, -np.inf], np.nan)


def _rolling_beta(y: pd.Series, x: pd.Series, window: int = 60) -> pd.Series:
    """Rolling OLS slope of y on x over `window` observations.

    beta = cov(y, x) / var(x). NaN in either input is skipped via pandas'
    pairwise rolling. The result is the conventional "sensitivity": e.g.
    if y is XLU's daily return and x is daily ΔDGS10, beta is the expected
    XLU daily return per 1pp move in 10Y.
    """
    cov = y.rolling(window, min_periods=window).cov(x)
    var = x.rolling(window, min_periods=window).var()
    beta = cov / var
    return beta.replace([np.inf, -np.inf], np.nan)


# Macro factors expressed as the "innovation" series (daily change or pct change).
# Keyed by feature suffix; value is a callable that pulls and transforms the raw
# series. Same suffixes are reused for both beta_* and impact_* feature names.
def _factor_innovations(
    macro_factors: dict[str, pd.Series] | None,
) -> dict[str, tuple[pd.Series, pd.Series]]:
    """Resolve macro factors to (1d innovation, 5d innovation) pairs.

    Returns suffix -> (daily_change, 5d_change). Suffixes:
      dgs10  : ΔDGS10 in pp (level diff)
      twos10s: ΔT10Y2Y in pp
      dxy    : DXY pct change
      oil    : WTI pct change (DCOILWTICO)
      hyoas  : ΔBAMLH0A0HYM2 in pp
      vix    : ΔVIX in vol points

    Skips any factor whose underlying series isn't provided.
    """
    out: dict[str, tuple[pd.Series, pd.Series]] = {}
    if not macro_factors:
        return out

    def _level_diff(key: str, suffix: str) -> None:
        s = macro_factors.get(key)
        if s is not None and s.notna().any():
            out[suffix] = (s.diff(1), s.diff(5))

    def _pct(key: str, suffix: str) -> None:
        s = macro_factors.get(key)
        if s is not None and s.notna().any():
            out[suffix] = (s.pct_change(1), s.pct_change(5))

    _level_diff("DGS10", "dgs10")
    _level_diff("T10Y2Y", "twos10s")
    _pct("DXY", "dxy")
    _pct("WTI", "oil")
    _level_diff("HY_OAS", "hyoas")
    _level_diff("VIX", "vix")
    return out


def compute_for_symbol(
    close: pd.Series,
    volume: pd.Series | None,
    spy: pd.Series | None,
    open_: pd.Series | None = None,
    high: pd.Series | None = None,
    low: pd.Series | None = None,
    macro_factors: dict[str, pd.Series] | None = None,
) -> pd.DataFrame:
    """Compute per-symbol features for a single symbol's series.

    The original 12 features keep the same names (returns, MA distances, RSI,
    RV, volume z, RS-vs-SPY, 52w high) so existing trained models keep
    working. When OHLC is also provided, we additionally append the 49
    Alpha158-port features for a richer panel.
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

    # --- Alpha158 port (9 K-line + 40 rolling, only when OHLC available) ---
    if open_ is not None and high is not None and low is not None:
        a158 = alpha158.compute_for_symbol(open_, high, low, close)
        out = pd.concat([out, a158], axis=1)

    # --- Macro sensitivity: rolling-60d beta + 5d-impact per factor ---
    # Per-sector-per-date features (vary across ETFs even though the underlying
    # macro series is broadcast), so an XGBoost ranker can actually use them.
    daily_ret = close.pct_change(1)
    for suffix, (innov_1d, innov_5d) in _factor_innovations(macro_factors).items():
        innov_1d = innov_1d.reindex(close.index)
        innov_5d = innov_5d.reindex(close.index)
        beta = _rolling_beta(daily_ret, innov_1d, window=60)
        out[f"beta_{suffix}_60d"] = beta
        # Predicted 5d-ahead drag/lift from current factor move = beta × Δfactor.
        # Sign convention: positive impact means the recent macro move favors
        # this sector given its historical sensitivity.
        out[f"impact_{suffix}_5d"] = beta * innov_5d

    return out.replace([np.inf, -np.inf], np.nan)


def compute(
    prices_wide: pd.DataFrame,
    volumes_wide: pd.DataFrame | None,
    target_symbols: list[str],
    benchmark: str = "SPY",
    open_wide: pd.DataFrame | None = None,
    high_wide: pd.DataFrame | None = None,
    low_wide: pd.DataFrame | None = None,
    macro_factors: dict[str, pd.Series] | None = None,
) -> pd.DataFrame:
    """Compute features for every target symbol; return long-format DataFrame.

    Columns: ts, symbol, plus one column per feature. When the OHLC wide
    tables are passed, each symbol's row gets the 49 Alpha158 features
    appended; otherwise only the original 12 features are produced.
    """
    spy = prices_wide.get(benchmark)
    pieces: list[pd.DataFrame] = []
    for sym in target_symbols:
        if sym not in prices_wide.columns:
            continue
        vol = volumes_wide[sym] if volumes_wide is not None and sym in volumes_wide.columns else None
        op = open_wide[sym] if open_wide is not None and sym in open_wide.columns else None
        hi = high_wide[sym] if high_wide is not None and sym in high_wide.columns else None
        lo = low_wide[sym] if low_wide is not None and sym in low_wide.columns else None
        feats = compute_for_symbol(
            prices_wide[sym], vol, spy,
            open_=op, high=hi, low=lo,
            macro_factors=macro_factors,
        )
        feats = feats.reset_index().rename(columns={"index": "ts"})
        feats["symbol"] = sym
        pieces.append(feats)
    if not pieces:
        return pd.DataFrame()
    return pd.concat(pieces, ignore_index=True)
