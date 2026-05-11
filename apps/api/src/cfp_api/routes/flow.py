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
