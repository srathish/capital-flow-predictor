"""News aggregator endpoints — multi-source headlines for the chatter board.

  GET /v1/news/ticker/{ticker}?limit=30
    Merged + deduped + confidence-ranked news for a single ticker. Powers
    the click-through drawer on /reddit.

  GET /v1/news/recent?tickers=AAPL,MSFT&limit=10
    Batched per-ticker news for the leaderboard composite score. Bounded
    concurrency so free-tier rate limits stay sane.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.news_aggregator import (
    fetch_news_for_ticker,
    fetch_news_for_tickers,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/news", tags=["news"])


class NewsItemModel(BaseModel):
    source: str
    ticker: str
    title: str
    url: str
    publisher: str | None
    published_at: str
    summary: str | None
    image_url: str | None
    sentiment: float | None
    hours_old: float
    score: float


class TickerNewsResponse(BaseModel):
    ticker: str
    n_items: int
    sources_used: list[str]
    items: list[NewsItemModel]


class RecentNewsResponse(BaseModel):
    n_tickers: int
    items_by_ticker: dict[str, list[NewsItemModel]]


@router.get("/ticker/{ticker}", response_model=TickerNewsResponse)
async def ticker_news(
    ticker: str,
    limit: int = Query(30, ge=1, le=100),
) -> TickerNewsResponse:
    items = await fetch_news_for_ticker(ticker, limit=limit)
    if not items and not ticker.isalnum():
        raise HTTPException(status_code=400, detail="invalid ticker")
    sources_used = sorted({i.source for i in items})
    return TickerNewsResponse(
        ticker=ticker.upper(),
        n_items=len(items),
        sources_used=sources_used,
        items=[NewsItemModel(**i.to_dict()) for i in items],
    )


@router.get("/recent", response_model=RecentNewsResponse)
async def recent_news(
    tickers: str = Query(..., description="comma-separated tickers, max 25"),
    limit: int = Query(8, ge=1, le=20),
) -> RecentNewsResponse:
    raw = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="tickers required")
    if len(raw) > 25:
        raise HTTPException(status_code=400, detail="max 25 tickers per call")
    by_ticker = await fetch_news_for_tickers(raw, per_ticker_limit=limit)
    return RecentNewsResponse(
        n_tickers=len(by_ticker),
        items_by_ticker={
            t: [NewsItemModel(**i.to_dict()) for i in items]
            for t, items in by_ticker.items()
        },
    )
