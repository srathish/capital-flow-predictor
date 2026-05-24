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
    # v0.3 quant additions (NULL on v0.1/v0.2 rows; populated for v0.3-quant)
    prob_lo: float | None = None
    prob_hi: float | None = None
    prob_ci_n: int | None = None
    kelly_fraction: float | None = None
    return_p10: float | None = None
    return_p50: float | None = None
    return_p90: float | None = None
    gex_wall_anchored: bool = False
    # Phase 5d: concrete option suggestion if generated yet. NULL when
    # delphi-options-suggest hasn't run for this prediction.
    option: "OptionSuggestion | None" = None


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
    option: "OptionSuggestion | None" = None


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


class OptionSuggestion(BaseModel):
    """Concrete tradeable contract suggested for a Delphi prediction."""
    prediction_id: str
    contract_symbol: str | None
    underlying: str
    option_type: str          # 'C' or 'P'
    strike: float
    expiry: datetime
    days_to_expiry: int
    current_mid: float | None
    current_iv: float | None
    current_delta: float | None
    price_source: str | None
    theo_price_now: float | None
    value_at_target: float | None
    value_at_invalidation: float | None
    ev_per_contract: float | None       # $ per contract (100 shares)
    ev_pct_of_cost: float | None
    breakeven_probability: float | None
    contracts_at_kelly: int | None
    rationale: str | None


class V3HealthResponse(BaseModel):
    """One-screen morning sanity check for v0.3 pipeline.

    All fields are aggregate-only — no per-prediction PII. Designed to be
    polled cheaply from a dashboard or curl'd from a launch-day script.
    """
    generated_at: datetime
    feature_rows_24h: int
    feature_universe_size_latest: int
    v3_predictions_24h: int
    v3_horizons: dict[str, int]
    v3_conflict_rate: float | None
    v3_gex_anchored_rate: float | None
    v3_kelly_actionable_rate: float | None      # fraction with kelly >= 5%
    v3_avg_probability: float | None
    v3_avg_ci_n: float | None                   # avg # comparable outcomes used in CI
    ml_models_total: int
    ml_models_active: int
    ml_models_tripwire_fired: int
    last_regime_composite: str | None
    last_regime_asof: datetime | None
    promotions_total: int
    promotions_promoted: int


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


def _opt_row_to_model(row: dict | None) -> OptionSuggestion | None:
    if not row or not row.get("prediction_id"):
        return None
    from datetime import datetime as _dt
    expiry = row["expiry"]
    if hasattr(expiry, "isoformat") and not isinstance(expiry, _dt):
        # date -> datetime at midnight UTC for the Pydantic field
        expiry = _dt.combine(expiry, _dt.min.time())
    return OptionSuggestion(
        prediction_id=row["prediction_id"],
        contract_symbol=row.get("contract_symbol"),
        underlying=row["underlying"],
        option_type=row["option_type"],
        strike=float(row["strike"]),
        expiry=expiry,
        days_to_expiry=int(row["days_to_expiry"] or 0),
        current_mid=row.get("current_mid"),
        current_iv=row.get("current_iv"),
        current_delta=row.get("current_delta"),
        price_source=row.get("price_source"),
        theo_price_now=row.get("theo_price_now"),
        value_at_target=row.get("value_at_target"),
        value_at_invalidation=row.get("value_at_invalidation"),
        ev_per_contract=row.get("ev_per_contract"),
        ev_pct_of_cost=row.get("ev_pct_of_cost"),
        breakeven_probability=row.get("breakeven_probability"),
        contracts_at_kelly=row.get("contracts_at_kelly"),
        rationale=row.get("rationale"),
    )


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
        # v0.3 quant fields — .get() because v0.1/v0.2 rows return NULL
        # AND because older API deployments may select with SELECT * before
        # the migration applied (defensive across rolling restarts).
        prob_lo=row.get("prob_lo"),
        prob_hi=row.get("prob_hi"),
        prob_ci_n=row.get("prob_ci_n"),
        kelly_fraction=row.get("kelly_fraction"),
        return_p10=row.get("return_p10"),
        return_p50=row.get("return_p50"),
        return_p90=row.get("return_p90"),
        gex_wall_anchored=bool(row.get("gex_wall_anchored") or False),
        option=_opt_row_to_model(row) if row.get("contract_symbol") else None,
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

    # LEFT JOIN delphi_option_suggestions so the table renders contract +
    # mid + EV in one fetch. Wrap in a defensive guard: if migration 0039
    # hasn't applied on this DB, fall back to the non-joined query.
    sql = f"""
        WITH latest AS (
            SELECT MAX(created_at) AS ts
            FROM delphi_predictions
            WHERE forecast_horizon = $1
        )
        SELECT p.*, o.contract_symbol, o.underlying, o.option_type, o.strike,
               o.expiry, o.days_to_expiry,
               o.current_mid, o.current_iv, o.current_delta,
               o.price_source, o.theo_price_now,
               o.value_at_target, o.value_at_invalidation,
               o.ev_per_contract, o.ev_pct_of_cost, o.breakeven_probability,
               o.contracts_at_kelly, o.rationale
        FROM delphi_predictions p, latest
        LEFT JOIN delphi_option_suggestions o USING (prediction_id)
        WHERE {' AND '.join('p.' + w if not w.startswith('p.') else w for w in where)}
          AND p.created_at >= latest.ts - INTERVAL '12 hours'
        ORDER BY {('p.' + order_clause).replace(', ', ', p.')}
        LIMIT {int(limit)}
    """

    pool = get_pool()
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(sql, *params)
        except Exception as e:
            # Fall back to the un-joined query if 0039 hasn't applied yet.
            import logging as _l
            _l.getLogger("cfp_api").warning(
                "delphi predictions JOIN with options_suggestions failed (%s); "
                "falling back to bare prediction rows", e,
            )
            bare_sql = f"""
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
            rows = await conn.fetch(bare_sql, *params)

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
        opt = None
        try:
            opt = await conn.fetchrow(
                "SELECT * FROM delphi_option_suggestions WHERE prediction_id = $1",
                prediction_id,
            )
        except Exception:
            opt = None

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
    option_model = _opt_row_to_model(dict(opt)) if opt is not None else None
    # base.model_dump() includes `option=None` from the PredictionRow default;
    # remove so we can pass the resolved value explicitly to PredictionDetail.
    base_dump = base.model_dump()
    base_dump.pop("option", None)
    return PredictionDetail(**base_dump, outcome=outcome_model, option=option_model)


@router.get("/predictions/{prediction_id}/option", response_model=OptionSuggestion)
async def get_prediction_option(prediction_id: str) -> OptionSuggestion:
    """Concrete option contract suggested for this Delphi prediction.

    404 when the suggestion job hasn't run for this prediction yet
    (delphi-options-suggest runs after each rank-v2). Same row that
    surfaces inline on the list endpoint via LEFT JOIN.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM delphi_option_suggestions WHERE prediction_id = $1",
                prediction_id,
            )
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"options_suggestions table not ready: {e}")
    if row is None:
        raise HTTPException(status_code=404, detail="no option suggestion for this prediction")
    model = _opt_row_to_model(dict(row))
    if model is None:
        raise HTTPException(status_code=500, detail="failed to render option suggestion")
    return model


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


@router.get("/v3-health", response_model=V3HealthResponse)
async def v3_health() -> V3HealthResponse:
    """Aggregate health check on the v0.3 pipeline.

    Reads:
      - delphi_features (composer output last 24h)
      - delphi_predictions WHERE model_version='v0.3-quant' last 24h
      - delphi_ml_models (registry + tripwire counts)
      - macro_regime (latest composite)
      - delphi_reason_code_promotions (BH FDR promotion log)

    Cheap (~6 aggregate queries) — safe to poll from a dashboard. Every
    field can return None when the underlying table is empty; the UI/script
    should treat None as "calibrating", not "broken".
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        # Features volume
        try:
            feat_24h = await conn.fetchval(
                "SELECT COUNT(*) FROM delphi_features WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'"
            ) or 0
            feat_universe = await conn.fetchval(
                """
                SELECT COUNT(DISTINCT ticker) FROM delphi_features
                WHERE snapshot_ts = (SELECT MAX(snapshot_ts) FROM delphi_features)
                """
            ) or 0
        except Exception:
            feat_24h = 0
            feat_universe = 0

        # v0.3 predictions
        try:
            row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS n,
                    AVG(probability) AS avg_p,
                    AVG(prob_ci_n) AS avg_ci_n,
                    AVG(CASE WHEN array_length(reason_codes, 1) IS NOT NULL
                             AND EXISTS (SELECT 1 FROM unnest(reason_codes) c WHERE c LIKE 'CONFLICT_%%')
                             THEN 1.0 ELSE 0.0 END) AS conflict_rate,
                    AVG(CASE WHEN gex_wall_anchored THEN 1.0 ELSE 0.0 END) AS gex_rate,
                    AVG(CASE WHEN kelly_fraction >= 0.05 THEN 1.0 ELSE 0.0 END) AS kelly_rate
                FROM delphi_predictions
                WHERE model_version = 'v0.3-quant'
                  AND created_at >= NOW() - INTERVAL '24 hours'
                """
            )
            v3_n = (row["n"] or 0) if row else 0
            avg_p = float(row["avg_p"]) if row and row["avg_p"] is not None else None
            avg_ci_n = float(row["avg_ci_n"]) if row and row["avg_ci_n"] is not None else None
            conflict_rate = float(row["conflict_rate"]) if row and row["conflict_rate"] is not None else None
            gex_rate = float(row["gex_rate"]) if row and row["gex_rate"] is not None else None
            kelly_rate = float(row["kelly_rate"]) if row and row["kelly_rate"] is not None else None

            horizons_rows = await conn.fetch(
                """
                SELECT forecast_horizon, COUNT(*) AS n
                FROM delphi_predictions
                WHERE model_version = 'v0.3-quant'
                  AND created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY forecast_horizon
                """
            )
            horizons = {r["forecast_horizon"]: int(r["n"]) for r in horizons_rows}
        except Exception:
            v3_n = 0
            avg_p = None
            avg_ci_n = None
            conflict_rate = None
            gex_rate = None
            kelly_rate = None
            horizons = {}

        # ML registry
        try:
            ml_row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'active') AS active,
                    COUNT(*) FILTER (WHERE tripwire_fired) AS tripped
                FROM delphi_ml_models
                """
            )
            ml_total = int(ml_row["total"] or 0)
            ml_active = int(ml_row["active"] or 0)
            ml_tripped = int(ml_row["tripped"] or 0)
        except Exception:
            ml_total = ml_active = ml_tripped = 0

        # Regime
        try:
            reg_row = await conn.fetchrow(
                "SELECT composite_regime, asof_date::timestamptz AS asof_date FROM macro_regime ORDER BY asof_date DESC LIMIT 1"
            )
            last_regime = reg_row["composite_regime"] if reg_row else None
            last_regime_asof = reg_row["asof_date"] if reg_row else None
        except Exception:
            last_regime = None
            last_regime_asof = None

        # Promotions
        try:
            prom_row = await conn.fetchrow(
                """
                SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE promoted) AS promoted
                FROM delphi_reason_code_promotions
                """
            )
            prom_total = int(prom_row["total"] or 0)
            prom_promoted = int(prom_row["promoted"] or 0)
        except Exception:
            prom_total = prom_promoted = 0

    return V3HealthResponse(
        generated_at=datetime.utcnow(),
        feature_rows_24h=int(feat_24h),
        feature_universe_size_latest=int(feat_universe),
        v3_predictions_24h=int(v3_n),
        v3_horizons=horizons,
        v3_conflict_rate=conflict_rate,
        v3_gex_anchored_rate=gex_rate,
        v3_kelly_actionable_rate=kelly_rate,
        v3_avg_probability=avg_p,
        v3_avg_ci_n=avg_ci_n,
        ml_models_total=ml_total,
        ml_models_active=ml_active,
        ml_models_tripwire_fired=ml_tripped,
        last_regime_composite=last_regime,
        last_regime_asof=last_regime_asof,
        promotions_total=prom_total,
        promotions_promoted=prom_promoted,
    )


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
