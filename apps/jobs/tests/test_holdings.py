from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
from cfp_jobs.ingestion.holdings import fetch_holdings


def _fake_yf_top_holdings() -> pd.DataFrame:
    """yfinance returns a DataFrame indexed by symbol, with Holding Percent as a fraction."""
    return pd.DataFrame(
        {
            "Name": ["Apple Inc", "Microsoft Corp", "NVIDIA Corp"],
            "Holding Percent": [0.2431, 0.2205, 0.0812],
        },
        index=pd.Index(["AAPL", "MSFT", "NVDA"], name="Symbol"),
    )


def test_fetch_holdings_normalizes_to_db_rows() -> None:
    fake_funds = MagicMock()
    fake_funds.top_holdings = _fake_yf_top_holdings()
    fake_ticker = MagicMock()
    fake_ticker.funds_data = fake_funds

    with patch("cfp_jobs.ingestion.holdings.yf.Ticker", return_value=fake_ticker):
        rows = fetch_holdings("XLK")

    assert len(rows) == 3
    assert {r["constituent"] for r in rows} == {"AAPL", "MSFT", "NVDA"}

    aapl = next(r for r in rows if r["constituent"] == "AAPL")
    assert aapl["sector_etf"] == "XLK"
    # yfinance returns 0.2431; we store 24.31 (percentage)
    assert abs(aapl["weight"] - 24.31) < 1e-6
    assert aapl["source"] == "yfinance"
    assert aapl["last_updated"].tzinfo is not None


def test_fetch_holdings_handles_empty_dataframe() -> None:
    fake_funds = MagicMock()
    fake_funds.top_holdings = pd.DataFrame()
    fake_ticker = MagicMock()
    fake_ticker.funds_data = fake_funds

    with patch("cfp_jobs.ingestion.holdings.yf.Ticker", return_value=fake_ticker):
        assert fetch_holdings("BOGUS") == []


def test_fetch_holdings_handles_yfinance_exception() -> None:
    """Some symbols (e.g., individual stocks) don't have funds_data; yfinance raises."""
    fake_ticker = MagicMock()
    type(fake_ticker.funds_data).top_holdings = property(
        lambda _self: (_ for _ in ()).throw(RuntimeError("not a fund"))
    )
    with patch("cfp_jobs.ingestion.holdings.yf.Ticker", return_value=fake_ticker):
        assert fetch_holdings("AAPL") == []
