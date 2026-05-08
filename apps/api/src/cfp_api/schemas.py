"""Pydantic response schemas for the read API.

These define the wire contract between Railway-hosted FastAPI and the Vercel
Next.js dashboard. Keep them stable — any breaking change requires bumping the
v1/ path or the dashboard adapter.
"""

from __future__ import annotations

from datetime import datetime
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
    horizon_d: int | None = None
    n_constituents: int = 0


class SectorsResponse(BaseModel):
    run_ts: datetime | None = None
    sectors: list[SectorEntry]
