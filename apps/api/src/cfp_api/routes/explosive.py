"""Explosive options feed.

GET /v1/explosive
  Latest snapshot's ranked feed — tickers most likely to see a 1→100x options
  move based on flow concentration + IV term structure + squeeze setup +
  catalyst proximity + cheap optionality. See score_explosive.py for the
  composite formula.

GET /v1/explosive/{ticker}
  Latest score + signals for a single ticker.

The actual scoring runs in cfp-jobs (cfp-jobs explosive-ingest && cfp-jobs
explosive-score). This route is read-only against explosive_scores.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["explosive"])


class ExplosiveSubScores(BaseModel):
    flow_concentration: float
    iv_term: float
    squeeze: float
    catalyst: float
    cheap_optionality: float
    gex_bonus: float
    # Phase 2 confirmation signals (nullable on legacy rows pre-migration 0025)
    iv_vs_rv: float = 0.0
    skew_flip: float = 0.0
    nope: float = 0.0
    insider_buy: float = 0.0
    volume_profile: float = 0.0


class ExplosiveItem(BaseModel):
    ticker: str
    score: float
    catalyst_type: str | None = None
    catalyst_date: date | None = None
    catalyst_label: str | None = None
    days_to_catalyst: int | None = None
    underlying_price: float | None = None
    top_option_symbol: str | None = None
    top_option_type: str | None = None
    top_strike: float | None = None
    top_expiry: date | None = None
    top_last_price: float | None = None
    top_volume: int | None = None
    top_open_interest: int | None = None
    top_premium: float | None = None
    sub_scores: ExplosiveSubScores
    signals: dict[str, str]


class ExplosiveFeedResponse(BaseModel):
    snapshot_ts: datetime | None
    count: int
    items: list[ExplosiveItem]


def _row_to_item(row: Any) -> ExplosiveItem:
    return ExplosiveItem(
        ticker=row["ticker"],
        score=float(row["score"]),
        catalyst_type=row["catalyst_type"],
        catalyst_date=row["catalyst_date"],
        catalyst_label=row["catalyst_label"],
        days_to_catalyst=row["days_to_catalyst"],
        underlying_price=row["underlying_price"],
        top_option_symbol=row["top_option_symbol"],
        top_option_type=row["top_option_type"],
        top_strike=row["top_strike"],
        top_expiry=row["top_expiry"],
        top_last_price=row["top_last_price"],
        top_volume=row["top_volume"],
        top_open_interest=row["top_open_interest"],
        top_premium=row["top_premium"],
        sub_scores=ExplosiveSubScores(
            flow_concentration=row["flow_concentration_score"] or 0.0,
            iv_term=row["iv_term_score"] or 0.0,
            squeeze=row["squeeze_score"] or 0.0,
            catalyst=row["catalyst_score"] or 0.0,
            cheap_optionality=row["cheap_optionality_score"] or 0.0,
            gex_bonus=row["gex_bonus_score"] or 0.0,
            iv_vs_rv=row.get("iv_vs_rv_score") or 0.0,
            skew_flip=row.get("skew_flip_score") or 0.0,
            nope=row.get("nope_score") or 0.0,
            insider_buy=row.get("insider_buy_score") or 0.0,
            volume_profile=row.get("volume_profile_score") or 0.0,
        ),
        signals=row["signals"] or {},
    )


@router.get("/v1/explosive", response_model=ExplosiveFeedResponse)
async def list_explosive(
    limit: int = Query(50, ge=1, le=200),
    min_score: float = Query(0.0, ge=0.0, le=100.0),
    catalyst_type: str | None = Query(None, description="Filter: earnings|fda|ipo"),
) -> ExplosiveFeedResponse:
    """Latest snapshot of the ranked explosive-options feed."""
    pool = get_pool()
    async with pool.acquire() as conn:
        latest_ts = await conn.fetchval("SELECT MAX(snapshot_ts) FROM explosive_scores")
        if latest_ts is None:
            return ExplosiveFeedResponse(snapshot_ts=None, count=0, items=[])
        clauses = ["snapshot_ts = $1", "score >= $2"]
        params: list[Any] = [latest_ts, min_score]
        if catalyst_type:
            params.append(catalyst_type)
            clauses.append(f"catalyst_type = ${len(params)}")
        params.append(limit)
        sql = f"""
            SELECT
                ticker, score,
                catalyst_type, catalyst_date, catalyst_label, days_to_catalyst,
                underlying_price,
                top_option_symbol, top_option_type, top_strike, top_expiry,
                top_last_price, top_volume, top_open_interest, top_premium,
                flow_concentration_score, iv_term_score, squeeze_score,
                catalyst_score, cheap_optionality_score, gex_bonus_score,
                iv_vs_rv_score, skew_flip_score, nope_score,
                insider_buy_score, volume_profile_score,
                signals
            FROM explosive_scores
            WHERE {' AND '.join(clauses)}
            ORDER BY score DESC, ticker ASC
            LIMIT ${len(params)}
        """
        rows = await conn.fetch(sql, *params)
    return ExplosiveFeedResponse(
        snapshot_ts=latest_ts,
        count=len(rows),
        items=[_row_to_item(r) for r in rows],
    )


class ContractHistoryPoint(BaseModel):
    trade_date: date
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: int | None = None
    open_interest: int | None = None
    iv_close: float | None = None
    underlying_close: float | None = None


class FlowPerStrikePoint(BaseModel):
    expiry: date
    strike: float
    call_premium: float | None = None
    call_ask_premium: float | None = None
    call_volume: int | None = None
    call_oi: int | None = None


class IvTermPoint(BaseModel):
    expiry: date
    dte: int | None = None
    iv: float | None = None


class MaxPainPoint(BaseModel):
    expiry: date
    max_pain_strike: float | None = None


class CorrelationPeer(BaseModel):
    ticker: str
    correlation: float | None = None


class TopNetImpactEntry(BaseModel):
    rank: int | None = None
    net_premium: float | None = None
    net_delta: float | None = None
    net_gamma: float | None = None


class ExplosiveDetailResponse(BaseModel):
    item: ExplosiveItem
    contract_history: list[ContractHistoryPoint]
    flow_per_strike: list[FlowPerStrikePoint]
    iv_term: list[IvTermPoint]
    max_pain: list[MaxPainPoint]
    correlations: list[CorrelationPeer]
    market_impact: TopNetImpactEntry | None = None


@router.get("/v1/explosive/{ticker}/detail", response_model=ExplosiveDetailResponse)
async def get_explosive_detail(ticker: str) -> ExplosiveDetailResponse:
    """Per-ticker drilldown — bundles everything the detail page renders.

    All data comes from cached tables refreshed by:
      cfp-jobs explosive-ingest    (flow_per_strike, iv_term, max_pain)
      cfp-jobs explosive-score     (the score row)
      cfp-jobs explosive-drilldown (contract_history, correlations)
    """
    sym = ticker.upper()
    pool = get_pool()
    async with pool.acquire() as conn:
        score_row = await conn.fetchrow(
            """
            SELECT
                ticker, score,
                catalyst_type, catalyst_date, catalyst_label, days_to_catalyst,
                underlying_price,
                top_option_symbol, top_option_type, top_strike, top_expiry,
                top_last_price, top_volume, top_open_interest, top_premium,
                flow_concentration_score, iv_term_score, squeeze_score,
                catalyst_score, cheap_optionality_score, gex_bonus_score,
                iv_vs_rv_score, skew_flip_score, nope_score,
                insider_buy_score, volume_profile_score,
                signals
            FROM explosive_scores
            WHERE ticker = $1
            ORDER BY snapshot_ts DESC
            LIMIT 1
            """,
            sym,
        )
        if score_row is None:
            raise HTTPException(status_code=404, detail=f"no explosive score for {ticker}")
        item = _row_to_item(score_row)

        top_symbol = score_row["top_option_symbol"]
        history_rows = []
        if top_symbol:
            history_rows = await conn.fetch(
                """
                SELECT trade_date, open, high, low, close, volume,
                       open_interest, iv_close, underlying_close
                FROM uw_option_contract_history
                WHERE option_symbol = $1
                ORDER BY trade_date ASC
                """,
                top_symbol,
            )

        strike_rows = await conn.fetch(
            """
            SELECT expiry, strike, call_premium, call_ask_premium,
                   call_volume, call_oi
            FROM uw_flow_per_strike
            WHERE ticker = $1
              AND snapshot_date = (
                SELECT MAX(snapshot_date) FROM uw_flow_per_strike WHERE ticker = $1
              )
            ORDER BY COALESCE(call_ask_premium, call_premium, 0) DESC
            LIMIT 20
            """,
            sym,
        )

        iv_rows = await conn.fetch(
            """
            SELECT expiry, dte, iv
            FROM uw_iv_term_structure
            WHERE ticker = $1
              AND snapshot_date = (
                SELECT MAX(snapshot_date) FROM uw_iv_term_structure WHERE ticker = $1
              )
            ORDER BY dte ASC
            """,
            sym,
        )

        mp_rows = await conn.fetch(
            """
            SELECT expiry, max_pain_strike
            FROM uw_max_pain
            WHERE ticker = $1
              AND snapshot_date = (
                SELECT MAX(snapshot_date) FROM uw_max_pain WHERE ticker = $1
              )
            ORDER BY expiry ASC
            LIMIT 8
            """,
            sym,
        )

        corr_rows = await conn.fetch(
            """
            SELECT snd_ticker AS peer, correlation
            FROM uw_correlations
            WHERE fst_ticker = $1
              AND snapshot_date = (
                SELECT MAX(snapshot_date) FROM uw_correlations WHERE fst_ticker = $1
              )
            ORDER BY correlation DESC NULLS LAST
            LIMIT 10
            """,
            sym,
        )

        impact_row = await conn.fetchrow(
            """
            SELECT rank, net_premium, net_delta, net_gamma
            FROM uw_top_net_impact
            WHERE ticker = $1
            ORDER BY snapshot_ts DESC
            LIMIT 1
            """,
            sym,
        )

    return ExplosiveDetailResponse(
        item=item,
        contract_history=[
            ContractHistoryPoint(
                trade_date=r["trade_date"],
                open=r["open"],
                high=r["high"],
                low=r["low"],
                close=r["close"],
                volume=r["volume"],
                open_interest=r["open_interest"],
                iv_close=r["iv_close"],
                underlying_close=r["underlying_close"],
            )
            for r in history_rows
        ],
        flow_per_strike=[
            FlowPerStrikePoint(
                expiry=r["expiry"],
                strike=r["strike"],
                call_premium=r["call_premium"],
                call_ask_premium=r["call_ask_premium"],
                call_volume=r["call_volume"],
                call_oi=r["call_oi"],
            )
            for r in strike_rows
        ],
        iv_term=[
            IvTermPoint(expiry=r["expiry"], dte=r["dte"], iv=r["iv"])
            for r in iv_rows
        ],
        max_pain=[
            MaxPainPoint(expiry=r["expiry"], max_pain_strike=r["max_pain_strike"])
            for r in mp_rows
        ],
        correlations=[
            CorrelationPeer(ticker=r["peer"], correlation=r["correlation"])
            for r in corr_rows
        ],
        market_impact=(
            TopNetImpactEntry(
                rank=impact_row["rank"],
                net_premium=impact_row["net_premium"],
                net_delta=impact_row["net_delta"],
                net_gamma=impact_row["net_gamma"],
            )
            if impact_row is not None
            else None
        ),
    )


@router.get("/v1/explosive/{ticker}", response_model=ExplosiveItem)
async def get_explosive_ticker(ticker: str) -> ExplosiveItem:
    """Latest explosive-score for one ticker."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                ticker, score,
                catalyst_type, catalyst_date, catalyst_label, days_to_catalyst,
                underlying_price,
                top_option_symbol, top_option_type, top_strike, top_expiry,
                top_last_price, top_volume, top_open_interest, top_premium,
                flow_concentration_score, iv_term_score, squeeze_score,
                catalyst_score, cheap_optionality_score, gex_bonus_score,
                iv_vs_rv_score, skew_flip_score, nope_score,
                insider_buy_score, volume_profile_score,
                signals
            FROM explosive_scores
            WHERE ticker = $1
            ORDER BY snapshot_ts DESC
            LIMIT 1
            """,
            ticker.upper(),
        )
    if row is None:
        raise HTTPException(status_code=404, detail=f"no explosive score for {ticker}")
    return _row_to_item(row)
