"""Sector network — correlation graph + lead-lag DAG.

GET /v1/network/correlation?window=60&min_correlation=0.55&horizon=10
  Force-directed graph data: each sector ETF is a node (colored by XGB
  rank: top-3 green, mid gray, bottom-3 orange), each edge is a pairwise
  correlation above the threshold.

GET /v1/network/lead-lag (future)
  Already have lead_lag_matrix from the Granger pipeline.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

import numpy as np
from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_shared import PREDICTION_TARGETS

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/network", tags=["network"])


class NetworkNode(BaseModel):
    id: str                      # ticker, e.g. "XLK"
    name: str                    # display name (currently same as id)
    rank: int | None             # XGB rank within the universe (1 = strongest)
    score: float | None          # XGB raw score
    bucket: Literal["leader", "mid", "laggard", "unranked"]
    return_window: float | None  # realized return over the corr window
    avg_correlation: float       # average |r| to other nodes in graph (for sizing)


class NetworkEdge(BaseModel):
    source: str
    target: str
    correlation: float           # signed Pearson r over the window


class NetworkResponse(BaseModel):
    window_days: int
    horizon_d: int
    min_correlation: float
    universe: list[str]
    n_obs: int                   # business days observed in the window
    nodes: list[NetworkNode]
    edges: list[NetworkEdge]
    as_of: datetime | None


@router.get("/correlation", response_model=NetworkResponse)
async def get_correlation_network(
    window: int = Query(60, ge=20, le=252, description="Trading-days lookback for correlation"),
    min_correlation: float = Query(0.55, ge=0.0, le=1.0),
    horizon: Literal[5, 10, 20] = Query(10, description="XGB prediction horizon for node coloring"),
    model: str = Query("xgb_v1"),
) -> NetworkResponse:
    """Pairwise correlation graph over the sector-ETF universe.

    Reads daily closes from prices_daily for the universe over the last
    `window` business days, computes log-return correlations, filters edges
    by `min_correlation` (absolute value), and joins to the latest XGB
    predictions to color nodes by rank bucket (top-3 leaders / mid / bottom-3
    laggards). Average |r| per node feeds the FE's node sizing."""
    pool = get_pool()
    universe = list(PREDICTION_TARGETS)

    # Pull prices for the universe.
    sql = """
        SELECT ts, symbol, close
        FROM prices_daily
        WHERE symbol = ANY($1::text[])
          AND ts >= NOW() - ($2 || ' days')::interval
        ORDER BY ts ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, universe, str(int(window * 1.5) + 10))

    if not rows:
        return NetworkResponse(
            window_days=window,
            horizon_d=horizon,
            min_correlation=min_correlation,
            universe=universe,
            n_obs=0,
            nodes=[],
            edges=[],
            as_of=None,
        )

    # Pivot to a (date, symbol -> close) matrix.
    by_date: dict[datetime, dict[str, float]] = {}
    for r in rows:
        ts = r["ts"]
        d = by_date.setdefault(ts, {})
        if r["close"] is not None:
            d[r["symbol"]] = float(r["close"])

    sorted_dates = sorted(by_date.keys())
    if len(sorted_dates) < 5:
        return NetworkResponse(
            window_days=window, horizon_d=horizon, min_correlation=min_correlation,
            universe=universe, n_obs=len(sorted_dates), nodes=[], edges=[], as_of=sorted_dates[-1] if sorted_dates else None,
        )

    # Build a matrix: rows = dates, cols = symbols. Symbols missing on a date
    # get NaN; we fill forward then drop rows that still have NaN.
    symbols_present = sorted({s for d in by_date.values() for s in d})
    n = len(sorted_dates)
    m = len(symbols_present)
    mat = np.full((n, m), np.nan, dtype=np.float64)
    for i, dt in enumerate(sorted_dates):
        d = by_date[dt]
        for j, sym in enumerate(symbols_present):
            if sym in d:
                mat[i, j] = d[sym]

    # Forward-fill, then trim to last `window` rows.
    for j in range(m):
        col = mat[:, j]
        last = np.nan
        for i in range(n):
            if np.isnan(col[i]):
                col[i] = last
            else:
                last = col[i]
        mat[:, j] = col

    mat = mat[-window:, :] if mat.shape[0] >= window else mat
    valid_rows = ~np.isnan(mat).any(axis=1)
    mat = mat[valid_rows]
    if mat.shape[0] < 5:
        return NetworkResponse(
            window_days=window, horizon_d=horizon, min_correlation=min_correlation,
            universe=universe, n_obs=int(mat.shape[0]), nodes=[], edges=[], as_of=sorted_dates[-1],
        )

    # Log returns + correlation.
    log_returns = np.diff(np.log(mat), axis=0)
    if log_returns.shape[0] < 2:
        return NetworkResponse(
            window_days=window, horizon_d=horizon, min_correlation=min_correlation,
            universe=universe, n_obs=int(mat.shape[0]), nodes=[], edges=[], as_of=sorted_dates[-1],
        )

    corr = np.corrcoef(log_returns, rowvar=False)
    if corr.ndim == 0:
        corr = np.array([[1.0]])

    # Realized return over the window per symbol.
    window_returns: dict[str, float] = {}
    for j, sym in enumerate(symbols_present):
        if mat[0, j] > 0:
            window_returns[sym] = float(mat[-1, j] / mat[0, j] - 1.0)

    # XGB predictions for node coloring. Re-rank by score on the read side
    # because the stored `rank` column is currently degenerate (all rows are
    # rank=1; XGB training has a known bug to be fixed separately). Pick the
    # latest (run_ts, target_ts) per symbol and rank by score descending.
    pred_sql = """
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
        scored AS (
            SELECT DISTINCT ON (p.symbol) p.symbol, p.score
            FROM predictions p, latest, latest_target
            WHERE p.run_ts = latest.run_ts
              AND p.target_ts = latest_target.target_ts
              AND p.horizon_d = $1 AND p.model = $2
            ORDER BY p.symbol, p.score DESC NULLS LAST
        )
        SELECT symbol, score,
               RANK() OVER (ORDER BY score DESC NULLS LAST) AS rank
        FROM scored
    """
    async with pool.acquire() as conn:
        pred_rows = await conn.fetch(pred_sql, horizon, model)
    pred_by_sym = {r["symbol"]: r for r in pred_rows}

    # XGB ranks are currently degenerate (training bug). If the top decile
    # of scores all tie, the rank-bucket assignment is uninformative — fall
    # back to ranking by realized return over the window, which gives
    # meaningful colors regardless of XGB state.
    score_set = {float(r["score"]) for r in pred_rows if r["score"] is not None}
    use_returns_fallback = len(score_set) <= max(3, len(pred_rows) // 4)

    if use_returns_fallback and window_returns:
        sorted_by_ret = sorted(window_returns.items(), key=lambda kv: kv[1], reverse=True)
        ret_rank = {sym: i + 1 for i, (sym, _) in enumerate(sorted_by_ret)}
        n_ranked = len(ret_rank)
    else:
        ret_rank = {}
        n_ranked = len(pred_rows)

    leader_cutoff = 3
    laggard_cutoff = max(1, n_ranked - 3)

    def _bucket(rank: int | None) -> Literal["leader", "mid", "laggard", "unranked"]:
        if rank is None:
            return "unranked"
        if rank <= leader_cutoff:
            return "leader"
        if rank > laggard_cutoff:
            return "laggard"
        return "mid"

    # Compute average |r| per node first (over edges that survive the filter)
    # so node sizing reflects how connected each node is in this view.
    n_syms = len(symbols_present)
    abs_sums = np.zeros(n_syms)
    abs_counts = np.zeros(n_syms)

    edges: list[NetworkEdge] = []
    for i in range(n_syms):
        for j in range(i + 1, n_syms):
            r = float(corr[i, j])
            if not np.isfinite(r):
                continue
            if abs(r) < min_correlation:
                continue
            edges.append(NetworkEdge(
                source=symbols_present[i],
                target=symbols_present[j],
                correlation=r,
            ))
            abs_sums[i] += abs(r)
            abs_sums[j] += abs(r)
            abs_counts[i] += 1
            abs_counts[j] += 1

    nodes: list[NetworkNode] = []
    for i, sym in enumerate(symbols_present):
        p = pred_by_sym.get(sym)
        score = float(p["score"]) if p and p["score"] is not None else None
        # Use return-rank fallback if XGB scores are degenerate; else trust
        # the recomputed XGB rank.
        if use_returns_fallback:
            rank = ret_rank.get(sym)
        else:
            rank = int(p["rank"]) if p else None
        avg_r = float(abs_sums[i] / abs_counts[i]) if abs_counts[i] > 0 else 0.0
        nodes.append(NetworkNode(
            id=sym,
            name=sym,
            rank=rank,
            score=score,
            bucket=_bucket(rank),
            return_window=window_returns.get(sym),
            avg_correlation=avg_r,
        ))

    return NetworkResponse(
        window_days=window,
        horizon_d=horizon,
        min_correlation=min_correlation,
        universe=universe,
        n_obs=int(log_returns.shape[0]),
        nodes=nodes,
        edges=edges,
        as_of=sorted_dates[-1],
    )
