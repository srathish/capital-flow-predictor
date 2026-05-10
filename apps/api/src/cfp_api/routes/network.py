"""Sector network — correlation graph, lead-lag DAG, and sector expansion.

GET /v1/network/correlation?window=60&min_correlation=0.55&horizon=10
  Force-directed graph data: each sector ETF is a node (colored by XGB
  rank: top-3 green, mid gray, bottom-3 orange), each edge is a pairwise
  correlation above the threshold.

GET /v1/network/lead-lag?max_p=0.05&min_lag=1&max_lag=10
  Directed Granger lead → follower edges from lead_lag_matrix.

GET /v1/network/sector/{etf}/expand?window=60&min_correlation=0.55&top=12
  Top-N constituents of `etf` plus a tether edge to the parent ETF and
  pairwise correlation edges among the constituents themselves.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

import numpy as np
from cfp_shared import PREDICTION_TARGETS
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

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


_VALID_HORIZONS = {5, 10, 20}


@router.get("/correlation", response_model=NetworkResponse)
async def get_correlation_network(
    window: int = Query(60, ge=20, le=252, description="Trading-days lookback for correlation"),
    min_correlation: float = Query(0.55, ge=0.0, le=1.0),
    # FastAPI's Literal[5, 10, 20] doesn't coerce string query params to int —
    # it rejects "20" because it's not literally the int 20. Take int + validate.
    horizon: int = Query(10, description="XGB prediction horizon (5, 10, or 20)"),
    model: str = Query("xgb_v1"),
) -> NetworkResponse:
    if horizon not in _VALID_HORIZONS:
        raise HTTPException(status_code=400, detail=f"horizon must be one of {sorted(_VALID_HORIZONS)}")
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
        if use_returns_fallback:  # noqa: SIM108 — nested ternary would be unreadable
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


# ---------- lead-lag DAG -----------------------------------------------------


class LeadLagEdge(BaseModel):
    source: str          # leader
    target: str          # follower
    lag: int             # business days
    p_value: float       # Granger F-test p-value


class LeadLagResponse(BaseModel):
    computed_ts: datetime | None
    horizon_d: int
    max_p: float
    min_lag: int
    max_lag: int
    universe: list[str]
    nodes: list[NetworkNode]
    edges: list[LeadLagEdge]


@router.get("/lead-lag", response_model=LeadLagResponse)
async def get_lead_lag(
    max_p: float = Query(0.05, ge=0.0, le=1.0, description="Max Granger p-value to include"),
    min_lag: int = Query(1, ge=1, le=20),
    max_lag: int = Query(10, ge=1, le=20),
    horizon: int = Query(10, description="XGB horizon used to color nodes (5, 10, 20)"),
    model: str = Query("xgb_v1"),
) -> LeadLagResponse:
    """Directed lead → follower edges from the latest Granger computation."""
    if horizon not in _VALID_HORIZONS:
        raise HTTPException(status_code=400, detail=f"horizon must be one of {sorted(_VALID_HORIZONS)}")
    if min_lag > max_lag:
        raise HTTPException(status_code=400, detail="min_lag must be <= max_lag")

    pool = get_pool()
    universe = list(PREDICTION_TARGETS)

    sql = """
        WITH latest AS (
            SELECT MAX(computed_ts) AS computed_ts FROM lead_lag_matrix
        )
        SELECT m.leader, m.follower, m.max_lag, m.p_value, m.computed_ts
        FROM lead_lag_matrix m, latest l
        WHERE m.computed_ts = l.computed_ts
          AND m.leader = ANY($1::text[])
          AND m.follower = ANY($1::text[])
          AND m.max_lag BETWEEN $2 AND $3
          AND m.p_value <= $4
        ORDER BY m.p_value ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, universe, min_lag, max_lag, max_p)

    if not rows:
        return LeadLagResponse(
            computed_ts=None, horizon_d=horizon, max_p=max_p,
            min_lag=min_lag, max_lag=max_lag,
            universe=universe, nodes=[], edges=[],
        )

    computed_ts = rows[0]["computed_ts"]

    # For each pair (a, b) keep only the most-significant (smallest p) direction
    # so the DAG isn't cluttered by both A→B and B→A edges. The matrix is
    # asymmetric in principle, but in practice the noise direction adds clutter.
    best_per_pair: dict[tuple[str, str], dict] = {}
    for r in rows:
        a, b = r["leader"], r["follower"]
        key = tuple(sorted((a, b)))
        prev = best_per_pair.get(key)
        if prev is None or float(r["p_value"]) < float(prev["p_value"]):
            best_per_pair[key] = r

    edges: list[LeadLagEdge] = [
        LeadLagEdge(
            source=r["leader"],
            target=r["follower"],
            lag=int(r["max_lag"]),
            p_value=float(r["p_value"]),
        )
        for r in best_per_pair.values()
    ]

    # Node coloring — same XGB rank logic as /correlation, sans corr fallback.
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

    score_set = {float(r["score"]) for r in pred_rows if r["score"] is not None}
    use_returns_fallback = len(score_set) <= max(3, len(pred_rows) // 4)
    n_ranked = len(pred_rows)
    if use_returns_fallback:
        n_ranked = 0  # disable bucketing if XGB is degenerate; render as unranked

    leader_cutoff = 3
    laggard_cutoff = max(1, n_ranked - 3)

    def _bucket(rank: int | None) -> Literal["leader", "mid", "laggard", "unranked"]:
        if rank is None or n_ranked == 0:
            return "unranked"
        if rank <= leader_cutoff:
            return "leader"
        if rank > laggard_cutoff:
            return "laggard"
        return "mid"

    # Out-degree per node — leaders (high out-degree) get sized larger.
    out_deg: dict[str, int] = {}
    in_deg: dict[str, int] = {}
    for e in edges:
        out_deg[e.source] = out_deg.get(e.source, 0) + 1
        in_deg[e.target] = in_deg.get(e.target, 0) + 1

    present = set(out_deg.keys()) | set(in_deg.keys())
    nodes: list[NetworkNode] = []
    for sym in sorted(present):
        p = pred_by_sym.get(sym)
        score = float(p["score"]) if p and p["score"] is not None else None
        rank = int(p["rank"]) if p and not use_returns_fallback else None
        # Repurpose avg_correlation as a connectivity proxy so the FE sizing
        # logic still works without a new field — out-degree dominates.
        deg = out_deg.get(sym, 0) * 2 + in_deg.get(sym, 0)
        nodes.append(NetworkNode(
            id=sym,
            name=sym,
            rank=rank,
            score=score,
            bucket=_bucket(rank),
            return_window=None,
            avg_correlation=float(deg),
        ))

    return LeadLagResponse(
        computed_ts=computed_ts,
        horizon_d=horizon,
        max_p=max_p,
        min_lag=min_lag,
        max_lag=max_lag,
        universe=universe,
        nodes=nodes,
        edges=edges,
    )


# ---------- sector expansion: ETF → constituents ----------------------------


class ExpandedNode(BaseModel):
    id: str                      # ticker
    name: str                    # short name
    is_parent: bool              # the sector ETF itself
    weight: float | None         # constituent weight in the parent ETF (None for parent)
    return_window: float | None
    parent_correlation: float | None  # correlation to parent ETF over the window


class ExpandedEdge(BaseModel):
    source: str
    target: str
    correlation: float
    is_tether: bool              # true if this edge ties a constituent to its parent ETF


class ExpandedSectorResponse(BaseModel):
    etf: str
    window_days: int
    min_correlation: float
    n_obs: int
    nodes: list[ExpandedNode]
    edges: list[ExpandedEdge]
    as_of: datetime | None


@router.get("/sector/{etf}/expand", response_model=ExpandedSectorResponse)
async def expand_sector(
    etf: str,
    window: int = Query(60, ge=20, le=252),
    min_correlation: float = Query(0.55, ge=0.0, le=1.0),
    top: int = Query(12, ge=2, le=50, description="Top constituents by weight to include"),
) -> ExpandedSectorResponse:
    """Top constituents of an ETF, tethered to the parent and connected by correlation."""
    etf = etf.upper()
    pool = get_pool()

    # Top constituents by weight.
    holdings_sql = """
        SELECT ticker, short_name, weight
        FROM uw_etf_holdings
        WHERE etf = $1 AND ticker IS NOT NULL
        ORDER BY weight DESC NULLS LAST
        LIMIT $2
    """
    async with pool.acquire() as conn:
        holdings = await conn.fetch(holdings_sql, etf, top)

    if not holdings:
        return ExpandedSectorResponse(
            etf=etf, window_days=window, min_correlation=min_correlation,
            n_obs=0, nodes=[], edges=[], as_of=None,
        )

    constituents = [h["ticker"] for h in holdings]
    name_by_sym = {h["ticker"]: (h["short_name"] or h["ticker"]) for h in holdings}
    weight_by_sym = {h["ticker"]: (float(h["weight"]) if h["weight"] is not None else None) for h in holdings}

    symbols = [etf, *constituents]
    price_sql = """
        SELECT ts, symbol, close
        FROM prices_daily
        WHERE symbol = ANY($1::text[])
          AND ts >= NOW() - ($2 || ' days')::interval
        ORDER BY ts ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(price_sql, symbols, str(int(window * 1.5) + 10))

    if not rows:
        return ExpandedSectorResponse(
            etf=etf, window_days=window, min_correlation=min_correlation,
            n_obs=0, nodes=[], edges=[], as_of=None,
        )

    by_date: dict[datetime, dict[str, float]] = {}
    for r in rows:
        d = by_date.setdefault(r["ts"], {})
        if r["close"] is not None:
            d[r["symbol"]] = float(r["close"])

    sorted_dates = sorted(by_date.keys())
    symbols_present = sorted({s for d in by_date.values() for s in d})
    if etf not in symbols_present or len(symbols_present) < 2:
        return ExpandedSectorResponse(
            etf=etf, window_days=window, min_correlation=min_correlation,
            n_obs=0, nodes=[], edges=[], as_of=sorted_dates[-1] if sorted_dates else None,
        )

    n, m = len(sorted_dates), len(symbols_present)
    mat = np.full((n, m), np.nan, dtype=np.float64)
    for i, dt in enumerate(sorted_dates):
        d = by_date[dt]
        for j, sym in enumerate(symbols_present):
            if sym in d:
                mat[i, j] = d[sym]

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
        return ExpandedSectorResponse(
            etf=etf, window_days=window, min_correlation=min_correlation,
            n_obs=int(mat.shape[0]), nodes=[], edges=[], as_of=sorted_dates[-1],
        )

    log_returns = np.diff(np.log(mat), axis=0)
    if log_returns.shape[0] < 2:
        return ExpandedSectorResponse(
            etf=etf, window_days=window, min_correlation=min_correlation,
            n_obs=int(mat.shape[0]), nodes=[], edges=[], as_of=sorted_dates[-1],
        )

    corr = np.corrcoef(log_returns, rowvar=False)
    if corr.ndim == 0:
        corr = np.array([[1.0]])

    window_returns: dict[str, float] = {}
    for j, sym in enumerate(symbols_present):
        if mat[0, j] > 0:
            window_returns[sym] = float(mat[-1, j] / mat[0, j] - 1.0)

    parent_idx = symbols_present.index(etf)
    parent_corr: dict[str, float] = {}
    for j, sym in enumerate(symbols_present):
        if sym == etf:
            continue
        r = float(corr[parent_idx, j])
        if np.isfinite(r):
            parent_corr[sym] = r

    nodes: list[ExpandedNode] = [
        ExpandedNode(
            id=etf, name=etf, is_parent=True, weight=None,
            return_window=window_returns.get(etf),
            parent_correlation=None,
        )
    ]
    for sym in symbols_present:
        if sym == etf:
            continue
        nodes.append(ExpandedNode(
            id=sym,
            name=name_by_sym.get(sym, sym),
            is_parent=False,
            weight=weight_by_sym.get(sym),
            return_window=window_returns.get(sym),
            parent_correlation=parent_corr.get(sym),
        ))

    # Tether edges constituent → parent (always included so the cluster stays
    # tied to the ETF visually, regardless of correlation strength).
    edges: list[ExpandedEdge] = []
    for sym, r in parent_corr.items():
        edges.append(ExpandedEdge(source=etf, target=sym, correlation=r, is_tether=True))

    # Pairwise edges among constituents above the threshold.
    for i in range(len(symbols_present)):
        for j in range(i + 1, len(symbols_present)):
            a, b = symbols_present[i], symbols_present[j]
            if a == etf or b == etf:
                continue
            r = float(corr[i, j])
            if not np.isfinite(r) or abs(r) < min_correlation:
                continue
            edges.append(ExpandedEdge(source=a, target=b, correlation=r, is_tether=False))

    return ExpandedSectorResponse(
        etf=etf,
        window_days=window,
        min_correlation=min_correlation,
        n_obs=int(log_returns.shape[0]),
        nodes=nodes,
        edges=edges,
        as_of=sorted_dates[-1],
    )


# ---------- lead-lag triggers: "X just moved, watch its followers" ----------


class FollowerHint(BaseModel):
    symbol: str
    lag: int
    p_value: float


class LeadLagTrigger(BaseModel):
    leader: str
    last_close: float
    prev_close: float
    return_pct: float            # today / yesterday - 1
    zscore: float                # standardized vs 30d return distribution
    followers: list[FollowerHint]


class LeadLagTriggersResponse(BaseModel):
    as_of: datetime | None
    sigma: float
    lookback_days: int
    matrix_computed_ts: datetime | None
    triggers: list[LeadLagTrigger]


@router.get("/lead-lag/triggers", response_model=LeadLagTriggersResponse)
async def get_lead_lag_triggers(
    sigma: float = Query(1.5, ge=0.5, le=5.0, description="Z-score threshold for an unusual move"),
    lookback: int = Query(30, ge=10, le=120, description="Trading days for vol normalization"),
    max_p: float = Query(0.05, ge=0.0, le=1.0, description="Max Granger p-value for follower edges"),
    top_followers: int = Query(5, ge=1, le=20),
) -> LeadLagTriggersResponse:
    """For each symbol whose latest daily return exceeds `sigma` of its 30d
    distribution, return the historical Granger followers from the latest
    lead_lag_matrix snapshot. Surfaces the user's "DELL moved → watch IREN"
    signal: an unusual move in a leader is a heads-up that its followers may
    move next.
    """
    pool = get_pool()
    universe = list(PREDICTION_TARGETS)

    # Pull lookback+1 closes per symbol so we can compute today's return + a
    # `lookback`-day distribution of prior returns for z-scoring.
    pad = max(int(lookback * 1.6) + 5, 45)
    price_sql = """
        SELECT ts, symbol, close
        FROM prices_daily
        WHERE symbol = ANY($1::text[])
          AND ts >= NOW() - ($2 || ' days')::interval
        ORDER BY ts ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(price_sql, universe, str(pad))

    if not rows:
        return LeadLagTriggersResponse(
            as_of=None, sigma=sigma, lookback_days=lookback,
            matrix_computed_ts=None, triggers=[],
        )

    by_sym: dict[str, list[tuple[datetime, float]]] = {}
    for r in rows:
        if r["close"] is None:
            continue
        by_sym.setdefault(r["symbol"], []).append((r["ts"], float(r["close"])))

    as_of: datetime | None = None
    candidates: dict[str, dict] = {}
    for sym, series in by_sym.items():
        series.sort(key=lambda t: t[0])
        if len(series) < lookback + 2:
            continue
        closes = np.array([c for _, c in series], dtype=np.float64)
        returns = np.diff(closes) / closes[:-1]
        if returns.size < lookback + 1:
            continue
        recent = returns[-1]
        history = returns[-(lookback + 1):-1]
        std = float(np.std(history, ddof=1))
        if not np.isfinite(std) or std <= 0:
            continue
        z = float(recent / std)
        if abs(z) < sigma:
            continue
        last_ts = series[-1][0]
        as_of = max(as_of, last_ts) if as_of else last_ts
        candidates[sym] = {
            "last_close": float(closes[-1]),
            "prev_close": float(closes[-2]),
            "return_pct": float(recent),
            "zscore": z,
        }

    if not candidates:
        return LeadLagTriggersResponse(
            as_of=as_of, sigma=sigma, lookback_days=lookback,
            matrix_computed_ts=None, triggers=[],
        )

    # Look up followers for each candidate from the latest matrix snapshot.
    follower_sql = """
        WITH latest AS (
            SELECT MAX(computed_ts) AS computed_ts FROM lead_lag_matrix
        )
        SELECT m.leader, m.follower, m.max_lag, m.p_value, m.computed_ts
        FROM lead_lag_matrix m, latest l
        WHERE m.computed_ts = l.computed_ts
          AND m.leader = ANY($1::text[])
          AND m.p_value <= $2
        ORDER BY m.leader, m.p_value ASC
    """
    async with pool.acquire() as conn:
        f_rows = await conn.fetch(follower_sql, list(candidates.keys()), max_p)

    matrix_computed_ts: datetime | None = f_rows[0]["computed_ts"] if f_rows else None
    followers_by_leader: dict[str, list[FollowerHint]] = {}
    for r in f_rows:
        bucket = followers_by_leader.setdefault(r["leader"], [])
        if len(bucket) >= top_followers:
            continue
        bucket.append(FollowerHint(
            symbol=r["follower"],
            lag=int(r["max_lag"]),
            p_value=float(r["p_value"]),
        ))

    triggers: list[LeadLagTrigger] = []
    for sym, c in candidates.items():
        followers = followers_by_leader.get(sym, [])
        if not followers:
            continue
        triggers.append(LeadLagTrigger(
            leader=sym,
            last_close=c["last_close"],
            prev_close=c["prev_close"],
            return_pct=c["return_pct"],
            zscore=c["zscore"],
            followers=followers,
        ))

    triggers.sort(key=lambda t: abs(t.zscore), reverse=True)

    return LeadLagTriggersResponse(
        as_of=as_of,
        sigma=sigma,
        lookback_days=lookback,
        matrix_computed_ts=matrix_computed_ts,
        triggers=triggers,
    )
