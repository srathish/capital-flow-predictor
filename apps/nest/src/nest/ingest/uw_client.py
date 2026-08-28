"""Thin Unusual Whales client for the Nest — Bearer auth, whitelisted GET paths,
TTL cache. Mirrors apps/athena/perception/uw_client.py; kept local so the Nest is a
self-contained app. This data costs money and rate-limits — cache aggressively.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from nest import config

log = logging.getLogger(__name__)

# Spec-verified paths only (anti-hallucination gate). Confirmed trap: the flow-alerts
# endpoint is /api/stock/{ticker}/flow-alerts, not /api/options/flow.
WHITELIST: dict[str, str] = {
    # market-wide feeds (one call → all tickers) — the emergent-universe firehoses
    "darkpool_recent": "/api/darkpool/recent",
    "flow_alerts_market": "/api/option-trades/flow-alerts",
    "insider_transactions": "/api/insider/transactions",
    "congress_recent": "/api/congress/recent-trades",
    "news_headlines": "/api/news/headlines",
    "economic_calendar": "/api/market/economic-calendar",
    "analysts_screener": "/api/screener/analysts",
    "oi_change_market": "/api/market/oi-change",
    "market_tide": "/api/market/market-tide",
    "fda_calendar": "/api/market/fda-calendar",
    # per-ticker (enrichment on surfaced names only)
    "greek_exposure_strike": "/api/stock/{ticker}/greek-exposure/strike",
    "stock_state": "/api/stock/{ticker}/stock-state",
    "ohlc": "/api/stock/{ticker}/ohlc/{candle_size}",
    "financials": "/api/stock/{ticker}/financials",
    "short_interest_float": "/api/shorts/{ticker}/interest-float",
    "short_data": "/api/shorts/{ticker}/data",
    "max_pain": "/api/stock/{ticker}/max-pain",
    "net_prem_ticks": "/api/stock/{ticker}/net-prem-ticks",
}

_TTL: dict[str, int] = {
    "darkpool_recent": 60,
    "flow_alerts_market": 60,
    "insider_transactions": 900,
    "congress_recent": 1800,
    "news_headlines": 120,
    "economic_calendar": 1800,
    "analysts_screener": 300,
    "oi_change_market": 600,
    "market_tide": 120,
    "fda_calendar": 3600,
    "greek_exposure_strike": 300,
    "stock_state": 30,
    "ohlc": 60,
    "financials": 86400,
    "short_interest_float": 43200,
    "short_data": 3600,
    "max_pain": 900,
    "net_prem_ticks": 120,
}

_cache: dict[str, tuple[float, Any]] = {}


class UWClient:
    def __init__(self, token: str | None = None):
        self._client = httpx.Client(
            base_url=config.UW_BASE,
            headers={
                "Authorization": f"Bearer {token or config.uw_token()}",
                "Accept": "application/json",
            },
            timeout=30,
        )

    def get(self, name: str, params: dict | None = None, **path_args: str) -> Any:
        if name not in WHITELIST:
            raise KeyError(f"endpoint {name!r} is not in the spec-verified whitelist")
        url = WHITELIST[name].format(**path_args)
        key = f"{url}?{json.dumps(params or {}, sort_keys=True)}"
        ttl = _TTL.get(name, 60)
        now = time.monotonic()
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        resp = self._client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()
        data = body.get("data", body) if isinstance(body, dict) else body
        _cache[key] = (now, data)
        return data

    def close(self) -> None:
        self._client.close()
