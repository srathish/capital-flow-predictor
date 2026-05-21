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

# Negative cache: when a symbol comes back empty, remember *why* for a short
# window so the next refresh doesn't re-probe yfinance.info on every render.
# Reasons are stable enough that 15 min is fine — delistings and bad tickers
# don't recover, and rate limits clear well inside the TTL.
_REASON_TTL = 900
_reason_cache: dict[str, tuple[float, str]] = {}
_reason_lock = threading.Lock()


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


def _reason_get(ticker: str) -> str | None:
    with _reason_lock:
        entry = _reason_cache.get(ticker)
    if entry is None:
        return None
    ts, reason = entry
    if time.time() - ts > _REASON_TTL:
        return None
    return reason


def _reason_put(ticker: str, reason: str) -> None:
    with _reason_lock:
        _reason_cache[ticker] = (time.time(), reason)


def _classify_empty(ticker: str, exc_msg: str | None) -> str:
    """Decide *why* yfinance returned no bars for `ticker`.

    Returns one of:
      - 'rate_limited'        — Yahoo throttled us; retry later
      - 'not_found'           — symbol isn't recognized (wrong ticker, delisted,
                                missing exchange suffix on non-US listings)
      - 'insufficient_history'— symbol exists but has < a usable history window
                                (new IPO, recent halt)
      - 'no_data'             — fallback when the probe itself fails

    Probes `Ticker.fast_info` for a last_price hint, which is cheaper than the
    full `Ticker.info` call. Negative-cached for 15 min upstream.
    """
    cached = _reason_get(ticker)
    if cached is not None:
        return cached

    if exc_msg:
        m = exc_msg.lower()
        if "rate" in m or "too many requests" in m or "429" in m:
            _reason_put(ticker, "rate_limited")
            return "rate_limited"

    try:
        yf = _yfinance()
        info = yf.Ticker(ticker).fast_info
        last_price = None
        # fast_info is dict-like in newer yfinance, attribute-based in older.
        try:
            last_price = info["lastPrice"]
        except (KeyError, TypeError):
            last_price = getattr(info, "last_price", None)
        if last_price is None:
            _reason_put(ticker, "not_found")
            return "not_found"
        # Symbol resolves but we got zero history bars — usually a brand-new
        # listing or a halt that wiped the recent window.
        _reason_put(ticker, "insufficient_history")
        return "insufficient_history"
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "rate" in msg or "429" in msg or "too many requests" in msg:
            _reason_put(ticker, "rate_limited")
            return "rate_limited"
        logger.debug("classify_empty probe failed for %s: %s", ticker, exc)
        _reason_put(ticker, "no_data")
        return "no_data"


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


def fetch_bars(ticker: str, lookback_days: int = 400) -> tuple[list[StageBar], str | None]:
    """Fetch daily OHLCV for one ticker. 400 days covers the 252-bar 52w window
    plus headroom for the 60-bar ATR lookback.

    Returns `(bars, reason)`. `reason` is None on success; otherwise one of
    'not_found' | 'rate_limited' | 'insufficient_history' | 'no_data' so the
    UI can surface a useful message instead of a generic 'no_data' row.
    """
    ticker = ticker.upper()
    cached = _cache_get(ticker, lookback_days)
    if cached is not None:
        return cached, None

    yf = _yfinance()
    exc_msg: str | None = None
    try:
        df = yf.Ticker(ticker).history(period=f"{lookback_days}d", auto_adjust=False)
    except Exception as exc:  # noqa: BLE001 — yfinance raises a zoo of exceptions
        logger.warning("yfinance fetch failed for %s: %s", ticker, exc)
        exc_msg = str(exc)
        df = None

    if df is not None and not df.empty:
        bars = _df_to_bars(df)
        if bars:
            _cache_put(ticker, lookback_days, bars)
            return bars, None

    return [], _classify_empty(ticker, exc_msg)


def fetch_bars_batch(
    tickers: Iterable[str], lookback_days: int = 400
) -> dict[str, tuple[list[StageBar], str | None]]:
    """Bulk-fetch many tickers in one yfinance call.

    Returns a dict of `ticker -> (bars, reason)`. `reason` is None on success;
    when bars come back empty we run `_classify_empty` so callers can tell
    'wrong ticker' from 'rate limited' from 'insufficient_history'.
    """
    tickers = [t.upper() for t in tickers]
    out: dict[str, tuple[list[StageBar], str | None]] = {}
    missing: list[str] = []

    # Serve cached entries first; only fetch the rest.
    for t in tickers:
        cached = _cache_get(t, lookback_days)
        if cached is not None:
            out[t] = (cached, None)
        else:
            missing.append(t)

    if not missing:
        return out

    yf = _yfinance()
    batch_exc_msg: str | None = None
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
        batch_exc_msg = str(exc)
        df = None

    if df is None or df.empty:
        for t in missing:
            out[t] = ([], _classify_empty(t, batch_exc_msg))
        return out

    # Single-ticker shape vs multi-ticker shape — yfinance returns different
    # column structures depending on how many symbols you asked for.
    if len(missing) == 1:
        bars = _df_to_bars(df)
        if bars:
            _cache_put(missing[0], lookback_days, bars)
            out[missing[0]] = (bars, None)
        else:
            out[missing[0]] = ([], _classify_empty(missing[0], batch_exc_msg))
        return out

    for t in missing:
        try:
            sub = df[t].dropna(how="all")
        except KeyError:
            out[t] = ([], _classify_empty(t, batch_exc_msg))
            continue
        bars = _df_to_bars(sub)
        if bars:
            _cache_put(t, lookback_days, bars)
            out[t] = (bars, None)
        else:
            out[t] = ([], _classify_empty(t, batch_exc_msg))

    return out
