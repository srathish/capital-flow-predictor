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

import os
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


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


class CalibrationBucket(BaseModel):
    forecast_horizon: str
    regime: str
    probability_bucket: str
    prediction_count: int
    actual_hit_rate: float | None
    calibration_gap: float | None
    adjusted_probability: float | None


class AdaptiveWeight(BaseModel):
    signal_timeframe: str
    forecast_horizon: str
    regime: str
    feature_group: str
    current_weight: float
    default_weight: float
    sample_size: int
    performance_score: float | None


class TickerMemoryRow(BaseModel):
    ticker: str
    best_horizon: str | None
    best_reason_codes: list[str]
    weak_reason_codes: list[str]
    prediction_count: int
    average_hit_rate: float | None
    average_return: float | None
    data_quality_score: float


class ModelPerformanceRow(BaseModel):
    model_version: str
    signal_timeframe: str
    forecast_horizon: str
    prediction_count: int
    target_hit_rate: float | None
    average_realized_return: float | None
    profit_factor: float | None
    brier_score: float | None
    calibration_error: float | None


class LearningStateResponse(BaseModel):
    """What Layers 2-4 have learned so far.

    Surfaces the four learning tables read-only so the UI can show the loop
    closing before the ranker is actually wired up to consume them. Gates
    (`use_adaptive_weights`, `use_calibration`) report whether the ranker is
    currently reading these tables; both default off.
    """
    generated_at: datetime
    use_adaptive_weights: bool
    use_calibration: bool
    ml_overlay_status: str
    outcomes_total: int
    calibration: list[CalibrationBucket]
    adaptive_weights: list[AdaptiveWeight]
    ticker_memory: list[TickerMemoryRow]
    model_performance: list[ModelPerformanceRow]


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


# -- /learning/state ---------------------------------------------------------


@router.get("/learning/state", response_model=LearningStateResponse)
async def learning_state(
    horizon: str | None = Query(None, description="Filter calibration + adaptive_weight rows."),
    ticker_limit: int = Query(25, ge=1, le=200),
) -> LearningStateResponse:
    """Read-only view of what Layers 2-4 have learned.

    Surfaces delphi_calibration_buckets, delphi_adaptive_weights,
    delphi_ticker_memory, delphi_model_performance. The `use_*` flags report
    whether delphi-rank is currently consuming these tables (default off —
    set DELPHI_USE_ADAPTIVE_WEIGHTS / DELPHI_USE_CALIBRATION on the jobs
    runner to flip).
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        outcomes_total = await conn.fetchval("SELECT COUNT(*) FROM delphi_outcomes") or 0

        cal_sql = "SELECT * FROM delphi_calibration_buckets"
        cal_args: list = []
        if horizon:
            cal_sql += " WHERE forecast_horizon = $1"
            cal_args.append(horizon)
        cal_sql += " ORDER BY forecast_horizon, regime, probability_bucket"
        cal_rows = await conn.fetch(cal_sql, *cal_args)

        aw_sql = "SELECT * FROM delphi_adaptive_weights WHERE ticker = '*'"
        aw_args: list = []
        if horizon:
            aw_sql += " AND forecast_horizon = $1"
            aw_args.append(horizon)
        aw_sql += " ORDER BY signal_timeframe, forecast_horizon, regime, feature_group"
        aw_rows = await conn.fetch(aw_sql, *aw_args)

        tm_rows = await conn.fetch(
            """
            SELECT * FROM delphi_ticker_memory
            ORDER BY average_hit_rate DESC NULLS LAST, prediction_count DESC
            LIMIT $1
            """,
            ticker_limit,
        )
        mp_rows = await conn.fetch(
            """
            SELECT * FROM delphi_model_performance
            ORDER BY model_version, signal_timeframe, forecast_horizon
            """
        )

    return LearningStateResponse(
        generated_at=datetime.utcnow(),
        use_adaptive_weights=_flag("DELPHI_USE_ADAPTIVE_WEIGHTS"),
        use_calibration=_flag("DELPHI_USE_CALIBRATION"),
        ml_overlay_status=(
            "calibrating" if outcomes_total < 500 else "ready_for_training"
        ),
        outcomes_total=int(outcomes_total),
        calibration=[
            CalibrationBucket(
                forecast_horizon=r["forecast_horizon"],
                regime=r["regime"],
                probability_bucket=r["probability_bucket"],
                prediction_count=r["prediction_count"] or 0,
                actual_hit_rate=r["actual_hit_rate"],
                calibration_gap=r["calibration_gap"],
                adjusted_probability=r["adjusted_probability"],
            )
            for r in cal_rows
        ],
        adaptive_weights=[
            AdaptiveWeight(
                signal_timeframe=r["signal_timeframe"],
                forecast_horizon=r["forecast_horizon"],
                regime=r["regime"],
                feature_group=r["feature_group"],
                current_weight=r["current_weight"],
                default_weight=r["default_weight"],
                sample_size=r["sample_size"] or 0,
                performance_score=r["performance_score"],
            )
            for r in aw_rows
        ],
        ticker_memory=[
            TickerMemoryRow(
                ticker=r["ticker"],
                best_horizon=r["best_horizon"],
                best_reason_codes=list(r["best_reason_codes"] or []),
                weak_reason_codes=list(r["weak_reason_codes"] or []),
                prediction_count=r["prediction_count"] or 0,
                average_hit_rate=r["average_hit_rate"],
                average_return=r["average_return"],
                data_quality_score=r["data_quality_score"] or 1.0,
            )
            for r in tm_rows
        ],
        model_performance=[
            ModelPerformanceRow(
                model_version=r["model_version"],
                signal_timeframe=r["signal_timeframe"],
                forecast_horizon=r["forecast_horizon"],
                prediction_count=r["prediction_count"] or 0,
                target_hit_rate=r["target_hit_rate"],
                average_realized_return=r["average_realized_return"],
                profit_factor=r["profit_factor"],
                brier_score=r["brier_score"],
                calibration_error=r["calibration_error"],
            )
            for r in mp_rows
        ],
    )
