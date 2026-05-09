"""GET /v1/sectors — sector list + per-ETF full constituent holdings."""

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
) -> SectorsResponse:
    """Sectors with their latest predicted rank (if any) and constituent count."""
    pool = get_pool()
    sql = """
        WITH latest AS (
            SELECT MAX(run_ts) AS run_ts FROM predictions
            WHERE horizon_d = $1 AND model = $2
        ),
        latest_target AS (
            SELECT MAX(target_ts) AS target_ts
            FROM predictions, latest
            WHERE predictions.run_ts = latest.run_ts
              AND predictions.horizon_d = $1 AND predictions.model = $2
        ),
        ranked AS (
            SELECT p.symbol, p.rank, p.score, p.run_ts, p.target_ts
            FROM predictions p, latest, latest_target
            WHERE p.run_ts = latest.run_ts
              AND p.target_ts = latest_target.target_ts
              AND p.horizon_d = $1 AND p.model = $2
        ),
        holdings_counts AS (
            SELECT sector_etf, COUNT(*) AS n
            FROM sector_holdings
            GROUP BY sector_etf
        )
        SELECT
            COALESCE(r.symbol, h.sector_etf) AS symbol,
            r.rank,
            r.score,
            COALESCE(h.n, 0) AS n_constituents,
            r.run_ts
        FROM ranked r
        FULL OUTER JOIN holdings_counts h ON r.symbol = h.sector_etf
        ORDER BY r.rank ASC NULLS LAST, symbol
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, horizon, model)

    run_ts = next((r["run_ts"] for r in rows if r["run_ts"] is not None), None)

    return SectorsResponse(
        run_ts=run_ts,
        sectors=[
            SectorEntry(
                symbol=r["symbol"],
                latest_rank=r["rank"],
                latest_score=float(r["score"]) if r["score"] is not None else None,
                horizon_d=horizon if r["rank"] is not None else None,
                n_constituents=int(r["n_constituents"] or 0),
            )
            for r in rows
        ],
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


class HoldingsResponse(BaseModel):
    etf: str
    n_holdings: int
    last_updated: datetime | None
    sort: str
    holdings: list[HoldingEntry]


_VALID_SORT = {
    "weight", "return_1d", "return_5d", "return_20d", "return_60d",
    "call_put_ratio", "bullish_pct", "ticker", "pct_off_52w_high", "volume_z",
}


@router.get("/{etf}/holdings", response_model=HoldingsResponse)
async def get_etf_holdings(
    etf: str,
    sort: str = Query("weight", description=f"Sort key. One of: {sorted(_VALID_SORT)}"),
    direction: Literal["asc", "desc"] = Query("desc"),
    limit: int = Query(500, ge=1, le=1000),
) -> HoldingsResponse:
    """Full constituent list for `etf` with per-name returns + options sentiment.

    Returns are computed as (close vs the close N business days back) joined
    against prices_daily. Volume z is (today / 30d-avg - 1)."""
    if sort not in _VALID_SORT:
        raise HTTPException(status_code=400, detail=f"Invalid sort: {sort}. Valid: {sorted(_VALID_SORT)}")

    etf = etf.upper()
    pool = get_pool()

    # One pass with windowed price lookups for each holding.
    sql = """
        WITH holdings AS (
            SELECT * FROM uw_etf_holdings WHERE etf = $1
        )
        SELECT
            h.*,
            p5.close  AS close_5d,
            p20.close AS close_20d,
            p60.close AS close_60d
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
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, etf)

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
        # Push Nones to the end regardless of direction.
        if v is None:
            return (1, 0)
        return (0, -v if reverse and isinstance(v, (int, float)) else v)

    entries.sort(key=_key)
    entries = entries[:limit]

    return HoldingsResponse(
        etf=etf,
        n_holdings=len(entries),
        last_updated=last_updated_ts,
        sort=sort,
        holdings=entries,
    )
