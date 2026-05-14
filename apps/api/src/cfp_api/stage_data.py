"""yfinance wrapper for the STAGE scanner.

Single concern: hand `stage_logic.analyze` a list of OHLCV bars for one
ticker, oldest first. Batch-aware so a 500-ticker scan doesn't make 500
sequential HTTP calls.

We cache by (ticker, lookback_days) for STAGE_CACHE_TTL_SEC because yfinance
is rate-sensitive and a single page refresh shouldn't re-hammer Yahoo.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Iterable

from .stage_logic import StageBar

logger = logging.getLogger(__name__)

# Cached on first import. yfinance is heavy and we don't want to pay the import
# cost unless someone actually uses the scanner.
_yf = None
_yf_lock = threading.Lock()


def _yfinance():
    global _yf
    if _yf is None:
        with _yf_lock:
            if _yf is None:
                import yfinance as yf  # type: ignore

                _yf = yf
    return _yf


_CACHE_TTL = int(os.environ.get("STAGE_CACHE_TTL_SEC", "3600"))
_cache: dict[tuple[str, int], tuple[float, list[StageBar]]] = {}
_cache_lock = threading.Lock()


def _cache_get(ticker: str, lookback_days: int) -> list[StageBar] | None:
    with _cache_lock:
        entry = _cache.get((ticker, lookback_days))
    if entry is None:
        return None
    ts, bars = entry
    if time.time() - ts > _CACHE_TTL:
        return None
    return bars


def _cache_put(ticker: str, lookback_days: int, bars: list[StageBar]) -> None:
    with _cache_lock:
        _cache[(ticker, lookback_days)] = (time.time(), bars)


def _df_to_bars(df) -> list[StageBar]:
    """Convert a yfinance DataFrame into our StageBar list. Drops any rows
    where OHLCV is NaN (Yahoo sometimes emits these for half-days)."""
    bars: list[StageBar] = []
    for ts, row in df.iterrows():
        # yfinance returns numpy types; cast to native for JSON-safety.
        try:
            o = float(row["Open"])
            h = float(row["High"])
            l = float(row["Low"])
            c = float(row["Close"])
            v = float(row["Volume"])
        except (KeyError, TypeError, ValueError):
            continue
        if any(x != x for x in (o, h, l, c, v)):  # NaN check without numpy
            continue
        bars.append(
            StageBar(
                date=ts.strftime("%Y-%m-%d"),
                open=o,
                high=h,
                low=l,
                close=c,
                volume=v,
            )
        )
    return bars


def fetch_bars(ticker: str, lookback_days: int = 400) -> list[StageBar]:
    """Fetch daily OHLCV for one ticker. 400 days covers the 252-bar 52w window
    plus headroom for the 60-bar ATR lookback."""
    ticker = ticker.upper()
    cached = _cache_get(ticker, lookback_days)
    if cached is not None:
        return cached

    yf = _yfinance()
    try:
        df = yf.Ticker(ticker).history(period=f"{lookback_days}d", auto_adjust=False)
    except Exception as exc:  # noqa: BLE001 — yfinance raises a zoo of exceptions
        logger.warning("yfinance fetch failed for %s: %s", ticker, exc)
        return []
    if df is None or df.empty:
        return []
    bars = _df_to_bars(df)
    _cache_put(ticker, lookback_days, bars)
    return bars


def fetch_bars_batch(
    tickers: Iterable[str], lookback_days: int = 400
) -> dict[str, list[StageBar]]:
    """Bulk-fetch many tickers in one yfinance call. Falls back to per-ticker
    fetch for symbols Yahoo returned no data for."""
    tickers = [t.upper() for t in tickers]
    out: dict[str, list[StageBar]] = {}
    missing: list[str] = []

    # Serve cached entries first; only fetch the rest.
    for t in tickers:
        cached = _cache_get(t, lookback_days)
        if cached is not None:
            out[t] = cached
        else:
            missing.append(t)

    if not missing:
        return out

    yf = _yfinance()
    try:
        df = yf.download(
            tickers=missing,
            period=f"{lookback_days}d",
            interval="1d",
            group_by="ticker",
            auto_adjust=False,
            threads=True,
            progress=False,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("yfinance batch fetch failed: %s", exc)
        df = None

    if df is None or df.empty:
        for t in missing:
            out[t] = []
        return out

    # Single-ticker shape vs multi-ticker shape — yfinance returns different
    # column structures depending on how many symbols you asked for.
    if len(missing) == 1:
        bars = _df_to_bars(df)
        _cache_put(missing[0], lookback_days, bars)
        out[missing[0]] = bars
        return out

    for t in missing:
        try:
            sub = df[t].dropna(how="all")
        except KeyError:
            out[t] = []
            continue
        bars = _df_to_bars(sub)
        _cache_put(t, lookback_days, bars)
        out[t] = bars

    return out
