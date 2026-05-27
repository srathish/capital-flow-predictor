"""Stage 1 — technical breakout setup detection.

Computes all per-ticker technical signals from a daily OHLC frame and returns
a TechRow with the metrics + pass/fail booleans + a 0-100 technical sub-score.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass
class TechRow:
    ticker: str
    price: float
    base_length: int
    base_high: float
    base_low: float
    base_range_pct: float
    breakout_date: str | None
    pct_from_base_high: float
    pct_from_ema21: float
    atr_pct: float
    atr_squeeze_ratio: float
    vol_ratio_breakout: float
    avg_dollar_vol: float
    # Booleans
    has_base: bool
    has_breakout: bool
    near_ema: bool
    atr_squeeze: bool
    vol_expansion: bool
    liquid: bool
    # Composite
    passes_stage1: bool
    tech_score: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _ema(x: pd.Series, n: int) -> pd.Series:
    return x.ewm(span=n, adjust=False).mean()


def _atr(df: pd.DataFrame, n: int) -> pd.Series:
    h, l, c = df["high"], df["low"], df["close"]
    pc = c.shift(1)
    tr = pd.concat([(h - l), (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n, min_periods=n).mean()


def compute_technical(df: pd.DataFrame, cfg: dict) -> TechRow | None:
    """Compute Stage 1 metrics on a single ticker's OHLC daily frame.

    Returns None if there isn't enough history.
    """
    if df is None or len(df) < cfg["ohlc"]["history_min_sessions"]:
        return None

    df = df.copy().sort_values("date").reset_index(drop=True)
    s = cfg["stage1_technical"]
    ticker = df["ticker"].iloc[0]
    price = float(df["close"].iloc[-1])

    # EMAs.
    df["ema_fast"] = _ema(df["close"], s["ema_fast"])
    df["ema_slow"] = _ema(df["close"], s["ema_slow"])

    # ATR%. Measured at the LAST PRE-BREAKOUT session (end of the base) — by the
    # day of the breakout itself, ATR usually pops, which would mask a real squeeze.
    atr = _atr(df, s["atr_period"])
    df["atr_pct"] = (atr / df["close"]) * 100.0
    # Use a window ending at the base_end (we'll recompute properly once we know it).
    pre_idx = max(0, len(df) - s["base_exclude_recent"] - 1)
    atr_pct = float(df["atr_pct"].iloc[pre_idx]) if not np.isnan(df["atr_pct"].iloc[pre_idx]) else float("nan")
    atr_window = df["atr_pct"].iloc[max(0, pre_idx - s["atr_squeeze_lookback"]) : pre_idx + 1]
    atr_avg = float(atr_window.mean()) if not atr_window.empty else float("nan")
    atr_squeeze_ratio = atr_pct / atr_avg if atr_avg and atr_avg > 0 else float("nan")

    # Dollar volume (20d).
    df["dollar_vol"] = df["close"] * df["volume"]
    avg_dollar_vol = float(df["dollar_vol"].tail(s["dollar_vol_avg_period"]).mean())

    # Volume ratio for each recent day (vs 50d avg).
    vol_avg = df["volume"].rolling(s["vol_avg_period"], min_periods=20).mean()
    df["vol_ratio"] = df["volume"] / vol_avg

    # ---- BASE: find the longest contiguous window ending at (len - base_exclude_recent)
    # with (high-low)/low < base_max_range_pct.
    excl = s["base_exclude_recent"]
    if len(df) <= excl + s["base_min_length"]:
        return None
    base_end_idx = len(df) - excl - 1  # inclusive
    best_len = 0
    best_lo = best_hi = None
    best_range_pct = None
    # Walk backward from base_end_idx, expanding the window; keep the largest valid one.
    # Cap exploration at base_max_length sessions.
    hi = -np.inf
    lo = np.inf
    for j in range(base_end_idx, max(0, base_end_idx - s["base_max_length"]), -1):
        hi = max(hi, float(df["high"].iloc[j]))
        lo = min(lo, float(df["low"].iloc[j]))
        cur_len = base_end_idx - j + 1
        rng = (hi - lo) / lo if lo > 0 else float("inf")
        if rng < s["base_max_range_pct"] and cur_len >= s["base_min_length"]:
            best_len = cur_len
            best_lo = lo
            best_hi = hi
            best_range_pct = rng
        # If range already blown past threshold, no longer base will help.
        if rng >= s["base_max_range_pct"] and cur_len > s["base_min_length"]:
            break
    has_base = best_len > 0 and best_hi is not None

    # ---- BREAKOUT: close >= 0.98 * base_high inside last `breakout_lookback` sessions.
    breakout_date = None
    breakout_idx = None
    if has_base:
        thresh = s["breakout_threshold"] * best_hi
        window = df.tail(s["breakout_lookback"])
        hits = window[window["close"] >= thresh]
        if not hits.empty:
            breakout_idx = hits.index[-1]
            breakout_date = str(df["date"].iloc[breakout_idx])
    has_breakout = breakout_idx is not None

    pct_from_base_high = (price / best_hi - 1.0) if best_hi else float("nan")

    # ---- EMA proximity.
    ema21 = float(df["ema_slow"].iloc[-1])
    pct_from_ema21 = (price / ema21 - 1.0) if ema21 > 0 else float("nan")
    near_ema = abs(pct_from_ema21) <= s["max_pct_from_ema_slow"] if not np.isnan(pct_from_ema21) else False

    # ---- ATR squeeze (current ATR% <= ratio * avg).
    atr_squeeze = (not np.isnan(atr_squeeze_ratio)) and atr_squeeze_ratio <= s["atr_squeeze_max_ratio"]

    # ---- Volume expansion on breakout day.
    vol_ratio_breakout = float("nan")
    vol_expansion = False
    if has_breakout:
        vol_ratio_breakout = float(df["vol_ratio"].iloc[breakout_idx])
        vol_expansion = vol_ratio_breakout >= s["vol_breakout_ratio"]

    liquid = avg_dollar_vol >= s["min_avg_dollar_vol"]

    passes_stage1 = has_base and has_breakout and near_ema and atr_squeeze and vol_expansion and liquid

    # ---- Tech sub-score (0-100): six gates, weighted.
    # Base: 25, Breakout: 25, EMA: 10, Squeeze: 15, Volume: 15, Liquidity: 10.
    score = 0.0
    if has_base:
        # Reward longer + tighter bases.
        score += 15.0
        score += 10.0 * max(0.0, min(1.0, (s["base_max_range_pct"] - (best_range_pct or s["base_max_range_pct"])) / s["base_max_range_pct"]))
    if has_breakout:
        score += 15.0
        # Bonus for clean (within 5% above base_high, not extended).
        if 0 <= pct_from_base_high <= 0.05:
            score += 10.0
        elif -0.02 <= pct_from_base_high < 0:
            score += 7.0  # right at the edge
    if near_ema:
        score += 10.0
    if atr_squeeze:
        score += 10.0
        # Bonus for very tight (current ATR% <= 0.8x avg).
        if atr_squeeze_ratio <= 0.8:
            score += 5.0
    if vol_expansion:
        score += 10.0
        if vol_ratio_breakout >= 2.5:
            score += 5.0
    if liquid:
        score += 10.0

    return TechRow(
        ticker=ticker,
        price=price,
        base_length=int(best_len),
        base_high=float(best_hi) if best_hi else float("nan"),
        base_low=float(best_lo) if best_lo else float("nan"),
        base_range_pct=float(best_range_pct) if best_range_pct is not None else float("nan"),
        breakout_date=breakout_date,
        pct_from_base_high=float(pct_from_base_high) if not np.isnan(pct_from_base_high) else float("nan"),
        pct_from_ema21=float(pct_from_ema21) if not np.isnan(pct_from_ema21) else float("nan"),
        atr_pct=atr_pct,
        atr_squeeze_ratio=float(atr_squeeze_ratio) if not np.isnan(atr_squeeze_ratio) else float("nan"),
        vol_ratio_breakout=vol_ratio_breakout,
        avg_dollar_vol=avg_dollar_vol,
        has_base=has_base,
        has_breakout=has_breakout,
        near_ema=near_ema,
        atr_squeeze=atr_squeeze,
        vol_expansion=vol_expansion,
        liquid=liquid,
        passes_stage1=passes_stage1,
        tech_score=float(min(100.0, score)),
    )
