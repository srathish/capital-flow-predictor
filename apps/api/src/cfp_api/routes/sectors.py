"""GET /v1/sectors — sector list with predictions + holdings count."""

from __future__ import annotations

from fastapi import APIRouter, Query

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
