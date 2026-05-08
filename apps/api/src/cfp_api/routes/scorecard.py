"""Agent scorecard — per-persona track records over forward returns.

GET /v1/agents/scorecard?horizon=20 -> per-agent hit-rate, IC vs forward
returns, n_calls, broken down overall and by regime (bull/bear/chop).

Designed to read from agent_eval (populated daily by `cfp-jobs eval-agents`).
After ~60 days of daily runs you get statistically meaningful data.

Until enough data accrues, endpoints return empty rows or low n_calls; the
frontend should show "needs N more days of data" rather than a misleading
hit-rate of 100% on 3 calls.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/agents/scorecard", tags=["scorecard"])


class AgentScore(BaseModel):
    agent: str
    n_calls: int
    n_hits: int
    hit_rate: float | None
    avg_confidence: float | None
    avg_fwd_return: float | None        # average forward return when call was directional
    ic: float | None                    # signed-confidence vs fwd-return correlation
    bull_hit_rate: float | None
    bear_hit_rate: float | None
    chop_hit_rate: float | None


class ScorecardResponse(BaseModel):
    horizon_d: int
    n_total_calls: int
    agents: list[AgentScore]


_HORIZON_TO_RETCOL = {
    5: ("fwd_return_5d", "hit_5d"),
    10: ("fwd_return_10d", "hit_10d"),
    20: ("fwd_return_20d", "hit_20d"),
    60: ("fwd_return_60d", "hit_60d"),
}


@router.get("", response_model=ScorecardResponse)
async def get_scorecard(
    horizon: Literal[5, 10, 20, 60] = Query(20, description="Forward-return horizon in days"),
) -> ScorecardResponse:
    """Per-agent track record at a given horizon.

    Excludes neutral calls from `n_calls` for hit-rate purposes — neutrals
    are scored separately (a neutral call hits if |fwd return| < 1%).
    """
    if horizon not in _HORIZON_TO_RETCOL:
        raise HTTPException(status_code=400, detail=f"Unsupported horizon: {horizon}")
    ret_col, hit_col = _HORIZON_TO_RETCOL[horizon]

    pool = get_pool()
    sql = f"""
        WITH base AS (
            SELECT
              agent,
              signal,
              confidence,
              regime_at_run,
              {ret_col} AS fwd_ret,
              {hit_col} AS hit
            FROM agent_eval
            WHERE {ret_col} IS NOT NULL AND {hit_col} IS NOT NULL
        ),
        per_agent AS (
            SELECT
              agent,
              COUNT(*) AS n_calls,
              COUNT(*) FILTER (WHERE hit) AS n_hits,
              AVG(confidence) AS avg_confidence,
              AVG(CASE WHEN signal IN ('bullish', 'bearish') THEN fwd_ret END) AS avg_fwd_return,
              CORR(
                CASE WHEN signal = 'bullish' THEN  confidence
                     WHEN signal = 'bearish' THEN -confidence
                     ELSE 0 END,
                fwd_ret
              ) AS ic,
              -- regime breakdowns
              SUM(CASE WHEN regime_at_run = 'bull' AND hit THEN 1 ELSE 0 END)::float
                / NULLIF(SUM(CASE WHEN regime_at_run = 'bull' THEN 1 ELSE 0 END), 0) AS bull_hr,
              SUM(CASE WHEN regime_at_run = 'bear' AND hit THEN 1 ELSE 0 END)::float
                / NULLIF(SUM(CASE WHEN regime_at_run = 'bear' THEN 1 ELSE 0 END), 0) AS bear_hr,
              SUM(CASE WHEN regime_at_run = 'chop' AND hit THEN 1 ELSE 0 END)::float
                / NULLIF(SUM(CASE WHEN regime_at_run = 'chop' THEN 1 ELSE 0 END), 0) AS chop_hr
            FROM base
            GROUP BY agent
        )
        SELECT agent, n_calls, n_hits, avg_confidence, avg_fwd_return, ic,
               bull_hr, bear_hr, chop_hr
        FROM per_agent
        ORDER BY n_calls DESC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)

    def _f(v: Any) -> float | None:
        return float(v) if v is not None else None

    out = [
        AgentScore(
            agent=r["agent"],
            n_calls=int(r["n_calls"] or 0),
            n_hits=int(r["n_hits"] or 0),
            hit_rate=(int(r["n_hits"]) / int(r["n_calls"])) if r["n_calls"] else None,
            avg_confidence=_f(r["avg_confidence"]),
            avg_fwd_return=_f(r["avg_fwd_return"]),
            ic=_f(r["ic"]),
            bull_hit_rate=_f(r["bull_hr"]),
            bear_hit_rate=_f(r["bear_hr"]),
            chop_hit_rate=_f(r["chop_hr"]),
        )
        for r in rows
    ]
    return ScorecardResponse(
        horizon_d=horizon,
        n_total_calls=sum(a.n_calls for a in out),
        agents=out,
    )


class AgreementCell(BaseModel):
    agent_a: str
    agent_b: str
    n_overlap: int
    agreement_rate: float | None


class AgreementMatrixResponse(BaseModel):
    horizon_d: int
    cells: list[AgreementCell]


@router.get("/agreement", response_model=AgreementMatrixResponse)
async def get_agreement_matrix(
    horizon: Literal[5, 10, 20, 60] = Query(20),
) -> AgreementMatrixResponse:
    """Pairwise agreement matrix — for each ordered pair (a, b), what fraction
    of (run_ts, ticker) pairs did both agents make the same directional call?
    Pairs with agreement > 0.85 indicate one of the two is redundant."""
    pool = get_pool()
    sql = """
        WITH joined AS (
            SELECT a.agent AS agent_a, a.signal AS sig_a,
                   b.agent AS agent_b, b.signal AS sig_b
            FROM agent_eval a
            JOIN agent_eval b
              ON a.run_ts = b.run_ts
             AND a.ticker = b.ticker
             AND a.agent < b.agent
        )
        SELECT
          agent_a, agent_b,
          COUNT(*) AS n_overlap,
          AVG(CASE WHEN sig_a = sig_b THEN 1.0 ELSE 0.0 END) AS agreement_rate
        FROM joined
        GROUP BY agent_a, agent_b
        HAVING COUNT(*) >= 5
        ORDER BY agreement_rate DESC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)

    return AgreementMatrixResponse(
        horizon_d=horizon,
        cells=[
            AgreementCell(
                agent_a=r["agent_a"],
                agent_b=r["agent_b"],
                n_overlap=int(r["n_overlap"]),
                agreement_rate=float(r["agreement_rate"]) if r["agreement_rate"] is not None else None,
            )
            for r in rows
        ],
    )
