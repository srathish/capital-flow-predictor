"""Minimal live UW client for the Talon scanner.

Two endpoints only — that's all Talon needs:
  GET /api/stock/{ticker}/greek-exposure?timeframe=1M  → daily GEX timeseries
  GET /api/stock/{ticker}/volume-by-price              → latest-session DP snapshot

Adds:
  - 15-minute in-process TTL cache keyed by (endpoint, ticker)
  - ThreadPoolExecutor fan-out for batch fetches (default 10 concurrent)
  - 429 backoff with retry; 404 → None
  - Bearer auth from settings.unusual_whales_api_key (env UNUSUAL_WHALES_API_KEY)

Used by talon_scanner when TALON_USE_LIVE_FETCH=1 (default in production).
Local dev can set TALON_USE_LIVE_FETCH=0 to keep using the disk JSON cache.
"""
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from cfp_api.settings import settings

log = logging.getLogger(__name__)

UW_BASE = "https://api.unusualwhales.com"
DEFAULT_TIMEOUT_SECONDS = 20.0
# Default 5 — keeps total req/sec well under UW's 120/min limit so we don't get 503s.
DEFAULT_CONCURRENCY = int(os.environ.get("TALON_LIVE_CONCURRENCY", "5"))


def use_live_fetch() -> bool:
    return os.environ.get("TALON_USE_LIVE_FETCH", "1") not in ("0", "false", "False")


class _NullCache:
    """Pass-through. Every call to get() returns None so we always live-fetch.

    Kept as a class (rather than removing the attribute) so the rest of the
    client doesn't need a code path for "no cache present."
    """

    def get(self, key: str) -> Any | None:  # noqa: ARG002
        return None

    def set(self, key: str, value: Any) -> None:
        return None

    def clear(self) -> None:
        return None


_CACHE = _NullCache()


class TalonUwClient:
    """Thin sync httpx client. Constructed once per scan, used many times."""

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        concurrency: int = DEFAULT_CONCURRENCY,
    ):
        key = api_key or (settings.unusual_whales_api_key or "").strip()
        if not key:
            raise RuntimeError(
                "UNUSUAL_WHALES_API_KEY not configured — Talon needs it to live-fetch."
            )
        self._client = httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
                "User-Agent": "bellwether-talon/0.1",
            },
        )
        self._concurrency = concurrency

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    # ------------------------------------------------------------------
    # Low-level HTTP
    # ------------------------------------------------------------------
    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any | None:
        url = f"{UW_BASE}{path}"
        for attempt in range(3):
            try:
                r = self._client.get(url, params=params or {})
                if r.status_code == 429:
                    backoff = 0.5 * (2 ** attempt)
                    log.warning("UW 429 on %s, backing off %.1fs", path, backoff)
                    time.sleep(backoff)
                    continue
                if r.status_code in (404, 422):
                    return None
                if r.status_code >= 500:
                    if attempt == 2:
                        log.error("UW %s on %s after retries", r.status_code, path)
                        return None
                    time.sleep(0.5)
                    continue
                r.raise_for_status()
                return r.json()
            except httpx.RequestError as e:
                if attempt == 2:
                    log.error("UW request error %s on %s", e, path)
                    return None
                time.sleep(0.5)
        return None

    # ------------------------------------------------------------------
    # Public endpoints
    # ------------------------------------------------------------------
    def gex_timeseries(self, ticker: str, timeframe: str = "1M") -> dict | None:
        """GEX timeseries for one ticker. Returns the raw payload (UW wraps in `data`) or None.

        Normalized shape — we re-wrap under {"result": [...]} so downstream code
        matches the disk-cached fixture layout.
        """
        cache_key = f"gex:{ticker}:{timeframe}"
        cached = _CACHE.get(cache_key)
        if cached is not None:
            return cached
        body = self._get(
            f"/api/stock/{ticker}/greek-exposure",
            {"timeframe": timeframe},
        )
        if body is None:
            return None
        # UW returns {"data": [...]}; normalize to {"result": [...]} for compat with disk cache.
        rows = body.get("data") or body.get("result") or []
        normalized = {"result": rows}
        _CACHE.set(cache_key, normalized)
        return normalized

    def dp_volume_by_price(self, ticker: str) -> dict | None:
        """Latest-session stock-level per-price volume (DP + regular).

        Live UW response is per-print rows: {"price": float, "lit_vol": int, "off_vol": int}.
        We aggregate by price into the canonical shape used by the disk-cached fixtures:
          {"date": "YYYY-MM-DD", "stock_price_vol": [
              {"price": "...", "dark_pool_volume": int, "regular_volume": int},
              ...
          ]}
        """
        cache_key = f"dp:{ticker}"
        cached = _CACHE.get(cache_key)
        if cached is not None:
            return cached
        body = self._get(f"/api/stock/{ticker}/stock-volume-price-levels", None)
        if body is None:
            return None
        rows = body.get("data") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            return None

        # Aggregate per-print rows by exact price → DP/regular totals
        agg: dict[float, dict[str, float]] = {}
        for r in rows:
            try:
                price = float(r.get("price"))
            except (TypeError, ValueError):
                continue
            off = float(r.get("off_vol") or 0)
            lit = float(r.get("lit_vol") or 0)
            if price not in agg:
                agg[price] = {"off": 0.0, "lit": 0.0}
            agg[price]["off"] += off
            agg[price]["lit"] += lit

        normalized = {
            "date": None,  # UW REST doesn't include the date in this payload; metrics doesn't need it
            "stock_price_vol": [
                {
                    "price": str(p),
                    "dark_pool_volume": int(v["off"]),
                    "regular_volume": int(v["lit"]),
                }
                for p, v in sorted(agg.items())
            ],
        }
        _CACHE.set(cache_key, normalized)
        return normalized

    # ------------------------------------------------------------------
    # Batch fan-out — one call per ticker, executed concurrently
    # ------------------------------------------------------------------
    def gex_batch(self, tickers: list[str]) -> dict[str, dict | None]:
        return self._batch(tickers, self.gex_timeseries)

    def dp_batch(self, tickers: list[str]) -> dict[str, dict | None]:
        return self._batch(tickers, self.dp_volume_by_price)

    def _batch(self, tickers: list[str], fn) -> dict[str, dict | None]:
        out: dict[str, dict | None] = {}
        with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
            futures = {pool.submit(fn, t): t for t in tickers}
            for fut in futures:
                t = futures[fut]
                try:
                    out[t] = fut.result()
                except Exception as e:
                    log.warning("batch fetch failed for %s: %s", t, e)
                    out[t] = None
        return out


def clear_cache() -> None:
    """Public hook so the API can offer a force-refresh."""
    _CACHE.clear()
