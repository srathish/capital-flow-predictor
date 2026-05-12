"""GET /v1/sectors — sector list, rank history, scorecard, and per-ETF holdings."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.schemas import SectorEntry, SectorsResponse
from cfp_shared import PREDICTION_TARGETS

router = APIRouter(prefix="/v1/sectors", tags=["sectors"])


@router.get("", response_model=SectorsResponse)
async def get_sectors(
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
    history: int = Query(30, ge=2, le=120, description="How many recent runs to include in rank_history."),
) -> SectorsResponse:
    """Sectors with their latest rank, prior rank, confidence, and a rank-history sparkline."""
    pool = get_pool()

    # Pull the last `history` distinct run timestamps for this (horizon, model).
    # Each run produces one row per symbol; we order ASC so the sparkline reads
    # left→right oldest→newest on the client.
    sql = """
        WITH recent_runs AS (
            SELECT DISTINCT run_ts
            FROM predictions
            WHERE horizon_d = $1 AND model = $2
            ORDER BY run_ts DESC
            LIMIT $3
        ),
        ranked AS (
            SELECT p.symbol, p.rank, p.score, p.confidence, p.run_ts, p.target_ts,
                   ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.run_ts DESC) AS rn
            FROM predictions p
            JOIN recent_runs r ON r.run_ts = p.run_ts
            WHERE p.horizon_d = $1 AND p.model = $2
        ),
        holdings_counts AS (
            SELECT sector_etf, COUNT(*) AS n
            FROM sector_holdings
            GROUP BY sector_etf
        ),
        latest AS (
            SELECT symbol, rank, score, confidence, run_ts
            FROM ranked WHERE rn = 1
        ),
        prior AS (
            SELECT symbol, rank AS prior_rank
            FROM ranked WHERE rn = 2
        ),
        history_arr AS (
            SELECT symbol,
                   ARRAY_AGG(rank ORDER BY run_ts ASC) FILTER (WHERE rank IS NOT NULL) AS rank_history,
                   ARRAY_AGG(score ORDER BY run_ts ASC) FILTER (WHERE score IS NOT NULL) AS score_history
            FROM ranked
            GROUP BY symbol
        )
        SELECT
            COALESCE(l.symbol, h.sector_etf) AS symbol,
            l.rank,
            l.score,
            l.confidence,
            p.prior_rank,
            ha.rank_history,
            ha.score_history,
            COALESCE(h.n, 0) AS n_constituents,
            l.run_ts
        FROM latest l
        FULL OUTER JOIN holdings_counts h ON l.symbol = h.sector_etf
        LEFT JOIN prior p ON p.symbol = l.symbol
        LEFT JOIN history_arr ha ON ha.symbol = l.symbol
        ORDER BY l.rank ASC NULLS LAST, symbol
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, horizon, model, history)

    run_ts = next((r["run_ts"] for r in rows if r["run_ts"] is not None), None)

    return SectorsResponse(
        run_ts=run_ts,
        sectors=[
            SectorEntry(
                symbol=r["symbol"],
                latest_rank=r["rank"],
                latest_score=float(r["score"]) if r["score"] is not None else None,
                confidence=float(r["confidence"]) if r["confidence"] is not None else None,
                prior_rank=r["prior_rank"],
                rank_history=[int(v) for v in (r["rank_history"] or [])],
                score_history=[float(v) for v in (r["score_history"] or [])],
                horizon_d=horizon if r["rank"] is not None else None,
                n_constituents=int(r["n_constituents"] or 0),
            )
            for r in rows
        ],
    )


# ---------- /v1/sectors/scorecard ----------


class BaselineMetrics(BaseModel):
    """Naive-momentum baseline: rank sectors at each run by their trailing
    20d return (no model, no features) and run the same top-3 vs bottom-3
    forward-return test. Lets the UI show whether xgb_v1 actually beats
    naïve momentum."""
    hit_rate: float | None
    avg_top3_return: float | None
    avg_bottom3_return: float | None
    avg_spread: float | None


class ScorecardResponse(BaseModel):
    horizon_d: int
    model: str
    n_runs_evaluated: int
    n_runs_total: int
    hit_rate: float | None  # fraction of runs where top-3 beat bottom-3 over horizon
    avg_top3_return: float | None
    avg_bottom3_return: float | None
    avg_spread: float | None  # avg(top3 ret − bottom3 ret) in raw pct (e.g. 0.0123 = 1.23%)
    # Spearman rank IC of model rank vs realized forward return per run,
    # then averaged across the evaluated runs. Stdev is reported so the UI
    # can show ±σ; t_stat = mean / (stdev / sqrt(n)) gives a rough significance read.
    ic_mean: float | None
    ic_stdev: float | None
    ic_t_stat: float | None
    # Naïve 20d-momentum baseline run over the same set of run_ts.
    baseline: BaselineMetrics
    last_evaluated_run: datetime | None


@router.get("/scorecard", response_model=ScorecardResponse)
async def get_scorecard(
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
    lookback_runs: int = Query(30, ge=3, le=120),
) -> ScorecardResponse:
    """Backtest the model: for each of the last N runs, compare the actual
    forward-`horizon` return of the top-3 ranked sectors vs the bottom-3,
    compute the Spearman rank IC between model rank and realized return,
    and run a naïve 20d-momentum baseline over the same runs.

    A "hit" = top-3 basket avg return > bottom-3 basket avg return over horizon.
    Skips runs where the horizon hasn't elapsed yet (no realized data).
    """
    pool = get_pool()

    # Per-run, per-symbol model rank + realized forward return.
    # Wider than the previous query: we need every symbol's rank+return per run
    # (not just bucketed top/bottom rows) so we can compute IC and re-rank
    # symbols by their trailing 20d return for the naïve baseline.
    sql = """
        WITH recent_runs AS (
            SELECT DISTINCT run_ts
            FROM predictions
            WHERE horizon_d = $1 AND model = $2
              AND run_ts <= NOW() - ($3 || ' days')::INTERVAL
            ORDER BY run_ts DESC
            LIMIT $4
        ),
        runs_with_ranks AS (
            SELECT p.run_ts, p.symbol, p.rank
            FROM predictions p
            JOIN recent_runs r ON r.run_ts = p.run_ts
            WHERE p.horizon_d = $1 AND p.model = $2 AND p.rank IS NOT NULL
        ),
        prices_at AS (
            SELECT r.run_ts, r.symbol, r.rank,
                   p_now.close  AS close_now,
                   p_fwd.close  AS close_fwd,
                   p_prev.close AS close_prev20
            FROM runs_with_ranks r
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = r.symbol AND ts <= r.run_ts
                ORDER BY ts DESC LIMIT 1
            ) p_now ON TRUE
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = r.symbol AND ts <= r.run_ts + ($1 || ' days')::INTERVAL
                ORDER BY ts DESC LIMIT 1
            ) p_fwd ON TRUE
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = r.symbol AND ts <= r.run_ts - INTERVAL '20 days'
                ORDER BY ts DESC LIMIT 1
            ) p_prev ON TRUE
        )
        SELECT run_ts, symbol, rank,
               CASE WHEN close_now > 0 AND close_fwd IS NOT NULL
                    THEN close_fwd / close_now - 1.0 END AS fwd_ret,
               CASE WHEN close_prev20 > 0 AND close_now IS NOT NULL
                    THEN close_now / close_prev20 - 1.0 END AS mom_20d
        FROM prices_at
        ORDER BY run_ts DESC, rank ASC
    """
    async with pool.acquire() as conn:
        total_runs = await conn.fetchval(
            "SELECT COUNT(DISTINCT run_ts) FROM predictions WHERE horizon_d = $1 AND model = $2",
            horizon, model,
        )
        rows = await conn.fetch(sql, horizon, model, horizon, lookback_runs)

    empty_baseline = BaselineMetrics(
        hit_rate=None, avg_top3_return=None, avg_bottom3_return=None, avg_spread=None,
    )

    if not rows:
        return ScorecardResponse(
            horizon_d=horizon,
            model=model,
            n_runs_evaluated=0,
            n_runs_total=int(total_runs or 0),
            hit_rate=None,
            avg_top3_return=None,
            avg_bottom3_return=None,
            avg_spread=None,
            ic_mean=None,
            ic_stdev=None,
            ic_t_stat=None,
            baseline=empty_baseline,
            last_evaluated_run=None,
        )

    # Group rows by run_ts.
    from collections import defaultdict
    per_run: dict = defaultdict(list)
    for r in rows:
        per_run[r["run_ts"]].append(r)

    # Per-run aggregates: model top3/bot3 returns, model rank IC, baseline top3/bot3.
    model_tops: list[float] = []
    model_bots: list[float] = []
    ics: list[float] = []
    base_tops: list[float] = []
    base_bots: list[float] = []

    for run_ts in sorted(per_run.keys(), reverse=True):
        run_rows = per_run[run_ts]
        # Drop any symbols missing forward return (calendar gaps, fresh listings).
        valid = [r for r in run_rows if r["fwd_ret"] is not None]
        if len(valid) < 6:  # need at least top-3 and bottom-3
            continue

        # ----- Model side -----
        sorted_by_rank = sorted(valid, key=lambda r: r["rank"])
        n_sym = len(sorted_by_rank)
        top_n = min(3, n_sym // 2)
        top3 = sorted_by_rank[:top_n]
        bot3 = sorted_by_rank[-top_n:]
        model_top = sum(float(r["fwd_ret"]) for r in top3) / len(top3)
        model_bot = sum(float(r["fwd_ret"]) for r in bot3) / len(bot3)
        model_tops.append(model_top)
        model_bots.append(model_bot)

        # Spearman IC: per-run rank correlation of model rank vs realized return rank.
        ic = _spearman(
            [float(r["rank"]) for r in valid],
            [float(r["fwd_ret"]) for r in valid],
        )
        if ic is not None:
            # Convention: model rank 1 = best (highest predicted), so we negate
            # the rank before correlating with realized return so a "good" IC
            # is positive (low rank ↔ high return).
            ics.append(-ic)

        # ----- Naïve 20d-momentum baseline (re-rank same symbols on same date) -----
        with_mom = [r for r in valid if r["mom_20d"] is not None]
        if len(with_mom) >= 6:
            sorted_by_mom = sorted(with_mom, key=lambda r: float(r["mom_20d"]), reverse=True)
            mom_top_n = min(3, len(sorted_by_mom) // 2)
            base_top = sum(float(r["fwd_ret"]) for r in sorted_by_mom[:mom_top_n]) / mom_top_n
            base_bot = sum(float(r["fwd_ret"]) for r in sorted_by_mom[-mom_top_n:]) / mom_top_n
            base_tops.append(base_top)
            base_bots.append(base_bot)

    n_eval = len(model_tops)
    if n_eval == 0:
        return ScorecardResponse(
            horizon_d=horizon,
            model=model,
            n_runs_evaluated=0,
            n_runs_total=int(total_runs or 0),
            hit_rate=None,
            avg_top3_return=None,
            avg_bottom3_return=None,
            avg_spread=None,
            ic_mean=None,
            ic_stdev=None,
            ic_t_stat=None,
            baseline=empty_baseline,
            last_evaluated_run=None,
        )

    hits = sum(1 for t, b in zip(model_tops, model_bots, strict=True) if t > b)
    avg_top = sum(model_tops) / n_eval
    avg_bot = sum(model_bots) / n_eval

    ic_mean = sum(ics) / len(ics) if ics else None
    if ics and len(ics) >= 2:
        mean = ic_mean or 0.0
        var = sum((x - mean) ** 2 for x in ics) / (len(ics) - 1)
        ic_stdev: float | None = var ** 0.5
        ic_t_stat: float | None = (mean / (ic_stdev / (len(ics) ** 0.5))) if ic_stdev > 0 else None
    else:
        ic_stdev = None
        ic_t_stat = None

    if base_tops:
        b_hits = sum(1 for t, b in zip(base_tops, base_bots, strict=True) if t > b)
        baseline = BaselineMetrics(
            hit_rate=b_hits / len(base_tops),
            avg_top3_return=sum(base_tops) / len(base_tops),
            avg_bottom3_return=sum(base_bots) / len(base_bots),
            avg_spread=(sum(base_tops) - sum(base_bots)) / len(base_tops),
        )
    else:
        baseline = empty_baseline

    return ScorecardResponse(
        horizon_d=horizon,
        model=model,
        n_runs_evaluated=n_eval,
        n_runs_total=int(total_runs or 0),
        hit_rate=hits / n_eval,
        avg_top3_return=avg_top,
        avg_bottom3_return=avg_bot,
        avg_spread=avg_top - avg_bot,
        ic_mean=ic_mean,
        ic_stdev=ic_stdev,
        ic_t_stat=ic_t_stat,
        baseline=baseline,
        last_evaluated_run=max(per_run.keys()),
    )


def _spearman(xs: list[float], ys: list[float]) -> float | None:
    """Pearson correlation of ranks (Spearman) without scipy.

    Returns None if inputs are degenerate (constant or length < 2). Ties are
    handled with average-rank, which is the standard Spearman convention.
    """
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    rx = _ranks(xs)
    ry = _ranks(ys)
    n = len(rx)
    mx = sum(rx) / n
    my = sum(ry) / n
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    dx2 = sum((rx[i] - mx) ** 2 for i in range(n))
    dy2 = sum((ry[i] - my) ** 2 for i in range(n))
    denom = (dx2 * dy2) ** 0.5
    if denom == 0:
        return None
    return num / denom


def _ranks(xs: list[float]) -> list[float]:
    """Average-rank ranking (1-based). Ties get the mean of their slot range."""
    indexed = sorted(enumerate(xs), key=lambda t: t[1])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(indexed):
        j = i
        while j + 1 < len(indexed) and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg = (i + j) / 2.0 + 1.0  # 1-based midpoint of the tied slot range
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg
        i = j + 1
    return ranks


# ---------- /v1/sectors/forward-call ----------


class ForwardCallEntry(BaseModel):
    symbol: str
    rank: int
    score: float | None
    # Cross-seed rank stability from the live-forecast ensemble. 1.0 = every
    # seed placed the symbol at the same rank as the ensemble; 0.0 = seed
    # ranks spanned the whole universe. None when the row is from a historical
    # walk-forward fold rather than a live forecast (those have no ensemble).
    confidence: float | None = None


class HorizonDisagreement(BaseModel):
    """One sector ranked very differently in another horizon's latest run.

    `delta = active_rank - other_rank`. Positive delta = the active horizon is
    *less bullish* on this symbol than `other_horizon_d`; negative = more bullish.
    """
    symbol: str
    active_rank: int
    other_horizon_d: int
    other_rank: int
    delta: int


class ForwardCallResponse(BaseModel):
    """Structured forward-looking call assembled from the latest run across all
    three trained horizons. The frontend renders the prose; this endpoint
    supplies the facts.
    """
    horizon_d: int
    model: str
    run_ts: datetime | None
    # Forward projection endpoint: last feature date + horizon_d business days.
    # NOT the raw target_ts stored in the predictions row (that's the as-of feature date).
    target_ts: datetime | None
    # Days since run_ts. Lets the UI flag stale forecasts when the model hasn't been retrained.
    stale_days: int | None
    top: list[ForwardCallEntry]
    bottom: list[ForwardCallEntry]
    score_spread: float | None
    conviction: Literal["high", "medium", "low"]
    # Number of consecutive most-recent runs whose top-3 SET (any order) equals today's.
    stability_runs: int
    # Symbols whose rank in another horizon disagrees by ≥ 4 slots (top by magnitude, max 4).
    disagreements: list[HorizonDisagreement]


_FORWARD_HORIZONS = (5, 10, 20)


def _add_business_days(start: datetime, n: int) -> datetime:
    """Add n business days (Mon–Fri) to start. Naive on holidays — close enough for UI labelling."""
    d = start
    added = 0
    while added < n:
        d = d + timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d


@router.get("/forward-call", response_model=ForwardCallResponse)
async def get_forward_call(
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
) -> ForwardCallResponse:
    """Forward-looking call assembled from the latest run of the chosen horizon
    plus the latest runs of the other trained horizons, so the UI can flag
    cross-horizon disagreement and rank stability."""
    pool = get_pool()

    # Each run writes predictions for many target_ts (one per date in the
    # walk-forward panel). We want the latest run AND, within it, the latest
    # target_ts — without that second filter we'd return whichever rank=1 row
    # Postgres happened to pick from any historical fold.
    sql_active = """
        WITH latest_run AS (
            SELECT MAX(run_ts) AS rt FROM predictions
            WHERE horizon_d = $1 AND model = $2
        ),
        latest_target AS (
            SELECT MAX(target_ts) AS tt FROM predictions p, latest_run l
            WHERE p.run_ts = l.rt AND p.horizon_d = $1 AND p.model = $2
        )
        SELECT p.symbol, p.rank, p.score, p.confidence, p.run_ts, p.target_ts
        FROM predictions p, latest_run l, latest_target t
        WHERE p.run_ts = l.rt AND p.target_ts = t.tt
          AND p.horizon_d = $1 AND p.model = $2
          AND p.rank IS NOT NULL
        ORDER BY p.rank ASC
    """
    sql_other = """
        WITH latest_run AS (
            SELECT MAX(run_ts) AS rt FROM predictions
            WHERE horizon_d = $1 AND model = $2
        ),
        latest_target AS (
            SELECT MAX(target_ts) AS tt FROM predictions p, latest_run l
            WHERE p.run_ts = l.rt AND p.horizon_d = $1 AND p.model = $2
        )
        SELECT p.symbol, p.rank
        FROM predictions p, latest_run l, latest_target t
        WHERE p.run_ts = l.rt AND p.target_ts = t.tt
          AND p.horizon_d = $1 AND p.model = $2
          AND p.rank IS NOT NULL
    """
    # Stability: take the most recent N target_ts values within the latest run
    # so "held for K runs" actually means "held for K of the most recent
    # forecast snapshots" rather than K independent training runs.
    sql_stability = """
        WITH latest_run AS (
            SELECT MAX(run_ts) AS rt FROM predictions
            WHERE horizon_d = $1 AND model = $2
        ),
        recent_targets AS (
            SELECT DISTINCT p.target_ts FROM predictions p, latest_run l
            WHERE p.run_ts = l.rt AND p.horizon_d = $1 AND p.model = $2
            ORDER BY p.target_ts DESC
            LIMIT 12
        )
        SELECT p.target_ts AS run_ts, p.symbol
        FROM predictions p
        CROSS JOIN latest_run l
        JOIN recent_targets r ON r.target_ts = p.target_ts
        WHERE p.run_ts = l.rt
          AND p.horizon_d = $1 AND p.model = $2
          AND p.rank IS NOT NULL AND p.rank <= 3
        ORDER BY p.target_ts DESC, p.rank ASC
    """

    other_horizons = tuple(h for h in _FORWARD_HORIZONS if h != horizon)

    async with pool.acquire() as conn:
        active_rows = await conn.fetch(sql_active, horizon, model)
        other_by_h: dict[int, list] = {}
        for h in other_horizons:
            other_by_h[h] = await conn.fetch(sql_other, h, model)
        stability_rows = await conn.fetch(sql_stability, horizon, model)

    if not active_rows:
        return ForwardCallResponse(
            horizon_d=horizon, model=model, run_ts=None, target_ts=None,
            stale_days=None,
            top=[], bottom=[], score_spread=None,
            conviction="low", stability_runs=0, disagreements=[],
        )

    n = len(active_rows)
    top_k = max(1, min(3, n // 3))
    top_rows = list(active_rows[:top_k])
    bottom_rows = list(active_rows[-top_k:])

    def _entry(r) -> ForwardCallEntry:
        return ForwardCallEntry(
            symbol=r["symbol"],
            rank=int(r["rank"]),
            score=float(r["score"]) if r["score"] is not None else None,
            confidence=float(r["confidence"]) if r["confidence"] is not None else None,
        )

    top = [_entry(r) for r in top_rows]
    bottom = [_entry(r) for r in bottom_rows]

    top_score = top[0].score if top else None
    bot_score = bottom[-1].score if bottom else None
    score_spread: float | None = (
        top_score - bot_score if (top_score is not None and bot_score is not None) else None
    )

    if score_spread is None:
        conviction: Literal["high", "medium", "low"] = "low"
    elif score_spread >= 0.12:
        conviction = "high"
    elif score_spread >= 0.05:
        conviction = "medium"
    else:
        conviction = "low"

    # Stability of the *set* (order-insensitive) of top-3 symbols across recent runs.
    from collections import defaultdict
    runs_top: dict[Any, set[str]] = defaultdict(set)
    for r in stability_rows:
        runs_top[r["run_ts"]].add(r["symbol"])
    if runs_top:
        sorted_runs = sorted(runs_top.keys(), reverse=True)
        latest_set = runs_top[sorted_runs[0]]
        stability_runs = 0
        for rt in sorted_runs:
            if runs_top[rt] == latest_set:
                stability_runs += 1
            else:
                break
    else:
        stability_runs = 0

    active_rank_by_sym = {r["symbol"]: int(r["rank"]) for r in active_rows}
    disagreements: list[HorizonDisagreement] = []
    for h, rows in other_by_h.items():
        other_rank_by_sym = {r["symbol"]: int(r["rank"]) for r in rows}
        for sym, ar in active_rank_by_sym.items():
            or_ = other_rank_by_sym.get(sym)
            if or_ is None:
                continue
            delta = ar - or_
            if abs(delta) >= 4:
                disagreements.append(HorizonDisagreement(
                    symbol=sym, active_rank=ar, other_horizon_d=h,
                    other_rank=or_, delta=delta,
                ))
    disagreements.sort(key=lambda d: abs(d.delta), reverse=True)
    disagreements = disagreements[:4]

    # Forward target is the last feature date + horizon_d business days.
    # The raw target_ts column stores the feature observation date, not a forward target.
    raw_target_ts = active_rows[0]["target_ts"]
    forward_target_ts = (
        _add_business_days(raw_target_ts, horizon) if raw_target_ts is not None else None
    )

    run_ts = active_rows[0]["run_ts"]
    stale_days: int | None = None
    if run_ts is not None:
        now = datetime.now(tz=run_ts.tzinfo) if run_ts.tzinfo else datetime.now(tz=timezone.utc).replace(tzinfo=None)
        stale_days = max(0, (now - run_ts).days)

    return ForwardCallResponse(
        horizon_d=horizon,
        model=model,
        run_ts=run_ts,
        target_ts=forward_target_ts,
        stale_days=stale_days,
        top=top,
        bottom=bottom,
        score_spread=score_spread,
        conviction=conviction,
        stability_runs=stability_runs,
        disagreements=disagreements,
    )


# ---------- per-ETF holdings ----------


class HoldingEntry(BaseModel):
    ticker: str
    short_name: str | None
    sector: str | None
    weight: float | None
    close: float | None
    prev_price: float | None
    return_1d: float | None
    return_5d: float | None
    return_20d: float | None
    return_60d: float | None
    week52_high: float | None
    week52_low: float | None
    pct_off_52w_high: float | None
    volume: int | None
    avg30_volume: float | None
    volume_z: float | None  # latest / avg30 - 1
    call_premium: float | None
    put_premium: float | None
    call_put_ratio: float | None
    bullish_premium: float | None
    bearish_premium: float | None
    bullish_pct: float | None  # bullish / (bullish + bearish)
    model_score: float | None  # latest prediction score (xgb_v1, 10d) for this ticker
    model_rank: int | None     # rank within the universe at the latest run


class HoldingsResponse(BaseModel):
    etf: str
    n_holdings: int
    last_updated: datetime | None
    sort: str
    holdings: list[HoldingEntry]
    # Aggregate stats so the UI can show a footer row + breadth.
    median_return_1d: float | None
    median_return_5d: float | None
    median_return_20d: float | None
    pct_above_5d_zero: float | None  # share of holdings with positive 5d return
    pct_above_20d_zero: float | None  # share with positive 20d return


_VALID_SORT = {
    "weight", "return_1d", "return_5d", "return_20d", "return_60d",
    "call_put_ratio", "bullish_pct", "bullish_premium", "bearish_premium",
    "ticker", "pct_off_52w_high", "volume_z", "model_score",
}


@router.get("/{etf}/holdings", response_model=HoldingsResponse)
async def get_etf_holdings(
    etf: str,
    sort: str = Query("weight", description=f"Sort key. One of: {sorted(_VALID_SORT)}"),
    direction: Literal["asc", "desc"] = Query("desc"),
    limit: int = Query(500, ge=1, le=1000),
    horizon: int = Query(10, ge=1, le=60),
    model: str = Query("xgb_v1"),
) -> HoldingsResponse:
    """Full constituent list for `etf` with per-name returns + options sentiment + model score."""
    if sort not in _VALID_SORT:
        raise HTTPException(status_code=400, detail=f"Invalid sort: {sort}. Valid: {sorted(_VALID_SORT)}")

    etf = etf.upper()
    pool = get_pool()

    # Same windowed price lookup, plus a left join to the latest prediction
    # row per ticker so the UI can show model_score / model_rank inline.
    sql = """
        WITH holdings AS (
            SELECT * FROM uw_etf_holdings WHERE etf = $1
        ),
        latest_pred_run AS (
            SELECT MAX(run_ts) AS run_ts FROM predictions
            WHERE horizon_d = $2 AND model = $3
        ),
        -- Within the latest run, take only the most recent target_ts. Walk-forward
        -- CV writes ~1,250 target_ts per run; without this we'd return a random fold.
        latest_pred_target AS (
            SELECT MAX(p.target_ts) AS target_ts
            FROM predictions p, latest_pred_run lpr
            WHERE p.run_ts = lpr.run_ts
              AND p.horizon_d = $2 AND p.model = $3
        ),
        latest_preds AS (
            SELECT p.symbol, p.rank, p.score
            FROM predictions p, latest_pred_run lpr, latest_pred_target lpt
            WHERE p.run_ts = lpr.run_ts AND p.target_ts = lpt.target_ts
              AND p.horizon_d = $2 AND p.model = $3
        )
        SELECT
            h.*,
            p5.close  AS close_5d,
            p20.close AS close_20d,
            p60.close AS close_60d,
            lp.rank   AS model_rank,
            lp.score  AS model_score
        FROM holdings h
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE symbol = h.ticker AND ts <= NOW() - INTERVAL '5 days'
            ORDER BY ts DESC LIMIT 1
        ) p5 ON TRUE
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE symbol = h.ticker AND ts <= NOW() - INTERVAL '20 days'
            ORDER BY ts DESC LIMIT 1
        ) p20 ON TRUE
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily
            WHERE symbol = h.ticker AND ts <= NOW() - INTERVAL '60 days'
            ORDER BY ts DESC LIMIT 1
        ) p60 ON TRUE
        LEFT JOIN latest_preds lp ON lp.symbol = h.ticker
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, etf, horizon, model)

    def _ret(now: float | None, then: float | None) -> float | None:
        if now is None or then is None or then <= 0:
            return None
        return now / then - 1.0

    def _safe_div(a: float | None, b: float | None) -> float | None:
        if a is None or b is None or b == 0:
            return None
        return a / b

    def _pct_share(bull: float | None, bear: float | None) -> float | None:
        if bull is None or bear is None:
            return None
        denom = bull + bear
        return bull / denom if denom > 0 else None

    entries: list[HoldingEntry] = []
    last_updated_ts: datetime | None = None

    for r in rows:
        close = float(r["close"]) if r["close"] is not None else None
        prev = float(r["prev_price"]) if r["prev_price"] is not None else None
        c5 = float(r["close_5d"]) if r["close_5d"] is not None else None
        c20 = float(r["close_20d"]) if r["close_20d"] is not None else None
        c60 = float(r["close_60d"]) if r["close_60d"] is not None else None
        avg30 = float(r["avg30_volume"]) if r["avg30_volume"] is not None else None
        vol = int(r["volume"]) if r["volume"] is not None else None
        w52h = float(r["week52_high"]) if r["week52_high"] is not None else None
        cp = float(r["call_premium"]) if r["call_premium"] is not None else None
        pp = float(r["put_premium"]) if r["put_premium"] is not None else None
        bull = float(r["bullish_premium"]) if r["bullish_premium"] is not None else None
        bear = float(r["bearish_premium"]) if r["bearish_premium"] is not None else None

        entries.append(HoldingEntry(
            ticker=r["ticker"],
            short_name=r["short_name"],
            sector=r["sector"],
            weight=float(r["weight"]) if r["weight"] is not None else None,
            close=close,
            prev_price=prev,
            return_1d=_ret(close, prev),
            return_5d=_ret(close, c5),
            return_20d=_ret(close, c20),
            return_60d=_ret(close, c60),
            week52_high=w52h,
            week52_low=float(r["week52_low"]) if r["week52_low"] is not None else None,
            pct_off_52w_high=(close / w52h - 1.0) if (close and w52h and w52h > 0) else None,
            volume=vol,
            avg30_volume=avg30,
            volume_z=(vol / avg30 - 1.0) if (vol and avg30 and avg30 > 0) else None,
            call_premium=cp,
            put_premium=pp,
            call_put_ratio=_safe_div(cp, pp),
            bullish_premium=bull,
            bearish_premium=bear,
            bullish_pct=_pct_share(bull, bear),
            model_score=float(r["model_score"]) if r["model_score"] is not None else None,
            model_rank=int(r["model_rank"]) if r["model_rank"] is not None else None,
        ))
        if r["last_fetched"] is not None:
            ts = r["last_fetched"]
            if last_updated_ts is None or ts > last_updated_ts:
                last_updated_ts = ts

    # Sort in Python (small list — typically <100 holdings per ETF) so we can
    # treat None safely.
    reverse = direction == "desc"

    def _key(h: HoldingEntry):
        v = getattr(h, sort, None)
        if v is None:
            return (1, 0)
        return (0, -v if reverse and isinstance(v, (int, float)) else v)

    entries.sort(key=_key)
    entries = entries[:limit]

    # Aggregate stats — computed on the *returned* slice so the UI footer matches what's visible.
    def _median(xs: list[float]) -> float | None:
        if not xs:
            return None
        s = sorted(xs)
        n = len(s)
        return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])

    def _share_pos(xs: list[float]) -> float | None:
        if not xs:
            return None
        return sum(1 for x in xs if x > 0) / len(xs)

    r1 = [h.return_1d for h in entries if h.return_1d is not None]
    r5 = [h.return_5d for h in entries if h.return_5d is not None]
    r20 = [h.return_20d for h in entries if h.return_20d is not None]

    return HoldingsResponse(
        etf=etf,
        n_holdings=len(entries),
        last_updated=last_updated_ts,
        sort=sort,
        holdings=entries,
        median_return_1d=_median(r1),
        median_return_5d=_median(r5),
        median_return_20d=_median(r20),
        pct_above_5d_zero=_share_pos(r5),
        pct_above_20d_zero=_share_pos(r20),
    )


# ---------- /v1/sectors/rrg (Relative Rotation Graph) ----------


RrgQuadrant = Literal["leading", "weakening", "lagging", "improving"]


class RrgPoint(BaseModel):
    ts: datetime
    rs_ratio: float       # ~100-centered; >100 = outperforming benchmark
    rs_momentum: float    # ~100-centered; >100 = RS-Ratio accelerating
    quadrant: RrgQuadrant


class RrgSector(BaseModel):
    symbol: str
    points: list[RrgPoint]              # oldest -> newest within the requested tail window
    head_quadrant: RrgQuadrant          # quadrant of the latest point
    rotation: Literal["accelerating", "decelerating", "stable"]  # head momentum direction
    distance_from_origin: float         # √((rs−100)² + (mom−100)²) at head — bigger = more extreme


class RrgResponse(BaseModel):
    benchmark: str
    tail_weeks: int
    n_window: int                  # smoothing window in business days used for both axes
    sectors: list[RrgSector]
    asof: datetime | None


def _classify_quadrant(rs: float, mom: float) -> RrgQuadrant:
    if rs >= 100.0 and mom >= 100.0:
        return "leading"
    if rs >= 100.0 and mom < 100.0:
        return "weakening"
    if rs < 100.0 and mom < 100.0:
        return "lagging"
    return "improving"


@router.get("/rrg", response_model=RrgResponse)
async def get_rrg(
    tail_weeks: int = Query(8, ge=2, le=26),
    benchmark: str = Query("SPY"),
    n_window: int = Query(63, ge=10, le=252),
) -> RrgResponse:
    """Relative Rotation Graph for sector + theme ETFs against the benchmark.

    Uses the JdK-style construction: take the price ratio sector/benchmark,
    z-score it over a rolling n_window (default ~3 months) and re-center to 100
    to get RS-Ratio. Z-score that series over the same window to get RS-Momentum.
    The 4-quadrant plot lets traders see at a glance which sectors are
    *currently* outperforming AND accelerating (leading) vs. fading from a
    prior lead (weakening) vs. underperforming but turning up (improving).

    Daily bars; tail_weeks * 5 trading days of trail per sector.
    """
    import math

    symbols = [*PREDICTION_TARGETS, benchmark]
    pool = get_pool()

    sql = """
        SELECT symbol, ts, close
        FROM prices_daily
        WHERE symbol = ANY($1::text[])
        ORDER BY symbol, ts
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, symbols)

    if not rows:
        return RrgResponse(
            benchmark=benchmark, tail_weeks=tail_weeks, n_window=n_window,
            sectors=[], asof=None,
        )

    # Group prices by symbol -> [(ts, close), ...] sorted asc.
    by_sym: dict[str, list[tuple[datetime, float]]] = {}
    for r in rows:
        by_sym.setdefault(r["symbol"], []).append((r["ts"], float(r["close"])))

    bench = by_sym.get(benchmark)
    if not bench or len(bench) < n_window + 10:
        raise HTTPException(
            status_code=503,
            detail=f"insufficient {benchmark} price history for RRG (need ~{n_window + 10} bars)",
        )
    bench_by_ts = dict(bench)
    bench_ts_sorted = [t for t, _ in bench]

    tail_n = tail_weeks * 5  # daily bars approx weekly RRG
    asof_ts: datetime | None = None
    sectors: list[RrgSector] = []

    for sym in PREDICTION_TARGETS:
        bars = by_sym.get(sym)
        if not bars or len(bars) < n_window + tail_n + 10:
            continue

        # Align to benchmark calendar — drop sector bars whose ts the benchmark
        # doesn't have. Keeps the ratio honest (no holiday-day mismatches).
        aligned: list[tuple[datetime, float, float]] = []
        for ts, c in bars:
            bp = bench_by_ts.get(ts)
            if bp is None or bp == 0.0:
                continue
            aligned.append((ts, c, bp))
        if len(aligned) < n_window + tail_n + 5:
            continue

        # Compute price ratio and a rolling z-score thereof, re-centered to 100.
        ratios = [c / bp for _, c, bp in aligned]
        n = len(ratios)

        def _rolling_zscore_100(series: list[float], window: int) -> list[float | None]:
            out: list[float | None] = []
            for i in range(len(series)):
                if i + 1 < window:
                    out.append(None)
                    continue
                w = series[i + 1 - window : i + 1]
                mean = sum(w) / window
                var = sum((x - mean) ** 2 for x in w) / window
                sd = math.sqrt(var) if var > 0 else 0.0
                if sd == 0.0:
                    out.append(100.0)
                else:
                    out.append(100.0 + (series[i] - mean) / sd)
            return out

        rs_ratio = _rolling_zscore_100(ratios, n_window)

        # RS-Momentum: same z-score-to-100 transform applied to RS-Ratio, but
        # we can only compute it from the first non-null index.
        rs_ratio_clean: list[float] = []
        first_valid = next((i for i, v in enumerate(rs_ratio) if v is not None), None)
        if first_valid is None:
            continue
        for v in rs_ratio[first_valid:]:
            rs_ratio_clean.append(v if v is not None else 100.0)
        mom_window = max(10, n_window // 3)
        rs_mom_clean = _rolling_zscore_100(rs_ratio_clean, mom_window)

        # Walk back through the tail. We want the last `tail_n` points where
        # both series are populated.
        points: list[RrgPoint] = []
        for j in range(len(rs_mom_clean) - tail_n, len(rs_mom_clean)):
            if j < 0:
                continue
            mom = rs_mom_clean[j]
            rs = rs_ratio_clean[j]
            if mom is None:
                continue
            ts = aligned[first_valid + j][0]
            points.append(RrgPoint(
                ts=ts, rs_ratio=float(rs), rs_momentum=float(mom),
                quadrant=_classify_quadrant(rs, mom),
            ))
        if not points:
            continue

        head = points[-1]
        prev_mom = points[-2].rs_momentum if len(points) >= 2 else head.rs_momentum
        delta = head.rs_momentum - prev_mom
        rotation: Literal["accelerating", "decelerating", "stable"]
        if delta > 0.15:
            rotation = "accelerating"
        elif delta < -0.15:
            rotation = "decelerating"
        else:
            rotation = "stable"
        dist = math.sqrt((head.rs_ratio - 100.0) ** 2 + (head.rs_momentum - 100.0) ** 2)

        sectors.append(RrgSector(
            symbol=sym,
            points=points,
            head_quadrant=head.quadrant,
            rotation=rotation,
            distance_from_origin=dist,
        ))
        if asof_ts is None or head.ts > asof_ts:
            asof_ts = head.ts

    # Stable order: leading first (closest to top-right corner), then by distance descending.
    quadrant_pri = {"leading": 0, "improving": 1, "weakening": 2, "lagging": 3}
    sectors.sort(key=lambda s: (quadrant_pri[s.head_quadrant], -s.distance_from_origin))

    return RrgResponse(
        benchmark=benchmark,
        tail_weeks=tail_weeks,
        n_window=n_window,
        sectors=sectors,
        asof=asof_ts,
    )
