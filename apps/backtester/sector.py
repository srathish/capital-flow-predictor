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

# Hardcoded ticker -> sector ETF (avoids slow yfinance .info lookups).
# Expanded to cover the diversified basket for v3 ablations.
TICKER_SECTOR = {
    # Tech
    "INTC": "XLK", "AAPL": "XLK", "NVDA": "XLK", "MSFT": "XLK",
    "AMD": "XLK", "AVGO": "XLK", "MU": "XLK", "MRVL": "XLK",
    "ORCL": "XLK", "CRM": "XLK", "ADBE": "XLK", "QCOM": "XLK",
    # Communication services
    "META": "XLC", "NFLX": "XLC", "GOOGL": "XLC", "GOOG": "XLC",
    "DIS": "XLC", "T": "XLC", "VZ": "XLC",
    # Consumer discretionary
    "AMZN": "XLY", "TSLA": "XLY", "HD": "XLY", "MCD": "XLY",
    "NKE": "XLY", "SBUX": "XLY", "LOW": "XLY",
    # Consumer staples
    "WMT": "XLP", "KO": "XLP", "PG": "XLP", "PEP": "XLP",
    # Financials
    "JPM": "XLF", "GS": "XLF", "BAC": "XLF", "WFC": "XLF",
    "MS": "XLF", "C": "XLF", "BRK-B": "XLF",
    # Energy
    "XOM": "XLE", "CVX": "XLE", "COP": "XLE", "SLB": "XLE",
    # Health
    "JNJ": "XLV", "UNH": "XLV", "PFE": "XLV", "ABBV": "XLV", "LLY": "XLV",
    # Industrials
    "BA": "XLI", "CAT": "XLI", "GE": "XLI", "HON": "XLI", "LMT": "XLI",
    "RTX": "XLI", "NOC": "XLI", "GD": "XLI",
    # Space basket
    "RKLB": "XLI", "ASTS": "XLC", "SPCE": "XLI", "PL": "XLI",
    "RDW": "XLI", "IRDM": "XLC", "AMPG": "XLI",
    # Materials / Utilities / Real Estate
    "GLD": "XLB", "TLT": "XLB",  # not really sector ETFs but for proxy
    "XLU": "XLU", "XLRE": "XLRE",
    # Benchmarks
    "SPY": "SPY", "QQQ": "QQQ", "IWM": "SPY",  # IWM uses SPY as fallback
}


def ticker_to_sector_etf(ticker: str) -> str:
    return TICKER_SECTOR.get(ticker.upper(), "SPY")


@lru_cache(maxsize=20)
def get_sector_series(etf: str, period: str = "max") -> pd.DataFrame:
    if etf == "SPY":
        spy = load_ohlcv("SPY", period=period)["close"].rename("sec_close")
        df = spy.to_frame()
        df["sec_sma50"] = df["sec_close"].rolling(50).mean()
        df["sec_sma200"] = df["sec_close"].rolling(200).mean()
        df["sec_above_50"] = df["sec_close"] > df["sec_sma50"]
        df["sec_above_200"] = df["sec_close"] > df["sec_sma200"]
        df["sec_roc20"] = df["sec_close"].pct_change(20) * 100
        df["sec_rs_vs_spy_20"] = 0.0
        df["sec_hot"] = df["sec_above_50"]
        df["sec_not_dead"] = df["sec_above_200"]  # weaker filter — used by v3
        return df

    sec = load_ohlcv(etf, period=period)["close"].rename("sec_close")
    spy = load_ohlcv("SPY", period=period)["close"].rename("spy_close")
    df = pd.concat([sec, spy], axis=1).dropna()
    df["sec_sma50"] = df["sec_close"].rolling(50).mean()
    df["sec_sma200"] = df["sec_close"].rolling(200).mean()
    df["sec_above_50"] = df["sec_close"] > df["sec_sma50"]
    df["sec_above_200"] = df["sec_close"] > df["sec_sma200"]
    df["sec_roc20"] = df["sec_close"].pct_change(20) * 100
    df["spy_roc20"] = df["spy_close"].pct_change(20) * 100
    df["sec_rs_vs_spy_20"] = df["sec_roc20"] - df["spy_roc20"]
    df["sec_hot"] = df["sec_above_50"] & (df["sec_rs_vs_spy_20"] > 0)
    df["sec_not_dead"] = df["sec_above_200"]  # weaker filter — only blocks bear-sector trades
    return df[["sec_close", "sec_sma50", "sec_sma200", "sec_above_50", "sec_above_200",
               "sec_roc20", "sec_rs_vs_spy_20", "sec_hot", "sec_not_dead"]]


def get_sector_for_ticker(ticker: str, period: str = "max") -> pd.DataFrame:
    etf = ticker_to_sector_etf(ticker)
    return get_sector_series(etf, period=period)


if __name__ == "__main__":
    for tk in ["INTC", "NVDA", "AMZN", "XOM"]:
        etf = ticker_to_sector_etf(tk)
        df = get_sector_for_ticker(tk, period="2y")
        hot_pct = df["sec_hot"].mean() * 100
        not_dead_pct = df["sec_not_dead"].mean() * 100
        print(f"{tk} -> {etf}: hot {hot_pct:.0f}%  not_dead {not_dead_pct:.0f}%")
