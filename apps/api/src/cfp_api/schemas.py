"""Pydantic response schemas for the read API.

These define the wire contract between Railway-hosted FastAPI and the Vercel
Next.js dashboard. Keep them stable — any breaking change requires bumping the
v1/ path or the dashboard adapter.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------- /v1/rankings ----------


class RankingItem(BaseModel):
    rank: int
    symbol: str
    score: float | None = None
    target_ts: datetime


class RankingsResponse(BaseModel):
    run_ts: datetime
    horizon_d: int
    model: str
    target_ts: datetime
    rankings: list[RankingItem]


# ---------- /v1/watchlist + /v1/watchlist/{sector} ----------


WatchlistSignal = Literal["long", "short", "avoid"]


class WatchlistItem(BaseModel):
    rank: int
    ticker: str
    final_signal: WatchlistSignal
    final_confidence: float
    target_weight: float | None = None
    rationale: dict[str, Any] = Field(default_factory=dict)


class WatchlistSector(BaseModel):
    sector: str
    items: list[WatchlistItem]


class WatchlistResponse(BaseModel):
    run_ts: datetime
    sectors: list[WatchlistSector]


# ---------- /v1/agents/{ticker} ----------


AgentKind = Literal["analyst", "persona", "synthesis", "unknown"]
AgentSignalKind = Literal["bullish", "bearish", "neutral"]


class AgentSignalEntry(BaseModel):
    agent: str
    kind: AgentKind
    signal: AgentSignalKind
    confidence: float
    rationale: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentsForTickerResponse(BaseModel):
    ticker: str
    run_ts: datetime
    signals: list[AgentSignalEntry]


class AgentsTimelineEntry(BaseModel):
    run_ts: datetime
    signal: AgentSignalKind
    confidence: float
    rationale: str | None = None


class AgentsTimelineResponse(BaseModel):
    ticker: str
    agent: str
    entries: list[AgentsTimelineEntry]


# ---------- /v1/sectors ----------


class SectorEntry(BaseModel):
    symbol: str
    latest_rank: int | None = None
    latest_score: float | None = None
    confidence: float | None = None
    prior_rank: int | None = None  # rank from the run before the latest
    rank_history: list[int] = Field(default_factory=list)  # oldest → newest, latest run last
    score_history: list[float] = Field(default_factory=list)
    horizon_d: int | None = None
    n_constituents: int = 0


class SectorsResponse(BaseModel):
    run_ts: datetime | None = None
    sectors: list[SectorEntry]


# ---------- /v1/stocks/screen ----------


ScreenSignal = Literal["long", "short", "avoid", "any"]


class StockScreenItem(BaseModel):
    ticker: str
    sector: str | None = None
    final_signal: WatchlistSignal
    confidence: float
    target_weight: float | None = None
    iv_rank: float | None = None  # 0..1 proxy: latest_iv position within trailing-90d min/max
    latest_iv: float | None = None
    open_interest: int | None = None  # SUM(curr_oi) across strikes on latest oi-change date
    liquidity_ok: bool  # whether OI cleared the min_oi gate
    next_earnings_date: date | None = None
    days_to_earnings: int | None = None
    expected_move_pct: float | None = None
    near_earnings: bool = False  # within exclude_earnings_within_days
    composite_score: float  # confidence × coalesce(iv_rank, 0.5) × √max(oi, 1)
    rationale: str | None = None
    has_agent_verdict: bool = True  # False when ticker came from Finviz with no recent PM run


class StockScreenResponse(BaseModel):
    run_ts: datetime | None = None  # latest portfolio_manager run considered
    universe_size: int
    filtered_count: int
    filters: dict[str, Any]
    items: list[StockScreenItem]


class FinvizPreset(BaseModel):
    key: str
    label: str
    thesis: str  # "bullish" or "bearish" — the trade direction this preset implies


class FinvizPresetsResponse(BaseModel):
    presets: list[FinvizPreset]
