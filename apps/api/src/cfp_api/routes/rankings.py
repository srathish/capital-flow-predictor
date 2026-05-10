"""GET /v1/rankings — latest predictor output for a given horizon + model."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from cfp_api.db import get_pool
from cfp_api.schemas import RankingItem, RankingsResponse

router = APIRouter(prefix="/v1/rankings", tags=["rankings"])


@router.get("", response_model=RankingsResponse)
async def get_rankings(
    horizon: int = Query(10, ge=1, le=60, description="Prediction horizon in days"),
    model: str = Query("xgb_v1", description="Predictor model name"),
    limit: int = Query(50, ge=1, le=200),
) -> RankingsResponse:
    """Most recent predictions for the given horizon + model, sorted by rank.

    Re-ranks by `score` on the read side to defend against the historically
    degenerate `predictions.rank` column (same workaround pattern as /v1/network).
    """
    pool = get_pool()
    sql = """
        WITH latest_run AS (
            SELECT MAX(run_ts) AS run_ts
            FROM predictions
            WHERE horizon_d = $1 AND model = $2
        ),
        latest_target AS (
            SELECT MAX(target_ts) AS target_ts
            FROM predictions, latest_run
            WHERE predictions.run_ts = latest_run.run_ts
              AND predictions.horizon_d = $1
              AND predictions.model = $2
        ),
        scored AS (
            SELECT DISTINCT ON (p.symbol)
                   p.run_ts, p.target_ts, p.symbol, p.score
            FROM predictions p, latest_run, latest_target
            WHERE p.run_ts = latest_run.run_ts
              AND p.target_ts = latest_target.target_ts
              AND p.horizon_d = $1
              AND p.model = $2
            ORDER BY p.symbol, p.score DESC NULLS LAST
        )
        SELECT run_ts, target_ts, symbol, score,
               RANK() OVER (ORDER BY score DESC NULLS LAST) AS rank
        FROM scored
        ORDER BY rank ASC, symbol ASC
        LIMIT $3
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, horizon, model, limit)

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No predictions found for horizon={horizon} model={model}",
        )

    first = rows[0]
    return RankingsResponse(
        run_ts=first["run_ts"],
        horizon_d=horizon,
        model=model,
        target_ts=first["target_ts"],
        rankings=[
            RankingItem(
                rank=r["rank"],
                symbol=r["symbol"],
                score=float(r["score"]) if r["score"] is not None else None,
                target_ts=r["target_ts"],
            )
            for r in rows
        ],
    )
