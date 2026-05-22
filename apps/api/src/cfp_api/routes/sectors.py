"""GET /v1/sectors — sector list, rank history, scorecard, and per-ETF holdings."""

from __future__ import annotations

import math
from datetime import UTC, date as date_t, datetime
from typing import Literal

from cfp_shared import PREDICTION_TARGETS
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.schemas import SectorEntry, SectorsResponse

router = APIRouter(prefix="/v1/sectors", tags=["sectors"])


@router.get("", response_model=SectorsResponse)
async def get_sectors(
    horizon: int = Query(1, ge=1, le=60, description="Days of return to rank by. 1=today, 5=this week, 20=this month."),
    history: int = Query(30, ge=2, le=120, description="Trading days of rank/return trajectory."),
    model: str = Query("ignored", description="Legacy parameter, ignored. Was xgb_v1 model selector."),
) -> SectorsResponse:
    """Sector ETFs ranked by their actual N-day return ending today.

    Previously surfaced XGB rotation predictions from the `predictions` table.
    Rotation prediction at our horizon isn't reliable, so we ripped out the
    forecast layer and now compute pure realized return — "what's actually
    hot right now" — from `prices_daily`.

    The horizon param controls the lens (1d = today's tape, 5d = this week,
    20d = trailing month). Response shape is preserved for backwards
    compatibility with the heatmap UI:
      - latest_rank        = rank by N-day return (1 = best)
      - latest_score       = the N-day return itself (e.g. 0.0123 = +1.23%)
      - confidence         = always None (no model, no confidence)
      - prior_rank         = rank computed against yesterday's data
      - rank_history       = daily ranks over last `history` trading days
      - score_history      = N-day returns over the same window
      - n_constituents     = unchanged, from sector_holdings
      - run_ts             = latest close timestamp on the common date axis
    """
    pool = get_pool()
    _ = model  # accept-and-ignore so old clients passing model don't 422
    # Universe = 11 SPDR sector ETFs + 15 thematic ETFs (SMH/SOXX/ARKK/IBB/
    # KRE/ITA/JETS/XBI/XOP/URA/URNM/REMX/WCLD/TAN/LIT). 26 symbols total —
    # restored from the SECTORS-only narrowing in the initial Tier A rewrite.
    sectors = list(PREDICTION_TARGETS)
    # Need enough history to compute `history` daily snapshots of N-day return.
    # Add ~60% calendar buffer for weekends/holidays.
    buffer_days = int((history + horizon + 5) * 1.6)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT symbol, ts::date AS d, close
            FROM prices_daily
            WHERE symbol = ANY($1::text[])
              AND ts >= NOW() - ($2 || ' days')::interval
              AND close IS NOT NULL
            ORDER BY symbol, ts ASC
            """,
            sectors, str(buffer_days),
        )
        h_rows = await conn.fetch(
            "SELECT sector_etf, COUNT(*) AS n FROM sector_holdings GROUP BY sector_etf"
        )

    holdings = {r["sector_etf"]: int(r["n"]) for r in h_rows}
    by_sym: dict[str, list[tuple[date_t, float]]] = {}
    for r in rows:
        by_sym.setdefault(r["symbol"], []).append((r["d"], float(r["close"])))

    if not by_sym:
        return SectorsResponse(
            run_ts=None,
            sectors=[
                SectorEntry(
                    symbol=sym, latest_rank=None, latest_score=None, confidence=None,
                    prior_rank=None, rank_history=[], score_history=[],
                    horizon_d=None, n_constituents=holdings.get(sym, 0),
                )
                for sym in sectors
            ],
        )

    # Build a common date axis across sectors we have data for. Sectors with
    # no data in the window get a placeholder entry at the end.
    covered = {s: pts for s, pts in by_sym.items() if pts}
    common_dates = sorted(set.intersection(*(set(d for d, _ in pts) for pts in covered.values())))
    if len(common_dates) <= horizon:
        # Not enough days to compute even one snapshot of N-day return.
        return SectorsResponse(
            run_ts=None,
            sectors=[
                SectorEntry(
                    symbol=sym, latest_rank=None, latest_score=None, confidence=None,
                    prior_rank=None, rank_history=[], score_history=[],
                    horizon_d=None, n_constituents=holdings.get(sym, 0),
                )
                for sym in sectors
            ],
        )

    closes_aligned: dict[str, list[float]] = {}
    for sym, pts in covered.items():
        day_map = dict(pts)
        closes_aligned[sym] = [day_map[d] for d in common_dates]

    # Walk every valid day t (those with t >= horizon), compute N-day return
    # per sector, rank desc. Keep the last `history` snapshots so the UI gets
    # both the latest rank/score and a trajectory for the sparkline.
    n_days = len(common_dates)
    snapshots: list[dict[str, float]] = []  # per t in valid range: {sym: ret}
    for t in range(horizon, n_days):
        rets: dict[str, float] = {}
        for sym, closes in closes_aligned.items():
            c_now = closes[t]
            c_back = closes[t - horizon]
            if c_back > 0:
                rets[sym] = (c_now / c_back) - 1.0
        snapshots.append(rets)
    snapshots = snapshots[-history:]  # cap

    # Per (snapshot, symbol) → rank
    rank_history: dict[str, list[int]] = {s: [] for s in sectors}
    score_history: dict[str, list[float]] = {s: [] for s in sectors}
    for rets in snapshots:
        ordered = sorted(rets.items(), key=lambda kv: -kv[1])
        rank_map = {sym: i + 1 for i, (sym, _) in enumerate(ordered)}
        for sym in sectors:
            if sym in rank_map:
                rank_history[sym].append(rank_map[sym])
                score_history[sym].append(rets[sym])

    last_date = common_dates[-1]
    run_ts = datetime.combine(last_date, datetime.min.time(), tzinfo=UTC)

    entries: list[SectorEntry] = []
    for sym in sectors:
        rh = rank_history[sym]
        sh = score_history[sym]
        if not rh:
            entries.append(SectorEntry(
                symbol=sym, latest_rank=None, latest_score=None, confidence=None,
                prior_rank=None, rank_history=[], score_history=[],
                horizon_d=None, n_constituents=holdings.get(sym, 0),
            ))
            continue
        entries.append(SectorEntry(
            symbol=sym,
            latest_rank=rh[-1],
            latest_score=sh[-1],
            confidence=None,
            prior_rank=rh[-2] if len(rh) >= 2 else None,
            rank_history=rh,
            score_history=sh,
            horizon_d=horizon,
            n_constituents=holdings.get(sym, 0),
        ))
    entries.sort(key=lambda e: (e.latest_rank is None, e.latest_rank or 999))

    return SectorsResponse(run_ts=run_ts, sectors=entries)


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
    horizon: int = Query(10, ge=1, le=60, description="Legacy parameter, ignored."),
    model: str = Query("ignored", description="Legacy parameter, ignored. Was xgb_v1 model selector."),
) -> HoldingsResponse:
    """Full constituent list for `etf` with per-name returns + options sentiment.

    `model_rank` / `model_score` are kept in the response shape for backwards
    compat with the FE column but are now always None (the XGB predictions
    layer was deleted; per-stock momentum lives in the laggards panel).
    """
    _ = (horizon, model)
    if sort not in _VALID_SORT:
        raise HTTPException(status_code=400, detail=f"Invalid sort: {sort}. Valid: {sorted(_VALID_SORT)}")

    etf = etf.upper()
    pool = get_pool()

    sql = """
        WITH holdings AS (
            SELECT * FROM uw_etf_holdings WHERE etf = $1
        )
        SELECT
            h.*,
            p5.close  AS close_5d,
            p20.close AS close_20d,
            p60.close AS close_60d,
            NULL::int   AS model_rank,
            NULL::float AS model_score
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
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, etf)

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
