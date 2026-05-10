"""Reddit mention browser + catalyst-keyword feed.

GET /v1/reddit/mentions?limit=50&subreddit=all-stocks
  Today's top tickers by mention count, with 7d sparkline data,
  spike ratio, asymmetry flags, and per-subreddit breakdown.

GET /v1/reddit/catalysts (Phase B — separate route)
  Catalyst-flagged Reddit posts (partnership/leak/rumor/FDA/etc.)
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/reddit", tags=["reddit"])


class SubMentions(BaseModel):
    subreddit: str
    mentions: int
    rank: int | None


class MentionRow(BaseModel):
    ticker: str
    name: str | None
    mentions_today: int
    mentions_7d_avg: float
    spike_ratio: float | None
    rank_today: int | None
    rank_7d_ago: int | None
    rank_change_7d: int | None
    upvotes_today: int
    is_contrarian_warning: bool
    is_stealth: bool
    sparkline_7d: list[int]
    by_subreddit: list[SubMentions]


class MentionsResponse(BaseModel):
    snapshot_date: date | None
    n_total: int
    rows: list[MentionRow]


@router.get("/mentions", response_model=MentionsResponse)
async def get_mentions(
    limit: int = Query(50, ge=1, le=300),
    sort: Literal["mentions", "spike", "rank_change"] = Query("mentions"),
) -> MentionsResponse:
    """Top tickers by chatter on the most recent snapshot.

    Joins to per-subreddit mentions for the breakdown column, and to a
    7-day mention history for the sparkline."""
    pool = get_pool()
    sql = """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d FROM reddit_mentions WHERE subreddit = 'all-stocks'
        ),
        today AS (
            SELECT * FROM reddit_mentions, latest
            WHERE subreddit = 'all-stocks' AND snapshot_date = latest.d
        ),
        avg7 AS (
            SELECT ticker, AVG(mentions)::float AS avg_m, MIN(rank) AS best_rank
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date >= (SELECT d FROM latest) - 7
            GROUP BY ticker
        ),
        rank_7d AS (
            SELECT DISTINCT ON (ticker) ticker, rank AS rank_7d_ago
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date <= (SELECT d FROM latest) - 7
            ORDER BY ticker, snapshot_date DESC
        ),
        spark AS (
            SELECT ticker, ARRAY_AGG(mentions ORDER BY snapshot_date) AS hist
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date >= (SELECT d FROM latest) - 7
            GROUP BY ticker
        )
        SELECT
          t.ticker, t.name, t.mentions, t.upvotes, t.rank,
          a.avg_m, r.rank_7d_ago, s.hist
        FROM today t
        LEFT JOIN avg7 a ON a.ticker = t.ticker
        LEFT JOIN rank_7d r ON r.ticker = t.ticker
        LEFT JOIN spark s ON s.ticker = t.ticker
        ORDER BY t.mentions DESC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)

        # Per-subreddit breakdown for the top N tickers (one query, indexed by ticker)
        top_tickers = [r["ticker"] for r in rows[:limit]]
        sub_sql = """
            SELECT ticker, subreddit, mentions, rank
            FROM reddit_mentions
            WHERE subreddit <> 'all-stocks'
              AND ticker = ANY($1::text[])
              AND snapshot_date = (SELECT MAX(snapshot_date) FROM reddit_mentions WHERE subreddit='all-stocks')
        """
        sub_rows = await conn.fetch(sub_sql, top_tickers)

    by_ticker_subs: dict[str, list[SubMentions]] = {}
    for r in sub_rows:
        by_ticker_subs.setdefault(r["ticker"], []).append(SubMentions(
            subreddit=r["subreddit"],
            mentions=int(r["mentions"] or 0),
            rank=int(r["rank"]) if r["rank"] is not None else None,
        ))

    out: list[MentionRow] = []
    snapshot_date: date | None = None
    for r in rows:
        mentions_today = int(r["mentions"] or 0)
        avg_m = float(r["avg_m"] or 0.0)
        spike = (mentions_today / avg_m) if avg_m > 0 else None
        rank_today = int(r["rank"]) if r["rank"] is not None else None
        rank_7d_ago = int(r["rank_7d_ago"]) if r["rank_7d_ago"] is not None else None
        rank_change = (rank_today - rank_7d_ago) if (rank_today is not None and rank_7d_ago is not None) else None
        contrarian = (
            spike is not None and spike > 3.0
            and rank_today is not None and rank_today <= 20
        )
        stealth = mentions_today < 5 and (rank_today is None or rank_today > 100)
        hist = list(r["hist"]) if r["hist"] else []

        out.append(MentionRow(
            ticker=r["ticker"],
            name=r["name"],
            mentions_today=mentions_today,
            mentions_7d_avg=avg_m,
            spike_ratio=spike,
            rank_today=rank_today,
            rank_7d_ago=rank_7d_ago,
            rank_change_7d=rank_change,
            upvotes_today=int(r["upvotes"] or 0),
            is_contrarian_warning=contrarian,
            is_stealth=stealth,
            sparkline_7d=[int(x or 0) for x in hist],
            by_subreddit=by_ticker_subs.get(r["ticker"], []),
        ))

    if not snapshot_date:
        # Pull the snapshot date from the first row's metadata.
        async with pool.acquire() as conn:
            d = await conn.fetchval("SELECT MAX(snapshot_date) FROM reddit_mentions WHERE subreddit='all-stocks'")
            if d:
                snapshot_date = d if isinstance(d, date) else datetime.fromisoformat(str(d)).date()

    # Sort + truncate.
    if sort == "mentions":
        out.sort(key=lambda r: -r.mentions_today)
    elif sort == "spike":
        out.sort(key=lambda r: -(r.spike_ratio or 0))
    elif sort == "rank_change":
        # Most-improved first (most-negative rank_change = climbed the most).
        out.sort(key=lambda r: r.rank_change_7d if r.rank_change_7d is not None else 999)

    return MentionsResponse(
        snapshot_date=snapshot_date,
        n_total=len(rows),
        rows=out[:limit],
    )


# ---------- catalyst-keyword feed ----------


class CatalystPost(BaseModel):
    id: str
    created_at: datetime
    subreddit: str
    author: str | None
    title: str
    permalink: str | None
    tickers: list[str]
    keywords: list[str]
    catalyst_score: float
    hours_old: float


class CatalystsResponse(BaseModel):
    n_total: int
    posts: list[CatalystPost]


@router.get("/catalysts", response_model=CatalystsResponse)
async def get_catalysts(
    limit: int = Query(50, ge=1, le=200),
    min_score: float = Query(0.05, ge=0.0, le=1.0),
    ticker: str | None = Query(None, description="Filter to posts mentioning this ticker"),
    hours: int = Query(48, ge=1, le=168, description="Lookback window in hours"),
) -> CatalystsResponse:
    """Catalyst-flagged Reddit posts ordered by composite score.

    Filter by ticker for "what's the chatter saying about NVDA?". Default
    48-hour window keeps the feed actionable."""
    pool = get_pool()
    if ticker:
        sql = """
            SELECT id, created_at, subreddit, author, title, permalink,
                   tickers, keywords, catalyst_score
            FROM reddit_posts
            WHERE created_at >= NOW() - ($1 || ' hours')::interval
              AND catalyst_score >= $2
              AND $3 = ANY(tickers)
            ORDER BY catalyst_score DESC NULLS LAST, created_at DESC
            LIMIT $4
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, ticker.upper(), limit)
    else:
        sql = """
            SELECT id, created_at, subreddit, author, title, permalink,
                   tickers, keywords, catalyst_score
            FROM reddit_posts
            WHERE created_at >= NOW() - ($1 || ' hours')::interval
              AND catalyst_score >= $2
            ORDER BY catalyst_score DESC NULLS LAST, created_at DESC
            LIMIT $3
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, limit)

    now_utc = datetime.now(UTC)
    posts: list[CatalystPost] = []
    for r in rows:
        ts = r["created_at"]
        # TIMESTAMPTZ rows are always tz-aware; coerce naive defensively.
        ts_aware = ts if ts.tzinfo else ts.replace(tzinfo=UTC)
        delta = (now_utc - ts_aware).total_seconds() / 3600
        posts.append(CatalystPost(
            id=r["id"],
            created_at=ts,
            subreddit=r["subreddit"],
            author=r["author"],
            title=r["title"],
            permalink=r["permalink"],
            tickers=list(r["tickers"]) if r["tickers"] else [],
            keywords=list(r["keywords"]) if r["keywords"] else [],
            catalyst_score=float(r["catalyst_score"] or 0.0),
            hours_old=max(0.0, delta),
        ))

    return CatalystsResponse(n_total=len(posts), posts=posts)
