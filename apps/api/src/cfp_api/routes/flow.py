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

import logging
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

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

    if agg is None or (agg["n"] or 0) == 0:
        # Return an empty-but-well-formed response so the FE can render
        # "no flow in window" without a special error path.
        return FlowAggregateResponse(
            ticker=sym, days=days,
            oldest_alert_ts=None, newest_alert_ts=None,
            coverage_summary=f"No UW flow alerts ingested for {sym}.",
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
    )
