"""Price-action + volume features for the Delphi composer.

The user's framing: "price action and volume matter a lot." This module turns
the prices_daily history (which we already store for every universe ticker)
into ~50 numeric features per ticker. Output is a flat dict the composer
merges into delphi_features.features (JSONB).

Features fall into three groups:

  RETURNS / TREND (~14)
    ret_1d, ret_5d, ret_20d, ret_60d, ret_252d
    ret_vs_spy_5d/20d/60d  (relative strength)
    ma_20_distance, ma_50_distance, ma_200_distance
    ma_20_slope_10d, ma_50_slope_10d, dist_52w_high, dist_52w_low

  OSCILLATORS (~13)
    rsi_14, macd, macd_signal, macd_histogram, adx_14,
    bb_pct_position, bb_width, atr_14, atr_pct,
    williams_r_14, stoch_k, stoch_d, cci_20

  VOLUME / FLOW (~13)
    volume_5d_avg, volume_30d_avg, volume_vs_5d, volume_vs_30d,
    volume_z_30d, dollar_volume_5d, obv_slope_20, ad_line_slope_20,
    vwap_distance_20, up_down_volume_ratio_5d, highest_volume_day_5d,
    volume_price_correlation_20, gap_pct_today

  STRUCTURE (~5)
    consec_up_days, consec_down_days, inside_bar_5d_count,
    outside_bar_5d_count, price_percentile_252

Cost: one SELECT per ticker pulling 260 daily bars. Indexed access to
prices_daily(symbol, ts) makes this microseconds per ticker.

Math:
  - Standard TA-Lib equivalents. No third-party TA lib added; pandas + numpy
    do the lift. Hand-rolled to keep behavior predictable and to avoid
    pulling in `ta` (which has had a bad habit of changing column names).
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd
import psycopg

log = logging.getLogger(__name__)


# Reference benchmark for relative strength. SPY is what prices_daily
# already tracks for the rest of the system.
BENCHMARK = "SPY"


def _load_bars(conn: psycopg.Connection, ticker: str, n: int = 260) -> pd.DataFrame | None:
    """Pull the last `n` daily bars for `ticker`. Returns None if too sparse."""
    try:
        rows = conn.execute(
            """
            SELECT ts::date, MAX(high) AS high, MIN(low) AS low,
                   (ARRAY_AGG(close ORDER BY source DESC))[1] AS close,
                   (ARRAY_AGG(open  ORDER BY source DESC))[1] AS open,
                   SUM(volume) AS volume
            FROM prices_daily
            WHERE symbol = %s
              AND ts >= NOW() - INTERVAL '500 days'
              AND close IS NOT NULL
            GROUP BY ts::date
            ORDER BY ts DESC
            LIMIT %s
            """,
            (ticker, n),
        ).fetchall()
    except Exception as e:  # noqa: BLE001
        log.debug("price_action load failed for %s: %s", ticker, e)
        return None
    if not rows or len(rows) < 30:
        return None
    df = pd.DataFrame(rows, columns=["date", "high", "low", "close", "open", "volume"])
    df = df.sort_values("date").reset_index(drop=True)
    for col in ("high", "low", "close", "open", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _ret(series: pd.Series, n: int) -> float | None:
    if len(series) <= n or series.iloc[-n - 1] in (None, 0) or pd.isna(series.iloc[-n - 1]):
        return None
    return float(series.iloc[-1] / series.iloc[-n - 1] - 1.0)


def _ma_distance(price: float, ma: pd.Series, lookback: int) -> float | None:
    if len(ma) < lookback or pd.isna(ma.iloc[-1]) or ma.iloc[-1] == 0:
        return None
    return float(price / ma.iloc[-1] - 1.0)


def _ma_slope(ma: pd.Series, window: int) -> float | None:
    if len(ma) < window + 1 or pd.isna(ma.iloc[-1]) or pd.isna(ma.iloc[-window - 1]) or ma.iloc[-window - 1] == 0:
        return None
    return float(ma.iloc[-1] / ma.iloc[-window - 1] - 1.0)


def _rsi(close: pd.Series, period: int = 14) -> float | None:
    if len(close) < period + 1:
        return None
    delta = close.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    # Wilder smoothing
    avg_up = up.ewm(alpha=1 / period, adjust=False).mean()
    avg_down = down.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_up / avg_down.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    val = rsi.iloc[-1]
    return float(val) if not pd.isna(val) else None


def _macd(close: pd.Series) -> tuple[float | None, float | None, float | None]:
    if len(close) < 35:
        return (None, None, None)
    ema_12 = close.ewm(span=12, adjust=False).mean()
    ema_26 = close.ewm(span=26, adjust=False).mean()
    macd = ema_12 - ema_26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    return (
        float(macd.iloc[-1]) if not pd.isna(macd.iloc[-1]) else None,
        float(signal.iloc[-1]) if not pd.isna(signal.iloc[-1]) else None,
        float(hist.iloc[-1]) if not pd.isna(hist.iloc[-1]) else None,
    )


def _bollinger(close: pd.Series, period: int = 20) -> tuple[float | None, float | None]:
    if len(close) < period:
        return (None, None)
    mid = close.rolling(period).mean()
    sd = close.rolling(period).std()
    upper = mid + 2 * sd
    lower = mid - 2 * sd
    last = close.iloc[-1]
    u, l = upper.iloc[-1], lower.iloc[-1]
    if pd.isna(u) or pd.isna(l) or (u - l) == 0:
        return (None, None)
    pct_b = float((last - l) / (u - l))
    width = float((u - l) / mid.iloc[-1]) if not pd.isna(mid.iloc[-1]) and mid.iloc[-1] != 0 else None
    return (pct_b, width)


def _atr(df: pd.DataFrame, period: int = 14) -> tuple[float | None, float | None]:
    if len(df) < period + 1:
        return (None, None)
    h, l, c = df["high"], df["low"], df["close"]
    prev_c = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / period, adjust=False).mean()
    val = atr.iloc[-1]
    if pd.isna(val):
        return (None, None)
    last_close = c.iloc[-1]
    return (float(val), float(val / last_close) if last_close else None)


def _adx(df: pd.DataFrame, period: int = 14) -> float | None:
    if len(df) < period * 2:
        return None
    h, l, c = df["high"], df["low"], df["close"]
    up_move = h.diff()
    down_move = -l.diff()
    plus_dm = ((up_move > down_move) & (up_move > 0)).astype(float) * up_move
    minus_dm = ((down_move > up_move) & (down_move > 0)).astype(float) * down_move
    prev_c = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / period, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr.replace(0, np.nan)
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = dx.ewm(alpha=1 / period, adjust=False).mean()
    val = adx.iloc[-1]
    return float(val) if not pd.isna(val) else None


def _williams_r(df: pd.DataFrame, period: int = 14) -> float | None:
    if len(df) < period:
        return None
    h = df["high"].rolling(period).max()
    l = df["low"].rolling(period).min()
    c = df["close"]
    wr = -100 * (h.iloc[-1] - c.iloc[-1]) / (h.iloc[-1] - l.iloc[-1]) if h.iloc[-1] != l.iloc[-1] else None
    return float(wr) if wr is not None else None


def _stoch(df: pd.DataFrame, k_period: int = 14, d_period: int = 3) -> tuple[float | None, float | None]:
    if len(df) < k_period + d_period:
        return (None, None)
    h = df["high"].rolling(k_period).max()
    l = df["low"].rolling(k_period).min()
    c = df["close"]
    k_raw = 100 * (c - l) / (h - l).replace(0, np.nan)
    d_smooth = k_raw.rolling(d_period).mean()
    return (
        float(k_raw.iloc[-1]) if not pd.isna(k_raw.iloc[-1]) else None,
        float(d_smooth.iloc[-1]) if not pd.isna(d_smooth.iloc[-1]) else None,
    )


def _cci(df: pd.DataFrame, period: int = 20) -> float | None:
    if len(df) < period:
        return None
    tp = (df["high"] + df["low"] + df["close"]) / 3
    sma = tp.rolling(period).mean()
    mad = tp.rolling(period).apply(lambda s: (s - s.mean()).abs().mean(), raw=False)
    cci = (tp - sma) / (0.015 * mad.replace(0, np.nan))
    val = cci.iloc[-1]
    return float(val) if not pd.isna(val) else None


def _obv_slope(df: pd.DataFrame, window: int = 20) -> float | None:
    if len(df) < window + 1:
        return None
    direction = np.sign(df["close"].diff().fillna(0))
    obv = (direction * df["volume"]).cumsum()
    if len(obv) < window + 1:
        return None
    y = obv.iloc[-window:].values
    x = np.arange(window)
    if np.std(y) == 0:
        return 0.0
    slope = np.polyfit(x, y, 1)[0]
    return float(slope / max(1.0, np.mean(np.abs(y))))  # normalized


def _ad_line_slope(df: pd.DataFrame, window: int = 20) -> float | None:
    if len(df) < window + 1:
        return None
    h, l, c, v = df["high"], df["low"], df["close"], df["volume"]
    rng = (h - l).replace(0, np.nan)
    mfm = ((c - l) - (h - c)) / rng
    mfv = mfm * v
    ad = mfv.cumsum().fillna(method="ffill")
    if len(ad) < window + 1:
        return None
    y = ad.iloc[-window:].values
    x = np.arange(window)
    if np.std(y) == 0:
        return 0.0
    slope = np.polyfit(x, y, 1)[0]
    return float(slope / max(1.0, np.mean(np.abs(y))))


def _vwap_distance(df: pd.DataFrame, window: int = 20) -> float | None:
    if len(df) < window:
        return None
    sub = df.iloc[-window:]
    tp = (sub["high"] + sub["low"] + sub["close"]) / 3
    vwap = (tp * sub["volume"]).sum() / sub["volume"].sum() if sub["volume"].sum() > 0 else None
    if vwap is None or vwap == 0:
        return None
    return float(df["close"].iloc[-1] / vwap - 1.0)


def _up_down_volume_ratio(df: pd.DataFrame, window: int = 5) -> float | None:
    if len(df) < window + 1:
        return None
    sub = df.iloc[-window:]
    direction = np.sign(sub["close"].diff().fillna(0))
    up_v = sub["volume"][direction > 0].sum()
    down_v = sub["volume"][direction < 0].sum()
    if down_v == 0:
        return None
    return float(up_v / down_v)


def _vol_price_corr(df: pd.DataFrame, window: int = 20) -> float | None:
    if len(df) < window:
        return None
    sub = df.iloc[-window:]
    if sub["volume"].std() == 0 or sub["close"].std() == 0:
        return 0.0
    return float(sub["close"].pct_change().corr(sub["volume"].pct_change()))


def _consec_days(close: pd.Series, direction: int) -> int:
    """Number of consecutive recent days where sign(diff) == direction."""
    diff = close.diff()
    n = 0
    for v in diff.iloc[::-1]:
        if pd.isna(v):
            break
        if (direction == 1 and v > 0) or (direction == -1 and v < 0):
            n += 1
        else:
            break
    return n


def _inside_outside_bars(df: pd.DataFrame, window: int = 5) -> tuple[int, int]:
    if len(df) < window + 1:
        return (0, 0)
    sub = df.iloc[-window - 1:].reset_index(drop=True)
    inside = outside = 0
    for i in range(1, len(sub)):
        prev_hi, prev_lo = sub.loc[i - 1, "high"], sub.loc[i - 1, "low"]
        cur_hi, cur_lo = sub.loc[i, "high"], sub.loc[i, "low"]
        if cur_hi <= prev_hi and cur_lo >= prev_lo:
            inside += 1
        elif cur_hi > prev_hi and cur_lo < prev_lo:
            outside += 1
    return (inside, outside)


def _gap_today(df: pd.DataFrame) -> float | None:
    if len(df) < 2:
        return None
    prev_close = df["close"].iloc[-2]
    today_open = df["open"].iloc[-1]
    if not prev_close or pd.isna(today_open) or pd.isna(prev_close):
        return None
    return float(today_open / prev_close - 1.0)


def _price_percentile_252(close: pd.Series) -> float | None:
    if len(close) < 60:
        return None
    sub = close.iloc[-252:] if len(close) >= 252 else close
    last = sub.iloc[-1]
    rank = (sub <= last).sum() / len(sub)
    return float(rank)


def compute(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """Compute all price-action + volume features for `ticker`.

    Returns an empty dict if there's not enough history to compute anything
    meaningful (< 30 bars). Otherwise returns a flat dict of ~50 keys.
    """
    df = _load_bars(conn, ticker)
    if df is None:
        return {}
    close = df["close"]
    volume = df["volume"]
    last_close = float(close.iloc[-1])

    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    ma200 = close.rolling(200).mean()

    macd, macd_sig, macd_hist = _macd(close)
    bb_pct, bb_width = _bollinger(close)
    atr, atr_pct = _atr(df)
    stoch_k, stoch_d = _stoch(df)
    inside_n, outside_n = _inside_outside_bars(df)

    # Relative strength vs SPY
    rs = {"ret_vs_spy_5d": None, "ret_vs_spy_20d": None, "ret_vs_spy_60d": None}
    if ticker.upper() != BENCHMARK:
        spy_df = _load_bars(conn, BENCHMARK, n=70)
        if spy_df is not None:
            spy_close = spy_df["close"]
            for n, key in ((5, "ret_vs_spy_5d"), (20, "ret_vs_spy_20d"), (60, "ret_vs_spy_60d")):
                r_t = _ret(close, n)
                r_s = _ret(spy_close, n)
                if r_t is not None and r_s is not None:
                    rs[key] = r_t - r_s

    high_252 = close.iloc[-252:].max() if len(close) >= 60 else None
    low_252 = close.iloc[-252:].min() if len(close) >= 60 else None
    dist_hi = float(last_close / high_252 - 1.0) if high_252 else None
    dist_lo = float(last_close / low_252 - 1.0) if low_252 else None

    vol_5 = float(volume.iloc[-5:].mean()) if len(volume) >= 5 else None
    vol_30 = float(volume.iloc[-30:].mean()) if len(volume) >= 30 else None
    vol_today = float(volume.iloc[-1])
    vol_z = None
    if len(volume) >= 30:
        m, s = volume.iloc[-30:].mean(), volume.iloc[-30:].std()
        vol_z = float((vol_today - m) / s) if s and s != 0 else None
    dollar_vol_5d = float((close.iloc[-5:] * volume.iloc[-5:]).sum()) if len(close) >= 5 else None
    highest_vol_5d = bool(vol_today == volume.iloc[-5:].max()) if len(volume) >= 5 else False

    return {
        # returns / trend
        "ret_1d":  _ret(close, 1),
        "ret_5d":  _ret(close, 5),
        "ret_20d": _ret(close, 20),
        "ret_60d": _ret(close, 60),
        "ret_252d": _ret(close, 252),
        **rs,
        "ma_20_distance":  _ma_distance(last_close, ma20, 20),
        "ma_50_distance":  _ma_distance(last_close, ma50, 50),
        "ma_200_distance": _ma_distance(last_close, ma200, 200),
        "ma_20_slope_10d": _ma_slope(ma20, 10),
        "ma_50_slope_10d": _ma_slope(ma50, 10),
        "dist_52w_high":   dist_hi,
        "dist_52w_low":    dist_lo,
        "price_percentile_252": _price_percentile_252(close),
        # oscillators
        "rsi_14":           _rsi(close),
        "macd":             macd,
        "macd_signal":      macd_sig,
        "macd_histogram":   macd_hist,
        "adx_14":           _adx(df),
        "bb_pct_position":  bb_pct,
        "bb_width":         bb_width,
        "atr_14":           atr,
        "atr_pct":          atr_pct,
        "williams_r_14":    _williams_r(df),
        "stoch_k":          stoch_k,
        "stoch_d":          stoch_d,
        "cci_20":           _cci(df),
        # volume
        "volume_5d_avg":    vol_5,
        "volume_30d_avg":   vol_30,
        "volume_vs_5d":     (vol_today / vol_5) if vol_5 else None,
        "volume_vs_30d":    (vol_today / vol_30) if vol_30 else None,
        "volume_z_30d":     vol_z,
        "dollar_volume_5d": dollar_vol_5d,
        "obv_slope_20":     _obv_slope(df),
        "ad_line_slope_20": _ad_line_slope(df),
        "vwap_distance_20": _vwap_distance(df),
        "up_down_volume_ratio_5d": _up_down_volume_ratio(df),
        "highest_volume_day_5d":   highest_vol_5d,
        "volume_price_correlation_20": _vol_price_corr(df),
        "gap_pct_today":    _gap_today(df),
        # structure
        "consec_up_days":   _consec_days(close, +1),
        "consec_down_days": _consec_days(close, -1),
        "inside_bar_5d_count":  inside_n,
        "outside_bar_5d_count": outside_n,
        # promoted scalars the composer pulls for convenience
        "last_close":       last_close,
        "n_bars":           int(len(df)),
    }
