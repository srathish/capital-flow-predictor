"""Intraday Delphi evaluator — fixes hit_invalidation_first ordering noise.

The daily-bar evaluator (delphi_evaluate.py) can't tell which of {target,
invalidation} touched first when both touched the same day. It defaults to
hit_invalidation_first = (hit_invalidation AND NOT hit_target_range), which
biases the label set toward "wins": any same-day double-touch is recorded
as a win even when invalidation was actually crossed first.

This module fixes that for any prediction whose daily outcome shows BOTH
sides touched. It pulls 5-minute bars from yfinance for the
created_at → horizon_ends_at window, finds the first timestamp each side
was touched, and writes the corrected outcome to delphi_intraday_outcomes.
delphi-learn joins this overlay back when computing reason-code edge.

Cost:
  - One yfinance call per ambiguous prediction (chunked across tickers).
  - yfinance throttles around 2k/hour; we run nightly with cap of 200
    predictions / run to stay polite.
  - 5m intraday bars are only available for the trailing 60 days on
    yfinance. Older predictions stay daily-bar resolved.

Quant rationale (Lopez de Prado-style):
  Label noise on training data caps the upper bound on holdout Brier.
  If 30% of "wins" are actually invalidated-first, the learner trains
  on lies for those rows. Cleaning labels = cleaner model = lower
  out-of-sample Brier. This is one of the higher-ROI fixes when working
  with horizon-based event labels.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


def _ambiguous_predictions(conn: psycopg.Connection, max_batch: int = 200) -> list[dict[str, Any]]:
    """Predictions where both target AND invalidation touched same day-or-window
    and we haven't already intraday-resolved them.

    Also includes predictions where only one side touched but the daily-bar
    evaluator labeled it 'invalidated' or 'win' WITHOUT touch-order info —
    those benefit from confirming the daily call was correct.
    """
    rows = conn.execute(
        """
        SELECT p.prediction_id, p.ticker, p.created_at, p.horizon_ends_at,
               p.bias, p.target_range_low, p.target_range_high,
               p.primary_target, p.invalidation, o.hit_target_range,
               o.hit_invalidation
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        LEFT JOIN delphi_intraday_outcomes io USING (prediction_id)
        WHERE io.prediction_id IS NULL
          AND o.hit_target_range AND o.hit_invalidation  -- both touched
          AND p.horizon_ends_at >= NOW() - INTERVAL '60 days'  -- yfinance 5m horizon limit
        ORDER BY p.horizon_ends_at DESC
        LIMIT %s
        """,
        (max_batch,),
    ).fetchall()
    return [
        {
            "prediction_id": r[0], "ticker": r[1],
            "created_at": r[2], "horizon_ends_at": r[3], "bias": r[4],
            "target_low": float(r[5]), "target_high": float(r[6]),
            "primary_target": float(r[7]), "invalidation": float(r[8]),
        }
        for r in rows
    ]


def _fetch_intraday_bars(ticker: str, start: datetime, end: datetime) -> Any:
    """Pull 5m bars from yfinance. Returns DataFrame indexed by datetime."""
    import yfinance as yf
    # yfinance restricts 5m bars to the trailing 60 days
    if (datetime.now(UTC) - start).days > 59:
        return None
    df = yf.download(
        ticker,
        start=start.strftime("%Y-%m-%d"),
        end=(end + timedelta(days=1)).strftime("%Y-%m-%d"),
        interval="5m",
        progress=False,
        auto_adjust=False,
    )
    if df is None or df.empty:
        return None
    return df


def _resolve_touch_order(pred: dict[str, Any], bars: Any) -> dict[str, Any] | None:
    """Walk the 5m bars in order; record first timestamp target high/low was
    touched and first timestamp invalidation was touched. Direction depends
    on bias.
    """
    if bars is None or bars.empty:
        return None
    bias = pred["bias"]
    tlow, thigh = pred["target_low"], pred["target_high"]
    inv = pred["invalidation"]
    entry_ts = pred["created_at"]
    horizon_end = pred["horizon_ends_at"]

    # filter to the prediction window
    bars = bars.copy()
    bars.index = bars.index.tz_convert("UTC") if bars.index.tzinfo else bars.index.tz_localize("UTC")
    bars = bars[(bars.index >= entry_ts) & (bars.index <= horizon_end)]
    if bars.empty:
        return None

    first_target_ts = None
    first_invalid_ts = None
    for ts, row in bars.iterrows():
        # MultiIndex columns from yfinance when single-ticker: ('High', 'TICKER')
        high = float(row["High"].iloc[0] if hasattr(row["High"], "iloc") else row["High"])
        low = float(row["Low"].iloc[0] if hasattr(row["Low"], "iloc") else row["Low"])

        if first_target_ts is None:
            if bias == "bullish" and high >= tlow:  # touched the target range
                first_target_ts = ts
            elif bias == "bearish" and low <= thigh:
                first_target_ts = ts
        if first_invalid_ts is None:
            if bias == "bullish" and low <= inv:
                first_invalid_ts = ts
            elif bias == "bearish" and high >= inv:
                first_invalid_ts = ts
        if first_target_ts is not None and first_invalid_ts is not None:
            break

    hit_target_first = (
        first_target_ts is not None
        and (first_invalid_ts is None or first_target_ts < first_invalid_ts)
    )
    hit_invalidation_first = (
        first_invalid_ts is not None
        and (first_target_ts is None or first_invalid_ts < first_target_ts)
    )

    time_to_target_h = None
    if first_target_ts is not None:
        time_to_target_h = (first_target_ts - entry_ts).total_seconds() / 3600.0
    time_to_invalid_h = None
    if first_invalid_ts is not None:
        time_to_invalid_h = (first_invalid_ts - entry_ts).total_seconds() / 3600.0

    # Corrected result classifier:
    #   target_first   -> win
    #   invalid_first  -> invalidated
    #   neither (data gap) -> daily-bar result still applies; we return None
    if hit_target_first:
        corrected = "win"
    elif hit_invalidation_first:
        corrected = "invalidated"
    else:
        corrected = None

    return {
        "first_touch_target_ts": first_target_ts,
        "first_touch_invalidation_ts": first_invalid_ts,
        "hit_target_first": hit_target_first,
        "hit_invalidation_first": hit_invalidation_first,
        "time_to_target_hours": time_to_target_h,
        "time_to_invalidation_h": time_to_invalid_h,
        "corrected_result": corrected,
    }


def _upsert_intraday_outcome(conn: psycopg.Connection, prediction_id: str, r: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO delphi_intraday_outcomes (
            prediction_id, intraday_source, bar_interval_minutes,
            first_touch_target_ts, first_touch_invalidation_ts,
            hit_target_first, hit_invalidation_first,
            time_to_target_hours, time_to_invalidation_h,
            corrected_result
        ) VALUES (
            %s, 'yfinance_5m', 5,
            %s, %s,
            %s, %s,
            %s, %s,
            %s
        ) ON CONFLICT (prediction_id) DO UPDATE SET
            first_touch_target_ts = EXCLUDED.first_touch_target_ts,
            first_touch_invalidation_ts = EXCLUDED.first_touch_invalidation_ts,
            hit_target_first = EXCLUDED.hit_target_first,
            hit_invalidation_first = EXCLUDED.hit_invalidation_first,
            time_to_target_hours = EXCLUDED.time_to_target_hours,
            time_to_invalidation_h = EXCLUDED.time_to_invalidation_h,
            corrected_result = EXCLUDED.corrected_result,
            evaluation_at = NOW()
        """,
        (
            prediction_id,
            r["first_touch_target_ts"], r["first_touch_invalidation_ts"],
            r["hit_target_first"], r["hit_invalidation_first"],
            r["time_to_target_hours"], r["time_to_invalidation_h"],
            r["corrected_result"],
        ),
    )


def evaluate(database_url: str, *, max_batch: int = 200) -> dict[str, Any]:
    """Resolve touch-order for ambiguous predictions using 5m yfinance bars."""
    try:
        import yfinance  # noqa: F401
    except ImportError:
        return {"status": "missing_dep", "error": "yfinance not installed"}

    scored = skipped_no_bars = corrected_to_loss = corrected_to_win = 0
    with connect(database_url) as conn:
        ambiguous = _ambiguous_predictions(conn, max_batch=max_batch)
        if not ambiguous:
            return {"ambiguous": 0, "scored": 0, "note": "nothing to resolve"}
        log.info("delphi-evaluate-intraday: resolving %d ambiguous predictions", len(ambiguous))

        for pred in ambiguous:
            try:
                bars = _fetch_intraday_bars(pred["ticker"], pred["created_at"], pred["horizon_ends_at"])
                resolved = _resolve_touch_order(pred, bars)
                if resolved is None:
                    skipped_no_bars += 1
                    continue
                _upsert_intraday_outcome(conn, pred["prediction_id"], resolved)
                scored += 1
                if resolved["corrected_result"] == "invalidated":
                    # The original daily-bar evaluator likely called this a 'win'
                    # because hit_target_range=true. The intraday overlay says
                    # invalidation actually touched first → that win was a loss.
                    corrected_to_loss += 1
                elif resolved["corrected_result"] == "win":
                    corrected_to_win += 1
            except Exception as e:  # noqa: BLE001
                log.warning("intraday eval failed for %s: %s", pred["prediction_id"], e)
                skipped_no_bars += 1

        conn.commit()

    return {
        "ambiguous": len(ambiguous),
        "scored": scored,
        "skipped_no_bars": skipped_no_bars,
        "corrected_to_loss": corrected_to_loss,
        "corrected_to_win": corrected_to_win,
        "label_noise_rate": (corrected_to_loss / max(1, scored)),  # share of double-touch days that were actually losses
    }
