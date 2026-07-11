"""Thin Unusual Whales client: Bearer auth, whitelist-only paths, TTL cache.

Every endpoint is GET. Cache aggressively — this data costs money and rate limits.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from athena import config
from athena.perception import endpoints
from athena.perception.models import (
    Bar,
    FlowAlert,
    NetPremTick,
    StockState,
    StrikeExposure,
    TideTick,
)

log = logging.getLogger(__name__)

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
        """Fetch a whitelisted endpoint's `data` payload, TTL-cached."""
        url = endpoints.path(name, **path_args)
        key = f"{url}?{json.dumps(params or {}, sort_keys=True)}"
        ttl = config.TTL.get(name, 60)
        now = time.monotonic()
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        resp = self._client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json().get("data", resp.json())
        _cache[key] = (now, data)
        return data

    # Typed conveniences -------------------------------------------------

    def strike_exposures(self, ticker: str, expiry: str | None = None) -> list[StrikeExposure]:
        if expiry:
            rows = self.get("spot_exposures_expiry_strike", ticker=ticker, expiry=expiry)
        else:
            rows = self.get("spot_exposures_strike", ticker=ticker)
        return [StrikeExposure.model_validate(r) for r in rows]

    def flow_alerts(self, ticker: str, limit: int = 50) -> list[FlowAlert]:
        rows = self.get("flow_alerts", params={"limit": limit}, ticker=ticker)
        return [FlowAlert.model_validate(r) for r in rows]

    def bars(self, ticker: str, candle_size: str = "5m", limit: int = 100) -> list[Bar]:
        rows = self.get("ohlc", params={"limit": limit}, ticker=ticker, candle_size=candle_size)
        return [Bar.model_validate(r) for r in rows]

    def stock_state(self, ticker: str) -> StockState:
        return StockState.model_validate(self.get("stock_state", ticker=ticker))

    def market_tide(self) -> list[TideTick]:
        return [TideTick.model_validate(r) for r in self.get("market_tide")]

    def net_prem_ticks(self, ticker: str) -> list[NetPremTick]:
        return [NetPremTick.model_validate(r) for r in self.get("net_prem_ticks", ticker=ticker)]
