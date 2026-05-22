"""GET /v1/cohorts — sub-industry cohort spread analysis.

A cohort is a tight group of tickers that share an end-market or business
driver (memory semis, refiners, regional banks, etc.). Within a cohort, the
spread between any two names tends to mean-revert because the macro/sector
driver is shared and only idiosyncratic news pulls them apart.

This module exposes:

  GET /v1/cohorts                 — list of cohorts with summary spread state
  GET /v1/cohorts/{key}           — per-pair spreads + per-member positioning
  GET /v1/cohorts/by-ticker/{t}   — cohorts containing a given ticker (used by
                                    the per-ticker dossier in Phase 3)

Math is intentionally simple in Phase 2: log-price spread, z-scored against
its own rolling history. Phase 3 layers Engle-Granger cointegration on top so
we can suppress pairs whose spread isn't actually stationary.
"""
from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

from cfp_shared import COHORTS, COHORTS_BY_KEY, Cohort, cohorts_containing
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from cfp_api.db import get_pool

router = APIRouter(prefix="/v1/cohorts", tags=["cohorts"])


# ---------- shapes ----------


class CohortPairSpread(BaseModel):
    """One (leg_a, leg_b) pair within a cohort, with current spread z-score."""
    leg_a: str
    leg_b: str
    n_obs: int                  # number of overlapping closes used
    last_spread: float          # log(close_a) - log(close_b) on last bar
    mean_spread: float
    std_spread: float
    z: float                    # (last - mean) / std; sign convention: z>0 → A rich, B cheap
    pctile: float | None = None  # current spread's percentile within window history


class CohortMember(BaseModel):
    """Per-ticker positioning within a cohort over the analysis window."""
    ticker: str
    ret_window: float | None    # cumulative return over the window
    rel_vs_median: float | None  # ret_window − cohort median ret_window
    is_leader: bool = False
    is_laggard: bool = False


class CohortSummary(BaseModel):
    """Compact summary used by the cross-cohort list endpoint."""
    key: str
    label: str
    description: str
    members: list[str]
    n_members: int
    last_close_ts: datetime | None
    # Worst-stretched pair, by |z|. None if not enough data to compute any pair.
    max_abs_z: float | None
    max_abs_z_pair: tuple[str, str] | None
    leader: str | None
    laggard: str | None


class CohortDetail(BaseModel):
    """Full detail for one cohort: every pair spread + every member's position."""
    key: str
    label: str
    description: str
    window_days: int
    last_close_ts: datetime | None
    members: list[CohortMember]
    pairs: list[CohortPairSpread]


class CohortListResponse(BaseModel):
    window_days: int
    cohorts: list[CohortSummary]


class CohortsByTickerResponse(BaseModel):
    ticker: str
    cohorts: list[CohortSummary]


# ---------- helpers ----------


async def _fetch_closes(
    members: tuple[str, ...], lookback_days: int
) -> tuple[list[datetime], dict[str, list[float]]]:
    """Pull aligned daily closes for each cohort member.

    Returns (sorted_ts_list, {ticker: [close per ts]}). Only timestamps where
    *every* member has a close are returned, so the per-pair arrays line up
    without per-pair date-alignment work downstream.

    Uses the most recent `lookback_days * 1.6` calendar days to give some
    buffer for weekends/holidays so we land close to `lookback_days` trading
    rows even when the window crosses a long weekend.
    """
    cutoff = datetime.now(UTC) - timedelta(days=int(lookback_days * 1.6))
    pool = get_pool()
    async with pool.acquire() as conn:
        # One query per ticker is fine — small fan-out (3-6 names), each query
        # is a fast index lookup on (symbol, ts).
        per_ticker: dict[str, dict[datetime, float]] = {}
        for sym in members:
            rows = await conn.fetch(
                """
                SELECT ts, close
                FROM prices_daily
                WHERE symbol = $1 AND ts >= $2 AND close IS NOT NULL
                ORDER BY ts ASC
                """,
                sym, cutoff,
            )
            per_ticker[sym] = {r["ts"]: float(r["close"]) for r in rows}

    if not per_ticker:
        return [], {}

    # Intersect timestamps across all members so every pair is aligned.
    common_ts = set.intersection(*(set(d.keys()) for d in per_ticker.values()))
    sorted_ts = sorted(common_ts)
    aligned = {sym: [per_ticker[sym][t] for t in sorted_ts] for sym in members}
    return sorted_ts, aligned


def _pair_spreads(closes: dict[str, list[float]]) -> list[CohortPairSpread]:
    """Compute log-price spread stats for every (a, b) pair, a < b alphabetically.

    Z-score convention: z>0 means leg_a is rich vs leg_b on this bar relative
    to the window's typical spread; the convergence trade is short A / long B.
    """
    out: list[CohortPairSpread] = []
    members = list(closes.keys())
    for i, a in enumerate(members):
        for b in members[i + 1:]:
            arr_a, arr_b = closes[a], closes[b]
            n = min(len(arr_a), len(arr_b))
            if n < 20:  # not enough overlap to estimate dispersion meaningfully
                continue
            # log spread series; needs positive prices throughout (they are)
            spread = [math.log(arr_a[k]) - math.log(arr_b[k]) for k in range(n)]
            mean = sum(spread) / n
            var = sum((s - mean) ** 2 for s in spread) / max(n - 1, 1)
            std = math.sqrt(var)
            last = spread[-1]
            z = (last - mean) / std if std > 0 else 0.0
            # Empirical percentile of `last` within the window — useful when the
            # spread distribution is skewed and z over-estimates extremity.
            below = sum(1 for s in spread if s <= last)
            pctile = below / n
            # Alphabetize the pair label for deterministic ordering across runs.
            la, lb = (a, b) if a < b else (b, a)
            if la != a:
                # If we swapped, flip sign of z so the "rich/cheap" convention
                # still applies to the leg listed first.
                z = -z
                last = -last
                mean = -mean
                pctile = 1.0 - pctile
            out.append(CohortPairSpread(
                leg_a=la, leg_b=lb,
                n_obs=n,
                last_spread=last, mean_spread=mean, std_spread=std,
                z=z, pctile=pctile,
            ))
    out.sort(key=lambda p: abs(p.z), reverse=True)
    return out


def _member_positions(
    closes: dict[str, list[float]],
) -> list[CohortMember]:
    """Per-member cumulative return over the window + relative position vs
    cohort median. Used to label leader and laggard for the UI."""
    rets: dict[str, float | None] = {}
    for sym, arr in closes.items():
        if len(arr) < 2 or arr[0] <= 0:
            rets[sym] = None
            continue
        rets[sym] = (arr[-1] / arr[0]) - 1.0
    resolved = [(s, r) for s, r in rets.items() if r is not None]
    median = sorted(r for _, r in resolved)[len(resolved) // 2] if resolved else None
    leader_sym = max(resolved, key=lambda x: x[1])[0] if resolved else None
    laggard_sym = min(resolved, key=lambda x: x[1])[0] if resolved else None
    out: list[CohortMember] = []
    for sym in closes:
        r = rets[sym]
        rel = (r - median) if (r is not None and median is not None) else None
        out.append(CohortMember(
            ticker=sym,
            ret_window=r,
            rel_vs_median=rel,
            is_leader=(sym == leader_sym),
            is_laggard=(sym == laggard_sym),
        ))
    return out


async def _summarize(cohort: Cohort, window_days: int) -> CohortSummary:
    """One row for the cross-cohort list — just the headline numbers, no
    pair-by-pair detail. Cheap enough to fan out across all cohorts on
    each `/v1/cohorts` call."""
    ts, closes = await _fetch_closes(cohort.members, window_days)
    if not closes or not ts:
        return CohortSummary(
            key=cohort.key, label=cohort.label, description=cohort.description,
            members=list(cohort.members), n_members=len(cohort.members),
            last_close_ts=None, max_abs_z=None, max_abs_z_pair=None,
            leader=None, laggard=None,
        )
    pairs = _pair_spreads(closes)
    positions = _member_positions(closes)
    top = pairs[0] if pairs else None
    leader = next((m.ticker for m in positions if m.is_leader), None)
    laggard = next((m.ticker for m in positions if m.is_laggard), None)
    return CohortSummary(
        key=cohort.key, label=cohort.label, description=cohort.description,
        members=list(cohort.members), n_members=len(cohort.members),
        last_close_ts=ts[-1],
        max_abs_z=abs(top.z) if top else None,
        max_abs_z_pair=(top.leg_a, top.leg_b) if top else None,
        leader=leader, laggard=laggard,
    )


# ---------- endpoints ----------


@router.get("", response_model=CohortListResponse)
async def list_cohorts(
    window_days: int = Query(60, ge=20, le=252, description="Trading days of price history."),
) -> CohortListResponse:
    """Every cohort with its current worst-stretched pair, sorted by |z| desc.

    This is the cross-cohort dispersion view — surfaces which sub-industries
    currently have the most unusual relative pricing across their members.
    """
    summaries = []
    for c in COHORTS:
        summaries.append(await _summarize(c, window_days))
    # Stretched first, but always-pushed-to-the-end for cohorts with no data.
    summaries.sort(
        key=lambda s: (s.max_abs_z is None, -(s.max_abs_z or 0.0)),
    )
    return CohortListResponse(window_days=window_days, cohorts=summaries)


@router.get("/by-ticker/{ticker}", response_model=CohortsByTickerResponse)
async def cohorts_for_ticker(
    ticker: str,
    window_days: int = Query(60, ge=20, le=252),
) -> CohortsByTickerResponse:
    """Which cohorts contain this ticker, with summary stats per cohort.
    Used by the per-ticker dossier so "why am I being shown this name" has
    a referenceable cohort answer."""
    matched = cohorts_containing(ticker)
    summaries = [await _summarize(c, window_days) for c in matched]
    return CohortsByTickerResponse(ticker=ticker.upper(), cohorts=summaries)


@router.get("/{key}", response_model=CohortDetail)
async def cohort_detail(
    key: str,
    window_days: int = Query(60, ge=20, le=252),
) -> CohortDetail:
    """Full per-pair detail for one cohort: every spread, every z-score, every
    member's relative position. Drives the cohort drill-down UI."""
    cohort = COHORTS_BY_KEY.get(key)
    if cohort is None:
        raise HTTPException(status_code=404, detail=f"unknown cohort '{key}'")
    ts, closes = await _fetch_closes(cohort.members, window_days)
    return CohortDetail(
        key=cohort.key, label=cohort.label, description=cohort.description,
        window_days=window_days,
        last_close_ts=ts[-1] if ts else None,
        members=_member_positions(closes) if closes else [
            CohortMember(ticker=m, ret_window=None, rel_vs_median=None)
            for m in cohort.members
        ],
        pairs=_pair_spreads(closes) if closes else [],
    )
