"""Daily OHLCV ingestion from Yahoo Finance via yfinance.

Idempotent: re-runs upsert by (ts, symbol, source) primary key.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import pandas as pd
import yfinance as yf

from cfp_jobs.db import connect, upsert_prices

log = logging.getLogger(__name__)
SOURCE = "yfinance"


def _to_float(v: object) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if pd.isna(f):
        return None
    return f


def _to_int(v: object) -> int | None:
    f = _to_float(v)
    if f is None:
        return None
    return int(f)


def _normalize_ts(ts: pd.Timestamp) -> datetime:
    """Yahoo daily bars come back tz-naive at midnight; treat as UTC midnight."""
    py = ts.to_pydatetime()
    if py.tzinfo is None:
        return py.replace(tzinfo=UTC)
    return py.astimezone(UTC)


def fetch_prices(
    symbols: list[str],
    start: datetime,
    end: datetime | None = None,
) -> pd.DataFrame:
    """Fetch daily OHLCV for `symbols` between [start, end]. Returns long-format DataFrame.

    Columns: ts, symbol, open, high, low, close, volume, source.
    Symbols with no data are skipped (logged at WARNING).
    """
    end = end or datetime.now(UTC)
    end_excl = end + timedelta(days=1)

    df = yf.download(
        tickers=" ".join(symbols),
        start=start.date().isoformat(),
        end=end_excl.date().isoformat(),
        interval="1d",
        auto_adjust=False,
        progress=False,
        group_by="ticker",
        threads=True,
    )

    if df is None or df.empty:
        return _empty_frame()

    rows: list[dict] = []
    if isinstance(df.columns, pd.MultiIndex):
        top_level = set(df.columns.get_level_values(0))
        for symbol in symbols:
            if symbol not in top_level:
                log.warning("yfinance: no data returned for %s", symbol)
                continue
            sym_df = df[symbol].dropna(subset=["Close"])
            for ts, row in sym_df.iterrows():
                rows.append(_row(ts, symbol, row))
    else:
        # Single-symbol path: columns are flat
        symbol = symbols[0]
        for ts, row in df.dropna(subset=["Close"]).iterrows():
            rows.append(_row(ts, symbol, row))

    if not rows:
        return _empty_frame()
    return pd.DataFrame(rows)


def _row(ts: pd.Timestamp, symbol: str, row: pd.Series) -> dict:
    return {
        "ts": _normalize_ts(ts),
        "symbol": symbol,
        "open": _to_float(row.get("Open")),
        "high": _to_float(row.get("High")),
        "low": _to_float(row.get("Low")),
        "close": _to_float(row.get("Close")),
        "volume": _to_int(row.get("Volume")),
        "source": SOURCE,
    }


def _empty_frame() -> pd.DataFrame:
    return pd.DataFrame(
        columns=["ts", "symbol", "open", "high", "low", "close", "volume", "source"]
    )


def ingest(
    database_url: str,
    symbols: list[str],
    start: datetime,
    end: datetime | None = None,
) -> int:
    """Fetch + upsert. Returns number of rows written."""
    df = fetch_prices(symbols, start, end)
    if df.empty:
        log.warning("ingest_prices: no rows fetched")
        return 0
    rows = df.to_dict(orient="records")
    with connect(database_url) as conn:
        n = upsert_prices(conn, rows)
        conn.commit()
    log.info(
        "prices: upserted %d rows for %d symbols (latest=%s)",
        n,
        df["symbol"].nunique(),
        df["ts"].max(),
    )
    return n
