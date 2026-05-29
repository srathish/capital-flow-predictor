"""Fetch daily OHLC for Talon scan tickers, May 18 - May 28, 2026.

Uses yfinance. Caches to parquet per ticker. Idempotent.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import yaml
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "reference" / "2026-05-18.yaml"
CACHE = ROOT / "cache" / "ohlc"
CACHE.mkdir(parents=True, exist_ok=True)

START = "2026-05-18"
END = "2026-05-29"  # yfinance end is exclusive; include May 28


def load_tickers() -> list[str]:
    with REF.open() as f:
        scan = yaml.safe_load(f)
    return [t["ticker"] for t in scan["tickers"]]


def fetch_ticker(ticker: str, use_cache: bool = True) -> pd.DataFrame:
    """Fetch one ticker, cache to parquet. Returns DataFrame with index=date, cols=O/H/L/C/V."""
    safe = ticker.replace("^", "_")
    cache_path = CACHE / f"{safe}.csv"
    if use_cache and cache_path.exists():
        return pd.read_csv(cache_path, index_col="date", parse_dates=True)

    df = yf.Ticker(ticker).history(start=START, end=END, auto_adjust=False)
    if df.empty:
        return df

    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df.index.name = "date"
    df.to_csv(cache_path)
    return df


def fetch_all(use_cache: bool = True) -> dict[str, pd.DataFrame]:
    """Fetch all tickers. Returns {ticker: DataFrame}. Empty frames for failures."""
    tickers = load_tickers()
    out: dict[str, pd.DataFrame] = {}
    for t in tickers:
        try:
            df = fetch_ticker(t, use_cache=use_cache)
            out[t] = df
            status = f"{len(df)} rows" if not df.empty else "EMPTY"
            print(f"  {t:>6}  {status}")
        except Exception as e:
            print(f"  {t:>6}  ERROR: {e}")
            out[t] = pd.DataFrame()
    return out


if __name__ == "__main__":
    import sys
    use_cache = "--refresh" not in sys.argv
    print(f"Fetching OHLC for Talon scan tickers (cache={'on' if use_cache else 'off'})...")
    bars = fetch_all(use_cache=use_cache)
    n_ok = sum(1 for df in bars.values() if not df.empty)
    print(f"\n{n_ok}/{len(bars)} tickers fetched successfully.")
