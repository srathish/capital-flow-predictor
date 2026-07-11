"""Technical indicators — pure functions over bars. Each returns the raw value;
normalization happens in features.py so signals stay composable.
Bars are chronological (oldest first).
"""

from __future__ import annotations

from itertools import pairwise

from athena.perception.models import Bar


def vwap(bars: list[Bar]) -> float | None:
    pv = sum(((b.high + b.low + b.close) / 3) * b.volume for b in bars)
    vol = sum(b.volume for b in bars)
    return pv / vol if vol else None


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    out = sum(values[:period]) / period
    for v in values[period:]:
        out = v * k + out * (1 - k)
    return out


def atr(bars: list[Bar], period: int = 14) -> float | None:
    if len(bars) < period + 1:
        return None
    trs = []
    for prev, cur in pairwise(bars):
        trs.append(max(cur.high - cur.low, abs(cur.high - prev.close), abs(cur.low - prev.close)))
    return sum(trs[-period:]) / period


def rvol(bars: list[Bar], lookback: int = 20) -> float | None:
    """Last bar's volume vs the average of the prior `lookback` bars."""
    if len(bars) < lookback + 1:
        return None
    avg = sum(b.volume for b in bars[-lookback - 1 : -1]) / lookback
    return bars[-1].volume / avg if avg else None


def opening_range(bars: list[Bar], n_bars: int = 6) -> tuple[float, float] | None:
    """(high, low) of the first n bars of the session (6 x 5m = first 30 minutes)."""
    if not bars:
        return None
    first = bars[:n_bars]
    return max(b.high for b in first), min(b.low for b in first)


def session_range_used(bars: list[Bar]) -> float | None:
    """Today's realized range as a fraction of ATR-scaled expectation (0..n)."""
    if not bars:
        return None
    hi = max(b.high for b in bars)
    lo = min(b.low for b in bars)
    a = atr(bars)
    return (hi - lo) / a if a else None
