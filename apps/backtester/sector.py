"""Sector strength — map ticker -> sector ETF, compute hot/cold flags."""

from __future__ import annotations

from functools import lru_cache

import pandas as pd

from data import load_ohlcv

# S&P sector -> SPDR sector ETF
SECTOR_ETF = {
    "Technology": "XLK",
    "Information Technology": "XLK",
    "Communication Services": "XLC",
    "Communications": "XLC",
    "Consumer Discretionary": "XLY",
    "Consumer Cyclical": "XLY",
    "Consumer Staples": "XLP",
    "Consumer Defensive": "XLP",
    "Energy": "XLE",
    "Financials": "XLF",
    "Financial Services": "XLF",
    "Healthcare": "XLV",
    "Health Care": "XLV",
    "Industrials": "XLI",
    "Materials": "XLB",
    "Basic Materials": "XLB",
    "Real Estate": "XLRE",
    "Utilities": "XLU",
}

# Hardcoded ticker -> sector for the test basket (avoids slow yfinance .info lookups)
TICKER_SECTOR = {
    "INTC": "XLK", "META": "XLC", "NFLX": "XLC", "AAPL": "XLK",
    "NVDA": "XLK", "MSFT": "XLK", "AMZN": "XLY", "GOOGL": "XLC",
    "SPY": "SPY", "QQQ": "QQQ",  # benchmarks — use self
    # Space basket (from user memory)
    "RKLB": "XLI", "ASTS": "XLC", "SPCE": "XLI", "PL": "XLI",
    "RDW": "XLI", "IRDM": "XLC", "LMT": "XLI", "RTX": "XLI",
    "NOC": "XLI", "BA": "XLI", "GD": "XLI", "AMPG": "XLI",
    # Common test tickers
    "TSLA": "XLY", "AMD": "XLK", "AVGO": "XLK", "MU": "XLK",
    "MRVL": "XLK", "JPM": "XLF", "GS": "XLF", "BAC": "XLF",
    "XOM": "XLE", "CVX": "XLE", "GLD": "XLB", "TLT": "XLB",
}


def ticker_to_sector_etf(ticker: str) -> str:
    """Return the SPDR sector ETF for a ticker. Falls back to SPY if unknown."""
    return TICKER_SECTOR.get(ticker.upper(), "SPY")


@lru_cache(maxsize=20)
def get_sector_series(etf: str, period: str = "max") -> pd.DataFrame:
    """Pull sector ETF data + compute strength signals.

    Returns DataFrame with:
      sec_close, sec_sma50, sec_above_50, sec_roc20, sec_rs_vs_spy_20, sec_hot
    """
    if etf == "SPY":
        spy = load_ohlcv("SPY", period=period)["close"].rename("sec_close")
        df = spy.to_frame()
        df["sec_sma50"] = df["sec_close"].rolling(50).mean()
        df["sec_above_50"] = df["sec_close"] > df["sec_sma50"]
        df["sec_roc20"] = df["sec_close"].pct_change(20) * 100
        df["sec_rs_vs_spy_20"] = 0.0  # SPY vs SPY = 0
        df["sec_hot"] = df["sec_above_50"]
        return df

    sec = load_ohlcv(etf, period=period)["close"].rename("sec_close")
    spy = load_ohlcv("SPY", period=period)["close"].rename("spy_close")
    df = pd.concat([sec, spy], axis=1).dropna()
    df["sec_sma50"] = df["sec_close"].rolling(50).mean()
    df["sec_above_50"] = df["sec_close"] > df["sec_sma50"]
    df["sec_roc20"] = df["sec_close"].pct_change(20) * 100
    df["spy_roc20"] = df["spy_close"].pct_change(20) * 100
    df["sec_rs_vs_spy_20"] = df["sec_roc20"] - df["spy_roc20"]
    df["sec_hot"] = df["sec_above_50"] & (df["sec_rs_vs_spy_20"] > 0)
    return df[["sec_close", "sec_sma50", "sec_above_50", "sec_roc20", "sec_rs_vs_spy_20", "sec_hot"]]


def get_sector_for_ticker(ticker: str, period: str = "max") -> pd.DataFrame:
    """Convenience: get sector signals aligned to a ticker's universe."""
    etf = ticker_to_sector_etf(ticker)
    return get_sector_series(etf, period=period)


if __name__ == "__main__":
    for tk in ["INTC", "NVDA", "AMZN", "XOM"]:
        etf = ticker_to_sector_etf(tk)
        df = get_sector_for_ticker(tk, period="2y")
        hot_pct = df["sec_hot"].mean() * 100
        print(f"{tk} -> {etf}: hot {hot_pct:.0f}% of last 2y, recent RS vs SPY: {df['sec_rs_vs_spy_20'].iloc[-1]:+.1f}%")
