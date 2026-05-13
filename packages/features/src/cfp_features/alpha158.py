"""Alpha158-inspired feature library — port of Microsoft Qlib's Alpha158 spec.

Original: https://github.com/microsoft/qlib/blob/main/qlib/contrib/data/handler.py

We do NOT depend on qlib (heavy — pulls TensorFlow + Torch). This is a clean
port of the most useful subset for sector-rotation ranking, scaled to our
universe (~26 ETFs across years of daily bars).

Two families:

  K-line features (9, per-bar)
    KMID, KLEN, KMID2, KUP, KUP2, KLOW, KLOW2, KSFT, KSFT2 — candle shape
    encoded as ratios. Self-normalized by either open price or full range.

  Rolling features (10 features × 4 windows = 40)
    For W ∈ {5, 10, 20, 60}:
      MA, STD, MAX, MIN, QTLU, QTLD, RSV, RANK, IMAX, IMIN

    All ratios to current close (or argmax/argmin recency normalized to W),
    so they are scale-invariant and comparable across symbols.

Total: 49 new features per symbol per day. Combined with the existing
sector.compute_for_symbol output (~12 features), the panel jumps from
~12 to ~61 features per (date, symbol) cell — enough for the XGB ranker
to actually discriminate names rather than collapsing to 3 score buckets.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Numerical safety: prevent /0 when high == low or std == 0.
_EPS = 1e-12


def kline_features(
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
) -> pd.DataFrame:
    """The 9 K-line features (per-bar candle shape)."""
    out = pd.DataFrame(index=close.index)
    rng = (high - low).clip(lower=_EPS)
    upper_body = pd.concat([open_, close], axis=1).max(axis=1)
    lower_body = pd.concat([open_, close], axis=1).min(axis=1)

    out["KMID"] = (close - open_) / open_                           # body magnitude
    out["KLEN"] = (high - low) / open_                              # full bar range
    out["KMID2"] = (close - open_) / rng                            # body / range
    out["KUP"] = (high - upper_body) / open_                        # upper shadow / open
    out["KUP2"] = (high - upper_body) / rng                         # upper shadow / range
    out["KLOW"] = (lower_body - low) / open_                        # lower shadow / open
    out["KLOW2"] = (lower_body - low) / rng                         # lower shadow / range
    out["KSFT"] = (2 * close - high - low) / open_                  # close skew vs range
    out["KSFT2"] = (2 * close - high - low) / rng                   # ditto, normalized to range

    return out.replace([np.inf, -np.inf], np.nan)


def rolling_features(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    windows: tuple[int, ...] = (5, 10, 20, 60),
) -> pd.DataFrame:
    """For each window W, produce 10 rolling features. All scale-invariant
    (ratios to close, or position-in-window for argmax/argmin).
    """
    out = pd.DataFrame(index=close.index)

    for w in windows:
        roll_close = close.rolling(w, min_periods=w)
        roll_high = high.rolling(w, min_periods=w)
        roll_low = low.rolling(w, min_periods=w)

        ma = roll_close.mean()
        std = roll_close.std()
        cmax = roll_close.max()
        cmin = roll_close.min()
        cmax_h = roll_high.max()
        cmin_l = roll_low.min()

        out[f"MA_{w}"] = ma / close                                 # MA position (1 = on MA)
        out[f"STD_{w}"] = std / close                               # vol (normalized)
        out[f"MAX_{w}"] = cmax / close                              # how far below window-max
        out[f"MIN_{w}"] = cmin / close                              # how far above window-min

        # Quantile band — distance to the W-window 80th and 20th percentiles
        out[f"QTLU_{w}"] = roll_close.quantile(0.80) / close
        out[f"QTLD_{w}"] = roll_close.quantile(0.20) / close

        # RSV (Raw Stochastic Value): position of close in window range
        rng = (cmax_h - cmin_l).clip(lower=_EPS)
        out[f"RSV_{w}"] = (close - cmin_l) / rng

        # The lambdas below close over `w`, but `.apply()` runs them
        # synchronously inside this iteration — there's no deferred execution,
        # so the loop-variable capture is safe. (Silences B023.)

        # Rank within window (0 = lowest, 1 = highest of the W bars)
        out[f"RANK_{w}"] = roll_close.apply(
            lambda x: float(pd.Series(x).rank(pct=True).iloc[-1]) if len(x) == w else np.nan,  # noqa: B023
            raw=False,
        )

        # Recency of window-max / window-min — distance from current bar (0 = today, 1 = W-1 bars ago)
        out[f"IMAX_{w}"] = roll_high.apply(
            lambda x: float((len(x) - 1 - np.argmax(x)) / max(len(x) - 1, 1)) if len(x) == w else np.nan,  # noqa: B023
            raw=True,
        )
        out[f"IMIN_{w}"] = roll_low.apply(
            lambda x: float((len(x) - 1 - np.argmin(x)) / max(len(x) - 1, 1)) if len(x) == w else np.nan,  # noqa: B023
            raw=True,
        )

    return out.replace([np.inf, -np.inf], np.nan)


def compute_for_symbol(
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
) -> pd.DataFrame:
    """Top-level: combine K-line + rolling features for one symbol's OHLC series.

    Returns a DataFrame indexed by ts with all 49 Alpha158 features.
    """
    parts = [
        kline_features(open_, high, low, close),
        rolling_features(high, low, close),
    ]
    return pd.concat(parts, axis=1)
