"""Backtest Lab — walk-forward replay metrics + ML model registry.

GET /v1/backtest/runs
    List of delphi_backtest_runs (most recent first), with aggregate metrics.

GET /v1/backtest/runs/{run_id}
    Single run with by_horizon + by_regime + by_reason_code breakdowns.

GET /v1/backtest/model-compare
    Side-by-side metrics across model_versions (v0.1-rules vs v0.2-features
    vs any v0.3-lgbm row that earned status='active').

GET /v1/backtest/ml-models
    Registry of trained ML models. Surfaces the overfitting tripwire status
    so users see WHY a model didn't get promoted.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["backtest"], prefix="/v1/backtest")


class RunSummary(BaseModel):
    run_id: str
    created_at: datetime
    model_version: str
    window_start: datetime
    window_end: datetime
    n_predictions: int
    n_scored: int
    hit_rate: float | None
    brier_score: float | None
    log_loss: float | None
    profit_factor: float | None
    avg_realized_return: float | None
    notes: str | None


class RunDetail(RunSummary):
    by_horizon: dict[str, Any]
    by_regime: dict[str, Any]
    by_reason_code: dict[str, Any]


class ModelCompareRow(BaseModel):
    model_version: str
    family: str | None
    description: str | None
    is_default: bool
    signal_timeframe: str
    forecast_horizon: str
    prediction_count: int
    target_hit_rate: float | None
    brier_score: float | None
    calibration_error: float | None
    profit_factor: float | None
    average_realized_return: float | None


class MlModelRow(BaseModel):
    model_version: str
    created_at: datetime
    status: str
    n_train: int
    n_val: int
    n_holdout: int
    train_brier: float | None
    val_brier: float | None
    holdout_brier: float | None
    holdout_hit_rate: float | None
    holdout_auc: float | None
    overfit_gap: float | None
    overfit_threshold: float | None
    tripwire_fired: bool
    top_features: list[dict[str, Any]]


@router.get("/runs", response_model=list[RunSummary])
async def list_runs(limit: int = Query(25, ge=1, le=100)) -> list[RunSummary]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT run_id, created_at, model_version,
                   window_start::timestamptz AS window_start,
                   window_end::timestamptz   AS window_end,
                   n_predictions, n_scored, hit_rate, brier_score, log_loss,
                   profit_factor, avg_realized_return, notes
            FROM delphi_backtest_runs
            ORDER BY created_at DESC LIMIT $1
            """,
            limit,
        )
    return [RunSummary(**dict(r)) for r in rows]


@router.get("/runs/{run_id}", response_model=RunDetail)
async def get_run(run_id: str) -> RunDetail:
    pool = get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            """
            SELECT run_id, created_at, model_version,
                   window_start::timestamptz AS window_start,
                   window_end::timestamptz   AS window_end,
                   n_predictions, n_scored, hit_rate, brier_score, log_loss,
                   profit_factor, avg_realized_return, notes,
                   by_horizon, by_regime, by_reason_code
            FROM delphi_backtest_runs WHERE run_id = $1
            """,
            run_id,
        )
        if not r:
            raise HTTPException(404, detail="run not found")
    return RunDetail(
        run_id=r["run_id"],
        created_at=r["created_at"],
        model_version=r["model_version"],
        window_start=r["window_start"],
        window_end=r["window_end"],
        n_predictions=r["n_predictions"],
        n_scored=r["n_scored"],
        hit_rate=r["hit_rate"],
        brier_score=r["brier_score"],
        log_loss=r["log_loss"],
        profit_factor=r["profit_factor"],
        avg_realized_return=r["avg_realized_return"],
        notes=r["notes"],
        by_horizon=dict(r["by_horizon"] or {}),
        by_regime=dict(r["by_regime"] or {}),
        by_reason_code=dict(r["by_reason_code"] or {}),
    )


@router.get("/model-compare", response_model=list[ModelCompareRow])
async def model_compare() -> list[ModelCompareRow]:
    pool = get_pool()
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch("SELECT * FROM v_delphi_model_compare ORDER BY model_version, forecast_horizon")
        except Exception:
            rows = []
    return [
        ModelCompareRow(
            model_version=r["model_version"],
            family=r.get("family"),
            description=r.get("description"),
            is_default=bool(r.get("is_default")),
            signal_timeframe=r["signal_timeframe"],
            forecast_horizon=r["forecast_horizon"],
            prediction_count=r["prediction_count"] or 0,
            target_hit_rate=r["target_hit_rate"],
            brier_score=r["brier_score"],
            calibration_error=r["calibration_error"],
            profit_factor=r["profit_factor"],
            average_realized_return=r["average_realized_return"],
        )
        for r in rows
    ]


@router.get("/ml-models", response_model=list[MlModelRow])
async def ml_models() -> list[MlModelRow]:
    pool = get_pool()
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(
                """
                SELECT model_version, created_at, status,
                       n_train, n_val, n_holdout,
                       train_brier, val_brier, holdout_brier,
                       holdout_hit_rate, holdout_auc,
                       overfit_gap, overfit_threshold, tripwire_fired,
                       feature_importance
                FROM delphi_ml_models
                ORDER BY created_at DESC
                """
            )
        except Exception:
            rows = []
    out = []
    for r in rows:
        importance = dict(r["feature_importance"] or {})
        top = sorted(importance.items(), key=lambda kv: -kv[1])[:15]
        out.append(MlModelRow(
            model_version=r["model_version"],
            created_at=r["created_at"],
            status=r["status"],
            n_train=r["n_train"], n_val=r["n_val"], n_holdout=r["n_holdout"],
            train_brier=r["train_brier"], val_brier=r["val_brier"],
            holdout_brier=r["holdout_brier"], holdout_hit_rate=r["holdout_hit_rate"],
            holdout_auc=r["holdout_auc"],
            overfit_gap=r["overfit_gap"], overfit_threshold=r["overfit_threshold"],
            tripwire_fired=bool(r["tripwire_fired"]),
            top_features=[{"name": n, "gain": float(g)} for n, g in top],
        ))
    return out
