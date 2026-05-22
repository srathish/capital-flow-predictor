"""Delphi outcome evaluator — close the prediction-memory loop.

For every prediction whose horizon_ends_at has passed, pull the actual price
action between created_at and now, fill in delphi_outcomes, and let the
memory dashboard learn from the result.

This is the "keep receipts" half of the doc's design principle (section 22.9).
Without it, Delphi is just a fancy scanner. With it, you can answer:
  - which reason codes actually paid?
  - what was my real hit rate at 70%-stated probability?
  - which tickers should be down-weighted because Delphi is noisy on them?

Wire-up: ``cfp-jobs delphi-evaluate`` runs hourly. Idempotent — predictions
that already have a row in delphi_outcomes are skipped.

Price source: ``prices_daily(ts, symbol, open, high, low, close, volume, source)``
from migration 0001. The PK includes ``source`` so multiple feeds (yfinance,
fmp, polygon) can coexist for the same bar; we aggregate MAX/MIN/last across
sources, matching the pattern used in routes/reddit.py.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# Source for actual high/low/close between created_at and horizon_ends_at.
# Migration 0001 defines this as the canonical OHLCV table.
PRICE_TABLE = "prices_daily"


def _due_predictions(conn: psycopg.Connection, *, max_batch: int) -> list[dict[str, Any]]:
    """Predictions whose horizon has closed and don't yet have an outcome."""
    rows = conn.execute(
        """
        SELECT p.prediction_id, p.ticker, p.created_at, p.horizon_ends_at,
               p.current_price, p.bias,
               p.target_range_low, p.target_range_high, p.primary_target,
               p.invalidation
        FROM delphi_predictions p
        LEFT JOIN delphi_outcomes o USING (prediction_id)
        WHERE o.prediction_id IS NULL
          AND p.horizon_ends_at <= NOW()
        ORDER BY p.horizon_ends_at ASC
        LIMIT %s
        """,
        (max_batch,),
    ).fetchall()

    return [
        {
            "prediction_id": r[0],
            "ticker": r[1],
            "created_at": r[2],
            "horizon_ends_at": r[3],
            "current_price": float(r[4]),
            "bias": r[5],
            "target_range_low": float(r[6]),
            "target_range_high": float(r[7]),
            "primary_target": float(r[8]),
            "invalidation": float(r[9]),
        }
        for r in rows
    ]


def _price_window(
    conn: psycopg.Connection, ticker: str, start: datetime, end: datetime
) -> tuple[float, float, float] | None:
    """Return (actual_high, actual_low, actual_close) across the window.

    Aggregates across all sources for the same (ts, symbol) — prices_daily's
    PK is (ts, symbol, source), so yfinance/fmp/polygon rows for the same
    bar coexist. MAX(high) / MIN(low) is robust to that; for close we want
    the last observation, so we order by (ts, source) DESC.
    """
    try:
        row = conn.execute(
            f"""
            SELECT MAX(high), MIN(low),
                   (ARRAY_AGG(close ORDER BY ts DESC, source DESC))[1] AS last_close
            FROM {PRICE_TABLE}
            WHERE symbol = %s
              AND ts >= %s
              AND ts <= %s
              AND high IS NOT NULL
              AND low IS NOT NULL
              AND close IS NOT NULL
            """,
            (ticker, start, end),
        ).fetchone()
    except psycopg.errors.UndefinedTable:
        # Allow Delphi to ship before the price-bars table is wired in;
        # the job simply no-ops until the source is available.
        log.warning("delphi-evaluate: %s does not exist; cannot score outcomes", PRICE_TABLE)
        return None

    if not row or row[0] is None:
        return None
    return (float(row[0]), float(row[1]), float(row[2]))


def _classify(
    pred: dict[str, Any], high: float, low: float, close: float
) -> dict[str, Any]:
    """Apply the doc's outcome rules — section 22.4.

    `hit_target_range` is true if price traded into [low, high] at any point.
    `hit_invalidation_first` is approximated as "invalidation was hit AND the
    target was not" — true touch-order would need intraday data, which is
    out of scope for the daily-bar v0.
    """
    bias = pred["bias"]
    target_low = pred["target_range_low"]
    target_high = pred["target_range_high"]
    primary = pred["primary_target"]
    invalidation = pred["invalidation"]
    entry_price = pred["current_price"]

    hit_target_range = (low <= target_high) and (high >= target_low)
    if bias == "bullish":
        hit_primary = high >= primary
        hit_invalidation = low <= invalidation
    elif bias == "bearish":
        hit_primary = low <= primary
        hit_invalidation = high >= invalidation
    else:  # vol_expansion — symmetric
        hit_primary = high >= primary or low <= primary
        hit_invalidation = False  # vol expansion doesn't have a one-sided invalidation

    hit_invalidation_first = hit_invalidation and not hit_target_range

    if bias == "bullish":
        max_favorable = (high - entry_price) / entry_price
        max_adverse = (low - entry_price) / entry_price
    elif bias == "bearish":
        max_favorable = (entry_price - low) / entry_price
        max_adverse = (entry_price - high) / entry_price
    else:
        max_favorable = max(abs(high - entry_price), abs(low - entry_price)) / entry_price
        max_adverse = 0.0

    if hit_invalidation_first:
        result = "invalidated"
    elif hit_target_range:
        result = "win"
    elif abs(close - entry_price) / entry_price < 0.005:
        result = "breakeven"
    else:
        result = "loss"

    return {
        "actual_high": high,
        "actual_low": low,
        "actual_close": close,
        "hit_target_range": hit_target_range,
        "hit_primary_target": hit_primary,
        "hit_invalidation": hit_invalidation,
        "hit_invalidation_first": hit_invalidation_first,
        "max_favorable_return": max_favorable,
        "max_adverse_return": max_adverse,
        # time_to_target_hours requires intraday data; skip in v0.
        "time_to_target_hours": None,
        "result": result,
    }


def _insert_outcome(conn: psycopg.Connection, prediction_id: str, o: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO delphi_outcomes (
            prediction_id, evaluation_at,
            actual_high, actual_low, actual_close,
            hit_target_range, hit_primary_target,
            hit_invalidation, hit_invalidation_first,
            max_favorable_return, max_adverse_return,
            time_to_target_hours, result
        ) VALUES (
            %s, NOW(),
            %s, %s, %s,
            %s, %s,
            %s, %s,
            %s, %s,
            %s, %s
        )
        ON CONFLICT (prediction_id) DO NOTHING
        """,
        (
            prediction_id,
            o["actual_high"], o["actual_low"], o["actual_close"],
            o["hit_target_range"], o["hit_primary_target"],
            o["hit_invalidation"], o["hit_invalidation_first"],
            o["max_favorable_return"], o["max_adverse_return"],
            o["time_to_target_hours"], o["result"],
        ),
    )


def evaluate(database_url: str, *, max_batch: int = 500) -> dict[str, Any]:
    """Score every due prediction. Returns a summary dict for logging."""
    scored = 0
    skipped_no_data = 0
    wins = losses = invalidated = breakeven = 0

    with connect(database_url) as conn:
        due = _due_predictions(conn, max_batch=max_batch)
        if not due:
            return {"due": 0, "scored": 0}

        for pred in due:
            window = _price_window(
                conn, pred["ticker"], pred["created_at"], pred["horizon_ends_at"]
            )
            if window is None:
                skipped_no_data += 1
                continue
            high, low, close = window
            outcome = _classify(pred, high, low, close)
            _insert_outcome(conn, pred["prediction_id"], outcome)
            scored += 1
            if outcome["result"] == "win":
                wins += 1
            elif outcome["result"] == "invalidated":
                invalidated += 1
            elif outcome["result"] == "breakeven":
                breakeven += 1
            else:
                losses += 1

        conn.commit()

    return {
        "due": len(due),
        "scored": scored,
        "skipped_no_price_data": skipped_no_data,
        "wins": wins,
        "losses": losses,
        "invalidated": invalidated,
        "breakeven": breakeven,
    }
