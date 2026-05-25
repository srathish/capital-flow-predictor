"""Yahoo Finance data loader with simple disk cache."""

from __future__ import annotations

import pickle
from pathlib import Path

import pandas as pd
import yfinance as yf

CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)


def load_ohlcv(ticker: str, period: str = "max", interval: str = "1d", refresh: bool = False) -> pd.DataFrame:
    """Load OHLCV from yfinance, cached on disk by ticker+period+interval.

    Returns a DataFrame with lowercase columns: open, high, low, close, volume,
    indexed by date (DatetimeIndex).
    """
    cache_key = f"{ticker}_{period}_{interval}.pkl"
    cache_path = CACHE_DIR / cache_key

    if cache_path.exists() and not refresh:
        with open(cache_path, "rb") as f:
            return pickle.load(f)

    raw = yf.download(ticker, period=period, interval=interval, auto_adjust=True, progress=False)
    if raw.empty:
        raise ValueError(f"No data returned for {ticker}")

    # yfinance returns MultiIndex columns sometimes — flatten
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = [c[0] if isinstance(c, tuple) else c for c in raw.columns]

    df = raw.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].copy()
    df.index.name = "Date"

    with open(cache_path, "wb") as f:
        pickle.dump(df, f)

    return df


if __name__ == "__main__":
    # Smoke test
    df = load_ohlcv("AAPL", period="5y")
    print(f"AAPL: {len(df)} bars from {df.index[0].date()} to {df.index[-1].date()}")
    print(df.tail())
