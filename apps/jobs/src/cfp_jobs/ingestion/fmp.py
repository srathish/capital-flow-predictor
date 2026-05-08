"""Thin Financial Modeling Prep (FMP) client.

Uses the /stable/ API only — FMP deprecated /api/v3/* on 2025-08-31 for new users.
Free tier covers fundamentals (income/balance/cash-flow/key-metrics/ratios).
ETF holdings is paywalled, so we use yfinance for that elsewhere.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE_URL = "https://financialmodelingprep.com/stable"


class FmpClient:
    def __init__(self, api_key: str, timeout: float = 20.0) -> None:
        if not api_key:
            raise RuntimeError("FMP_API_KEY not configured")
        self.api_key = api_key
        self._client = httpx.Client(timeout=timeout)

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        params = dict(params or {})
        params["apikey"] = self.api_key
        url = f"{BASE_URL}/{path}"
        r = self._client.get(url, params=params)
        if r.status_code == 429:
            raise RuntimeError("FMP rate limit hit (free tier = 250 calls/day)")
        r.raise_for_status()
        return r.json()

    # --- Fundamentals ---

    def income_statement(self, ticker: str, period: str = "annual", limit: int = 5) -> list[dict]:
        return self._get(
            "income-statement",
            params={"symbol": ticker, "period": period, "limit": limit},
        ) or []

    def balance_sheet(self, ticker: str, period: str = "annual", limit: int = 5) -> list[dict]:
        return self._get(
            "balance-sheet-statement",
            params={"symbol": ticker, "period": period, "limit": limit},
        ) or []

    def cash_flow(self, ticker: str, period: str = "annual", limit: int = 5) -> list[dict]:
        return self._get(
            "cash-flow-statement",
            params={"symbol": ticker, "period": period, "limit": limit},
        ) or []

    def key_metrics(self, ticker: str, period: str = "annual", limit: int = 5) -> list[dict]:
        return self._get(
            "key-metrics",
            params={"symbol": ticker, "period": period, "limit": limit},
        ) or []

    def ratios(self, ticker: str, period: str = "annual", limit: int = 5) -> list[dict]:
        """Valuation ratios (P/E, P/B, debt ratios). Field names live here under /stable/."""
        return self._get(
            "ratios",
            params={"symbol": ticker, "period": period, "limit": limit},
        ) or []

    def profile(self, ticker: str) -> list[dict]:
        """Company profile — used to resolve sector/industry for ad-hoc tickers
        outside the predictor universe. Returns a one-element list on hit, [] on miss."""
        return self._get("profile", params={"symbol": ticker}) or []

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> FmpClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
