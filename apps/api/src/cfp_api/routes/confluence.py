"""Cross-tab confluence — surfaces tickers firing across multiple scanners.

A ticker "fires" on a source when it crosses that source's intensity bar.
The bars are deliberately conservative — easier to relax than tighten.

GET  /v1/confluence/{ticker}      — single ticker, lazy
POST /v1/confluence/batch          — list of tickers, lazy
GET  /v1/confluence/active          — currently-hot tickers (n_sources >= 2)

"Lazy" = if confluence_signals has a row for the ticker computed within the
last 15 minutes, return it. Otherwise compute from the source tables, upsert
into confluence_signals, return. This means the screener only pays the
aggregation cost for tickers actually being viewed.

Source bars (see migration 0038 docstring):
  explosive         — explosive_scores.score >= 70 (top quintile)
  delphi            — ticker in latest top-10 delphi_score on any horizon
  whale             — whale_conviction_signals.score >= 70 last 4h
  reddit_mentions   — top 20 by spike_ratio last 6h
  reddit_catalysts  — >=1 post with catalyst_score >= 0.10 last 24h
  flow              — uw_flow_alert with total_premium >= 1M last 4h
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["confluence"], prefix="/v1/confluence")


# Cache TTL — re-aggregate when a row is older than this. 15 min matches the
# slowest source's cadence (uw-screeners-ingest at :03/:18/:33/:48).
CACHE_TTL = timedelta(minutes=15)


# --- Source thresholds — single source of truth ----------------------------

EXPLOSIVE_MIN_SCORE = 70.0
WHALE_MIN_SCORE = 70.0
REDDIT_MENTIONS_TOP_N = 20
REDDIT_CATALYST_MIN_SCORE = 0.10
FLOW_MIN_PREMIUM_USD = 1_000_000.0
DELPHI_TOP_N = 10


# --- Models -----------------------------------------------------------------


class ConfluenceSource(BaseModel):
    name: str           # "explosive" | "delphi" | "whale" | "reddit_mentions" | "reddit_catalysts" | "flow"
    score: float | None  # source-native score when meaningful
    detail: str         # human-readable one-liner for the source pill


class ConfluenceRow(BaseModel):
    ticker: str
    computed_at: datetime
    n_sources: int
    max_source_score: float | None
    sources: list[ConfluenceSource]
    summary: str | None


class BatchRequest(BaseModel):
    tickers: list[str]


class BatchResponse(BaseModel):
    generated_at: datetime
    rows: list[ConfluenceRow]


# --- Source computation -----------------------------------------------------


async def _compute_sources_for(
    conn, tickers: list[str]
) -> dict[str, list[ConfluenceSource]]:
    """Return {ticker: [sources...]} by querying all six sources once each.

    O(6) queries regardless of how many tickers were requested. Each query
    returns only tickers that fire — the caller assembles per-ticker lists.
    """
    out: dict[str, list[ConfluenceSource]] = {t: [] for t in tickers}

    # 1) explosive — most recent score per ticker, gate at 70.
    rows = await conn.fetch(
        """
        WITH latest AS (
            SELECT ticker, score,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY snapshot_ts DESC) AS rn
            FROM explosive_scores
            WHERE ticker = ANY($1::text[])
        )
        SELECT ticker, score FROM latest WHERE rn = 1 AND score >= $2
        """,
        tickers, EXPLOSIVE_MIN_SCORE,
    )
    for r in rows:
        out[r["ticker"]].append(ConfluenceSource(
            name="explosive",
            score=float(r["score"]),
            detail=f"Explosive {r['score']:.0f}",
        ))

    # 2) delphi — ticker in top-10 by delphi_score on any horizon, latest 12h.
    rows = await conn.fetch(
        """
        WITH ranked AS (
            SELECT ticker, forecast_horizon, delphi_score,
                   ROW_NUMBER() OVER (PARTITION BY forecast_horizon ORDER BY delphi_score DESC) AS rn
            FROM delphi_predictions
            WHERE created_at >= NOW() - INTERVAL '12 hours'
        )
        SELECT ticker, forecast_horizon, delphi_score
        FROM ranked
        WHERE rn <= $2 AND ticker = ANY($1::text[])
        """,
        tickers, DELPHI_TOP_N,
    )
    # A ticker can appear in multiple horizon top-10s; collapse to the best.
    delphi_best: dict[str, tuple[str, float]] = {}
    for r in rows:
        cur = delphi_best.get(r["ticker"])
        if cur is None or float(r["delphi_score"]) > cur[1]:
            delphi_best[r["ticker"]] = (r["forecast_horizon"], float(r["delphi_score"]))
    for ticker, (hz, score) in delphi_best.items():
        out[ticker].append(ConfluenceSource(
            name="delphi",
            score=score,
            detail=f"Delphi {hz} {score:.0f}",
        ))

    # 3) whale conviction — latest 4h window per ticker, gate at 70.
    rows = await conn.fetch(
        """
        WITH latest AS (
            SELECT ticker, score, direction, window_hours,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY window_end DESC) AS rn
            FROM whale_conviction_signals
            WHERE ticker = ANY($1::text[])
              AND window_hours = 4
              AND window_end >= NOW() - INTERVAL '4 hours'
        )
        SELECT ticker, score, direction FROM latest WHERE rn = 1 AND score >= $2
        """,
        tickers, WHALE_MIN_SCORE,
    )
    for r in rows:
        out[r["ticker"]].append(ConfluenceSource(
            name="whale",
            score=float(r["score"]),
            detail=f"Whale {r['direction']} {r['score']:.0f}",
        ))

    # 4) reddit mentions — top 20 by spike ratio in the latest snapshot, all-stocks
    # aggregate. Spike ratio = mentions / mentions_24h_ago.
    rows = await conn.fetch(
        """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d FROM reddit_mentions
        ),
        ranked AS (
            SELECT m.ticker,
                   m.mentions,
                   m.mentions_24h_ago,
                   m.mentions::float / NULLIF(m.mentions_24h_ago, 0) AS spike_ratio
            FROM reddit_mentions m, latest
            WHERE m.snapshot_date = latest.d
              AND m.subreddit = 'all-stocks'
              AND m.mentions IS NOT NULL
              AND m.mentions_24h_ago IS NOT NULL
              AND m.mentions_24h_ago > 0
        )
        SELECT ticker, mentions, mentions_24h_ago, spike_ratio
        FROM ranked
        WHERE ticker = ANY($1::text[])
        ORDER BY spike_ratio DESC NULLS LAST
        LIMIT $2
        """,
        tickers, REDDIT_MENTIONS_TOP_N,
    )
    # We've already filtered to the requested set; only those rows belong here.
    # But the "top 20" semantics is across the whole universe — re-check by
    # joining outside the LIMIT.
    top_rows = await conn.fetch(
        """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d FROM reddit_mentions
        )
        SELECT m.ticker, m.mentions::float / NULLIF(m.mentions_24h_ago, 0) AS spike
        FROM reddit_mentions m, latest
        WHERE m.snapshot_date = latest.d
          AND m.subreddit = 'all-stocks'
          AND m.mentions_24h_ago > 0
        ORDER BY spike DESC NULLS LAST
        LIMIT $1
        """,
        REDDIT_MENTIONS_TOP_N,
    )
    top_set = {r["ticker"]: float(r["spike"]) for r in top_rows if r["spike"] is not None}
    for ticker in tickers:
        if ticker in top_set:
            spike = top_set[ticker]
            out[ticker].append(ConfluenceSource(
                name="reddit_mentions",
                score=spike,
                detail=f"Reddit mentions spike ×{spike:.1f}",
            ))

    # 5) reddit catalysts — any qualifying post in last 24h.
    rows = await conn.fetch(
        """
        SELECT UNNEST(tickers) AS ticker,
               MAX(catalyst_score) AS top_score,
               COUNT(*) AS n_posts
        FROM reddit_posts
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND catalyst_score >= $2
          AND tickers && $1::text[]
        GROUP BY UNNEST(tickers)
        """,
        tickers, REDDIT_CATALYST_MIN_SCORE,
    )
    for r in rows:
        if r["ticker"] not in out:
            continue
        out[r["ticker"]].append(ConfluenceSource(
            name="reddit_catalysts",
            score=float(r["top_score"]),
            detail=f"Reddit catalysts {int(r['n_posts'])} post(s) (top {r['top_score']:.2f})",
        ))

    # 6) flow — any flow alert >= $1M premium in last 4h.
    rows = await conn.fetch(
        """
        SELECT ticker, SUM(total_premium) AS premium_sum, COUNT(*) AS n_alerts
        FROM uw_flow_alerts
        WHERE ticker = ANY($1::text[])
          AND created_at >= NOW() - INTERVAL '4 hours'
          AND total_premium IS NOT NULL
        GROUP BY ticker
        HAVING SUM(total_premium) >= $2
        """,
        tickers, FLOW_MIN_PREMIUM_USD,
    )
    for r in rows:
        premium_m = float(r["premium_sum"]) / 1_000_000.0
        out[r["ticker"]].append(ConfluenceSource(
            name="flow",
            score=float(r["premium_sum"]),
            detail=f"Flow ${premium_m:.1f}M in {int(r['n_alerts'])} alert(s)",
        ))

    return out


def _build_summary(ticker: str, sources: list[ConfluenceSource]) -> str:
    if not sources:
        return f"{ticker}: no active sources"
    names = ", ".join(s.name for s in sources)
    return f"{ticker}: {len(sources)} sources active — {names}"


async def _upsert_confluence(
    conn, ticker: str, sources: list[ConfluenceSource]
) -> ConfluenceRow:
    max_score = max((s.score for s in sources if s.score is not None), default=None)
    summary = _build_summary(ticker, sources)
    sources_json = json.dumps([s.model_dump() for s in sources])
    now = datetime.now(timezone.utc)

    await conn.execute(
        """
        INSERT INTO confluence_signals (
            ticker, computed_at, n_sources, max_source_score, sources, summary
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (ticker) DO UPDATE SET
            computed_at = EXCLUDED.computed_at,
            n_sources = EXCLUDED.n_sources,
            max_source_score = EXCLUDED.max_source_score,
            sources = EXCLUDED.sources,
            summary = EXCLUDED.summary
        """,
        ticker, now, len(sources), max_score, sources_json, summary,
    )

    return ConfluenceRow(
        ticker=ticker,
        computed_at=now,
        n_sources=len(sources),
        max_source_score=max_score,
        sources=sources,
        summary=summary,
    )


def _row_to_model(r: dict) -> ConfluenceRow:
    raw_sources = r["sources"]
    if isinstance(raw_sources, str):
        raw_sources = json.loads(raw_sources)
    return ConfluenceRow(
        ticker=r["ticker"],
        computed_at=r["computed_at"],
        n_sources=r["n_sources"] or 0,
        max_source_score=r["max_source_score"],
        sources=[ConfluenceSource(**s) for s in (raw_sources or [])],
        summary=r["summary"],
    )


async def _resolve_confluence(
    tickers: list[str], force_refresh: bool = False
) -> list[ConfluenceRow]:
    """Lazy resolver — read cache, recompute stale rows in one batch."""
    if not tickers:
        return []
    tickers = [t.upper() for t in tickers if t]
    pool = get_pool()
    async with pool.acquire() as conn:
        if force_refresh:
            cached: dict[str, ConfluenceRow] = {}
            stale = list(tickers)
        else:
            cutoff = datetime.now(timezone.utc) - CACHE_TTL
            cached_rows = await conn.fetch(
                """
                SELECT * FROM confluence_signals
                WHERE ticker = ANY($1::text[])
                  AND computed_at >= $2
                """,
                tickers, cutoff,
            )
            cached = {r["ticker"]: _row_to_model(dict(r)) for r in cached_rows}
            stale = [t for t in tickers if t not in cached]

        if stale:
            fresh = await _compute_sources_for(conn, stale)
            for ticker in stale:
                row = await _upsert_confluence(conn, ticker, fresh.get(ticker, []))
                cached[ticker] = row

    return [cached[t] for t in tickers if t in cached]


# --- Routes -----------------------------------------------------------------


@router.get("/{ticker}", response_model=ConfluenceRow)
async def get_one(ticker: str, refresh: bool = Query(False)) -> ConfluenceRow:
    rows = await _resolve_confluence([ticker], force_refresh=refresh)
    if not rows:
        raise HTTPException(status_code=404, detail="ticker not resolvable")
    return rows[0]


@router.post("/batch", response_model=BatchResponse)
async def batch(req: BatchRequest, refresh: bool = Query(False)) -> BatchResponse:
    if len(req.tickers) > 200:
        raise HTTPException(status_code=400, detail="max 200 tickers per batch")
    rows = await _resolve_confluence(req.tickers, force_refresh=refresh)
    return BatchResponse(generated_at=datetime.now(timezone.utc), rows=rows)


async def _seed_universe(conn, max_total: int = 100) -> list[str]:
    """Build the seed list the /confluence page warms its leaderboard with.

    Pulls top scorers across the upstream tables — these are the tickers
    most likely to fire on multiple confluence sources. Deduped, capped.
    """
    out: list[str] = []
    seen: set[str] = set()

    def _add(rows, key="ticker"):
        for r in rows:
            t = r[key]
            if t and t not in seen:
                seen.add(t)
                out.append(t)

    explosive_rows = await conn.fetch(
        """
        WITH latest AS (
            SELECT ticker, score,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY snapshot_ts DESC) AS rn
            FROM explosive_scores
        )
        SELECT ticker FROM latest WHERE rn = 1
        ORDER BY score DESC NULLS LAST LIMIT 50
        """
    )
    _add(explosive_rows)

    delphi_rows = await conn.fetch(
        """
        SELECT DISTINCT ticker FROM delphi_predictions
        WHERE created_at >= NOW() - INTERVAL '12 hours'
        ORDER BY ticker
        LIMIT 50
        """
    )
    _add(delphi_rows)

    whale_rows = await conn.fetch(
        """
        SELECT DISTINCT ticker FROM whale_conviction_signals
        WHERE window_end >= NOW() - INTERVAL '4 hours'
          AND score >= 60
        ORDER BY ticker
        LIMIT 30
        """
    )
    _add(whale_rows)

    return out[:max_total]


@router.get("/active", response_model=BatchResponse)
async def active(
    min_sources: int = Query(2, ge=1, le=6),
    limit: int = Query(50, ge=1, le=200),
    seed: bool = Query(False, description="When true, recompute confluence over a seed universe first."),
) -> BatchResponse:
    """Currently-hot tickers.

    Default reads the cache only — fast, no extra DB work. With `seed=true`,
    first pulls the seed universe (top explosive + delphi + whale), runs
    confluence aggregation across it, then returns the leaderboard. The
    /confluence page uses seed=true on mount + plain reads on subsequent polls.
    """
    pool = get_pool()
    if seed:
        async with pool.acquire() as conn:
            tickers = await _seed_universe(conn)
        if tickers:
            await _resolve_confluence(tickers, force_refresh=False)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM confluence_signals
            WHERE n_sources >= $1
              AND computed_at >= NOW() - INTERVAL '1 hour'
            ORDER BY n_sources DESC, max_source_score DESC NULLS LAST, computed_at DESC
            LIMIT $2
            """,
            min_sources, limit,
        )
    return BatchResponse(
        generated_at=datetime.now(timezone.utc),
        rows=[_row_to_model(dict(r)) for r in rows],
    )
