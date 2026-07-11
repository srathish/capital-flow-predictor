"""Pydantic boundaries for UW responses. Field names come from the live OpenAPI
spec (2026-07-11), not memory. extra='allow' so upstream additions never break us;
values arrive as strings from UW, so coercing types here is the point.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


class _Permissive(BaseModel):
    model_config = ConfigDict(extra="allow")

    @field_validator("*", mode="before")
    @classmethod
    def _empty_str_to_none(cls, v):
        return None if v == "" else v


class StrikeExposure(_Permissive):
    """One row of /api/stock/{ticker}/spot-exposures/strike (OI-based fields)."""

    strike: float
    price: float | None = None
    call_gamma_oi: float = 0.0
    put_gamma_oi: float = 0.0
    call_vanna_oi: float = 0.0
    put_vanna_oi: float = 0.0
    call_charm_oi: float = 0.0
    put_charm_oi: float = 0.0

    @property
    def net_gamma(self) -> float:
        return self.call_gamma_oi + self.put_gamma_oi

    @property
    def net_vanna(self) -> float:
        return self.call_vanna_oi + self.put_vanna_oi


class FlowAlert(_Permissive):
    """One row of /api/stock/{ticker}/flow-alerts."""

    ticker: str = ""
    type: str = ""  # call | put
    strike: str = ""
    expiry: str = ""
    total_premium: float = 0.0
    total_ask_side_prem: float = 0.0
    total_bid_side_prem: float = 0.0
    total_size: int = 0
    has_sweep: bool = False
    has_floor: bool = False
    all_opening_trades: bool = False
    volume_oi_ratio: float = 0.0
    underlying_price: float | None = None
    created_at: str = ""


class Bar(_Permissive):
    """One row of /api/stock/{ticker}/ohlc/{candle_size}."""

    open: float
    high: float
    low: float
    close: float
    volume: int = 0
    start_time: str = ""


class StockState(_Permissive):
    open: float
    high: float
    low: float
    close: float
    prev_close: float | None = None
    volume: int = 0
    tape_time: str = ""


class TideTick(_Permissive):
    """One row of /api/market/market-tide."""

    net_call_premium: float = 0.0
    net_put_premium: float = 0.0
    net_volume: float = 0.0
    timestamp: str = ""


class NetPremTick(_Permissive):
    """One row of /api/stock/{ticker}/net-prem-ticks."""

    net_call_premium: float = 0.0
    net_put_premium: float = 0.0
    net_delta: float = 0.0
    tape_time: str = ""
