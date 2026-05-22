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
    classify_headline,
    fetch_news_for_ticker,
    fetch_news_for_tickers,
    score_news_catalyst,
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


# ---------- catalyst-feed shape ---------------------------------------------
#
# Compatible-ish with the existing CatalystPost shape so the frontend can
# render reddit + news rows through the same code path with a `source`
# discriminant.


class NewsCatalystScoreBreakdown(BaseModel):
    base: float
    recency: float
    trust: float | None
    n_tickers: int
    n_keywords: int


class NewsCatalystItem(BaseModel):
    id: str               # stable hash of url
    created_at: str
    source: str           # always "news" — discriminates from reddit posts
    source_name: str      # which feed: fmp, polygon, yahoo-rss, etc.
    publisher: str | None # e.g. "Reuters", "Bloomberg"
    title: str
    permalink: str
    tickers: list[str]
    keywords: list[str]
    catalyst_score: float
    hours_old: float
    primary_category: str  # mna|regulatory|earnings|insider|partnership|leak|product|other
    sentiment: float | None
    score_breakdown: NewsCatalystScoreBreakdown


class NewsCatalystsResponse(BaseModel):
    n_total: int
    n_sources_used: int
    sources_used: list[str]
    items: list[NewsCatalystItem]


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


@router.get("/catalysts", response_model=NewsCatalystsResponse)
async def news_catalysts(
    tickers: str = Query(
        ...,
        description="comma-separated tickers, max 25. Scope of the news scan.",
    ),
    hours: int = Query(48, ge=1, le=168),
    min_score: float = Query(0.05, ge=0.0, le=1.0),
    limit: int = Query(100, ge=1, le=200),
) -> NewsCatalystsResponse:
    """News-side catalyst feed: classify every recent headline for the given
    tickers into the same M&A / FDA / earnings / etc. taxonomy as Reddit
    posts, then return ranked items in a CatalystPost-compatible shape.

    Returns only items where the headline matched at least one catalyst
    keyword (i.e. primary_category != "other") AND catalyst_score >=
    min_score. Headlines older than `hours` are dropped.
    """
    import hashlib

    raw = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="tickers required")
    if len(raw) > 25:
        raise HTTPException(status_code=400, detail="max 25 tickers per call")

    by_ticker = await fetch_news_for_tickers(raw, per_ticker_limit=20)
    items: list[NewsCatalystItem] = []
    seen_urls: set[str] = set()
    sources_used: set[str] = set()

    for ticker, news in by_ticker.items():
        for n in news:
            if n.hours_old > hours:
                continue
            if n.url in seen_urls:
                continue
            text = n.title
            if n.summary:
                text = f"{n.title}. {n.summary}"
            primary, kws = classify_headline(text)
            if primary == "other" or not kws:
                continue
            score, breakdown = score_news_catalyst(n, kws, n_tickers=1)
            if score < min_score:
                continue
            seen_urls.add(n.url)
            sources_used.add(n.source)
            uid = hashlib.sha1(n.url.encode("utf-8")).hexdigest()[:16]
            items.append(
                NewsCatalystItem(
                    id=f"news-{uid}",
                    created_at=n.published_at.isoformat(),
                    source="news",
                    source_name=n.source,
                    publisher=n.publisher,
                    title=n.title,
                    permalink=n.url,
                    tickers=[ticker],
                    keywords=kws,
                    catalyst_score=round(score, 4),
                    hours_old=round(n.hours_old, 2),
                    primary_category=primary,
                    sentiment=n.sentiment,
                    score_breakdown=NewsCatalystScoreBreakdown(**breakdown),
                )
            )

    items.sort(key=lambda x: (x.catalyst_score, -x.hours_old), reverse=True)
    items = items[:limit]
    return NewsCatalystsResponse(
        n_total=len(items),
        n_sources_used=len(sources_used),
        sources_used=sorted(sources_used),
        items=items,
    )
