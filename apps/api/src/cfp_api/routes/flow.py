"""Unusual options flow feed.

GET /v1/flow/unusual
  Returns a unified feed of anomalies our system can detect across
  uw_flow_alerts + uw_net_prem_daily. Each row is tagged with an anomaly
  `kind` so the UI can group/filter. Ranked by severity (rough dollar size
  + how far the signal sits beyond normal).

  Anomaly kinds:
    mega_sweep        — sweep with very large $ premium
    block_buy         — floor block, often LEAP positioning
    ask_aggression    — ≥85% of premium hit the ask (lifted offers)
    repeated_hits     — same chain hit repeatedly in the window
    iv_expansion      — IV jumped meaningfully during the alert
    oi_explosion      — volume/OI ratio extreme (new positioning)
    daily_skew        — daily call/put net-premium ratio outlier
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool
from cfp_api.settings import settings

log = logging.getLogger(__name__)


# Tickers currently being refreshed in-flight. Prevents fan-out when several
# clients hit /flow/{ticker} at the same time. Single-process API instance is
# the common case on Railway; if we scale to >1 we'll move this to a DB lock.
_REFRESH_IN_FLIGHT: set[str] = set()


def _is_rth() -> bool:
    """Rough US RTH check in UTC: weekdays 13:30-20:00 UTC (= 09:30-16:00 ET
    standard time). The lazy-refresh staleness threshold is tighter inside
    RTH because flow is moving fast; outside RTH a single overnight refresh
    is plenty."""
    now = datetime.now(UTC)
    if now.weekday() >= 5:
        return False
    minutes_since_midnight = now.hour * 60 + now.minute
    return 13 * 60 + 30 <= minutes_since_midnight < 20 * 60


async def _maybe_refresh_flow_async(
    ticker: str,
    latest_alert_at: datetime | None,
    force: bool = False,
) -> bool:
    """Kick off a background UW refresh for `ticker` if data is stale.

    Returns True if a refresh was queued (or already in-flight), False if
    we decided the existing data is fresh enough — or if UW credentials
    aren't set.

    Staleness rule:
      * during US RTH: refresh if latest alert is >30 min old
      * outside RTH:   refresh if latest alert is >12h old or missing
      * `force=True`:  always refresh (used by ?refresh=now)

    Concurrency: a per-process set guards against multiple in-flight ingests
    on the same ticker. We don't await the ingest — it runs in a thread so
    the API can return immediately and the next page-load sees fresh data.
    """
    uw_key = (settings.unusual_whales_api_key or "").strip()
    if not uw_key:
        return False

    if not force:
        threshold = timedelta(minutes=30) if _is_rth() else timedelta(hours=12)
        if latest_alert_at is not None and (datetime.now(UTC) - latest_alert_at) < threshold:
            return False

    sym = ticker.upper()
    if sym in _REFRESH_IN_FLIGHT:
        return True
    _REFRESH_IN_FLIGHT.add(sym)

    db_url = settings.database_url

    def _run_sync() -> None:
        # Import inside the thread so we don't pull psycopg/cfp_jobs onto the
        # async event loop's import path at startup.
        from cfp_jobs.ingestion import unusualwhales as uw
        try:
            uw.ingest_ticker(db_url, uw_key, sym)
        except Exception as e:  # noqa: BLE001
            log.warning("lazy flow refresh for %s failed: %s", sym, e)

    async def _runner() -> None:
        try:
            await asyncio.to_thread(_run_sync)
        finally:
            _REFRESH_IN_FLIGHT.discard(sym)

    asyncio.create_task(_runner())
    return True

router = APIRouter(prefix="/v1/flow", tags=["flow"])


AnomalyKind = Literal[
    "mega_sweep",
    "block_buy",
    "ask_aggression",
    "repeated_hits",
    "iv_expansion",
    "oi_explosion",
    "daily_skew",
]


class Catalyst(BaseModel):
    """Upcoming catalyst attached to a flow row as context, not as its own
    anomaly. Confluence ranker ignores this — it's a row modifier, not a lens.
    Severity gets a 1.3× boost (clipped to 1.0) when present."""
    kind: Literal["earnings"]
    when: str                      # YYYY-MM-DD of report_date
    session: str | None            # 'pre' | 'post' | 'amc' | 'bmo' | 'unknown'
    days_until: int                # 0 = today, 1 = tomorrow, …
    expected_move_pct: float | None


class FlowEvent(BaseModel):
    ts: str
    ticker: str
    kind: AnomalyKind
    headline: str
    premium: float | None
    option_type: str | None        # 'call' | 'put' | None for daily-skew rows
    expiry: str | None
    strike: float | None
    underlying_price: float | None
    severity: float                # 0..1 — used for sorting / heat
    iv_end: float | None
    iv_start: float | None
    ask_side_pct: float | None     # 0..1 share of premium at ask
    trade_count: int | None
    volume_oi_ratio: float | None
    alert_rule: str | None
    option_chain: str | None
    catalyst: Catalyst | None = None


class FlowResponse(BaseModel):
    as_of: str
    lookback_hours: int
    count_by_kind: dict[str, int]
    events: list[FlowEvent]


# Tunable thresholds. Kept in code (not a config table) so the dashboard
# behaves the same in dev and prod.
_MEGA_SWEEP_PREMIUM = 500_000
_BLOCK_PREMIUM = 250_000
_ASK_AGG_PREMIUM = 200_000
_ASK_AGG_RATIO = 0.85
_REPEATED_HITS_TRADES = 5
_IV_JUMP = 0.10
_OI_RATIO = 5.0
_OI_RATIO_PREMIUM = 100_000
_SKEW_RATIO = 4.0
_SKEW_MIN_PREM = 2_000_000


@router.get("/unusual", response_model=FlowResponse)
async def get_unusual_flow(
    lookback_hours: int = Query(24, ge=1, le=168),
    ticker: str | None = Query(None, description="Optional ticker filter"),
    kind: AnomalyKind | None = Query(None, description="Optional anomaly-kind filter"),
    min_premium: float = Query(100_000, ge=0),
    limit: int = Query(120, ge=1, le=500),
) -> FlowResponse:
    pool = get_pool()
    ticker_filter = (ticker or "").strip().upper() or None

    # --- alert-level detectors (uw_flow_alerts) -----------------------------
    # One CTE per detector; UNION ALL then filter/sort in outer query.
    alert_sql = """
    WITH base AS (
        SELECT
            created_at,
            ticker,
            option_chain,
            option_type,
            expiry,
            strike,
            underlying_price,
            total_premium,
            trade_count,
            iv_end,
            iv_start,
            has_sweep,
            has_floor,
            ask_side_prem,
            bid_side_prem,
            volume_oi_ratio,
            alert_rule
        FROM uw_flow_alerts
        WHERE created_at >= NOW() - ($1 || ' hours')::interval
          AND ($2::text IS NULL OR ticker = $2)
    ),
    mega_sweep AS (
        SELECT 'mega_sweep'::text AS kind, b.*
        FROM base b
        WHERE has_sweep = true AND total_premium >= $3
    ),
    block_buy AS (
        SELECT 'block_buy'::text AS kind, b.*
        FROM base b
        WHERE has_floor = true AND total_premium >= $4
    ),
    ask_aggression AS (
        SELECT 'ask_aggression'::text AS kind, b.*
        FROM base b
        WHERE total_premium >= $5
          AND ask_side_prem IS NOT NULL
          AND total_premium > 0
          AND (ask_side_prem / NULLIF(total_premium, 0)) >= $6
    ),
    repeated_hits AS (
        SELECT 'repeated_hits'::text AS kind, b.*
        FROM base b
        WHERE alert_rule LIKE 'RepeatedHits%' AND trade_count >= $7
    ),
    iv_expansion AS (
        SELECT 'iv_expansion'::text AS kind, b.*
        FROM base b
        WHERE iv_end IS NOT NULL AND iv_start IS NOT NULL
          AND (iv_end - iv_start) >= $8
    ),
    oi_explosion AS (
        SELECT 'oi_explosion'::text AS kind, b.*
        FROM base b
        WHERE volume_oi_ratio IS NOT NULL
          AND volume_oi_ratio >= $9
          AND total_premium >= $10
    )
    SELECT * FROM mega_sweep
    UNION ALL SELECT * FROM block_buy
    UNION ALL SELECT * FROM ask_aggression
    UNION ALL SELECT * FROM repeated_hits
    UNION ALL SELECT * FROM iv_expansion
    UNION ALL SELECT * FROM oi_explosion
    """

    skew_sql = """
    SELECT
        date,
        ticker,
        call_volume,
        put_volume,
        net_call_premium,
        net_put_premium
    FROM uw_net_prem_daily
    WHERE date >= (CURRENT_DATE - 2)
      AND ($1::text IS NULL OR ticker = $1)
      AND (
          (ABS(net_call_premium) >= $2 AND ABS(net_call_premium) >= $3 * GREATEST(ABS(net_put_premium), 1))
          OR
          (ABS(net_put_premium) >= $2 AND ABS(net_put_premium) >= $3 * GREATEST(ABS(net_call_premium), 1))
      )
    ORDER BY GREATEST(ABS(net_call_premium), ABS(net_put_premium)) DESC
    LIMIT 80
    """

    async with pool.acquire() as conn:
        alert_rows = await conn.fetch(
            alert_sql,
            str(lookback_hours),
            ticker_filter,
            _MEGA_SWEEP_PREMIUM,
            _BLOCK_PREMIUM,
            _ASK_AGG_PREMIUM,
            _ASK_AGG_RATIO,
            _REPEATED_HITS_TRADES,
            _IV_JUMP,
            _OI_RATIO,
            _OI_RATIO_PREMIUM,
        )
        skew_rows = await conn.fetch(skew_sql, ticker_filter, _SKEW_MIN_PREM, _SKEW_RATIO)
        ts_row = await conn.fetchrow("SELECT NOW() AT TIME ZONE 'UTC' AS now")

    events: list[FlowEvent] = []

    for r in alert_rows:
        prem = float(r["total_premium"]) if r["total_premium"] is not None else 0.0
        ask = float(r["ask_side_prem"]) if r["ask_side_prem"] is not None else None
        ask_pct = (ask / prem) if (ask is not None and prem > 0) else None
        events.append(
            FlowEvent(
                ts=r["created_at"].isoformat(),
                ticker=r["ticker"],
                kind=r["kind"],
                headline=_headline_for(r),
                premium=prem,
                option_type=r["option_type"],
                expiry=r["expiry"].isoformat() if r["expiry"] else None,
                strike=float(r["strike"]) if r["strike"] is not None else None,
                underlying_price=(
                    float(r["underlying_price"]) if r["underlying_price"] is not None else None
                ),
                severity=_severity(r["kind"], r),
                iv_end=float(r["iv_end"]) if r["iv_end"] is not None else None,
                iv_start=float(r["iv_start"]) if r["iv_start"] is not None else None,
                ask_side_pct=ask_pct,
                trade_count=r["trade_count"],
                volume_oi_ratio=(
                    float(r["volume_oi_ratio"]) if r["volume_oi_ratio"] is not None else None
                ),
                alert_rule=r["alert_rule"],
                option_chain=r["option_chain"],
            )
        )

    for r in skew_rows:
        ncp = float(r["net_call_premium"] or 0.0)
        npp = float(r["net_put_premium"] or 0.0)
        bias_call = abs(ncp) >= abs(npp)
        magnitude = max(abs(ncp), abs(npp))
        # Severity scales between $2M (floor) and $50M (saturated).
        sev = min(1.0, (magnitude - _SKEW_MIN_PREM) / 48_000_000 + 0.4)
        events.append(
            FlowEvent(
                ts=r["date"].isoformat() + "T16:00:00+00:00",
                ticker=r["ticker"],
                kind="daily_skew",
                headline=(
                    f"call skew · net ${magnitude/1e6:.1f}M"
                    if bias_call
                    else f"put skew · net ${magnitude/1e6:.1f}M"
                ),
                premium=magnitude,
                option_type="call" if bias_call else "put",
                expiry=None,
                strike=None,
                underlying_price=None,
                severity=sev,
                iv_end=None,
                iv_start=None,
                ask_side_pct=None,
                trade_count=None,
                volume_oi_ratio=None,
                alert_rule=None,
                option_chain=None,
            )
        )

    # Optional filters applied in-memory (cheap — at most a few hundred rows).
    if kind is not None:
        events = [e for e in events if e.kind == kind]
    if min_premium > 0:
        events = [e for e in events if (e.premium or 0) >= min_premium]

    # Catalyst attachment: earliest upcoming earnings within 7d, per ticker.
    # Runs after filters (smaller IN list) and before sort so the 1.3× boost
    # actually moves catalyst rows higher in the feed.
    tickers = sorted({e.ticker for e in events})
    if tickers:
        catalyst_sql = """
            SELECT DISTINCT ON (ticker)
                ticker, report_date, session, expected_move_pct
            FROM uw_earnings_calendar_daily
            WHERE ticker = ANY($1::text[])
              AND report_date >= CURRENT_DATE
              AND report_date <= CURRENT_DATE + INTERVAL '7 days'
            ORDER BY ticker, report_date ASC
        """
        async with pool.acquire() as conn:
            cat_rows = await conn.fetch(catalyst_sql, tickers)
        today = datetime.now(UTC).date()
        catalyst_by_ticker: dict[str, Catalyst] = {}
        for r in cat_rows:
            catalyst_by_ticker[r["ticker"]] = Catalyst(
                kind="earnings",
                when=r["report_date"].isoformat(),
                session=r["session"],
                days_until=max(0, (r["report_date"] - today).days),
                expected_move_pct=_f(r["expected_move_pct"]),
            )
        if catalyst_by_ticker:
            for e in events:
                cat = catalyst_by_ticker.get(e.ticker)
                if cat is not None:
                    e.catalyst = cat
                    e.severity = min(1.0, e.severity * 1.3)

    events.sort(key=lambda e: (e.severity, e.premium or 0), reverse=True)
    events = events[:limit]

    counts: dict[str, int] = {}
    for e in events:
        counts[e.kind] = counts.get(e.kind, 0) + 1

    return FlowResponse(
        as_of=ts_row["now"].isoformat(),
        lookback_hours=lookback_hours,
        count_by_kind=counts,
        events=events,
    )


def _headline_for(r) -> str:  # asyncpg.Record
    """Plain-English sentence for a flow-alert row."""
    kind = r["kind"]
    side = (r["option_type"] or "").upper()
    prem = float(r["total_premium"] or 0)
    prem_str = f"${prem/1e6:.1f}M" if prem >= 1e6 else f"${prem/1e3:.0f}K"
    strike = r["strike"]
    expiry = r["expiry"]
    strike_str = f"${strike:.0f}" if strike is not None else "?"
    expiry_str = expiry.isoformat()[2:] if expiry else "?"   # e.g. 26-06-05

    if kind == "mega_sweep":
        return f"sweep · {prem_str} {side} {strike_str} {expiry_str}"
    if kind == "block_buy":
        return f"floor block · {prem_str} {side} {strike_str} {expiry_str}"
    if kind == "ask_aggression":
        ask = float(r["ask_side_prem"] or 0)
        pct = (ask / prem * 100) if prem else 0
        return f"{pct:.0f}% lifted · {prem_str} {side} {strike_str} {expiry_str}"
    if kind == "repeated_hits":
        n = r["trade_count"] or 0
        return f"{n} repeated hits · {side} {strike_str} {expiry_str}"
    if kind == "iv_expansion":
        ivs = float(r["iv_start"] or 0) * 100
        ive = float(r["iv_end"] or 0) * 100
        return f"IV {ivs:.0f}→{ive:.0f} · {side} {strike_str} {expiry_str}"
    if kind == "oi_explosion":
        ratio = float(r["volume_oi_ratio"] or 0)
        return f"vol/OI {ratio:.1f}× · {prem_str} {side} {strike_str} {expiry_str}"
    return f"{prem_str} {side} {strike_str} {expiry_str}"


class WhaleBet(BaseModel):
    ticker: str
    direction: str                  # 'bull' | 'bear'
    score: float                    # 0..100
    window_hours: int
    window_end: str
    call_premium: float | None
    put_premium: float | None
    ask_side_premium: float | None
    sweep_count: int | None
    block_count: int | None
    opening_share: float | None
    vol_oi_max: float | None
    dark_pool_above_mid_prem: float | None
    insider_buy_7d: float | None
    congress_buy_14d: int | None
    iv_rank: float | None
    against_tape: bool | None
    reasons: list[str]


class WhalesResponse(BaseModel):
    as_of: str
    window_hours: int
    market_tide: str | None         # 'bull' | 'bear' | None
    count: int
    bets: list[WhaleBet]


@router.get("/whales", response_model=WhalesResponse)
async def get_whale_bets(
    window_hours: int = Query(4, description="Aggregation window (4 or 24)"),
    direction: Literal["bull", "bear"] | None = Query(None),
    min_score: float = Query(40.0, ge=0, le=100),
    limit: int = Query(40, ge=1, le=200),
) -> WhalesResponse:
    """Top tickers right now where the flow is loud, opening, aggressive, and
    corroborated by other smart-money signals. Reads the heuristic 0..100
    `whale_conviction_signals` table refreshed every ~5min by the scorer."""
    pool = get_pool()
    sql = """
        WITH latest AS (
            SELECT MAX(window_end) AS we
            FROM whale_conviction_signals
            WHERE window_hours = $1
              AND window_end >= NOW() - INTERVAL '6 hours'
        )
        SELECT
            window_end, ticker, direction, score,
            call_premium, put_premium, ask_side_premium,
            sweep_count, block_count, opening_share, vol_oi_max,
            dark_pool_above_mid_prem, insider_buy_7d, congress_buy_14d,
            iv_rank, against_tape, reasons
        FROM whale_conviction_signals, latest
        WHERE window_hours = $1
          AND window_end = latest.we
          AND score >= $2
          AND ($3::text IS NULL OR direction = $3)
        ORDER BY score DESC
        LIMIT $4
    """
    tape_sql = """
        SELECT
            SUM(COALESCE(net_call_premium, 0)) AS calls,
            SUM(COALESCE(net_put_premium, 0))  AS puts
        FROM uw_market_tide
        WHERE ts >= NOW() - INTERVAL '6 hours'
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, window_hours, min_score, direction, limit)
        tape_row = await conn.fetchrow(tape_sql)
        ts_row = await conn.fetchrow("SELECT NOW() AT TIME ZONE 'UTC' AS now")

    tape: str | None = None
    if tape_row and tape_row["calls"] is not None and tape_row["puts"] is not None:
        diff = float(tape_row["calls"]) - float(tape_row["puts"])
        if abs(diff) >= 50_000_000:
            tape = "bull" if diff > 0 else "bear"

    bets: list[WhaleBet] = []
    for r in rows:
        raw_reasons = r["reasons"]
        if isinstance(raw_reasons, str):
            import json
            try:
                raw_reasons = json.loads(raw_reasons)
            except Exception:
                raw_reasons = []
        bets.append(
            WhaleBet(
                ticker=r["ticker"],
                direction=r["direction"],
                score=float(r["score"]),
                window_hours=window_hours,
                window_end=r["window_end"].isoformat(),
                call_premium=_f(r["call_premium"]),
                put_premium=_f(r["put_premium"]),
                ask_side_premium=_f(r["ask_side_premium"]),
                sweep_count=r["sweep_count"],
                block_count=r["block_count"],
                opening_share=_f(r["opening_share"]),
                vol_oi_max=_f(r["vol_oi_max"]),
                dark_pool_above_mid_prem=_f(r["dark_pool_above_mid_prem"]),
                insider_buy_7d=_f(r["insider_buy_7d"]),
                congress_buy_14d=r["congress_buy_14d"],
                iv_rank=_f(r["iv_rank"]),
                against_tape=r["against_tape"],
                reasons=list(raw_reasons or []),
            )
        )

    return WhalesResponse(
        as_of=ts_row["now"].isoformat(),
        window_hours=window_hours,
        market_tide=tape,
        count=len(bets),
        bets=bets,
    )


def _f(v) -> float | None:
    return float(v) if v is not None else None


def _severity(kind: str, r) -> float:
    """Cheap 0..1 score so the UI can sort + color rows.

    Each detector saturates at a different dollar size — a $5M sweep is
    extreme, but a $5M block is only ordinary, so we tune per-kind.
    """
    prem = float(r["total_premium"] or 0)
    if kind == "mega_sweep":
        return min(1.0, prem / 5_000_000)
    if kind == "block_buy":
        return min(1.0, prem / 3_000_000)
    if kind == "ask_aggression":
        return min(1.0, prem / 2_000_000)
    if kind == "repeated_hits":
        return min(1.0, (r["trade_count"] or 0) / 25)
    if kind == "iv_expansion":
        jump = float((r["iv_end"] or 0) - (r["iv_start"] or 0))
        return min(1.0, jump / 0.40)
    if kind == "oi_explosion":
        return min(1.0, float(r["volume_oi_ratio"] or 0) / 25)
    return 0.5


# ---------- per-ticker flow aggregate ----------


class ExpiryBucket(BaseModel):
    """Premium binned by days-to-expiry at the time of the alert.

    Lets the UI answer questions like "where is the bullish money concentrated
    in time?" — e.g., "$8M of calls bought 30-90d out" is a much stronger
    signal than "$8M of 0DTE call premium" (which often just means scalpers).
    """
    label: str          # "0-7d", "7-30d", "30-90d", "90d+"
    days_min: int
    days_max: int | None  # None for the open-ended bucket
    n_alerts: int
    call_premium: float
    put_premium: float
    net_call_ask: float   # call ask − bid (positive = lifting offers)
    net_put_ask: float
    bullish_score: float  # ((net_call_ask − net_put_ask) / bucket_total_premium)


class SuggestedPlay(BaseModel):
    """A ranked candidate options contract with the data points that earned
    it the rank, plus a deterministic flip condition. Deliberately NOT a
    cost/sizing calculator — the user owns the decision; this is "here's
    what the data points to, and what would invalidate the thesis."
    """
    rank: int                          # 1..N
    conviction: Literal["high", "medium", "mixed"]
    conviction_score: float            # 0..100, internal composite
    strike: float
    option_type: Literal["call", "put"]
    expiry: str                        # YYYY-MM-DD
    days_to_expiry: int

    # Flow component breakdown — every chip the UI shows ties back to one of these
    oi_delta_30d: int
    current_oi: int
    days_of_oi_increases: int | None   # UW streak
    alerts_count: int                  # how many flow alerts on this exact contract
    alerts_premium: float               # total $ premium of those alerts
    avg_ask_side_pct: float | None     # 0..1; >0.7 = real buying aggression
    bucket_score: float                # the expiry-bucket bullish_score this contract sits in

    # Decisiveness layer (lever #2: cross-validate with the 25-agent ensemble)
    ensemble_aligned: bool             # do the agents agree with this contract's direction?
    ensemble_alignment_count: int      # how many bullish/bearish votes line up
    ensemble_total_voters: int          # how many agents weighed in on this ticker
    ensemble_pm_signal: str | None     # latest portfolio_manager call (bullish/bearish/neutral)

    # Decisiveness layer (lever #4: concrete trade structure, 1:3 risk:reward).
    # 1 contract = standard spec play, 2 contracts = high-conviction. 0 = skip.
    contracts: int                     # 0, 1, or 2
    risk_to_reward: str                # always "1:3" — we cut at -50%, target +200%
    target_payout_multiple: float      # 3.0 = sell at 3× premium paid
    stop_loss_pct: float               # -0.50 = cut at -50% of premium
    approx_spot_target: float | None   # rough underlying price needed for the 3× target

    why: list[str]                     # plain-English reasons we picked it
    caveats: list[str]                 # anti-conviction signals (trap detection)
    flip_condition: str                # what would invalidate the thesis


class SuggestedPlaysResponse(BaseModel):
    ticker: str
    spot: float | None                 # latest close used for flip-condition math
    n_candidates_considered: int
    # Decisiveness layer (lever #1: PROCEED / WAIT / SKIP gate at the top)
    gate: Literal["proceed", "wait", "skip"]
    gate_reason: str
    gate_signals: dict[str, str | float | None]  # flow, ensemble, regime, top_conviction
    plays: list[SuggestedPlay]
    method_note: str                   # one-line summary of how plays were scored


class OiGrowthStrike(BaseModel):
    """An option strike where open interest has been growing (or shrinking)
    over the lookback window. Sourced from uw_oi_change daily deltas — the
    answer to 'which strikes are positions being added to?'."""
    strike: float
    option_type: Literal["call", "put"]
    expiry: str | None              # YYYY-MM-DD
    oi_delta: int                   # sum of daily oi_diff_plain over window
    current_oi: int                 # latest curr_oi
    days_with_data: int             # how many days had a delta in window
    days_of_oi_increases: int | None  # UW-supplied streak of consecutive increases


class TopStrike(BaseModel):
    strike: float
    option_type: Literal["call", "put"]
    total_premium: float
    alert_count: int
    largest_expiry: str | None  # furthest expiry seen on this strike (LEAP signal)


class TopTradeAgg(BaseModel):
    ts: str
    option_type: Literal["call", "put"]
    strike: float
    expiry: str | None
    total_premium: float
    ask_side_pct: float | None  # ask_side_prem / total_premium — aggression
    alert: str | None
    option_chain: str | None


class MaxPainExpiry(BaseModel):
    """Max-pain strike for one expiry (pulled from uw_max_pain — owned by the
    explosive ingestion). The flow tab reads it soft: rendered when present,
    silently omitted when the explosive ingest hasn't run for this ticker."""
    expiry: str          # YYYY-MM-DD
    max_pain_strike: float
    distance_from_spot_pct: float | None  # (spot − max_pain) / spot, signed


class IvRankSnapshot(BaseModel):
    """Latest IV-rank chip — IV30 + where it sits in the trailing 1y range.
    iv_rank_1y is normalized to 0..1; >0.7 = vol-is-rich, <0.3 = vol-is-cheap."""
    snapshot_date: str
    iv30: float | None
    iv_rank_1y: float | None
    iv_rank_1y_pct: float | None   # iv_rank_1y * 100 for display


class UpcomingEarnings(BaseModel):
    """The next analyst-consensus earnings report on the calendar (if UW has
    it). Lets the flow tab surface 'unusual flow 3 days before earnings'
    instead of treating the call/put bias in isolation."""
    report_date: str
    days_until: int
    eps_estimate_average: float | None
    eps_estimate_analyst_count: int | None
    revenue_estimate_average: float | None
    revenue_estimate_analyst_count: int | None


class SectorAlignment(BaseModel):
    """Is this ticker's flow running with or against its sector tape?

    Sourced from uw_stock_info.sector × uw_sector_tide (rolling 1h sum).
    Verdict 'with-sector' = both ticker and sector lean the same direction;
    'against-sector' = opposites (= louder smart-money conviction); 'neutral'
    = sector premium too small to read."""
    sector: str
    sector_lean: Literal["bull", "bear", "neutral"]
    sector_net_call_premium_1h: float
    sector_net_put_premium_1h: float
    alignment: Literal["with-sector", "against-sector", "neutral"]
    headline: str  # one-line plain-English summary


class IvTermPoint(BaseModel):
    expiry: str
    dte: int | None
    iv: float | None
    iv_atm: float | None


class IvTermStructure(BaseModel):
    """ATM IV by expiry — when front > back IV, the market is pricing an
    imminent move. Pulled soft from uw_iv_term_structure (owned by explosive
    ingest)."""
    snapshot_date: str
    points: list[IvTermPoint]
    front_iv: float | None
    back_iv: float | None
    inverted: bool                  # front > back by ≥5% = catalyst priced
    inversion_pct: float | None     # (front - back) / back


class SkewPoint(BaseModel):
    dte: int
    skew: float | None         # 25-delta call_iv − put_iv (signed)
    call_iv: float | None
    put_iv: float | None


class RiskReversalSkew(BaseModel):
    """25-delta call IV minus put IV across DTE buckets. Positive = call
    demand > put demand = bullish lean from the option-pricing surface."""
    snapshot_date: str
    points: list[SkewPoint]
    headline: str               # one-line summary of bias


class IvVsRv(BaseModel):
    """IV30 (from uw_iv_rank_history) vs realized vol (from uw_realized_volatility).
    IV >> RV = vol overpriced (good for selling); IV << RV = cheap optionality."""
    snapshot_date: str
    iv30: float | None
    rv30: float | None
    iv_rv_ratio: float | None       # iv30 / rv30 (1.0 = equal)
    verdict: Literal["cheap", "fair", "rich"]


class PeerCorrelation(BaseModel):
    peer_ticker: str
    correlation: float | None


class TopPeers(BaseModel):
    """Peers most correlated with this ticker (UW correlations basket).
    Useful context for 'is this name moving alone or with a herd?'."""
    snapshot_date: str
    peers: list[PeerCorrelation]


class FlowAggregateResponse(BaseModel):
    ticker: str
    days: int                          # window applied (kept for the FE filter)
    oldest_alert_ts: str | None        # earliest alert created_at we considered
    newest_alert_ts: str | None        # latest alert created_at we considered
    coverage_summary: str              # one-line "N alerts from X to Y (~Zd of data)"
    n_alerts: int
    total_premium: float
    total_call_premium: float
    total_put_premium: float
    net_call_premium: float  # call ask-side − call bid-side
    net_put_premium: float   # put ask-side − put bid-side
    bullish_score: float     # in [-1, 1] (call_ask_aggression - put_ask_aggression), premium-weighted
    verdict: Literal["bullish", "bearish", "mixed"]
    verdict_reason: str      # one-line plain-English summary
    avg_ticket_size: float
    leap_call_premium: float  # expiry > +90d
    leap_put_premium: float
    expiry_buckets: list[ExpiryBucket]
    expiry_headline: str  # one-line "where is the money concentrated in time?"
    oi_growth_strikes: list[OiGrowthStrike]  # which strikes have positions been added to?
    oi_growth_window_days: int               # the window we summed daily deltas over
    top_strikes: list[TopStrike]
    top_trades: list[TopTradeAgg]
    # ---- New chips backed by migration 0027 + soft reads from 0024/0025 ----
    iv_rank: IvRankSnapshot | None = None                 # /api/stock/{T}/iv-rank
    upcoming_earnings: UpcomingEarnings | None = None     # /api/companies/{T}/earnings-estimates
    max_pain: list[MaxPainExpiry] = []                    # soft-read from uw_max_pain
    # The chips below are all soft-reads from tables owned by other ingests
    # (explosive Phase 2/3 + my sector_tide/correlations scheduler). They
    # silently nil-out when the source table is empty for this ticker.
    sector_alignment: SectorAlignment | None = None       # uw_stock_info × uw_sector_tide
    iv_term_structure: IvTermStructure | None = None      # uw_iv_term_structure
    risk_reversal_skew: RiskReversalSkew | None = None    # uw_risk_reversal_skew
    iv_vs_rv: IvVsRv | None = None                        # uw_realized_volatility + iv_rank
    top_peers: TopPeers | None = None                     # uw_correlations
    # True when this request triggered a background UW ingest (or one was
    # already in flight). The UI can poll/re-fetch to pick up the fresh data.
    refresh_queued: bool = False


@router.get("/aggregate/{ticker}", response_model=FlowAggregateResponse)
async def flow_aggregate(
    ticker: str,
    days: int = Query(
        730,
        ge=1,
        le=1825,
        description=(
            "Flow-alerts lookback window in days. Default 730 = effectively "
            "'all data we have' since UW retention rarely exceeds ~2 years."
        ),
    ),
    oi_window: int = Query(
        30,
        ge=1,
        le=365,
        description=(
            "Window for summing daily OI deltas to identify which strikes have "
            "had positions added or removed. Default 30d."
        ),
    ),
    refresh: Literal["auto", "now", "off"] = Query(
        "auto",
        description=(
            "auto = refresh if data is stale (30m RTH / 12h off-hours); "
            "now = force refresh in the background; "
            "off = serve whatever is in Postgres."
        ),
    ),
) -> FlowAggregateResponse:
    """All UW flow for one ticker, aggregated. Returns the bull/bear lean
    + the strike with the most dollars done + the largest single tickets.

    Bullish score: (net_call_premium − net_put_premium) / total_premium.
      net_*_premium = ask_side_prem − bid_side_prem on the leg (positive when
      institutions are lifting offers = bullish for that direction).

    Bullish/bearish verdict thresholds:
      bullish_score >  0.15 → bullish
      bullish_score < -0.15 → bearish
      otherwise           → mixed
    """
    sym = ticker.upper()
    pool = get_pool()
    async with pool.acquire() as conn:
        agg = await conn.fetchrow(
            """
            SELECT
              COUNT(*)::int AS n,
              MIN(created_at) AS oldest,
              MAX(created_at) AS newest,
              COALESCE(SUM(total_premium), 0)::float AS total_prem,
              COALESCE(SUM(CASE WHEN option_type='call' THEN total_premium ELSE 0 END), 0)::float AS call_prem,
              COALESCE(SUM(CASE WHEN option_type='put'  THEN total_premium ELSE 0 END), 0)::float AS put_prem,
              COALESCE(SUM(CASE WHEN option_type='call' THEN ask_side_prem - bid_side_prem ELSE 0 END), 0)::float AS net_call,
              COALESCE(SUM(CASE WHEN option_type='put'  THEN ask_side_prem - bid_side_prem ELSE 0 END), 0)::float AS net_put,
              COALESCE(SUM(CASE WHEN option_type='call' AND expiry > CURRENT_DATE + INTERVAL '90 days'
                                THEN total_premium ELSE 0 END), 0)::float AS leap_call,
              COALESCE(SUM(CASE WHEN option_type='put'  AND expiry > CURRENT_DATE + INTERVAL '90 days'
                                THEN total_premium ELSE 0 END), 0)::float AS leap_put
            FROM uw_flow_alerts
            WHERE ticker = $1
              AND created_at > NOW() - ($2 || ' days')::interval
            """,
            sym, str(days),
        )
        # Top strikes by dollar premium
        strike_rows = await conn.fetch(
            """
            SELECT strike, option_type,
                   SUM(total_premium)::float AS premium,
                   COUNT(*)::int AS alert_count,
                   MAX(expiry) AS furthest_expiry
            FROM uw_flow_alerts
            WHERE ticker = $1
              AND created_at > NOW() - ($2 || ' days')::interval
              AND total_premium IS NOT NULL
            GROUP BY strike, option_type
            ORDER BY premium DESC NULLS LAST
            LIMIT 8
            """,
            sym, str(days),
        )
        # Expiry buckets — bin alerts by days-to-expiry at the time of the alert.
        bucket_rows = await conn.fetch(
            """
            WITH alerts AS (
                SELECT
                    option_type,
                    total_premium,
                    ask_side_prem,
                    bid_side_prem,
                    (expiry::date - created_at::date) AS dte
                FROM uw_flow_alerts
                WHERE ticker = $1
                  AND created_at > NOW() - ($2 || ' days')::interval
                  AND expiry IS NOT NULL
            ),
            bucketed AS (
                SELECT
                    CASE
                        WHEN dte <= 7  THEN '0-7d'
                        WHEN dte <= 30 THEN '7-30d'
                        WHEN dte <= 90 THEN '30-90d'
                        ELSE '90d+'
                    END AS bucket,
                    option_type, total_premium, ask_side_prem, bid_side_prem
                FROM alerts
            )
            SELECT
                bucket,
                COUNT(*)::int AS n,
                COALESCE(SUM(CASE WHEN option_type='call' THEN total_premium ELSE 0 END), 0)::float AS call_prem,
                COALESCE(SUM(CASE WHEN option_type='put'  THEN total_premium ELSE 0 END), 0)::float AS put_prem,
                COALESCE(SUM(CASE WHEN option_type='call' THEN ask_side_prem - bid_side_prem ELSE 0 END), 0)::float AS net_call,
                COALESCE(SUM(CASE WHEN option_type='put'  THEN ask_side_prem - bid_side_prem ELSE 0 END), 0)::float AS net_put
            FROM bucketed
            GROUP BY bucket
            """,
            sym, str(days),
        )
        # Top single trades
        trade_rows = await conn.fetch(
            """
            SELECT created_at, option_type, strike, expiry, total_premium,
                   ask_side_prem, bid_side_prem, alert_rule, option_chain
            FROM uw_flow_alerts
            WHERE ticker = $1
              AND created_at > NOW() - ($2 || ' days')::interval
            ORDER BY total_premium DESC NULLS LAST
            LIMIT 8
            """,
            sym, str(days),
        )
        # OI growth — which strikes have positions actually been added to
        # over the window? Parses OCC-format option_symbol
        # (NVDA281215C00225000 → expiry 2028-12-15, call, strike 225.00).
        oi_rows = await conn.fetch(
            """
            WITH parsed AS (
                SELECT
                    substring(option_symbol from '(\\d{6})[CP]\\d{8}$') AS exp_yymmdd,
                    substring(option_symbol from '\\d{6}([CP])\\d{8}$') AS type_letter,
                    substring(option_symbol from '\\d{6}[CP](\\d{8})$') AS strike_padded,
                    oi_diff_plain, curr_oi, days_of_oi_increases, curr_date
                FROM uw_oi_change
                WHERE ticker = $1
                  AND curr_date > CURRENT_DATE - $2::int
                  AND option_symbol ~ '\\d{6}[CP]\\d{8}$'
            ),
            agg AS (
                SELECT
                    CASE WHEN type_letter = 'C' THEN 'call' ELSE 'put' END AS option_type,
                    to_date(exp_yymmdd, 'YYMMDD') AS expiry,
                    strike_padded::int / 1000.0 AS strike,
                    SUM(oi_diff_plain)::bigint AS oi_delta,
                    COUNT(*)::int AS days_with_data,
                    MAX(days_of_oi_increases) AS streak,
                    -- pick the most recent curr_oi per strike
                    (array_agg(curr_oi ORDER BY curr_date DESC))[1]::bigint AS current_oi
                FROM parsed
                GROUP BY 1, 2, 3
            )
            SELECT * FROM agg
            ORDER BY ABS(oi_delta) DESC NULLS LAST
            LIMIT 12
            """,
            sym, oi_window,
        )
        # ---- New chips (migration 0027 + soft read of explosive's 0024) ----
        # IV-rank latest snapshot for the ticker
        iv_rank_row = await conn.fetchrow(
            """
            SELECT snapshot_date, close, iv30, iv_rank_1y
            FROM uw_iv_rank_history
            WHERE ticker = $1
            ORDER BY snapshot_date DESC
            LIMIT 1
            """,
            sym,
        )
        # Next upcoming analyst-consensus earnings report
        earnings_row = await conn.fetchrow(
            """
            SELECT report_date,
                   eps_estimate_average, eps_estimate_analyst_count,
                   revenue_estimate_average, revenue_estimate_analyst_count
            FROM uw_earnings_estimates
            WHERE ticker = $1
              AND report_date >= CURRENT_DATE
            ORDER BY report_date ASC
            LIMIT 1
            """,
            sym,
        )
        # Max-pain — soft read from the explosive-owned uw_max_pain table.
        # Wrapped in a try/except so the flow route never breaks even if the
        # explosive migration hasn't been applied yet.
        max_pain_rows: list = []
        try:
            max_pain_rows = await conn.fetch(
                """
                SELECT expiry, max_pain_strike
                FROM uw_max_pain
                WHERE ticker = $1
                  AND snapshot_date = (
                    SELECT MAX(snapshot_date) FROM uw_max_pain WHERE ticker = $1
                  )
                  AND expiry >= CURRENT_DATE
                ORDER BY expiry ASC
                LIMIT 6
                """,
                sym,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("max_pain soft-read failed for %s: %s", sym, e)
            max_pain_rows = []
        # Spot for the max-pain distance chip (latest daily close).
        spot_val = await conn.fetchval(
            "SELECT close FROM prices_daily WHERE symbol = $1 ORDER BY ts DESC LIMIT 1",
            sym,
        )
        # ---- Soft reads for advanced chips (explosive-owned + scheduler) ----
        # Each wrapped so a missing table / no data degrades gracefully.
        ticker_sector: str | None = None
        try:
            ticker_sector = await conn.fetchval(
                "SELECT sector FROM uw_stock_info WHERE ticker = $1",
                sym,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("stock_info sector read failed for %s: %s", sym, e)

        sector_tide_row = None
        if ticker_sector:
            try:
                sector_tide_row = await conn.fetchrow(
                    """
                    SELECT
                        COALESCE(SUM(net_call_premium), 0)::float AS call_sum,
                        COALESCE(SUM(net_put_premium),  0)::float AS put_sum
                    FROM uw_sector_tide
                    WHERE sector = $1 AND ts >= NOW() - INTERVAL '1 hour'
                    """,
                    ticker_sector,
                )
            except Exception as e:  # noqa: BLE001
                log.debug("sector_tide read failed for %s: %s", sym, e)

        iv_term_rows: list = []
        try:
            iv_term_rows = await conn.fetch(
                """
                SELECT expiry, dte, iv, iv_atm
                FROM uw_iv_term_structure
                WHERE ticker = $1
                  AND snapshot_date = (
                    SELECT MAX(snapshot_date) FROM uw_iv_term_structure WHERE ticker = $1
                  )
                ORDER BY expiry ASC
                LIMIT 12
                """,
                sym,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("iv_term_structure soft-read failed for %s: %s", sym, e)
            iv_term_rows = []

        skew_rows: list = []
        try:
            skew_rows = await conn.fetch(
                """
                SELECT dte, skew, call_iv, put_iv
                FROM uw_risk_reversal_skew
                WHERE ticker = $1
                  AND snapshot_date = (
                    SELECT MAX(snapshot_date) FROM uw_risk_reversal_skew WHERE ticker = $1
                  )
                ORDER BY dte ASC
                """,
                sym,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("risk_reversal_skew soft-read failed for %s: %s", sym, e)
            skew_rows = []

        rv30_val = None
        try:
            rv30_val = await conn.fetchval(
                """
                SELECT realized_volatility
                FROM uw_realized_volatility
                WHERE ticker = $1 AND rv_window_days = 30
                ORDER BY snapshot_date DESC
                LIMIT 1
                """,
                sym,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("realized_volatility soft-read failed for %s: %s", sym, e)

        peer_rows: list = []
        try:
            peer_rows = await conn.fetch(
                """
                SELECT snd_ticker AS peer, correlation
                FROM uw_correlations
                WHERE fst_ticker = $1
                  AND snapshot_date = (
                    SELECT MAX(snapshot_date) FROM uw_correlations WHERE fst_ticker = $1
                  )
                ORDER BY ABS(correlation) DESC NULLS LAST
                LIMIT 5
                """,
                sym,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("correlations soft-read failed for %s: %s", sym, e)
            peer_rows = []

    # Decide whether to kick off a background UW refresh. Force the refresh
    # when refresh=now or when we have zero alerts on file; otherwise apply
    # the auto-staleness rule (30m RTH / 12h off-hours).
    if refresh == "off":
        refresh_queued = False
    else:
        latest_alert_at = agg["newest"] if (agg is not None and (agg["n"] or 0) > 0) else None
        force_refresh = refresh == "now" or latest_alert_at is None
        refresh_queued = await _maybe_refresh_flow_async(sym, latest_alert_at, force=force_refresh)

    if agg is None or (agg["n"] or 0) == 0:
        # Return an empty-but-well-formed response so the FE can render
        # "no flow in window" without a special error path. If we kicked off
        # a refresh above the UI can re-fetch in a few seconds.
        return FlowAggregateResponse(
            ticker=sym, days=days,
            oldest_alert_ts=None, newest_alert_ts=None,
            coverage_summary=(
                f"No UW flow alerts ingested for {sym} yet — refresh queued, retry in ~20s."
                if refresh_queued
                else f"No UW flow alerts ingested for {sym}."
            ),
            n_alerts=0,
            total_premium=0.0, total_call_premium=0.0, total_put_premium=0.0,
            net_call_premium=0.0, net_put_premium=0.0,
            bullish_score=0.0, verdict="mixed",
            verdict_reason=f"No flow alerts for {sym} in the last {days}d.",
            avg_ticket_size=0.0,
            leap_call_premium=0.0, leap_put_premium=0.0,
            expiry_buckets=[], expiry_headline="No expiry-tagged alerts available.",
            oi_growth_strikes=[], oi_growth_window_days=oi_window,
            top_strikes=[], top_trades=[],
            refresh_queued=refresh_queued,
        )

    total_prem = float(agg["total_prem"] or 0.0)
    net_call = float(agg["net_call"] or 0.0)
    net_put = float(agg["net_put"] or 0.0)
    score = ((net_call - net_put) / total_prem) if total_prem > 0 else 0.0
    score = max(-1.0, min(1.0, score))

    if score > 0.15:
        verdict: Literal["bullish", "bearish", "mixed"] = "bullish"
        reason = (
            f"Net call ask-side premium of ${net_call / 1e6:.1f}M exceeds net "
            f"put by ${(net_call - net_put) / 1e6:.1f}M ({score:+.2f} score) — "
            f"institutions are lifting offers on calls."
        )
    elif score < -0.15:
        verdict = "bearish"
        reason = (
            f"Net put ask-side premium of ${net_put / 1e6:.1f}M exceeds net "
            f"call by ${(net_put - net_call) / 1e6:.1f}M ({score:+.2f} score) — "
            f"institutions are lifting offers on puts."
        )
    else:
        verdict = "mixed"
        reason = (
            f"Net call vs net put within ±15% of total premium "
            f"(score {score:+.2f}) — no clear directional lean."
        )

    n = int(agg["n"] or 0)
    avg_ticket = (total_prem / n) if n else 0.0

    # Expiry-bucket breakdown — answers "where is the bullish money concentrated in time?"
    bucket_spec: list[tuple[str, int, int | None]] = [
        ("0-7d", 0, 7),
        ("7-30d", 8, 30),
        ("30-90d", 31, 90),
        ("90d+", 91, None),
    ]
    bucket_map = {r["bucket"]: r for r in bucket_rows}
    expiry_buckets: list[ExpiryBucket] = []
    for label, dmin, dmax in bucket_spec:
        r = bucket_map.get(label)
        if r is None:
            expiry_buckets.append(ExpiryBucket(
                label=label, days_min=dmin, days_max=dmax,
                n_alerts=0, call_premium=0.0, put_premium=0.0,
                net_call_ask=0.0, net_put_ask=0.0, bullish_score=0.0,
            ))
            continue
        call_p = float(r["call_prem"] or 0.0)
        put_p = float(r["put_prem"] or 0.0)
        net_c = float(r["net_call"] or 0.0)
        net_p = float(r["net_put"] or 0.0)
        b_total = call_p + put_p
        b_score = ((net_c - net_p) / b_total) if b_total > 0 else 0.0
        expiry_buckets.append(ExpiryBucket(
            label=label, days_min=dmin, days_max=dmax,
            n_alerts=int(r["n"] or 0),
            call_premium=call_p, put_premium=put_p,
            net_call_ask=net_c, net_put_ask=net_p,
            bullish_score=max(-1.0, min(1.0, b_score)),
        ))

    # Headline: which bucket has the most directional premium, and which side?
    def _fmt_usd(n: float) -> str:
        if abs(n) >= 1e9: return f"${n / 1e9:.2f}B"
        if abs(n) >= 1e6: return f"${n / 1e6:.2f}M"
        if abs(n) >= 1e3: return f"${n / 1e3:.1f}K"
        return f"${n:.0f}"

    def _bucket_directional_dollars(b: ExpiryBucket) -> float:
        # The side with the most premium in the bucket dominates the headline.
        return max(b.call_premium, b.put_premium)
    visible = [b for b in expiry_buckets if b.n_alerts > 0]
    if visible:
        leader = max(visible, key=_bucket_directional_dollars)
        side = "calls" if leader.call_premium >= leader.put_premium else "puts"
        side_prem = leader.call_premium if side == "calls" else leader.put_premium
        expiry_headline = (
            f"Most money is in {leader.label} {side} "
            f"({_fmt_usd(side_prem)} across {leader.n_alerts} alerts)."
        )
    else:
        expiry_headline = "No expiry-tagged alerts in the window."

    top_strikes = [
        TopStrike(
            strike=float(r["strike"]),
            option_type=r["option_type"],
            total_premium=float(r["premium"]),
            alert_count=int(r["alert_count"]),
            largest_expiry=r["furthest_expiry"].isoformat() if r["furthest_expiry"] else None,
        )
        for r in strike_rows
    ]
    top_trades = []
    for r in trade_rows:
        prem = float(r["total_premium"] or 0)
        ask = float(r["ask_side_prem"] or 0)
        ask_pct = (ask / prem) if prem > 0 else None
        top_trades.append(
            TopTradeAgg(
                ts=r["created_at"].isoformat() if r["created_at"] else "",
                option_type=r["option_type"],
                strike=float(r["strike"]) if r["strike"] is not None else 0.0,
                expiry=r["expiry"].isoformat() if r["expiry"] else None,
                total_premium=prem,
                ask_side_pct=ask_pct,
                alert=r["alert_rule"],
                option_chain=r["option_chain"],
            )
        )

    oldest = agg["oldest"]
    newest = agg["newest"]
    if oldest is not None and newest is not None:
        span_days = max(1, (newest - oldest).days)
        coverage_summary = (
            f"{n} alerts spanning {oldest.date().isoformat()} → "
            f"{newest.date().isoformat()} (~{span_days}d of data)."
        )
    else:
        coverage_summary = f"{n} alerts in window."

    # ---- Build the new chips from the rows we fetched earlier ---------------
    iv_rank_chip: IvRankSnapshot | None = None
    if iv_rank_row is not None:
        rank_val = iv_rank_row["iv_rank_1y"]
        iv_rank_chip = IvRankSnapshot(
            snapshot_date=iv_rank_row["snapshot_date"].isoformat(),
            iv30=float(iv_rank_row["iv30"]) if iv_rank_row["iv30"] is not None else None,
            iv_rank_1y=float(rank_val) if rank_val is not None else None,
            iv_rank_1y_pct=(float(rank_val) * 100.0) if rank_val is not None else None,
        )

    upcoming_earnings_chip: UpcomingEarnings | None = None
    if earnings_row is not None:
        rd = earnings_row["report_date"]
        upcoming_earnings_chip = UpcomingEarnings(
            report_date=rd.isoformat(),
            days_until=(rd - datetime.now(UTC).date()).days,
            eps_estimate_average=(
                float(earnings_row["eps_estimate_average"])
                if earnings_row["eps_estimate_average"] is not None else None
            ),
            eps_estimate_analyst_count=earnings_row["eps_estimate_analyst_count"],
            revenue_estimate_average=(
                float(earnings_row["revenue_estimate_average"])
                if earnings_row["revenue_estimate_average"] is not None else None
            ),
            revenue_estimate_analyst_count=earnings_row["revenue_estimate_analyst_count"],
        )

    # ---- Build the advanced soft-read chips ---------------------------------
    sector_alignment_chip: SectorAlignment | None = None
    if ticker_sector and sector_tide_row is not None:
        call_sum = float(sector_tide_row["call_sum"] or 0.0)
        put_sum = float(sector_tide_row["put_sum"] or 0.0)
        diff = call_sum - put_sum
        if abs(diff) < 5_000_000:
            sec_lean: Literal["bull", "bear", "neutral"] = "neutral"
        else:
            sec_lean = "bull" if diff > 0 else "bear"
        # `verdict` is set above based on the ticker's bullish_score.
        if sec_lean == "neutral" or verdict == "mixed":
            alignment: Literal["with-sector", "against-sector", "neutral"] = "neutral"
            align_msg = "Sector flow too small to read; no alignment signal."
        else:
            ticker_lean = "bull" if verdict == "bullish" else "bear"
            if ticker_lean == sec_lean:
                alignment = "with-sector"
                align_msg = (
                    f"{sym} is {verdict} *with* {ticker_sector} sector "
                    f"(${abs(diff)/1e6:.1f}M net {sec_lean} in last hour)."
                )
            else:
                alignment = "against-sector"
                align_msg = (
                    f"{sym} is {verdict} *against* a {sec_lean}-leaning "
                    f"{ticker_sector} sector — louder smart-money conviction."
                )
        sector_alignment_chip = SectorAlignment(
            sector=ticker_sector,
            sector_lean=sec_lean,
            sector_net_call_premium_1h=call_sum,
            sector_net_put_premium_1h=put_sum,
            alignment=alignment,
            headline=align_msg,
        )

    iv_term_chip: IvTermStructure | None = None
    if iv_term_rows:
        pts = [
            IvTermPoint(
                expiry=r["expiry"].isoformat(),
                dte=int(r["dte"]) if r["dte"] is not None else None,
                iv=_f(r["iv"]),
                iv_atm=_f(r["iv_atm"]),
            )
            for r in iv_term_rows
        ]
        # Use iv_atm where available, fall back to iv; pick front and back IV
        # by DTE rather than table order to be robust.
        valued = [(p.dte, p.iv_atm if p.iv_atm is not None else p.iv) for p in pts if p.dte is not None]
        front_iv = back_iv = None
        if valued:
            front_iv = min(valued, key=lambda x: x[0])[1]
            back_iv = max(valued, key=lambda x: x[0])[1]
        inversion_pct: float | None = None
        inverted = False
        if front_iv is not None and back_iv is not None and back_iv > 0:
            inversion_pct = (front_iv - back_iv) / back_iv
            inverted = inversion_pct >= 0.05
        iv_term_chip = IvTermStructure(
            snapshot_date=iv_term_rows[0]["expiry"].isoformat(),
            points=pts,
            front_iv=front_iv,
            back_iv=back_iv,
            inverted=inverted,
            inversion_pct=inversion_pct,
        )

    skew_chip: RiskReversalSkew | None = None
    if skew_rows:
        sk_pts = [
            SkewPoint(
                dte=int(r["dte"]),
                skew=_f(r["skew"]),
                call_iv=_f(r["call_iv"]),
                put_iv=_f(r["put_iv"]),
            )
            for r in skew_rows
        ]
        # Headline: look at the 30d-ish bucket. Skew > +1% = bullish lean,
        # < -1% = bearish lean, else neutral.
        ref = min(sk_pts, key=lambda p: abs((p.dte or 30) - 30)) if sk_pts else None
        if ref is None or ref.skew is None:
            sk_msg = "Risk-reversal skew flat across DTE."
        elif ref.skew >= 0.01:
            sk_msg = f"+{ref.skew*100:.1f}% call-side skew at {ref.dte}d — option market is paying for upside."
        elif ref.skew <= -0.01:
            sk_msg = f"{ref.skew*100:.1f}% put-side skew at {ref.dte}d — option market is paying for downside."
        else:
            sk_msg = f"Neutral skew at {ref.dte}d (no directional lean from option pricing)."
        # We need a snapshot_date — pull it from any row's expiry isn't right
        # since skew rows are keyed by (date, ticker, dte). Re-fetch the date
        # cheaply from the first row's payload? skew_rows don't carry the
        # snapshot_date column; default to today.
        skew_chip = RiskReversalSkew(
            snapshot_date=datetime.now(UTC).date().isoformat(),
            points=sk_pts,
            headline=sk_msg,
        )

    iv_vs_rv_chip: IvVsRv | None = None
    if rv30_val is not None and iv_rank_chip is not None and iv_rank_chip.iv30 is not None:
        rv30 = float(rv30_val)
        iv30 = float(iv_rank_chip.iv30)
        ratio = iv30 / rv30 if rv30 > 0 else None
        if ratio is None:
            rv_verdict: Literal["cheap", "fair", "rich"] = "fair"
        elif ratio >= 1.30:
            rv_verdict = "rich"
        elif ratio <= 0.80:
            rv_verdict = "cheap"
        else:
            rv_verdict = "fair"
        iv_vs_rv_chip = IvVsRv(
            snapshot_date=iv_rank_chip.snapshot_date,
            iv30=iv30,
            rv30=rv30,
            iv_rv_ratio=ratio,
            verdict=rv_verdict,
        )

    top_peers_chip: TopPeers | None = None
    if peer_rows:
        top_peers_chip = TopPeers(
            snapshot_date=datetime.now(UTC).date().isoformat(),
            peers=[
                PeerCorrelation(peer_ticker=r["peer"], correlation=_f(r["correlation"]))
                for r in peer_rows
            ],
        )

    spot_for_mp: float | None = float(spot_val) if spot_val is not None else None
    max_pain_chips: list[MaxPainExpiry] = []
    for r in max_pain_rows:
        strike_mp = float(r["max_pain_strike"]) if r["max_pain_strike"] is not None else None
        if strike_mp is None:
            continue
        dist_pct: float | None = None
        if spot_for_mp is not None and spot_for_mp > 0:
            dist_pct = (spot_for_mp - strike_mp) / spot_for_mp
        max_pain_chips.append(
            MaxPainExpiry(
                expiry=r["expiry"].isoformat(),
                max_pain_strike=strike_mp,
                distance_from_spot_pct=dist_pct,
            )
        )

    return FlowAggregateResponse(
        ticker=sym, days=days,
        oldest_alert_ts=oldest.isoformat() if oldest else None,
        newest_alert_ts=newest.isoformat() if newest else None,
        coverage_summary=coverage_summary,
        n_alerts=n,
        total_premium=total_prem,
        total_call_premium=float(agg["call_prem"] or 0.0),
        total_put_premium=float(agg["put_prem"] or 0.0),
        net_call_premium=net_call,
        net_put_premium=net_put,
        bullish_score=score,
        verdict=verdict,
        verdict_reason=reason,
        avg_ticket_size=avg_ticket,
        leap_call_premium=float(agg["leap_call"] or 0.0),
        leap_put_premium=float(agg["leap_put"] or 0.0),
        expiry_buckets=expiry_buckets,
        expiry_headline=expiry_headline,
        oi_growth_strikes=[
            OiGrowthStrike(
                strike=float(r["strike"]),
                option_type=r["option_type"],
                expiry=r["expiry"].isoformat() if r["expiry"] else None,
                oi_delta=int(r["oi_delta"] or 0),
                current_oi=int(r["current_oi"] or 0),
                days_with_data=int(r["days_with_data"] or 0),
                days_of_oi_increases=(int(r["streak"]) if r["streak"] is not None else None),
            )
            for r in oi_rows
        ],
        oi_growth_window_days=oi_window,
        top_strikes=top_strikes,
        top_trades=top_trades,
        iv_rank=iv_rank_chip,
        upcoming_earnings=upcoming_earnings_chip,
        max_pain=max_pain_chips,
        sector_alignment=sector_alignment_chip,
        iv_term_structure=iv_term_chip,
        risk_reversal_skew=skew_chip,
        iv_vs_rv=iv_vs_rv_chip,
        top_peers=top_peers_chip,
        refresh_queued=refresh_queued,
    )


# ---------- Suggested plays (ranked candidates + gate) ----------


def _conviction_label(score: float) -> Literal["high", "medium", "mixed"]:
    if score >= 65:
        return "high"
    if score >= 40:
        return "medium"
    return "mixed"


@router.get("/aggregate/{ticker}/suggest", response_model=SuggestedPlaysResponse)
async def suggest_plays(
    ticker: str,
    n: int = Query(3, ge=1, le=10, description="How many ranked candidates to return"),
) -> SuggestedPlaysResponse:
    """Ranked candidate option contracts for ``ticker`` with a PROCEED/WAIT/SKIP gate.

    Three decisiveness levers stacked on top of the raw flow data:
      1. Top-of-panel gate (proceed/wait/skip) computed from flow + ensemble + regime
      2. Per-play ensemble cross-validation (do the 25 agents agree?)
      3. Per-play Kelly-bounded position size from cfp_models.position_sizing

    Deliberately not a cost calculator — we return the size as a portfolio
    fraction, the flip condition as a price/date threshold, and let the user
    decide.
    """
    sym = ticker.upper()
    pool = get_pool()
    async with pool.acquire() as conn:
        spot_row = await conn.fetchval(
            "SELECT close FROM prices_daily WHERE symbol = $1 ORDER BY ts DESC LIMIT 1",
            sym,
        )
        spot = float(spot_row) if spot_row else None

        # Latest run's full ensemble: PM signal + every agent vote
        ensemble = await conn.fetch(
            """
            SELECT agent, signal, confidence FROM agent_signals
            WHERE ticker = $1
              AND run_ts = (
                SELECT MAX(run_ts) FROM agent_signals
                WHERE ticker = $1 AND agent = 'portfolio_manager'
              )
            """,
            sym,
        )
        pm_signal: str | None = None
        bull_votes = 0
        bear_votes = 0
        total_voters = 0
        for r in ensemble:
            total_voters += 1
            if r["agent"] == "portfolio_manager":
                pm_signal = r["signal"]
            if r["signal"] == "bullish":
                bull_votes += 1
            elif r["signal"] == "bearish":
                bear_votes += 1

        # Per-contract aggregation: OI growth + alert-side aggression
        rows = await conn.fetch(
            """
            WITH oi_parsed AS (
                SELECT
                    option_symbol,
                    substring(option_symbol from '(\\d{6})[CP]\\d{8}$') AS exp_yymmdd,
                    substring(option_symbol from '\\d{6}([CP])\\d{8}$') AS type_letter,
                    substring(option_symbol from '\\d{6}[CP](\\d{8})$') AS strike_padded,
                    oi_diff_plain, curr_oi, days_of_oi_increases, curr_date
                FROM uw_oi_change
                WHERE ticker = $1
                  AND curr_date > CURRENT_DATE - 30
                  AND option_symbol ~ '\\d{6}[CP]\\d{8}$'
            ),
            oi_agg AS (
                SELECT
                    option_symbol,
                    CASE WHEN type_letter = 'C' THEN 'call' ELSE 'put' END AS option_type,
                    to_date(exp_yymmdd, 'YYMMDD') AS expiry,
                    strike_padded::int / 1000.0 AS strike,
                    SUM(oi_diff_plain)::bigint AS oi_delta,
                    MAX(days_of_oi_increases) AS streak,
                    (array_agg(curr_oi ORDER BY curr_date DESC))[1]::bigint AS current_oi
                FROM oi_parsed
                GROUP BY option_symbol, type_letter, exp_yymmdd, strike_padded
            ),
            alerts_agg AS (
                -- Carry strike/expiry/option_type directly from uw_flow_alerts so
                -- contracts that only have flow data (no oi_change snapshot yet)
                -- still surface as candidates.
                SELECT
                    option_chain AS option_symbol,
                    MAX(option_type)::text AS option_type,
                    MAX(expiry) AS expiry,
                    MAX(strike) AS strike,
                    COUNT(*)::int AS alerts_count,
                    SUM(total_premium)::float AS alerts_premium,
                    -- weighted ask-side aggression: sum(ask_pct * prem) / sum(prem)
                    SUM(CASE WHEN total_premium > 0 THEN ask_side_prem ELSE 0 END)::float
                      / NULLIF(SUM(total_premium), 0) AS avg_ask_side_pct,
                    -- trap detection: largest single alert's ask-side pct
                    (array_agg(
                        CASE WHEN total_premium > 0 THEN ask_side_prem / total_premium ELSE NULL END
                        ORDER BY total_premium DESC NULLS LAST
                    ))[1] AS largest_ticket_ask_pct,
                    MAX(total_premium)::float AS largest_ticket_premium
                FROM uw_flow_alerts
                WHERE ticker = $1
                  AND created_at > NOW() - INTERVAL '30 days'
                GROUP BY option_chain
            )
            SELECT
                COALESCE(oi.option_symbol, a.option_symbol) AS option_symbol,
                COALESCE(oi.option_type, a.option_type) AS option_type,
                COALESCE(oi.expiry, a.expiry) AS expiry,
                COALESCE(oi.strike, a.strike) AS strike,
                COALESCE(oi.oi_delta, 0)::bigint AS oi_delta,
                oi.streak,
                COALESCE(oi.current_oi, 0)::bigint AS current_oi,
                COALESCE(a.alerts_count, 0)::int AS alerts_count,
                COALESCE(a.alerts_premium, 0)::float AS alerts_premium,
                a.avg_ask_side_pct,
                a.largest_ticket_ask_pct,
                COALESCE(a.largest_ticket_premium, 0)::float AS largest_ticket_premium
            FROM oi_agg oi
            FULL OUTER JOIN alerts_agg a ON oi.option_symbol = a.option_symbol
            -- Surface a contract if EITHER side has positive evidence:
            --   * OI accumulating (existing path)
            --   * Flow alerts with non-trivial premium (new fallback — catches
            --     big single tickets that haven't had an oi_change snapshot yet)
            WHERE (COALESCE(oi.oi_delta, 0) > 0 OR COALESCE(a.alerts_premium, 0) >= 250000)
              AND COALESCE(oi.expiry, a.expiry) > CURRENT_DATE
            """,
            sym,
        )

        # Per-bucket score so we can attribute the right one to each candidate
        bucket_rows = await conn.fetch(
            """
            WITH alerts AS (
                SELECT option_type, total_premium, ask_side_prem, bid_side_prem,
                       (expiry::date - created_at::date) AS dte
                FROM uw_flow_alerts
                WHERE ticker = $1
                  AND created_at > NOW() - INTERVAL '60 days'
                  AND expiry IS NOT NULL
            ),
            bucketed AS (
                SELECT
                    CASE
                        WHEN dte <= 7  THEN '0-7d'
                        WHEN dte <= 30 THEN '7-30d'
                        WHEN dte <= 90 THEN '30-90d'
                        ELSE '90d+'
                    END AS bucket,
                    option_type, total_premium, ask_side_prem, bid_side_prem
                FROM alerts
            )
            SELECT
                bucket,
                COALESCE(SUM(total_premium), 0)::float AS total_prem,
                COALESCE(SUM(CASE WHEN option_type='call' THEN ask_side_prem - bid_side_prem ELSE 0 END), 0)::float AS net_call,
                COALESCE(SUM(CASE WHEN option_type='put'  THEN ask_side_prem - bid_side_prem ELSE 0 END), 0)::float AS net_put
            FROM bucketed
            GROUP BY bucket
            """,
            sym,
        )

    bucket_score: dict[str, float] = {}
    for r in bucket_rows:
        total = float(r["total_prem"] or 0)
        if total > 0:
            bucket_score[r["bucket"]] = max(-1.0, min(1.0, (float(r["net_call"]) - float(r["net_put"])) / total))
        else:
            bucket_score[r["bucket"]] = 0.0

    def _bucket_of(dte: int) -> str:
        if dte <= 7: return "0-7d"
        if dte <= 30: return "7-30d"
        if dte <= 90: return "30-90d"
        return "90d+"

    n_considered = len(rows)
    today = datetime.now(UTC).date()
    candidates: list[tuple[float, dict]] = []
    for r in rows:
        expiry = r["expiry"]
        dte = (expiry - today).days
        if dte <= 0:
            continue
        bucket = _bucket_of(dte)
        b_score = bucket_score.get(bucket, 0.0)
        # Postgres `numeric` columns come back as Decimal; coerce to float once.
        strike_f = float(r["strike"])
        oi_delta = int(r["oi_delta"] or 0)
        streak = int(r["streak"] or 0) if r["streak"] is not None else 0
        n_alerts = int(r["alerts_count"] or 0)
        alert_prem = float(r["alerts_premium"] or 0.0)
        ask_pct = float(r["avg_ask_side_pct"]) if r["avg_ask_side_pct"] is not None else None
        opt_type = r["option_type"]

        # Composite conviction score (0..100, components defined to be inspectable)
        score = 0.0
        # OI accumulation 40 pts: 10,000 contracts = full credit
        score += min(40.0, 40.0 * (oi_delta / 10_000.0))
        # Sustained-buying streak 20 pts: 4+ days = full credit
        score += min(20.0, 5.0 * streak)
        # Ask-side aggression 20 pts: 100% at ask = +20, 50% = 0, 0% = -20
        if ask_pct is not None:
            score += max(-20.0, min(20.0, (ask_pct - 0.5) * 40.0))
        # Bucket directional confirmation 10 pts: aligned with contract type
        if opt_type == "call":
            score += b_score * 10.0
        else:
            score += -b_score * 10.0
        # Size matters: 10 pts at $1M premium, capped
        score += min(10.0, alert_prem / 1e6 * 10.0)

        # Trap detection: largest single ticket printed at low % ask = likely seller
        caveats: list[str] = []
        largest_ask = r["largest_ticket_ask_pct"]
        largest_prem = float(r["largest_ticket_premium"] or 0.0)
        if largest_ask is not None and largest_ask < 0.3 and largest_prem > 500_000:
            caveats.append(
                f"largest single ticket (${largest_prem / 1e6:.1f}M) printed at "
                f"{float(largest_ask) * 100:.0f}% at ask — possible seller-initiated, "
                "score halved."
            )
            score *= 0.5

        # Ensemble alignment: a call wants bullish agreement, a put wants bearish.
        # Compare *directional voters only* — neutral agents abstain. Previously
        # the threshold was 60% of all voters, but ~10 of our 26 agents routinely
        # emit "neutral" (risk_manager on quiet days, news/sentiment without a
        # catalyst, etc.). With neutrals stuck in the denominator, even a
        # unanimous directional lean would barely clear 60% and the gate would
        # falsely read as disagreement.
        if opt_type == "call":
            aligned_votes = bull_votes
            opposing_votes = bear_votes
            aligned_target = "bullish"
        else:
            aligned_votes = bear_votes
            opposing_votes = bull_votes
            aligned_target = "bearish"
        directional_voters = bull_votes + bear_votes
        ensemble_aligned = (
            directional_voters >= 5
            and aligned_votes > opposing_votes
            and aligned_votes >= int(round(directional_voters * 0.6))
        )
        if ensemble_aligned:
            score += 10.0  # ensemble bonus

        # Flow-only candidate: the OI snapshot for this contract hasn't been
        # ingested yet, but the flow alerts on it are strong. Treat the absence
        # as a data gap (informational), not a negative signal. Max conviction
        # caps naturally at ~50 because the OI components zero out.
        flow_only = (oi_delta == 0 and streak == 0 and n_alerts > 0)

        # Build the "why" list — exactly what the UI shows as evidence chips
        why: list[str] = []
        if streak >= 3:
            why.append(f"{streak}-day OI growth streak (+{oi_delta:,} contracts)")
        elif oi_delta >= 5000:
            why.append(f"+{oi_delta:,} contracts in last 30d")
        if ask_pct is not None and ask_pct >= 0.7:
            why.append(f"{ask_pct * 100:.0f}% of alert premium lifted at the ask")
        if abs(b_score) >= 0.15 and (
            (opt_type == "call" and b_score > 0) or (opt_type == "put" and b_score < 0)
        ):
            why.append(f"{bucket} bucket score {b_score:+.2f} agrees with this contract")
        if alert_prem >= 1_000_000:
            why.append(f"${alert_prem / 1e6:.1f}M in flow-alert premium across {n_alerts} alerts")
        if ensemble_aligned:
            why.append(
                f"{aligned_votes}/{directional_voters} directional agents agree "
                f"({aligned_target}); {total_voters - directional_voters} neutral"
            )
        if flow_only:
            caveats.append(
                "OI snapshot not yet ingested for this contract — score reflects flow "
                "alerts only. Will firm up once daily OI delta data lands."
            )
        if not why:
            why.append("Sustained OI accumulation only — weak supporting evidence")

        # Flip condition: deterministic price threshold tied to spot
        if spot is None:
            flip = f"(spot unknown — re-run after a fresh price ingest for {sym})"
        else:
            # For short-dated plays (<14 DTE), the "7 days before expiry" rule
            # collapses to the past. Use today + min(7, dte//2) instead so the
            # flip horizon scales with the trade horizon.
            buffer = max(2, min(7, dte // 2)) if dte < 14 else 7
            flip_by = (expiry - timedelta(days=buffer)).isoformat()
            if opt_type == "call":
                target = strike_f * 0.95
                flip = f"{sym} closes below ${target:.2f} on or before {flip_by}"
            else:
                target = strike_f * 1.05
                flip = f"{sym} closes above ${target:.2f} on or before {flip_by}"

        # Concrete trade structure (lever #4): 1 or 2 contracts, 1:3 R:R.
        # High conviction (≥65) + ensemble agreement → 2 contracts.
        # Medium conviction (40-65) → 1 contract.
        # Mixed (<40) → 0 contracts (caller's gate will say SKIP).
        score = max(0.0, min(100.0, score))
        if score >= 65 and ensemble_aligned:
            contracts = 2
        elif score >= 40:
            contracts = 1
        else:
            contracts = 0
        target_multiple = 3.0   # exit at 3× premium (1:3 R:R)
        stop_loss_pct = -0.50   # cut at -50% of premium (preserves capital)
        # Rough spot target for the 3× payout. For an OTM call near expiry,
        # spot ≈ strike + 3 × premium_per_share gets you to ~3× cost. We
        # don't have the contract's mid price persisted reliably here; use
        # 5% above strike as a *placeholder* — the UI labels this "approx".
        if opt_type == "call":
            approx_spot_target = strike_f * 1.05 if spot is None else max(strike_f * 1.05, spot * 1.05)
        else:
            approx_spot_target = strike_f * 0.95 if spot is None else min(strike_f * 0.95, spot * 0.95)
        candidates.append((
            score,
            dict(
                conviction=_conviction_label(score),
                conviction_score=round(score, 1),
                strike=strike_f,
                option_type=opt_type,
                expiry=expiry.isoformat(),
                days_to_expiry=dte,
                oi_delta_30d=oi_delta,
                current_oi=int(r["current_oi"] or 0),
                days_of_oi_increases=streak if streak > 0 else None,
                alerts_count=n_alerts,
                alerts_premium=alert_prem,
                avg_ask_side_pct=ask_pct,
                bucket_score=round(b_score, 4),
                ensemble_aligned=ensemble_aligned,
                ensemble_alignment_count=aligned_votes,
                ensemble_opposing_count=opposing_votes,
                ensemble_directional_voters=directional_voters,
                ensemble_total_voters=total_voters,
                ensemble_pm_signal=pm_signal,
                contracts=contracts,
                risk_to_reward="1:3",
                target_payout_multiple=target_multiple,
                stop_loss_pct=stop_loss_pct,
                approx_spot_target=round(approx_spot_target, 2) if approx_spot_target is not None else None,
                why=why,
                caveats=caveats,
                flip_condition=flip,
            ),
        ))

    candidates.sort(key=lambda c: c[0], reverse=True)
    top = candidates[:n]

    # --- Decisiveness lever #1: PROCEED / WAIT / SKIP gate ---
    top_conviction = top[0][0] if top else 0.0
    # We don't pull market regime here for simplicity — defer to ensemble
    # alignment as a proxy for "the broader system agrees." When
    # MarketRegimeCtx is reliably populated on all tickers we can join
    # run_evidence and treat bear regime as a hard SKIP override.
    if not top:
        gate: Literal["proceed", "wait", "skip"] = "skip"
        gate_reason = "No accumulation candidates in last 30d. Skip — there's nothing to act on."
    elif top_conviction >= 60 and top[0][1]["ensemble_aligned"]:
        gate = "proceed"
        contracts_to_buy = top[0][1]["contracts"]
        aligned = top[0][1]["ensemble_alignment_count"]
        directional = top[0][1]["ensemble_directional_voters"]
        neutral = top[0][1]["ensemble_total_voters"] - directional
        gate_reason = (
            f"Top candidate scores {top_conviction:.0f}/100 with ensemble agreement "
            f"({aligned}/{directional} directional agents agree, {neutral} neutral). "
            f"Buy {contracts_to_buy} contract{'s' if contracts_to_buy != 1 else ''} at 1:3 R:R "
            f"(target +200%, stop −50%)."
        )
    elif top_conviction >= 40:
        gate = "wait"
        if not top[0][1]["ensemble_aligned"]:
            aligned = top[0][1]["ensemble_alignment_count"]
            opposing = top[0][1]["ensemble_opposing_count"]
            directional = top[0][1]["ensemble_directional_voters"]
            neutral = top[0][1]["ensemble_total_voters"] - directional
            target = "bullish" if top[0][1]["option_type"] == "call" else "bearish"
            gate_reason = (
                f"Flow conviction is {top_conviction:.0f}/100 but the ensemble isn't there yet: "
                f"{aligned} {target} vs {opposing} opposing across {directional} directional "
                f"agents ({neutral} neutral). Wait for the agents to confirm before acting."
            )
        else:
            gate_reason = f"Top candidate scores {top_conviction:.0f}/100 — modest conviction. Wait for a stronger setup."
    else:
        gate = "skip"
        gate_reason = (
            f"Top candidate only scores {top_conviction:.0f}/100. Flow signal is too weak "
            "to size a position. Skip and re-check tomorrow."
        )

    gate_signals: dict[str, str | float | None] = {
        "top_conviction": round(top_conviction, 1),
        "ensemble_pm_signal": pm_signal,
        "ensemble_bull_votes": float(bull_votes),
        "ensemble_bear_votes": float(bear_votes),
        "ensemble_total_voters": float(total_voters),
    }

    return SuggestedPlaysResponse(
        ticker=sym,
        spot=spot,
        n_candidates_considered=n_considered,
        gate=gate,
        gate_reason=gate_reason,
        gate_signals=gate_signals,
        plays=[
            SuggestedPlay(rank=i + 1, **c[1])  # type: ignore[arg-type]
            for i, c in enumerate(top)
        ],
        method_note=(
            "Score (0-100) = OI accumulation (40) + streak (20) + ask-side aggression (20) + "
            "bucket direction (10) + size (10) + ensemble alignment bonus (10). "
            "Trap detection halves score when the largest single ticket printed at low % at ask. "
            "Sizing: 1 contract at medium conviction (40-65), 2 contracts at high conviction (≥65) "
            "WITH ensemble agreement. Always 1:3 R:R — target +200%, stop −50% of premium."
        ),
    )


# ---------- New market-wide routes (migration 0027) ----------


class Mover(BaseModel):
    ticker: str
    price: float | None
    change: float | None
    change_percent: float | None
    volume: int | None


class MoversResponse(BaseModel):
    as_of: str
    top_gainers: list[Mover]
    top_losers: list[Mover]
    most_active: list[Mover]


@router.get("/movers", response_model=MoversResponse)
async def get_movers(limit: int = Query(20, ge=1, le=100)) -> MoversResponse:
    """Latest snapshot of top gainers / losers / most-active across the
    market. Refreshed by `cfp-jobs market-movers` (every ~5min RTH)."""
    pool = get_pool()
    sql = """
        WITH latest AS (
            SELECT MAX(snapshot_ts) AS ts FROM uw_movers_snapshot
        )
        SELECT bucket, rank, ticker, price, change, change_percent, volume
        FROM uw_movers_snapshot, latest
        WHERE snapshot_ts = latest.ts AND rank <= $1
        ORDER BY bucket, rank
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, limit)
        ts_row = await conn.fetchrow("SELECT MAX(snapshot_ts) AS ts FROM uw_movers_snapshot")

    buckets: dict[str, list[Mover]] = {"top_gainers": [], "top_losers": [], "most_active": []}
    for r in rows:
        b = r["bucket"]
        if b not in buckets:
            continue
        buckets[b].append(
            Mover(
                ticker=r["ticker"],
                price=_f(r["price"]),
                change=_f(r["change"]),
                change_percent=_f(r["change_percent"]),
                volume=int(r["volume"]) if r["volume"] is not None else None,
            )
        )
    as_of = ts_row["ts"].isoformat() if ts_row and ts_row["ts"] else datetime.now(UTC).isoformat()
    return MoversResponse(
        as_of=as_of,
        top_gainers=buckets["top_gainers"],
        top_losers=buckets["top_losers"],
        most_active=buckets["most_active"],
    )


class SectorTidePoint(BaseModel):
    ts: str
    net_call_premium: float | None
    net_put_premium: float | None
    net_volume: int | None


class SectorTideResponse(BaseModel):
    sector: str
    lookback_hours: int
    net_call_premium_sum: float
    net_put_premium_sum: float
    lean: Literal["bull", "bear", "neutral"]
    points: list[SectorTidePoint]


@router.get("/sector-tide/{sector}", response_model=SectorTideResponse)
async def get_sector_tide(
    sector: str,
    lookback_hours: int = Query(6, ge=1, le=168),
) -> SectorTideResponse:
    """Per-sector minute-by-minute tape. `sector` is the UW slug, e.g.
    'Technology' or 'Energy' (see DEFAULT_SECTOR_SLUGS in cfp_jobs)."""
    pool = get_pool()
    sql = """
        SELECT ts, net_call_premium, net_put_premium, net_volume
        FROM uw_sector_tide
        WHERE sector = $1
          AND ts >= NOW() - ($2 || ' hours')::interval
        ORDER BY ts ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, sector, str(lookback_hours))

    points = [
        SectorTidePoint(
            ts=r["ts"].isoformat(),
            net_call_premium=_f(r["net_call_premium"]),
            net_put_premium=_f(r["net_put_premium"]),
            net_volume=int(r["net_volume"]) if r["net_volume"] is not None else None,
        )
        for r in rows
    ]
    call_sum = sum((p.net_call_premium or 0.0) for p in points)
    put_sum = sum((p.net_put_premium or 0.0) for p in points)
    diff = call_sum - put_sum
    if abs(diff) < 5_000_000:
        lean: Literal["bull", "bear", "neutral"] = "neutral"
    else:
        lean = "bull" if diff > 0 else "bear"
    return SectorTideResponse(
        sector=sector,
        lookback_hours=lookback_hours,
        net_call_premium_sum=call_sum,
        net_put_premium_sum=put_sum,
        lean=lean,
        points=points,
    )


class CorrelationPair(BaseModel):
    fst: str
    snd: str
    correlation: float | None
    min_date: str | None
    max_date: str | None
    sample_rows: int | None


class CorrelationsResponse(BaseModel):
    snapshot_date: str | None
    anchor: str
    pairs: list[CorrelationPair]


@router.get("/correlations/{ticker}", response_model=CorrelationsResponse)
async def get_correlations(
    ticker: str,
    limit: int = Query(20, ge=1, le=100),
) -> CorrelationsResponse:
    """Latest pairwise correlations with `ticker` as the anchor (UW `fst`).
    Sorted by absolute correlation descending so the strongest links surface
    first regardless of sign."""
    sym = ticker.upper()
    pool = get_pool()
    sql = """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d
            FROM uw_correlations
            WHERE fst_ticker = $1
        )
        SELECT fst_ticker, snd_ticker, correlation, min_date, max_date, sample_rows
        FROM uw_correlations, latest
        WHERE fst_ticker = $1
          AND snapshot_date = latest.d
        ORDER BY ABS(correlation) DESC NULLS LAST
        LIMIT $2
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, sym, limit)
    snapshot_date = rows[0]["max_date"].isoformat() if rows and rows[0]["max_date"] else None
    pairs = [
        CorrelationPair(
            fst=r["fst_ticker"],
            snd=r["snd_ticker"],
            correlation=_f(r["correlation"]),
            min_date=r["min_date"].isoformat() if r["min_date"] else None,
            max_date=r["max_date"].isoformat() if r["max_date"] else None,
            sample_rows=int(r["sample_rows"]) if r["sample_rows"] is not None else None,
        )
        for r in rows
    ]
    return CorrelationsResponse(snapshot_date=snapshot_date, anchor=sym, pairs=pairs)
