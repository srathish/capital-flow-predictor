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
from datetime import UTC, date as date_t, datetime, timedelta

import numpy as np
from cfp_shared import COHORTS, COHORTS_BY_KEY, Cohort, cohorts_containing
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from scipy import stats

from cfp_api.db import get_pool

# Engle-Granger critical values for the ADF test on cointegrating-regression
# residuals (intercept in step 1, no intercept in step 2, 0 lags, 2 variables).
# Source: MacKinnon (2010), Table 2 — values for N≈60-120 are stable to ±0.05.
# We surface 5% and 10% so the UI can show "cointegrated" vs "weakly cointegrated"
# rather than a single hard cutoff that would be unhelpfully binary.
_EG_CRIT_5PCT = -2.76
_EG_CRIT_10PCT = -2.45

router = APIRouter(prefix="/v1/cohorts", tags=["cohorts"])


# ---------- shapes ----------


class CohortPairSpread(BaseModel):
    """One (leg_a, leg_b) pair within a cohort, with current spread z-score
    and Engle-Granger cointegration test on the relationship."""
    leg_a: str
    leg_b: str
    n_obs: int                  # number of overlapping closes used
    last_spread: float          # log(close_a) - log(close_b) on last bar
    mean_spread: float
    std_spread: float
    z: float                    # (last - mean) / std; sign convention: z>0 → A rich, B cheap
    pctile: float | None = None  # current spread's percentile within window history
    # Engle-Granger cointegration on log(A) ~ log(B). Fields are null when n<30
    # or the regression is degenerate; we report them rather than suppress
    # non-cointegrated pairs so the user can choose how strict to be.
    eg_beta: float | None = None       # hedge ratio: log(A) ≈ α + β·log(B)
    eg_adf_t: float | None = None      # ADF t-stat on residuals; more negative = more stationary
    coint_5pct: bool | None = None     # passes Engle-Granger at 5% level
    coint_10pct: bool | None = None    # passes at 10% (weaker evidence of cointegration)


class CohortMember(BaseModel):
    """Per-ticker positioning within a cohort over the analysis window."""
    ticker: str
    ret_window: float | None    # cumulative return over the window
    rel_vs_median: float | None  # ret_window − cohort median ret_window
    is_leader: bool = False
    is_laggard: bool = False
    # Earnings annotation (±7 days). Negative offset = reported in the past
    # (interpretation: lag is fundamental); positive = upcoming (catalyst risk
    # AND potential catch-up trigger). We do NOT suppress signals on this — a
    # laggard with earnings tomorrow may be exactly the trade you want — but
    # we surface it so position-sizing can account for the asymmetry.
    earnings_date: date_t | None = None
    earnings_offset_days: int | None = None   # signed: -2 = reported 2 days ago, +3 = in 3 days
    earnings_session: str | None = None       # 'pre' | 'post' | 'amc' | 'bmo' | 'unknown'


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
    # Whether the worst-stretched pair is also cointegrated. A flagged pair
    # with coint=True is a much higher-quality signal than a flagged pair
    # with coint=False (the latter's spread doesn't actually mean-revert).
    max_abs_z_coint: bool | None = None
    leader: str | None
    laggard: str | None
    # Days until next earnings for the laggard (negative = reported, positive
    # = upcoming, null = nothing in the ±7d window). Surfaced inline so a
    # laggard with earnings tomorrow is visible from the cross-cohort view.
    laggard_earnings_offset_days: int | None = None
    leader_earnings_offset_days: int | None = None


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
) -> tuple[list[datetime], dict[str, list[float]], list[str]]:
    """Pull aligned daily closes for each cohort member.

    Returns (sorted_ts_list, {ticker: [close per ts]}, missing_members).
    Only timestamps where every *covered* member has a close are returned, so
    per-pair arrays line up without per-pair date-alignment work downstream.

    Members with zero rows in prices_daily are dropped from the result and
    reported in `missing_members` — without this, one un-ingested ticker would
    kill the entire cohort (set intersection on an empty set is empty).

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

    missing = [sym for sym in members if not per_ticker.get(sym)]
    covered = {sym: d for sym, d in per_ticker.items() if d}
    if not covered:
        return [], {}, list(missing)

    # Intersect timestamps across covered members only.
    common_ts = set.intersection(*(set(d.keys()) for d in covered.values()))
    sorted_ts = sorted(common_ts)
    aligned = {sym: [covered[sym][t] for t in sorted_ts] for sym in covered}
    return sorted_ts, aligned, list(missing)


def _engle_granger(
    log_a: np.ndarray, log_b: np.ndarray
) -> tuple[float | None, float | None, bool | None, bool | None]:
    """Engle-Granger cointegration test on log(A) vs log(B).

    Step 1: OLS log_a = α + β·log_b — β is the long-run hedge ratio.
    Step 2: ADF on residuals u_t with no constant and 0 lags:
        Δu_t = γ·u_{t-1} + ε_t
    The t-stat on γ is the ADF statistic; more negative = more stationary =
    stronger evidence the spread mean-reverts.

    Returns (beta, adf_t, coint_at_5pct, coint_at_10pct). All None when n<30
    or any intermediate quantity degenerates (zero variance, etc.).
    """
    n = len(log_a)
    if n < 30 or len(log_b) != n:
        return None, None, None, None
    # Step 1: cointegrating regression.
    reg = stats.linregress(log_b, log_a)
    beta = float(reg.slope)
    alpha = float(reg.intercept)
    residuals = log_a - (alpha + beta * log_b)
    # Step 2: ADF on residuals, no constant, 0 lags.
    u_lag = residuals[:-1]
    du = np.diff(residuals)
    sum_u_lag_sq = float(np.sum(u_lag ** 2))
    if sum_u_lag_sq <= 0 or len(du) < 2:
        return beta, None, None, None
    gamma = float(np.sum(du * u_lag) / sum_u_lag_sq)
    eps = du - gamma * u_lag
    sigma_sq = float(np.sum(eps ** 2) / max(len(du) - 1, 1))
    if sigma_sq <= 0:
        return beta, None, None, None
    se_gamma = math.sqrt(sigma_sq / sum_u_lag_sq)
    adf_t = gamma / se_gamma if se_gamma > 0 else 0.0
    return beta, adf_t, adf_t < _EG_CRIT_5PCT, adf_t < _EG_CRIT_10PCT


def _pair_spreads(closes: dict[str, list[float]]) -> list[CohortPairSpread]:
    """Compute log-price spread stats + Engle-Granger cointegration for every
    (a, b) pair, alphabetized.

    Z-score convention: z>0 means leg_a is rich vs leg_b on this bar relative
    to the window's typical spread; the convergence trade is short A / long B.
    A pair is decision-quality when |z|≥1.5 AND coint_5pct (or 10pct) is true.
    """
    out: list[CohortPairSpread] = []
    members = list(closes.keys())
    for i, a in enumerate(members):
        for b in members[i + 1:]:
            arr_a, arr_b = closes[a], closes[b]
            n = min(len(arr_a), len(arr_b))
            if n < 20:  # not enough overlap to estimate dispersion meaningfully
                continue
            log_a = np.log(np.array(arr_a[:n], dtype=float))
            log_b = np.log(np.array(arr_b[:n], dtype=float))
            # log spread series for the simple z-score view
            spread = log_a - log_b
            mean = float(spread.mean())
            std = float(spread.std(ddof=1)) if n > 1 else 0.0
            last = float(spread[-1])
            z = (last - mean) / std if std > 0 else 0.0
            below = int(np.sum(spread <= last))
            pctile = below / n
            # Cointegration uses original (unsigned) log series so beta is the
            # actual hedge ratio rather than a sign-flipped relabel.
            eg_beta, eg_adf_t, coint_5, coint_10 = _engle_granger(log_a, log_b)
            # Alphabetize the pair label for deterministic ordering.
            la, lb = (a, b) if a < b else (b, a)
            if la != a:
                z = -z
                last = -last
                mean = -mean
                pctile = 1.0 - pctile
                # Cointegration is symmetric — only β flips (1/β for the swap),
                # but β isn't decision-critical so we leave the value attached
                # to the original orientation and just rename legs.
            out.append(CohortPairSpread(
                leg_a=la, leg_b=lb,
                n_obs=n,
                last_spread=last, mean_spread=mean, std_spread=std,
                z=z, pctile=pctile,
                eg_beta=eg_beta, eg_adf_t=eg_adf_t,
                coint_5pct=coint_5, coint_10pct=coint_10,
            ))
    out.sort(key=lambda p: abs(p.z), reverse=True)
    return out


async def _fetch_earnings_offsets(
    tickers: tuple[str, ...] | list[str],
) -> dict[str, tuple[date_t, int, str | None]]:
    """For each ticker, return the *nearest* earnings event within ±7 calendar
    days as (report_date, signed_offset_days, session).

    Signed offset: -2 means reported 2 days ago, +3 means reports in 3 days.
    Tickers without an earnings event in the window are omitted from the dict.
    """
    if not tickers:
        return {}
    today = datetime.now(UTC).date()
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ticker, report_date, session
            FROM uw_earnings_calendar_daily
            WHERE ticker = ANY($1::text[])
              AND report_date BETWEEN $2 AND $3
            """,
            list({t.upper() for t in tickers}),
            today - timedelta(days=7),
            today + timedelta(days=7),
        )
    result: dict[str, tuple[date_t, int, str | None]] = {}
    for r in rows:
        t = r["ticker"]
        d: date_t = r["report_date"]
        offset = (d - today).days
        session = r["session"]
        # Keep the event closest to today per ticker — multiple rows can show
        # up if the calendar table contains revisions or cross-listings.
        if t not in result or abs(offset) < abs(result[t][1]):
            result[t] = (d, offset, session)
    return result


def _attach_earnings(
    members: list[CohortMember],
    earnings: dict[str, tuple[date_t, int, str | None]],
) -> None:
    """Mutate `members` in place, attaching earnings annotation where present."""
    for m in members:
        hit = earnings.get(m.ticker)
        if hit is None:
            continue
        d, offset, session = hit
        m.earnings_date = d
        m.earnings_offset_days = offset
        m.earnings_session = session


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


async def _summarize(
    cohort: Cohort,
    window_days: int,
    earnings: dict[str, tuple[date_t, int, str | None]] | None = None,
) -> CohortSummary:
    """One row for the cross-cohort list — just the headline numbers, no
    pair-by-pair detail. Cheap enough to fan out across all cohorts on
    each `/v1/cohorts` call.

    `earnings` is optional; passing it in lets the caller batch a single
    earnings query for many cohorts instead of paying per-cohort overhead.
    """
    ts, closes, _missing = await _fetch_closes(cohort.members, window_days)
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
    if earnings is None:
        earnings = await _fetch_earnings_offsets(cohort.members)
    leader_off = earnings[leader][1] if leader and leader in earnings else None
    laggard_off = earnings[laggard][1] if laggard and laggard in earnings else None
    return CohortSummary(
        key=cohort.key, label=cohort.label, description=cohort.description,
        members=list(cohort.members), n_members=len(cohort.members),
        last_close_ts=ts[-1],
        max_abs_z=abs(top.z) if top else None,
        max_abs_z_pair=(top.leg_a, top.leg_b) if top else None,
        max_abs_z_coint=top.coint_5pct if top else None,
        leader=leader, laggard=laggard,
        leader_earnings_offset_days=leader_off,
        laggard_earnings_offset_days=laggard_off,
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
    # One batched earnings query for every cohort member at once — avoids the
    # N round-trips _summarize would otherwise pay.
    all_members = [m for c in COHORTS for m in c.members]
    earnings = await _fetch_earnings_offsets(all_members)
    summaries = [await _summarize(c, window_days, earnings=earnings) for c in COHORTS]
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
    if not matched:
        return CohortsByTickerResponse(ticker=ticker.upper(), cohorts=[])
    all_members = [m for c in matched for m in c.members]
    earnings = await _fetch_earnings_offsets(all_members)
    summaries = [await _summarize(c, window_days, earnings=earnings) for c in matched]
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
    ts, closes, missing = await _fetch_closes(cohort.members, window_days)
    if closes:
        members = _member_positions(closes)
        # Add placeholder rows for any cohort members we don't have prices
        # for, so the UI can show them with "no data" rather than silently
        # dropping them and confusing the operator about cohort composition.
        for m in missing:
            members.append(CohortMember(ticker=m, ret_window=None, rel_vs_median=None))
    else:
        members = [
            CohortMember(ticker=m, ret_window=None, rel_vs_median=None)
            for m in cohort.members
        ]
    earnings = await _fetch_earnings_offsets(cohort.members)
    _attach_earnings(members, earnings)
    return CohortDetail(
        key=cohort.key, label=cohort.label, description=cohort.description,
        window_days=window_days,
        last_close_ts=ts[-1] if ts else None,
        members=members,
        pairs=_pair_spreads(closes) if closes else [],
    )
