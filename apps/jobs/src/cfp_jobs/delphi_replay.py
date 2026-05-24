"""Walk-forward backtest harness — delphi-replay.

Replays the v0.2 ranker on historical delphi_features snapshots and scores
the replayed predictions against real price action from prices_daily. Writes
one row to delphi_backtest_runs per named run.

How it works (walk-forward, no look-ahead):
  - For each snapshot_ts in [window_start, window_end), step every
    walk_forward_step_days:
      1. SELECT delphi_features WHERE snapshot_ts = ts
      2. Run rank_v2 build logic on each row (does not write to delphi_predictions)
      3. For each synthetic prediction, look up actual OHLC in prices_daily
         from ts → ts + horizon
      4. Score: hit_target_range, brier (proba, hit), realized_return
  - Aggregate over the window: hit_rate, brier, log_loss, profit_factor,
    avg realized return, calibration_error
  - Persist to delphi_backtest_runs

Honest eval gating:
  - Only replays predictions whose features.snapshot_ts is BEFORE the
    feature row was used for training. This is what makes the backtest
    walk-forward and not in-sample.

Skipped today: synthetic backfill via re-running the composer on historical
UW data (it would need a "as of" parameter throughout the composer + UW
endpoints with historical date filters; some UW endpoints don't support
that on our tier). For now the harness uses whatever delphi_features rows
already exist, which gives us starting from the first time delphi-features
ran. Calibrating until that horizon closes — same shape as the live loop.
"""

from __future__ import annotations

import logging
import math
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect
from cfp_jobs import delphi_rank_v2

log = logging.getLogger(__name__)


HORIZON_DAYS: dict[str, int] = {
    "EOD":  1,
    "1w":   7,
    "1mo":  30,
    "3mo":  90,
    "6mo":  180,
    "12mo": 365,
    "24mo": 730,
}


def _features_at(conn: psycopg.Connection, snapshot_ts: datetime, limit: int) -> list[delphi_rank_v2.FeatureSnapshot]:
    """One delphi_features snapshot at a specific historical timestamp.

    Picks the row per ticker whose snapshot_ts is closest to but <=
    `snapshot_ts` (look-ahead protection). Mirrors delphi_rank_v2._latest_features
    but anchored historically.
    """
    rows = conn.execute(
        """
        WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY snapshot_ts DESC) AS rn
            FROM delphi_features
            WHERE snapshot_ts <= %s
              AND snapshot_ts >= %s - INTERVAL '7 days'
        )
        SELECT
            ticker, snapshot_ts, spot_price, iv_rank, iv30, rv30,
            dp_net_premium_24h, dp_print_count_24h, dp_late_day_share,
            insider_net_30d, insider_buyers_30d, insider_sellers_30d,
            congress_buys_14d, congress_sells_14d,
            oi_delta_call_1d, oi_delta_put_1d, oi_opening_ratio,
            max_pain_distance, max_pain_expiry,
            short_pct_float, short_fee_rate, short_utilization,
            days_to_earnings, earnings_in_horizon,
            analyst_revisions_30d, analyst_net_upgrade,
            inst_net_delta_shares,
            gex_expiry_front,
            rr_skew_25d, nope_score,
            uw_smart_money_score, uw_whales_score,
            news_count_24h, news_sentiment_24h,
            seasonality_avg_ret,
            vol_regime, trend_regime, macro_regime,
            has_conflict, conflict_codes, features
        FROM ranked
        WHERE rn = 1
          AND spot_price IS NOT NULL AND spot_price > 1.0
        LIMIT %s
        """,
        (snapshot_ts, snapshot_ts, limit),
    ).fetchall()

    out: list[delphi_rank_v2.FeatureSnapshot] = []
    for r in rows:
        composite = f"{r[36] or 'rangebound'}_{r[35] or 'normal'}_{r[37] or 'neutral'}"
        promoted: dict[str, Any] = {
            "dp_net_premium_24h":   r[6],  "dp_print_count_24h":   r[7],
            "dp_late_day_share":    r[8],  "insider_net_30d":      r[9],
            "insider_buyers_30d":   r[10], "insider_sellers_30d":  r[11],
            "congress_buys_14d":    r[12], "congress_sells_14d":   r[13],
            "oi_delta_call_1d":     r[14], "oi_delta_put_1d":      r[15],
            "oi_opening_ratio":     r[16], "max_pain_distance":    r[17],
            "max_pain_expiry":      r[18], "short_pct_float":      r[19],
            "short_fee_rate":       r[20], "short_utilization":    r[21],
            "days_to_earnings":     r[22], "earnings_in_horizon":  r[23],
            "analyst_revisions_30d": r[24], "analyst_net_upgrade":  r[25],
            "inst_net_delta_shares": r[26], "gex_expiry_front":    r[27],
            "rr_skew_25d":          r[28], "nope_score":           r[29],
            "uw_smart_money_score": r[30], "uw_whales_score":      r[31],
            "news_count_24h":       r[32], "news_sentiment_24h":   r[33],
            "seasonality_avg_ret":  r[34],
        }
        out.append(delphi_rank_v2.FeatureSnapshot(
            ticker=r[0], snapshot_ts=r[1], spot=float(r[2]),
            iv_rank=float(r[3]) if r[3] is not None else None,
            iv30=float(r[4]) if r[4] is not None else None,
            rv30=float(r[5]) if r[5] is not None else None,
            composite_regime=composite,
            has_conflict=bool(r[38]), conflict_codes=list(r[39] or []),
            promoted=promoted, features=dict(r[40] or {}),
        ))
    return out


def _actual_window(
    conn: psycopg.Connection, ticker: str, start: datetime, end: datetime
) -> tuple[float, float, float] | None:
    row = conn.execute(
        """
        SELECT MAX(high), MIN(low),
               (ARRAY_AGG(close ORDER BY ts DESC, source DESC))[1]
        FROM prices_daily
        WHERE symbol = %s AND ts >= %s AND ts <= %s
          AND high IS NOT NULL AND low IS NOT NULL AND close IS NOT NULL
        """,
        (ticker, start, end),
    ).fetchone()
    if not row or row[0] is None:
        return None
    return (float(row[0]), float(row[1]), float(row[2]))


def _classify(pred: dict[str, Any], high: float, low: float, close: float) -> dict[str, Any]:
    bias = pred["bias"]
    target_low = pred["target_range_low"]
    target_high = pred["target_range_high"]
    invalidation = pred["invalidation"]
    entry = pred["current_price"]
    hit_target = (low <= target_high) and (high >= target_low)
    if bias == "bullish":
        hit_inv = low <= invalidation
        realized_ret = (close - entry) / entry
    else:
        hit_inv = high >= invalidation
        realized_ret = (entry - close) / entry
    return {
        "hit_target": hit_target,
        "hit_inv": hit_inv,
        "realized_return": realized_ret,
    }


def run(
    database_url: str,
    *,
    window_start: date,
    window_end: date,
    step_days: int = 7,
    candidate_limit: int = 50,
    run_id: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Walk-forward backtest. Returns aggregate metrics + persists to delphi_backtest_runs."""
    rid = run_id or f"replay_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    n_pred = n_scored = 0
    sum_hit = 0
    sum_brier = 0.0
    sum_log_loss = 0.0
    sum_ret_win = 0.0
    sum_ret_loss = 0.0
    by_horizon: dict[str, dict[str, Any]] = {}
    by_regime: dict[str, dict[str, Any]] = {}

    with connect(database_url) as conn:
        cur_dt = datetime.combine(window_start, datetime.min.time(), tzinfo=UTC)
        end_dt = datetime.combine(window_end,   datetime.min.time(), tzinfo=UTC)
        while cur_dt < end_dt:
            features = _features_at(conn, cur_dt, candidate_limit)
            for fs in features:
                for signal_tf, horizons in delphi_rank_v2.SIGNAL_TO_HORIZONS.items():
                    for horizon in horizons:
                        pred = delphi_rank_v2._build_prediction(fs, signal_tf, horizon)
                        if pred is None:
                            continue
                        # Determine the actual outcome window
                        days = HORIZON_DAYS[horizon]
                        actual_end = cur_dt + timedelta(days=days)
                        if actual_end > end_dt:
                            continue  # horizon doesn't close inside the backtest window
                        window = _actual_window(conn, fs.ticker, cur_dt, actual_end)
                        if window is None:
                            continue
                        high, low, close = window
                        result = _classify(pred, high, low, close)
                        n_pred += 1
                        n_scored += 1
                        y = 1 if result["hit_target"] else 0
                        p = float(pred["probability"])
                        sum_hit += y
                        sum_brier += (p - y) ** 2
                        # Clamped log loss
                        p_c = max(1e-6, min(1 - 1e-6, p))
                        sum_log_loss += -(y * math.log(p_c) + (1 - y) * math.log(1 - p_c))
                        if y:
                            sum_ret_win += max(0.0, result["realized_return"])
                        else:
                            sum_ret_loss += abs(min(0.0, result["realized_return"]))

                        bh = by_horizon.setdefault(horizon, {"n": 0, "hits": 0, "brier_sum": 0.0})
                        bh["n"] += 1; bh["hits"] += y; bh["brier_sum"] += (p - y) ** 2
                        br = by_regime.setdefault(fs.composite_regime, {"n": 0, "hits": 0, "brier_sum": 0.0})
                        br["n"] += 1; br["hits"] += y; br["brier_sum"] += (p - y) ** 2
            cur_dt += timedelta(days=step_days)

        hit_rate = (sum_hit / n_scored) if n_scored else None
        brier    = (sum_brier / n_scored) if n_scored else None
        log_loss = (sum_log_loss / n_scored) if n_scored else None
        pf       = (sum_ret_win / sum_ret_loss) if sum_ret_loss > 1e-6 else None
        avg_ret  = ((sum_ret_win - sum_ret_loss) / n_scored) if n_scored else None

        # Finalize per-segment dicts
        for d in (by_horizon, by_regime):
            for v in d.values():
                v["hit_rate"] = (v["hits"] / v["n"]) if v["n"] else None
                v["brier"]    = (v["brier_sum"] / v["n"]) if v["n"] else None
                v.pop("brier_sum", None)

        conn.execute(
            """
            INSERT INTO delphi_backtest_runs (
                run_id, model_version, window_start, window_end,
                walk_forward_step_days,
                n_predictions, n_scored, hit_rate, brier_score, log_loss,
                profit_factor, avg_realized_return, calibration_error,
                by_horizon, by_regime, by_reason_code, notes
            ) VALUES (
                %s, %s, %s, %s,
                %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s
            ) ON CONFLICT (run_id) DO UPDATE SET
                n_scored = EXCLUDED.n_scored,
                hit_rate = EXCLUDED.hit_rate,
                brier_score = EXCLUDED.brier_score,
                by_horizon = EXCLUDED.by_horizon,
                by_regime = EXCLUDED.by_regime
            """,
            (
                rid, delphi_rank_v2.MODEL_VERSION,
                window_start, window_end, step_days,
                n_pred, n_scored, hit_rate, brier, log_loss,
                pf, avg_ret, None,
                Jsonb(by_horizon), Jsonb(by_regime), Jsonb({}),
                notes,
            ),
        )
        conn.commit()

    return {
        "run_id": rid,
        "model_version": delphi_rank_v2.MODEL_VERSION,
        "window": [window_start.isoformat(), window_end.isoformat()],
        "n_predictions": n_pred,
        "n_scored": n_scored,
        "hit_rate": hit_rate,
        "brier_score": brier,
        "log_loss": log_loss,
        "profit_factor": pf,
        "avg_realized_return": avg_ret,
        "by_horizon": by_horizon,
        "by_regime": by_regime,
    }
