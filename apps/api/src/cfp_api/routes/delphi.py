"""Delphi — market-foresight predictions and memory.

GET /v1/delphi/predictions
    Latest ranked predictions for a given forecast horizon. The Delphi tab
    calls this once per horizon and lets the user toggle bullish/bearish/vol.

GET /v1/delphi/predictions/{prediction_id}
    Single prediction card (target range, probability, invalidation,
    reason codes, explanation) + outcome if the horizon has closed.

GET /v1/delphi/memory/stats
    Memory dashboard summary: predictions issued, evaluated, hit rate by
    horizon, top reason codes, calibration gap.

Read-only. Writes happen in cfp-jobs (delphi-rank, delphi-evaluate).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["delphi"], prefix="/v1/delphi")


# Allowed values mirror what delphi_rank writes; keeps the API surface honest.
_HORIZONS = ("EOD", "1w", "1mo", "3mo", "6mo", "12mo", "24mo")
_BIAS = ("bullish", "bearish", "vol_expansion")
_RANK_MODES = ("ev", "probability", "upside")


class TargetRange(BaseModel):
    low: float
    high: float


class PredictionRow(BaseModel):
    prediction_id: str
    created_at: datetime
    ticker: str
    signal_timeframe: str
    forecast_horizon: str
    horizon_ends_at: datetime
    current_price: float
    bias: str
    target_range: TargetRange
    primary_target: float
    expected_return: float
    probability: float
    downside_risk: float
    risk_reward: float | None
    invalidation: float
    confidence: str
    delphi_score: float
    reason_codes: list[str]
    regime: str | None
    model_version: str
    explanation: str | None


class PredictionOutcome(BaseModel):
    evaluation_at: datetime
    actual_high: float
    actual_low: float
    actual_close: float
    hit_target_range: bool
    hit_primary_target: bool
    hit_invalidation: bool
    hit_invalidation_first: bool
    max_favorable_return: float
    max_adverse_return: float
    time_to_target_hours: float | None
    result: str


class PredictionDetail(PredictionRow):
    outcome: PredictionOutcome | None = None


class PredictionListResponse(BaseModel):
    horizon: str
    rank_mode: str
    count: int
    generated_at: datetime
    predictions: list[PredictionRow]


class HorizonStat(BaseModel):
    horizon: str
    prediction_count: int
    evaluated_count: int
    target_hit_rate: float | None
    average_return: float | None


class ReasonCodeStat(BaseModel):
    reason_code: str
    times_used: int
    target_hit_rate: float | None
    average_return: float | None
    weight_modifier: float


class MemoryStatsResponse(BaseModel):
    generated_at: datetime
    total_predictions: int
    total_evaluated: int
    overall_hit_rate: float | None
    by_horizon: list[HorizonStat]
    top_reason_codes: list[ReasonCodeStat]


def _pred_row_to_model(row: dict) -> PredictionRow:
    return PredictionRow(
        prediction_id=row["prediction_id"],
        created_at=row["created_at"],
        ticker=row["ticker"],
        signal_timeframe=row["signal_timeframe"],
        forecast_horizon=row["forecast_horizon"],
        horizon_ends_at=row["horizon_ends_at"],
        current_price=row["current_price"],
        bias=row["bias"],
        target_range=TargetRange(low=row["target_range_low"], high=row["target_range_high"]),
        primary_target=row["primary_target"],
        expected_return=row["expected_return"],
        probability=row["probability"],
        downside_risk=row["downside_risk"],
        risk_reward=row["risk_reward"],
        invalidation=row["invalidation"],
        confidence=row["confidence"],
        delphi_score=row["delphi_score"],
        reason_codes=list(row["reason_codes"] or []),
        regime=row["regime"],
        model_version=row["model_version"],
        explanation=row["explanation"],
    )


# -- /predictions ------------------------------------------------------------


@router.get("/predictions", response_model=PredictionListResponse)
async def list_predictions(
    horizon: Literal["EOD", "1w", "1mo", "3mo", "6mo", "12mo", "24mo"] = Query("1w"),
    bias: Literal["bullish", "bearish", "vol_expansion"] | None = Query(None),
    rank_mode: Literal["ev", "probability", "upside"] = Query("ev"),
    limit: int = Query(25, ge=1, le=200),
) -> PredictionListResponse:
    """Latest ranked predictions for `horizon`. Most-recent run only.

    "Most recent" = predictions whose created_at falls inside the latest 12h
    window for that horizon. Stops the table from leaking yesterday's stale
    forecasts when today's run hasn't completed yet.
    """
    # Map rank_mode to the ORDER BY column. probability/upside still tiebreak
    # on score so two equal probabilities don't shuffle randomly.
    order_clause = {
        "ev": "delphi_score DESC, probability DESC",
        "probability": "probability DESC, delphi_score DESC",
        "upside": "expected_return DESC, delphi_score DESC",
    }[rank_mode]

    where = ["forecast_horizon = $1"]
    params: list = [horizon]
    if bias:
        params.append(bias)
        where.append(f"bias = ${len(params)}")

    sql = f"""
        WITH latest AS (
            SELECT MAX(created_at) AS ts
            FROM delphi_predictions
            WHERE forecast_horizon = $1
        )
        SELECT *
        FROM delphi_predictions, latest
        WHERE {' AND '.join(where)}
          AND created_at >= latest.ts - INTERVAL '12 hours'
        ORDER BY {order_clause}
        LIMIT {int(limit)}
    """

    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    preds = [_pred_row_to_model(dict(r)) for r in rows]
    return PredictionListResponse(
        horizon=horizon,
        rank_mode=rank_mode,
        count=len(preds),
        generated_at=datetime.utcnow(),
        predictions=preds,
    )


@router.get("/predictions/{prediction_id}", response_model=PredictionDetail)
async def get_prediction(prediction_id: str) -> PredictionDetail:
    pool = get_pool()
    async with pool.acquire() as conn:
        pred = await conn.fetchrow(
            "SELECT * FROM delphi_predictions WHERE prediction_id = $1",
            prediction_id,
        )
        if pred is None:
            raise HTTPException(status_code=404, detail="prediction not found")
        outcome = await conn.fetchrow(
            "SELECT * FROM delphi_outcomes WHERE prediction_id = $1",
            prediction_id,
        )

    base = _pred_row_to_model(dict(pred))
    outcome_model: PredictionOutcome | None = None
    if outcome is not None:
        o = dict(outcome)
        outcome_model = PredictionOutcome(
            evaluation_at=o["evaluation_at"],
            actual_high=o["actual_high"],
            actual_low=o["actual_low"],
            actual_close=o["actual_close"],
            hit_target_range=o["hit_target_range"],
            hit_primary_target=o["hit_primary_target"],
            hit_invalidation=o["hit_invalidation"],
            hit_invalidation_first=o["hit_invalidation_first"],
            max_favorable_return=o["max_favorable_return"],
            max_adverse_return=o["max_adverse_return"],
            time_to_target_hours=o["time_to_target_hours"],
            result=o["result"],
        )
    return PredictionDetail(**base.model_dump(), outcome=outcome_model)


# -- /memory/stats -----------------------------------------------------------


@router.get("/memory/stats", response_model=MemoryStatsResponse)
async def memory_stats() -> MemoryStatsResponse:
    pool = get_pool()
    async with pool.acquire() as conn:
        totals = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM delphi_predictions) AS total,
                (SELECT COUNT(*) FROM delphi_outcomes)    AS evaluated,
                (SELECT AVG(CASE WHEN hit_target_range THEN 1.0 ELSE 0.0 END)
                   FROM delphi_outcomes)                  AS hit_rate
            """
        )

        per_horizon = await conn.fetch(
            """
            SELECT
                p.forecast_horizon AS horizon,
                COUNT(p.prediction_id) AS prediction_count,
                COUNT(o.prediction_id) AS evaluated_count,
                AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END) AS hit_rate,
                AVG(CASE
                        WHEN o.hit_target_range THEN p.expected_return
                        WHEN o.hit_invalidation_first THEN -p.downside_risk
                        ELSE 0.0
                    END) AS avg_return
            FROM delphi_predictions p
            LEFT JOIN delphi_outcomes o USING (prediction_id)
            GROUP BY p.forecast_horizon
            ORDER BY p.forecast_horizon
            """
        )

        top_codes = await conn.fetch(
            """
            SELECT reason_code, SUM(times_used) AS times_used,
                   AVG(target_hit_rate) AS target_hit_rate,
                   AVG(average_return) AS average_return,
                   AVG(weight_modifier) AS weight_modifier
            FROM delphi_reason_code_performance
            GROUP BY reason_code
            HAVING SUM(times_used) > 0
            ORDER BY AVG(target_hit_rate) DESC NULLS LAST
            LIMIT 10
            """
        )

    return MemoryStatsResponse(
        generated_at=datetime.utcnow(),
        total_predictions=totals["total"] or 0,
        total_evaluated=totals["evaluated"] or 0,
        overall_hit_rate=totals["hit_rate"],
        by_horizon=[
            HorizonStat(
                horizon=r["horizon"],
                prediction_count=r["prediction_count"] or 0,
                evaluated_count=r["evaluated_count"] or 0,
                target_hit_rate=r["hit_rate"],
                average_return=r["avg_return"],
            )
            for r in per_horizon
        ],
        top_reason_codes=[
            ReasonCodeStat(
                reason_code=r["reason_code"],
                times_used=r["times_used"] or 0,
                target_hit_rate=r["target_hit_rate"],
                average_return=r["average_return"],
                weight_modifier=r["weight_modifier"] or 1.0,
            )
            for r in top_codes
        ],
    )
