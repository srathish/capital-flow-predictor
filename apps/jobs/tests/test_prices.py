from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pandas as pd
from cfp_jobs.ingestion.prices import fetch_prices


def _single_symbol_frame() -> pd.DataFrame:
    dates = pd.date_range("2024-01-02", periods=3, freq="B")
    return pd.DataFrame(
        {
            "Open": [100.0, 102.0, 101.5],
            "High": [101.0, 103.0, 102.0],
            "Low": [99.0, 101.0, 100.5],
            "Close": [100.5, 102.5, 101.7],
            "Volume": [1_000_000, 1_100_000, 950_000],
            "Adj Close": [100.5, 102.5, 101.7],
        },
        index=dates,
    )


def _multi_symbol_frame() -> pd.DataFrame:
    dates = pd.date_range("2024-01-02", periods=2, freq="B")
    fields = ["Open", "High", "Low", "Close", "Volume", "Adj Close"]
    cols = pd.MultiIndex.from_product([["XLK", "XLF"], fields])
    data = [
        # XLK row 1: O=100 H=101 L=99 C=100.5 V=1M AdjC=100.5; XLF row 1: O=50 H=51 L=49 C=50.5 V=500k AdjC=50.5
        [100, 101, 99, 100.5, 1_000_000, 100.5, 50, 51, 49, 50.5, 500_000, 50.5],
        [102, 103, 101, 102.5, 1_100_000, 102.5, 51, 52, 50, 51.5, 510_000, 51.5],
    ]
    return pd.DataFrame(data, index=dates, columns=cols)


def test_single_symbol_long_format() -> None:
    fake = _single_symbol_frame()
    with patch("cfp_jobs.ingestion.prices.yf.download", return_value=fake):
        df = fetch_prices(["XLK"], datetime(2024, 1, 1, tzinfo=UTC))

    assert len(df) == 3
    assert (df["symbol"] == "XLK").all()
    assert (df["source"] == "yfinance").all()
    assert df.iloc[0]["close"] == 100.5
    assert df.iloc[0]["volume"] == 1_000_000
    # Timestamps are tz-aware UTC
    assert df.iloc[0]["ts"].tzinfo is not None


def test_multi_symbol_long_format() -> None:
    fake = _multi_symbol_frame()
    with patch("cfp_jobs.ingestion.prices.yf.download", return_value=fake):
        df = fetch_prices(
            ["XLK", "XLF"], datetime(2024, 1, 1, tzinfo=UTC)
        )

    assert set(df["symbol"].unique()) == {"XLK", "XLF"}
    assert len(df) == 4  # 2 symbols x 2 dates
    xlk = df[df["symbol"] == "XLK"]
    xlf = df[df["symbol"] == "XLF"]
    assert xlk.iloc[0]["close"] == 100.5
    assert xlf.iloc[0]["close"] == 50.5


def test_missing_symbol_skipped() -> None:
    """If yfinance returns nothing for a symbol, it's logged + skipped without crashing."""
    fake = _multi_symbol_frame()
    with patch("cfp_jobs.ingestion.prices.yf.download", return_value=fake):
        df = fetch_prices(
            ["XLK", "XLF", "GHOST"], datetime(2024, 1, 1, tzinfo=UTC)
        )
    assert "GHOST" not in set(df["symbol"].unique())


def test_empty_response() -> None:
    with patch(
        "cfp_jobs.ingestion.prices.yf.download", return_value=pd.DataFrame()
    ):
        df = fetch_prices(["XLK"], datetime(2024, 1, 1, tzinfo=UTC))
    assert df.empty
