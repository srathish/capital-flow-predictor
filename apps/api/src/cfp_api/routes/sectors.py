"""GET /v1/sectors — sector list, rank history, scorecard, and per-ETF holdings."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.schemas import SectorEntry, SectorsResponse

router = APIRouter(prefix="/v1/sectors", tags=["sectors"])


@router.get("", response_model=SectorsResponse)
async def get_sectors(
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
    history: int = Query(30, ge=2, le=120, description="How many recent runs to include in rank_history."),
) -> SectorsResponse:
    """Sectors with their latest rank, prior rank, confidence, and a rank-history sparkline."""
    pool = get_pool()

    # Pull the last `history` distinct run timestamps for this (horizon, model).
    # Each run produces one row per symbol; we order ASC so the sparkline reads
    # left→right oldest→newest on the client.
    sql = """
        WITH recent_runs AS (
            SELECT DISTINCT run_ts
            FROM predictions
            WHERE horizon_d = $1 AND model = $2
            ORDER BY run_ts DESC
            LIMIT $3
        ),
        ranked AS (
            SELECT p.symbol, p.rank, p.score, p.confidence, p.run_ts, p.target_ts,
                   ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.run_ts DESC) AS rn
            FROM predictions p
            JOIN recent_runs r ON r.run_ts = p.run_ts
            WHERE p.horizon_d = $1 AND p.model = $2
        ),
        holdings_counts AS (
            SELECT sector_etf, COUNT(*) AS n
            FROM sector_holdings
            GROUP BY sector_etf
        ),
        latest AS (
            SELECT symbol, rank, score, confidence, run_ts
            FROM ranked WHERE rn = 1
        ),
        prior AS (
            SELECT symbol, rank AS prior_rank
            FROM ranked WHERE rn = 2
        ),
        history_arr AS (
            SELECT symbol,
                   ARRAY_AGG(rank ORDER BY run_ts ASC) FILTER (WHERE rank IS NOT NULL) AS rank_history,
                   ARRAY_AGG(score ORDER BY run_ts ASC) FILTER (WHERE score IS NOT NULL) AS score_history
            FROM ranked
            GROUP BY symbol
        )
        SELECT
            COALESCE(l.symbol, h.sector_etf) AS symbol,
            l.rank,
            l.score,
            l.confidence,
            p.prior_rank,
            ha.rank_history,
            ha.score_history,
            COALESCE(h.n, 0) AS n_constituents,
            l.run_ts
        FROM latest l
        FULL OUTER JOIN holdings_counts h ON l.symbol = h.sector_etf
        LEFT JOIN prior p ON p.symbol = l.symbol
        LEFT JOIN history_arr ha ON ha.symbol = l.symbol
        ORDER BY l.rank ASC NULLS LAST, symbol
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, horizon, model, history)

    run_ts = next((r["run_ts"] for r in rows if r["run_ts"] is not None), None)

    return SectorsResponse(
        run_ts=run_ts,
        sectors=[
            SectorEntry(
                symbol=r["symbol"],
                latest_rank=r["rank"],
                latest_score=float(r["score"]) if r["score"] is not None else None,
                confidence=float(r["confidence"]) if r["confidence"] is not None else None,
                prior_rank=r["prior_rank"],
                rank_history=[int(v) for v in (r["rank_history"] or [])],
                score_history=[float(v) for v in (r["score_history"] or [])],
                horizon_d=horizon if r["rank"] is not None else None,
                n_constituents=int(r["n_constituents"] or 0),
            )
            for r in rows
        ],
    )


# ---------- /v1/sectors/scorecard ----------


class ScorecardResponse(BaseModel):
    horizon_d: int
    model: str
    n_runs_evaluated: int
    n_runs_total: int
    hit_rate: float | None  # fraction of runs where top-3 beat bottom-3 over horizon
    avg_top3_return: float | None
    avg_bottom3_return: float | None
    avg_spread: float | None  # avg(top3 ret − bottom3 ret) in raw pct (e.g. 0.0123 = 1.23%)
    last_evaluated_run: datetime | None


@router.get("/scorecard", response_model=ScorecardResponse)
async def get_scorecard(
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
    lookback_runs: int = Query(30, ge=3, le=120),
) -> ScorecardResponse:
    """Backtest the model: for each of the last N runs, compare the actual
    forward-`horizon` return of the top-3 ranked sectors vs the bottom-3.

    A "hit" = top-3 basket avg return > bottom-3 basket avg return over horizon.
    Skips runs where the horizon hasn't elapsed yet (no realized data).
    """
    pool = get_pool()

    sql = """
        WITH recent_runs AS (
            SELECT DISTINCT run_ts
            FROM predictions
            WHERE horizon_d = $1 AND model = $2
              AND run_ts <= NOW() - ($3 || ' days')::INTERVAL
            ORDER BY run_ts DESC
            LIMIT $4
        ),
        runs_with_ranks AS (
            SELECT p.run_ts, p.symbol, p.rank
            FROM predictions p
            JOIN recent_runs r ON r.run_ts = p.run_ts
            WHERE p.horizon_d = $1 AND p.model = $2 AND p.rank IS NOT NULL
        ),
        max_rank_per_run AS (
            SELECT run_ts, MAX(rank) AS max_rank
            FROM runs_with_ranks
            GROUP BY run_ts
        ),
        buckets AS (
            SELECT r.run_ts, r.symbol, r.rank, m.max_rank,
                   CASE
                       WHEN r.rank <= 3 THEN 'top'
                       WHEN r.rank > m.max_rank - 3 THEN 'bottom'
                       ELSE NULL
                   END AS bucket
            FROM runs_with_ranks r
            JOIN max_rank_per_run m ON m.run_ts = r.run_ts
        ),
        bucket_filtered AS (
            SELECT * FROM buckets WHERE bucket IS NOT NULL
        ),
        forward_returns AS (
            SELECT b.run_ts, b.symbol, b.bucket,
                   p_now.close AS close_now,
                   p_fwd.close AS close_fwd
            FROM bucket_filtered b
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.symbol AND ts <= b.run_ts
                ORDER BY ts DESC LIMIT 1
            ) p_now ON TRUE
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.symbol AND ts <= b.run_ts + ($1 || ' days')::INTERVAL
                ORDER BY ts DESC LIMIT 1
            ) p_fwd ON TRUE
        ),
        per_run AS (
            SELECT run_ts, bucket,
                   AVG(CASE WHEN close_now > 0 AND close_fwd IS NOT NULL
                            THEN close_fwd / close_now - 1.0 END) AS avg_ret
            FROM forward_returns
            GROUP BY run_ts, bucket
        ),
        pivoted AS (
            SELECT run_ts,
                   MAX(CASE WHEN bucket = 'top' THEN avg_ret END) AS top_ret,
                   MAX(CASE WHEN bucket = 'bottom' THEN avg_ret END) AS bot_ret
            FROM per_run
            GROUP BY run_ts
        )
        SELECT run_ts, top_ret, bot_ret
        FROM pivoted
        WHERE top_ret IS NOT NULL AND bot_ret IS NOT NULL
        ORDER BY run_ts DESC
    """
    async with pool.acquire() as conn:
        # Total recent runs (pre-filter) for the denominator of n_runs_total.
        total_runs = await conn.fetchval(
            "SELECT COUNT(DISTINCT run_ts) FROM predictions WHERE horizon_d = $1 AND model = $2",
            horizon, model,
        )
        rows = await conn.fetch(sql, horizon, model, horizon, lookback_runs)

    if not rows:
        return ScorecardResponse(
            horizon_d=horizon,
            model=model,
            n_runs_evaluated=0,
            n_runs_total=int(total_runs or 0),
            hit_rate=None,
            avg_top3_return=None,
            avg_bottom3_return=None,
            avg_spread=None,
            last_evaluated_run=None,
        )

    n = len(rows)
    hits = sum(1 for r in rows if (r["top_ret"] or 0.0) > (r["bot_ret"] or 0.0))
    avg_top = sum(r["top_ret"] for r in rows) / n
    avg_bot = sum(r["bot_ret"] for r in rows) / n

    return ScorecardResponse(
        horizon_d=horizon,
        model=model,
        n_runs_evaluated=n,
        n_runs_total=int(total_runs or 0),
        hit_rate=hits / n,
        avg_top3_return=avg_top,
        avg_bottom3_return=avg_bot,
        avg_spread=avg_top - avg_bot,
        last_evaluated_run=rows[0]["run_ts"],
    )


# ---------- per-ETF holdings ----------


class HoldingEntry(BaseModel):
    ticker: str
    short_name: str | None
    sector: str | None
    weight: float | None
    close: float | None
    prev_price: float | None
    return_1d: float | None
    return_5d: float | None
    return_20d: float | None
    return_60d: float | None
    week52_high: float | None
    week52_low: float | None
    pct_off_52w_high: float | None
    volume: int | None
    avg30_volume: float | None
    volume_z: float | None  # latest / avg30 - 1
    call_premium: float | None
    put_premium: float | None
    call_put_ratio: float | None
    bullish_premium: float | None
    bearish_premium: float | None
    bullish_pct: float | None  # bullish / (bullish + bearish)
    model_score: float | None  # latest prediction score (xgb_v1, 10d) for this ticker
    model_rank: int | None     # rank within the universe at the latest run


class HoldingsResponse(BaseModel):
    etf: str
    n_holdings: int
    last_updated: datetime | None
    sort: str
    holdings: list[HoldingEntry]
    # Aggregate stats so the UI can show a footer row + breadth.
    median_return_1d: float | None
    median_return_5d: float | None
    median_return_20d: float | None
    pct_above_5d_zero: float | None  # share of holdings with positive 5d return
    pct_above_20d_zero: float | None  # share with positive 20d return


_VALID_SORT = {
    "weight", "return_1d", "return_5d", "return_20d", "return_60d",
    "call_put_ratio", "bullish_pct", "ticker", "pct_off_52w_high", "volume_z",
    "model_score",
}


@router.get("/{etf}/holdings", response_model=HoldingsResponse)
async def get_etf_holdings(
    etf: str,
    sort: str = Query("weight", description=f"Sort key. One of: {sorted(_VALID_SORT)}"),
    direction: Literal["asc", "desc"] = Query("desc"),
    limit: int = Query(500, ge=1, le=1000),
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
) -> HoldingsResponse:
    """Full constituent list for `etf` with per-name returns + options sentiment + model score."""
    if sort not in _VALID_SORT:
        raise HTTPException(status_code=400, detail=f"Invalid sort: {sort}. Valid: {sorted(_VALID_SORT)}")

    etf = etf.upper()
    pool = get_pool()

    # Same windowed price lookup, plus a left join to the latest prediction
    # row per ticker so the UI can show model_score / model_rank inline.
    sql = """
        WITH holdings AS (
            SELECT * FROM uw_etf_holdings WHERE etf = $1
        ),
        latest_pred_run AS (
            SELECT MAX(run_ts) AS run_ts FROM predictions
            WHERE horizon_d = $2 AND model = $3
        ),
        latest_preds AS (
            SELECT p.symbol, p.rank, p.score
            FROM predictions p, latest_pred_run lpr
            WHERE p.run_ts = lpr.run_ts
              AND p.horizon_d = $2 AND p.model = $3
        )
        SELECT
            h.*,
            p5.close  AS close_5d,
            p20.close AS close_20d,
            p60.close AS close_60d,
            lp.rank   AS model_rank,
            lp.score  AS model_score
        FROM holdings h
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE symbol = h.ticker AND ts <= NOW() - INTERVAL '5 days'
            ORDER BY ts DESC LIMIT 1
        ) p5 ON TRUE
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE symbol = h.ticker AND ts <= NOW() - INTERVAL '20 days'
            ORDER BY ts DESC LIMIT 1
        ) p20 ON TRUE
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE symbol = h.ticker AND ts <= NOW() - INTERVAL '60 days'
            ORDER BY ts DESC LIMIT 1
        ) p60 ON TRUE
        LEFT JOIN latest_preds lp ON lp.symbol = h.ticker
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, etf, horizon, model)

    def _ret(now: float | None, then: float | None) -> float | None:
        if now is None or then is None or then <= 0:
            return None
        return now / then - 1.0

    def _safe_div(a: float | None, b: float | None) -> float | None:
        if a is None or b is None or b == 0:
            return None
        return a / b

    def _pct_share(bull: float | None, bear: float | None) -> float | None:
        if bull is None or bear is None:
            return None
        denom = bull + bear
        return bull / denom if denom > 0 else None

    entries: list[HoldingEntry] = []
    last_updated_ts: datetime | None = None

    for r in rows:
        close = float(r["close"]) if r["close"] is not None else None
        prev = float(r["prev_price"]) if r["prev_price"] is not None else None
        c5 = float(r["close_5d"]) if r["close_5d"] is not None else None
        c20 = float(r["close_20d"]) if r["close_20d"] is not None else None
        c60 = float(r["close_60d"]) if r["close_60d"] is not None else None
        avg30 = float(r["avg30_volume"]) if r["avg30_volume"] is not None else None
        vol = int(r["volume"]) if r["volume"] is not None else None
        w52h = float(r["week52_high"]) if r["week52_high"] is not None else None
        cp = float(r["call_premium"]) if r["call_premium"] is not None else None
        pp = float(r["put_premium"]) if r["put_premium"] is not None else None
        bull = float(r["bullish_premium"]) if r["bullish_premium"] is not None else None
        bear = float(r["bearish_premium"]) if r["bearish_premium"] is not None else None

        entries.append(HoldingEntry(
            ticker=r["ticker"],
            short_name=r["short_name"],
            sector=r["sector"],
            weight=float(r["weight"]) if r["weight"] is not None else None,
            close=close,
            prev_price=prev,
            return_1d=_ret(close, prev),
            return_5d=_ret(close, c5),
            return_20d=_ret(close, c20),
            return_60d=_ret(close, c60),
            week52_high=w52h,
            week52_low=float(r["week52_low"]) if r["week52_low"] is not None else None,
            pct_off_52w_high=(close / w52h - 1.0) if (close and w52h and w52h > 0) else None,
            volume=vol,
            avg30_volume=avg30,
            volume_z=(vol / avg30 - 1.0) if (vol and avg30 and avg30 > 0) else None,
            call_premium=cp,
            put_premium=pp,
            call_put_ratio=_safe_div(cp, pp),
            bullish_premium=bull,
            bearish_premium=bear,
            bullish_pct=_pct_share(bull, bear),
            model_score=float(r["model_score"]) if r["model_score"] is not None else None,
            model_rank=int(r["model_rank"]) if r["model_rank"] is not None else None,
        ))
        if r["last_fetched"] is not None:
            ts = r["last_fetched"]
            if last_updated_ts is None or ts > last_updated_ts:
                last_updated_ts = ts

    # Sort in Python (small list — typically <100 holdings per ETF) so we can
    # treat None safely.
    reverse = direction == "desc"

    def _key(h: HoldingEntry):
        v = getattr(h, sort, None)
        if v is None:
            return (1, 0)
        return (0, -v if reverse and isinstance(v, (int, float)) else v)

    entries.sort(key=_key)
    entries = entries[:limit]

    # Aggregate stats — computed on the *returned* slice so the UI footer matches what's visible.
    def _median(xs: list[float]) -> float | None:
        if not xs:
            return None
        s = sorted(xs)
        n = len(s)
        return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])

    def _share_pos(xs: list[float]) -> float | None:
        if not xs:
            return None
        return sum(1 for x in xs if x > 0) / len(xs)

    r1 = [h.return_1d for h in entries if h.return_1d is not None]
    r5 = [h.return_5d for h in entries if h.return_5d is not None]
    r20 = [h.return_20d for h in entries if h.return_20d is not None]

    return HoldingsResponse(
        etf=etf,
        n_holdings=len(entries),
        last_updated=last_updated_ts,
        sort=sort,
        holdings=entries,
        median_return_1d=_median(r1),
        median_return_5d=_median(r5),
        median_return_20d=_median(r20),
        pct_above_5d_zero=_share_pos(r5),
        pct_above_20d_zero=_share_pos(r20),
    )
