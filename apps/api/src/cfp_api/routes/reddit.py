"""Reddit mention browser + catalyst-keyword feed.

GET /v1/reddit/mentions
  Top tickers on the latest Apewisdom snapshot, enriched with:
   - sentiment_bull_share (from reddit_posts catalyst keywords, last 7d)
   - price_change_1d / price_change_5d (from prices_daily)
   - momentum_score (slope of last-7d mention count, normalized)
   - days_in_top20_14d (count of recent snapshots ranked ≤20)
   - is_first_time_entrant (no top-100 appearance in the prior 30d)
   - audience_skew ("wsb" | "investing" | "mixed")
   - catalyst_post_count (reddit_posts touching this ticker, last 48h)
   - mentions_last_6h (live count from reddit_posts — ahead of Apewisdom)
   - sparkline_7d / per-subreddit breakdown / contrarian + stealth flags

  Filters: q, sector, exclude_meme, watchlist.
  Sorts: mentions | spike | rank_change | momentum.

GET /v1/reddit/catalysts
  Catalyst-flagged Reddit posts ordered by composite score.

GET /v1/reddit/backtest
  Aggregate stats: do mention spikes lead price moves? Returns the mean 5d
  forward return for tickers with spike_ratio ≥ threshold.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/reddit", tags=["reddit"])


# ---------- catalyst keyword sentiment buckets ----------
#
# Used to derive a per-ticker bull/bear share from reddit_posts.keywords.
# Anything not listed below is treated as neutral and ignored.

_BULLISH_KEYWORDS: frozenset[str] = frozenset({
    "partnership", "partner with", "deal with", "agreement with",
    "acquisition", "acquired", "acquires", "acquiring", "buyout", "takeover",
    "fda approval", "fda approves", "fda clearance",
    "raised guidance",
    "earnings beat", "beat estimates",
    "insider buy", "insider purchase",
    "contract", "contract win", "awarded",
    "buyback", "share repurchase", "dividend hike",
    "ipo",
})

_BEARISH_KEYWORDS: frozenset[str] = frozenset({
    "trial fail",
    "lowered guidance",
    "missed estimates",
    "insider selling",
    "investigation", "lawsuit", "settlement",
    "ceo steps down",
    "halt", "halted", "delisted",
})

# Perma-WSB names — the floor noise we let users hide.
_MEME_TICKERS: frozenset[str] = frozenset({
    "GME", "AMC", "BBBY", "MULN", "KOSS", "BB", "ATER", "DJT", "NOK",
})


# ---------- response models ----------


class SubMentions(BaseModel):
    subreddit: str
    mentions: int
    rank: int | None


class MentionRow(BaseModel):
    ticker: str
    name: str | None
    sector: str | None
    mentions_today: int
    mentions_7d_avg: float
    spike_ratio: float | None
    rank_today: int | None
    rank_7d_ago: int | None
    rank_change_7d: int | None
    upvotes_today: int
    is_contrarian_warning: bool
    is_stealth: bool
    is_first_time_entrant: bool
    is_meme: bool
    sparkline_7d: list[int]
    by_subreddit: list[SubMentions]
    audience_skew: Literal["wsb", "investing", "mixed", "unknown"]
    momentum_score: float | None
    days_in_top20_14d: int
    sentiment_bull_share: float | None
    n_bullish_kw: int
    n_bearish_kw: int
    price_change_1d: float | None
    price_change_5d: float | None
    catalyst_post_count: int
    mentions_last_6h: int


class BacktestSlice(BaseModel):
    spike_threshold: float
    n_observations: int
    mean_5d_return_pct: float | None
    win_rate: float | None  # fraction of events with positive 5d return


class MentionsResponse(BaseModel):
    snapshot_date: date | None
    snapshot_age_hours: float | None
    n_total: int
    rows: list[MentionRow]
    backtest: list[BacktestSlice] | None = None


# ---------- helpers ----------


def _audience_skew(by_sub: list[SubMentions]) -> Literal["wsb", "investing", "mixed", "unknown"]:
    """Classify by where the chatter concentrates. WSB-skew = degens; investing-
    skew = quality/boring; mixed = real broad interest."""
    if not by_sub:
        return "unknown"
    total = sum(s.mentions for s in by_sub) or 0
    if total == 0:
        return "unknown"
    wsb = next((s.mentions for s in by_sub if s.subreddit == "wallstreetbets"), 0)
    inv = sum(
        s.mentions for s in by_sub
        if s.subreddit in {"investing", "stocks", "SecurityAnalysis", "ValueInvesting"}
    )
    wsb_share = wsb / total
    inv_share = inv / total
    if wsb_share >= 0.7:
        return "wsb"
    if inv_share >= 0.7:
        return "investing"
    return "mixed"


def _momentum_slope(hist: list[int]) -> float | None:
    """Linear-regression slope over the last-N mention series, normalized by
    the series mean. Positive = chatter accelerating, negative = decaying.
    Returns None if the series is too short or flat at zero."""
    n = len(hist)
    if n < 3:
        return None
    mean_y = sum(hist) / n
    if mean_y == 0:
        return None
    # x is 0..n-1, y is hist
    mean_x = (n - 1) / 2.0
    num = sum((i - mean_x) * (hist[i] - mean_y) for i in range(n))
    den = sum((i - mean_x) ** 2 for i in range(n))
    if den == 0:
        return None
    slope = num / den
    return slope / mean_y  # normalized: +0.3 means ~+30% per day on the trend


# ---------- /mentions ----------


@router.get("/mentions", response_model=MentionsResponse)
async def get_mentions(
    limit: int = Query(60, ge=1, le=300),
    sort: Literal["mentions", "spike", "rank_change", "momentum"] = Query("mentions"),
    q: str | None = Query(None, description="Ticker prefix search (case-insensitive)"),
    sector: str | None = Query(None, description="Filter to tickers in this watchlist sector"),
    exclude_meme: bool = Query(False, description="Drop perma-WSB names (GME, AMC, …)"),
    watchlist: bool = Query(False, description="Restrict to tickers in the latest watchlists run"),
    backtest: bool = Query(False, description="Include 5d forward-return aggregates by spike bucket"),
) -> MentionsResponse:
    pool = get_pool()

    main_sql = """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d FROM reddit_mentions WHERE subreddit = 'all-stocks'
        ),
        today AS (
            SELECT * FROM reddit_mentions, latest
            WHERE subreddit = 'all-stocks' AND snapshot_date = latest.d
        ),
        avg7 AS (
            SELECT ticker, AVG(mentions)::float AS avg_m
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date BETWEEN (SELECT d FROM latest) - 7
                                    AND (SELECT d FROM latest) - 1
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
              AND snapshot_date >= (SELECT d FROM latest) - 6
            GROUP BY ticker
        ),
        days_top20 AS (
            SELECT ticker, COUNT(*)::int AS n
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date >= (SELECT d FROM latest) - 13
              AND rank IS NOT NULL AND rank <= 20
            GROUP BY ticker
        ),
        prior_30d AS (
            SELECT ticker, COUNT(*)::int AS n_appearances
            FROM reddit_mentions
            WHERE subreddit = 'all-stocks'
              AND snapshot_date BETWEEN (SELECT d FROM latest) - 30
                                    AND (SELECT d FROM latest) - 1
              AND rank IS NOT NULL AND rank <= 100
            GROUP BY ticker
        )
        SELECT
          t.ticker, t.name, t.mentions, t.upvotes, t.rank, t.last_fetched,
          a.avg_m, r.rank_7d_ago, s.hist,
          COALESCE(d.n, 0) AS days_top20_14d,
          COALESCE(p.n_appearances, 0) AS prior_appearances_30d
        FROM today t
        LEFT JOIN avg7 a       ON a.ticker = t.ticker
        LEFT JOIN rank_7d r    ON r.ticker = t.ticker
        LEFT JOIN spark s      ON s.ticker = t.ticker
        LEFT JOIN days_top20 d ON d.ticker = t.ticker
        LEFT JOIN prior_30d p  ON p.ticker = t.ticker
        ORDER BY t.mentions DESC
    """

    sub_sql = """
        SELECT ticker, subreddit, mentions, rank
        FROM reddit_mentions
        WHERE subreddit <> 'all-stocks'
          AND ticker = ANY($1::text[])
          AND snapshot_date = (
            SELECT MAX(snapshot_date) FROM reddit_mentions WHERE subreddit='all-stocks'
          )
    """

    # Sector lookup uses the latest watchlists run.
    sector_sql = """
        WITH last_run AS (SELECT MAX(run_ts) AS rt FROM watchlists)
        SELECT ticker, sector
        FROM watchlists
        WHERE run_ts = (SELECT rt FROM last_run)
          AND ticker = ANY($1::text[])
    """

    # Watchlist allowlist (latest run only).
    watchlist_sql = """
        WITH last_run AS (SELECT MAX(run_ts) AS rt FROM watchlists)
        SELECT DISTINCT ticker FROM watchlists WHERE run_ts = (SELECT rt FROM last_run)
    """

    # Catalyst-keyword aggregates over the last 7d.
    # NOTE: we unnest both tickers AND keywords and ARRAY_AGG the scalar `kw`.
    # Aggregating `keywords` directly yields a 2-D text array which postgres
    # rejects when posts have different keyword counts ("cannot accumulate
    # arrays of different dimensionality"). Counting posts requires
    # COUNT(DISTINCT id) since the keyword unnest multiplies rows.
    posts_sql = """
        SELECT t AS ticker,
               COUNT(DISTINCT p.id) FILTER (WHERE p.created_at >= NOW() - INTERVAL '48 hours') AS n_48h,
               COUNT(DISTINCT p.id) FILTER (WHERE p.created_at >= NOW() - INTERVAL '6 hours') AS n_6h,
               ARRAY_AGG(kw) AS kws_flat
        FROM reddit_posts p, UNNEST(p.tickers) AS t, UNNEST(p.keywords) AS kw
        WHERE p.created_at >= NOW() - INTERVAL '7 days'
          AND t = ANY($1::text[])
        GROUP BY t
    """

    # Prices: for each ticker, get latest 6 closes (most recent first).
    prices_sql = """
        WITH ranked AS (
            SELECT symbol, ts, close,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
            FROM prices_daily
            WHERE symbol = ANY($1::text[])
              AND ts >= NOW() - INTERVAL '20 days'
        )
        SELECT symbol,
               MAX(close) FILTER (WHERE rn = 1) AS px0,
               MAX(close) FILTER (WHERE rn = 2) AS px_1,
               MAX(close) FILTER (WHERE rn = 6) AS px_5
        FROM ranked
        GROUP BY symbol
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(main_sql)
        all_tickers = [r["ticker"] for r in rows]
        if not all_tickers:
            return MentionsResponse(
                snapshot_date=None,
                snapshot_age_hours=None,
                n_total=0,
                rows=[],
                backtest=None,
            )

        # All look-ups bounded to the universe of tickers we actually have today.
        sub_rows = await conn.fetch(sub_sql, all_tickers)
        sec_rows = await conn.fetch(sector_sql, all_tickers)
        post_rows = await conn.fetch(posts_sql, all_tickers)
        price_rows = await conn.fetch(prices_sql, all_tickers)
        wl_rows: list = []
        if watchlist:
            wl_rows = await conn.fetch(watchlist_sql)

    # Index lookup tables.
    by_ticker_subs: dict[str, list[SubMentions]] = {}
    for r in sub_rows:
        by_ticker_subs.setdefault(r["ticker"], []).append(SubMentions(
            subreddit=r["subreddit"],
            mentions=int(r["mentions"] or 0),
            rank=int(r["rank"]) if r["rank"] is not None else None,
        ))

    sector_map: dict[str, str] = {r["ticker"]: r["sector"] for r in sec_rows}

    sentiment_map: dict[str, tuple[int, int, int, int]] = {}
    # ticker -> (n_bullish_kw, n_bearish_kw, catalyst_post_count_48h, mentions_last_6h)
    for r in post_rows:
        n_bull = 0
        n_bear = 0
        for kw in (r["kws_flat"] or []):
            if kw in _BULLISH_KEYWORDS:
                n_bull += 1
            elif kw in _BEARISH_KEYWORDS:
                n_bear += 1
        sentiment_map[r["ticker"]] = (
            n_bull,
            n_bear,
            int(r["n_48h"] or 0),
            int(r["n_6h"] or 0),
        )

    price_map: dict[str, tuple[float | None, float | None, float | None]] = {}
    for r in price_rows:
        price_map[r["symbol"]] = (
            float(r["px0"]) if r["px0"] is not None else None,
            float(r["px_1"]) if r["px_1"] is not None else None,
            float(r["px_5"]) if r["px_5"] is not None else None,
        )

    wl_set: set[str] | None = {r["ticker"] for r in wl_rows} if watchlist else None

    # Snapshot freshness.
    snapshot_date: date | None = None
    snapshot_age_hours: float | None = None
    if rows:
        first = rows[0]
        d = first["last_fetched"]
        if isinstance(d, datetime):
            d_aware = d if d.tzinfo else d.replace(tzinfo=UTC)
            snapshot_age_hours = max(0.0, (datetime.now(UTC) - d_aware).total_seconds() / 3600)
        async with pool.acquire() as conn:
            sd = await conn.fetchval(
                "SELECT MAX(snapshot_date) FROM reddit_mentions WHERE subreddit='all-stocks'"
            )
            if sd:
                snapshot_date = sd if isinstance(sd, date) else datetime.fromisoformat(str(sd)).date()

    # Build rows.
    out: list[MentionRow] = []
    q_upper = (q or "").strip().upper()

    for r in rows:
        ticker = r["ticker"]

        if q_upper and not ticker.startswith(q_upper):
            continue
        if exclude_meme and ticker in _MEME_TICKERS:
            continue
        if sector and sector_map.get(ticker) != sector:
            continue
        if wl_set is not None and ticker not in wl_set:
            continue

        mentions_today = int(r["mentions"] or 0)
        avg_m = float(r["avg_m"] or 0.0)
        spike = (mentions_today / avg_m) if avg_m > 0 else None
        rank_today = int(r["rank"]) if r["rank"] is not None else None
        rank_7d_ago = int(r["rank_7d_ago"]) if r["rank_7d_ago"] is not None else None
        rank_change = (
            rank_today - rank_7d_ago
            if (rank_today is not None and rank_7d_ago is not None)
            else None
        )
        contrarian = (
            spike is not None and spike > 3.0
            and rank_today is not None and rank_today <= 20
        )
        stealth = mentions_today < 5 and (rank_today is None or rank_today > 100)
        hist = [int(x or 0) for x in (r["hist"] or [])]
        is_first_time = int(r["prior_appearances_30d"] or 0) == 0 and rank_today is not None and rank_today <= 100

        subs = by_ticker_subs.get(ticker, [])
        skew = _audience_skew(subs)

        n_bull, n_bear, n_48h, n_6h = sentiment_map.get(ticker, (0, 0, 0, 0))
        bull_share: float | None
        if n_bull + n_bear == 0:
            bull_share = None
        else:
            bull_share = n_bull / (n_bull + n_bear)

        px0, px1, px5 = price_map.get(ticker, (None, None, None))
        chg_1d = ((px0 - px1) / px1 * 100.0) if (px0 is not None and px1) else None
        chg_5d = ((px0 - px5) / px5 * 100.0) if (px0 is not None and px5) else None

        out.append(MentionRow(
            ticker=ticker,
            name=r["name"],
            sector=sector_map.get(ticker),
            mentions_today=mentions_today,
            mentions_7d_avg=avg_m,
            spike_ratio=spike,
            rank_today=rank_today,
            rank_7d_ago=rank_7d_ago,
            rank_change_7d=rank_change,
            upvotes_today=int(r["upvotes"] or 0),
            is_contrarian_warning=contrarian,
            is_stealth=stealth,
            is_first_time_entrant=is_first_time,
            is_meme=ticker in _MEME_TICKERS,
            sparkline_7d=hist,
            by_subreddit=subs,
            audience_skew=skew,
            momentum_score=_momentum_slope(hist),
            days_in_top20_14d=int(r["days_top20_14d"] or 0),
            sentiment_bull_share=bull_share,
            n_bullish_kw=n_bull,
            n_bearish_kw=n_bear,
            price_change_1d=chg_1d,
            price_change_5d=chg_5d,
            catalyst_post_count=n_48h,
            mentions_last_6h=n_6h,
        ))

    if sort == "mentions":
        out.sort(key=lambda r: -r.mentions_today)
    elif sort == "spike":
        out.sort(key=lambda r: -(r.spike_ratio or 0))
    elif sort == "rank_change":
        out.sort(key=lambda r: r.rank_change_7d if r.rank_change_7d is not None else 999)
    elif sort == "momentum":
        out.sort(key=lambda r: -(r.momentum_score or -math.inf))

    backtest_slices: list[BacktestSlice] | None = None
    if backtest:
        backtest_slices = await _compute_backtest()

    return MentionsResponse(
        snapshot_date=snapshot_date,
        snapshot_age_hours=snapshot_age_hours,
        n_total=len(out),
        rows=out[:limit],
        backtest=backtest_slices,
    )


# ---------- /backtest ----------


async def _compute_backtest() -> list[BacktestSlice]:
    """Mean 5d forward return for tickers whose mention count spiked above
    each threshold. Cheap one-shot — runs over the last 60d of snapshots."""
    pool = get_pool()
    sql = """
        WITH events AS (
            SELECT m.ticker, m.snapshot_date, m.mentions,
                   AVG(m2.mentions) AS avg7
            FROM reddit_mentions m
            JOIN reddit_mentions m2
              ON m2.ticker = m.ticker
             AND m2.subreddit = 'all-stocks'
             AND m2.snapshot_date BETWEEN m.snapshot_date - 7 AND m.snapshot_date - 1
            WHERE m.subreddit = 'all-stocks'
              AND m.snapshot_date >= CURRENT_DATE - 60
              AND m.snapshot_date <= CURRENT_DATE - 5
            GROUP BY m.ticker, m.snapshot_date, m.mentions
        ),
        priced AS (
            SELECT e.ticker, e.snapshot_date, e.mentions, e.avg7,
                   (e.mentions::float / NULLIF(e.avg7, 0)) AS spike,
                   p0.close AS px0,
                   p5.close AS px5
            FROM events e
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = e.ticker AND ts::date <= e.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) p0 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = e.ticker AND ts::date <= e.snapshot_date + 5
                ORDER BY ts DESC LIMIT 1
            ) p5 ON true
            WHERE p0.close IS NOT NULL AND p5.close IS NOT NULL
        )
        SELECT
          COUNT(*) AS n,
          AVG((px5 - px0) / px0 * 100.0) AS mean_5d,
          AVG(CASE WHEN px5 > px0 THEN 1.0 ELSE 0.0 END) AS win_rate,
          (CASE
            WHEN spike >= 5.0 THEN 5.0
            WHEN spike >= 3.0 THEN 3.0
            WHEN spike >= 1.5 THEN 1.5
            ELSE 0.0
          END) AS bucket
        FROM priced
        WHERE spike IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket
    """
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(sql)
        except Exception as e:
            log.warning("backtest query failed: %s", e)
            return []

    out: list[BacktestSlice] = []
    for r in rows:
        bucket = float(r["bucket"] or 0)
        if bucket == 0.0:
            continue  # skip the no-spike base bucket — confounds the lift signal
        out.append(BacktestSlice(
            spike_threshold=bucket,
            n_observations=int(r["n"] or 0),
            mean_5d_return_pct=float(r["mean_5d"]) if r["mean_5d"] is not None else None,
            win_rate=float(r["win_rate"]) if r["win_rate"] is not None else None,
        ))
    return out


@router.get("/backtest", response_model=list[BacktestSlice])
async def get_backtest() -> list[BacktestSlice]:
    """Standalone endpoint for the same backtest stats so the front-end can
    lazy-load it without slowing the main /mentions request."""
    return await _compute_backtest()


# ---------- catalyst-keyword feed ----------


class CatalystScoreBreakdown(BaseModel):
    """Components of the composite catalyst_score so the UI can show *why*
    a post scored highly. The stored score is frozen at ingest, so these are
    derived from the formula using the post's current hours_old + ticker /
    keyword counts; trust is inferred as the residual."""
    base: float            # min(log(1+n_t)*log(1+n_k)/3, 1) — breadth factor
    recency: float         # 1.0 (≤6h) decaying linearly to 0.2 (≥48h)
    trust: float | None    # author-trust factor, inferred from score / (base*recency)
    n_tickers: int
    n_keywords: int


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
    # Engagement (best-effort from RSS — may be 0 for very fresh posts)
    upvotes: int | None
    num_comments: int | None
    # Score breakdown
    score_breakdown: CatalystScoreBreakdown
    # Price reaction for the *first* (lead) ticker. Daily granularity only —
    # `prices_daily` is the finest source we have. Returns are in percent.
    lead_ticker: str | None
    price_at_post: float | None          # close on/before created_at
    price_next_day: float | None         # next trading day close
    price_now: float | None              # latest close
    return_next_day_pct: float | None    # (price_next_day / price_at_post - 1) * 100
    return_since_post_pct: float | None  # (price_now / price_at_post - 1) * 100


class CatalystsResponse(BaseModel):
    n_total: int
    posts: list[CatalystPost]


def _score_breakdown(
    n_tickers: int,
    n_keywords: int,
    hours_old: float,
    stored_score: float,
) -> CatalystScoreBreakdown:
    """Reconstruct score components from the same formula used at ingest
    (apps/jobs/.../reddit_rss.py:_catalyst_score). `trust` is the residual
    once base + recency are factored out — exact for the frozen stored
    score even though hours_old has drifted since ingest."""
    if n_tickers == 0 or n_keywords == 0:
        return CatalystScoreBreakdown(
            base=0.0, recency=0.0, trust=None,
            n_tickers=n_tickers, n_keywords=n_keywords,
        )
    base = min(math.log(1 + n_tickers) * math.log(1 + n_keywords) / 3.0, 1.0)
    if hours_old <= 6:
        recency = 1.0
    elif hours_old >= 48:
        recency = 0.2
    else:
        recency = 1.0 - 0.8 * (hours_old - 6) / 42.0
    trust: float | None = None
    denom = base * recency
    if denom > 1e-9:
        t = stored_score / denom
        # Trust is bounded 0.5..1.0 by construction; clamp to that range.
        trust = max(0.5, min(1.0, t))
    return CatalystScoreBreakdown(
        base=base, recency=recency, trust=trust,
        n_tickers=n_tickers, n_keywords=n_keywords,
    )


@router.get("/catalysts", response_model=CatalystsResponse)
async def get_catalysts(
    limit: int = Query(50, ge=1, le=200),
    min_score: float = Query(0.05, ge=0.0, le=1.0),
    ticker: str | None = Query(None, description="Filter to posts mentioning this ticker"),
    hours: int = Query(48, ge=1, le=168, description="Lookback window in hours"),
) -> CatalystsResponse:
    """Catalyst-flagged Reddit posts ordered by composite score, enriched
    with engagement (upvotes/comments), score breakdown, and lead-ticker
    price reaction (daily granularity)."""
    pool = get_pool()
    # LATERAL joins compute the lead-ticker price reaction inline. Cost is
    # bounded — `tickers` is GIN-indexed and prices_daily has (symbol, ts)
    # locality, so each LATERAL is a single index probe.
    base_select = """
        SELECT
            p.id, p.created_at, p.subreddit, p.author, p.title, p.permalink,
            p.tickers, p.keywords, p.catalyst_score,
            p.upvotes, p.num_comments,
            (CASE WHEN array_length(p.tickers, 1) > 0 THEN p.tickers[1] END) AS lead_ticker,
            p0.close AS price_at_post,
            p1.close AS price_next_day,
            pnow.close AS price_now
        FROM reddit_posts p
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
              AND ts <= p.created_at
            ORDER BY ts DESC LIMIT 1
        ) p0 ON true
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
              AND ts > p.created_at
            ORDER BY ts ASC LIMIT 1
        ) p1 ON true
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE p.tickers IS NOT NULL AND array_length(p.tickers, 1) > 0
              AND symbol = p.tickers[1]
            ORDER BY ts DESC LIMIT 1
        ) pnow ON true
    """
    if ticker:
        sql = (
            base_select
            + """
            WHERE p.created_at >= NOW() - ($1 || ' hours')::interval
              AND p.catalyst_score >= $2
              AND $3 = ANY(p.tickers)
            ORDER BY p.catalyst_score DESC NULLS LAST, p.created_at DESC
            LIMIT $4
        """
        )
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, ticker.upper(), limit)
    else:
        sql = (
            base_select
            + """
            WHERE p.created_at >= NOW() - ($1 || ' hours')::interval
              AND p.catalyst_score >= $2
            ORDER BY p.catalyst_score DESC NULLS LAST, p.created_at DESC
            LIMIT $3
        """
        )
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, str(hours), min_score, limit)

    now_utc = datetime.now(UTC)
    posts: list[CatalystPost] = []
    for r in rows:
        ts = r["created_at"]
        ts_aware = ts if ts.tzinfo else ts.replace(tzinfo=UTC)
        delta = (now_utc - ts_aware).total_seconds() / 3600
        tickers_list = list(r["tickers"]) if r["tickers"] else []
        keywords_list = list(r["keywords"]) if r["keywords"] else []
        stored_score = float(r["catalyst_score"] or 0.0)

        px0 = float(r["price_at_post"]) if r["price_at_post"] is not None else None
        px1 = float(r["price_next_day"]) if r["price_next_day"] is not None else None
        pxn = float(r["price_now"]) if r["price_now"] is not None else None
        ret_next = ((px1 / px0) - 1.0) * 100.0 if (px0 and px1 and px0 > 0) else None
        ret_since = ((pxn / px0) - 1.0) * 100.0 if (px0 and pxn and px0 > 0) else None
        # If the latest close *is* the close-at-post (post predates only one
        # bar), there's no "since post" move yet — suppress the 0% noise.
        if ret_since is not None and px0 == pxn:
            ret_since = None

        posts.append(CatalystPost(
            id=r["id"],
            created_at=ts,
            subreddit=r["subreddit"],
            author=r["author"],
            title=r["title"],
            permalink=r["permalink"],
            tickers=tickers_list,
            keywords=keywords_list,
            catalyst_score=stored_score,
            hours_old=max(0.0, delta),
            upvotes=int(r["upvotes"]) if r["upvotes"] is not None else None,
            num_comments=int(r["num_comments"]) if r["num_comments"] is not None else None,
            score_breakdown=_score_breakdown(
                len(tickers_list), len(keywords_list), max(0.0, delta), stored_score,
            ),
            lead_ticker=r["lead_ticker"],
            price_at_post=px0,
            price_next_day=px1,
            price_now=pxn,
            return_next_day_pct=ret_next,
            return_since_post_pct=ret_since,
        ))

    return CatalystsResponse(n_total=len(posts), posts=posts)
