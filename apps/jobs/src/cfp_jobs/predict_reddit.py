"""Reddit-features ML predictor.

Trains a small XGBoost regressor on (reddit-mention-snapshot features +
price context) → 20-trading-day forward return, then writes one prediction
row per ticker for the latest snapshot into `reddit_predictions`.

Designed to be safe to run from day one:
  * If we have fewer than `_MIN_TRAIN_EVENTS` (date, ticker) pairs with
    matured 20d forward returns, training is skipped and predict() writes
    nothing. The /v1/reddit/predict endpoint then reports "calibrating".
  * If reddit_mentions is empty, the function exits early.

Run nightly after `cfp-jobs reddit` so the latest snapshot is included.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime
from typing import Any

import numpy as np
import pandas as pd
import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

MODEL_VERSION = "xgb_reddit_v1"

# Minimum number of (date, ticker) rows with matured 20d return required
# before we'll actually fit the model. Below this, predictions are
# treated as too noisy to publish.
_MIN_TRAIN_EVENTS = 200

# Matching horizon (28 calendar days ≈ 20 trading days). Picked to keep
# the lateral price joins cheap.
_HORIZON_DAYS = 28

# Feature columns the model trains on. Adding one? Update both
# _build_training_panel and _predict_features.
_FEATURE_COLS = [
    "mentions",
    "rank",
    "spike",
    "avg_7d",
    "wsb_share",
    "inv_share",
    "momentum_slope",
    "prior_30d_n",
    "price_5d_pct",
    "price_20d_pct",
    "rel_volume",
]


def _load_training_panel(conn: psycopg.Connection) -> pd.DataFrame:
    """Build the (snapshot_date, ticker) panel of features + forward 20d
    return. Only includes rows where the forward return has matured (i.e.
    snapshot_date <= today - 28 days)."""
    sql = """
        WITH bounds AS (
            SELECT MAX(snapshot_date) AS d_max FROM reddit_mentions
            WHERE subreddit='all-stocks'
        ),
        base AS (
            SELECT
                m.snapshot_date, m.ticker, m.mentions, m.rank,
                COALESCE((
                    SELECT AVG(mentions)::float FROM reddit_mentions
                    WHERE subreddit='all-stocks' AND ticker = m.ticker
                      AND snapshot_date BETWEEN m.snapshot_date - 7 AND m.snapshot_date - 1
                ), 0) AS avg_7d,
                COALESCE((
                    SELECT SUM(mentions)::float / NULLIF(SUM(SUM(mentions)) OVER (), 0)
                    FROM reddit_mentions sm
                    WHERE sm.snapshot_date = m.snapshot_date AND sm.ticker = m.ticker
                      AND sm.subreddit = 'wallstreetbets'
                    GROUP BY sm.snapshot_date, sm.ticker
                ), 0) AS wsb_share,
                COALESCE((
                    SELECT SUM(mentions)::float / NULLIF(SUM(SUM(mentions)) OVER (), 0)
                    FROM reddit_mentions sm
                    WHERE sm.snapshot_date = m.snapshot_date AND sm.ticker = m.ticker
                      AND sm.subreddit IN ('investing','stocks','SecurityAnalysis','ValueInvesting')
                    GROUP BY sm.snapshot_date, sm.ticker
                ), 0) AS inv_share,
                (
                    SELECT CASE
                        WHEN COUNT(*) < 3 OR AVG(mentions) = 0 THEN NULL
                        ELSE REGR_SLOPE(mentions::float, EXTRACT(EPOCH FROM snapshot_date) / 86400.0)
                             / NULLIF(AVG(mentions), 0)
                    END
                    FROM reddit_mentions
                    WHERE subreddit='all-stocks' AND ticker = m.ticker
                      AND snapshot_date BETWEEN m.snapshot_date - 6 AND m.snapshot_date
                ) AS momentum_slope,
                COALESCE((
                    SELECT COUNT(*)::int FROM reddit_mentions p
                    WHERE p.subreddit='all-stocks' AND p.ticker = m.ticker
                      AND p.snapshot_date BETWEEN m.snapshot_date - 30 AND m.snapshot_date - 1
                      AND p.rank IS NOT NULL AND p.rank <= 100
                ), 0) AS prior_30d_n
            FROM reddit_mentions m
            JOIN bounds b ON true
            WHERE m.subreddit='all-stocks'
              AND m.snapshot_date <= b.d_max - %s
              AND m.snapshot_date >= b.d_max - 365
        ),
        priced AS (
            SELECT b.*,
                   p0.close AS px0,
                   pf.close AS pxf,
                   p5.close AS px_5d_back,
                   p20.close AS px_20d_back,
                   v.avg_vol AS avg_vol,
                   pv.volume AS vol_today
            FROM base b
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) p0 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date + %s
                ORDER BY ts DESC LIMIT 1
            ) pf ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date - 5
                ORDER BY ts DESC LIMIT 1
            ) p5 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date - 20
                ORDER BY ts DESC LIMIT 1
            ) p20 ON true
            LEFT JOIN LATERAL (
                SELECT AVG(volume)::float AS avg_vol FROM prices_daily
                WHERE symbol = b.ticker
                  AND ts::date BETWEEN b.snapshot_date - 30 AND b.snapshot_date - 1
            ) v ON true
            LEFT JOIN LATERAL (
                SELECT volume FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) pv ON true
        )
        SELECT
            snapshot_date, ticker, mentions, rank, avg_7d,
            (mentions::float / NULLIF(avg_7d, 0)) AS spike,
            wsb_share, inv_share, momentum_slope, prior_30d_n,
            CASE WHEN px_5d_back > 0 THEN (px0 - px_5d_back) / px_5d_back * 100.0 END AS price_5d_pct,
            CASE WHEN px_20d_back > 0 THEN (px0 - px_20d_back) / px_20d_back * 100.0 END AS price_20d_pct,
            CASE WHEN avg_vol > 0 THEN vol_today::float / avg_vol END AS rel_volume,
            CASE WHEN px0 > 0 AND pxf IS NOT NULL THEN (pxf - px0) / px0 * 100.0 END AS ret_20d
        FROM priced
        WHERE px0 IS NOT NULL AND pxf IS NOT NULL
    """
    with conn.cursor() as cur:
        cur.execute(sql, (_HORIZON_DAYS, _HORIZON_DAYS))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=cols)
    return df


def _load_predict_panel(conn: psycopg.Connection) -> pd.DataFrame:
    """Build the feature panel for *today's* snapshot only, with no
    forward-return column. These are the rows we'll write predictions for."""
    # Reuses the same logic as the training panel but anchored at the
    # latest snapshot_date with no horizon-maturity cutoff.
    sql = """
        WITH bounds AS (
            SELECT MAX(snapshot_date) AS d_max FROM reddit_mentions
            WHERE subreddit='all-stocks'
        ),
        base AS (
            SELECT
                m.snapshot_date, m.ticker, m.mentions, m.rank,
                COALESCE((
                    SELECT AVG(mentions)::float FROM reddit_mentions
                    WHERE subreddit='all-stocks' AND ticker = m.ticker
                      AND snapshot_date BETWEEN m.snapshot_date - 7 AND m.snapshot_date - 1
                ), 0) AS avg_7d,
                COALESCE((
                    SELECT SUM(mentions)::float / NULLIF(SUM(SUM(mentions)) OVER (), 0)
                    FROM reddit_mentions sm
                    WHERE sm.snapshot_date = m.snapshot_date AND sm.ticker = m.ticker
                      AND sm.subreddit = 'wallstreetbets'
                    GROUP BY sm.snapshot_date, sm.ticker
                ), 0) AS wsb_share,
                COALESCE((
                    SELECT SUM(mentions)::float / NULLIF(SUM(SUM(mentions)) OVER (), 0)
                    FROM reddit_mentions sm
                    WHERE sm.snapshot_date = m.snapshot_date AND sm.ticker = m.ticker
                      AND sm.subreddit IN ('investing','stocks','SecurityAnalysis','ValueInvesting')
                    GROUP BY sm.snapshot_date, sm.ticker
                ), 0) AS inv_share,
                (
                    SELECT CASE
                        WHEN COUNT(*) < 3 OR AVG(mentions) = 0 THEN NULL
                        ELSE REGR_SLOPE(mentions::float, EXTRACT(EPOCH FROM snapshot_date) / 86400.0)
                             / NULLIF(AVG(mentions), 0)
                    END
                    FROM reddit_mentions
                    WHERE subreddit='all-stocks' AND ticker = m.ticker
                      AND snapshot_date BETWEEN m.snapshot_date - 6 AND m.snapshot_date
                ) AS momentum_slope,
                COALESCE((
                    SELECT COUNT(*)::int FROM reddit_mentions p
                    WHERE p.subreddit='all-stocks' AND p.ticker = m.ticker
                      AND p.snapshot_date BETWEEN m.snapshot_date - 30 AND m.snapshot_date - 1
                      AND p.rank IS NOT NULL AND p.rank <= 100
                ), 0) AS prior_30d_n
            FROM reddit_mentions m
            JOIN bounds b ON true
            WHERE m.subreddit='all-stocks' AND m.snapshot_date = b.d_max
        ),
        priced AS (
            SELECT b.*,
                   p0.close AS px0,
                   p5.close AS px_5d_back,
                   p20.close AS px_20d_back,
                   v.avg_vol AS avg_vol,
                   pv.volume AS vol_today
            FROM base b
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) p0 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date - 5
                ORDER BY ts DESC LIMIT 1
            ) p5 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date - 20
                ORDER BY ts DESC LIMIT 1
            ) p20 ON true
            LEFT JOIN LATERAL (
                SELECT AVG(volume)::float AS avg_vol FROM prices_daily
                WHERE symbol = b.ticker
                  AND ts::date BETWEEN b.snapshot_date - 30 AND b.snapshot_date - 1
            ) v ON true
            LEFT JOIN LATERAL (
                SELECT volume FROM prices_daily
                WHERE symbol = b.ticker AND ts::date <= b.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) pv ON true
        )
        SELECT
            snapshot_date, ticker, mentions, rank, avg_7d,
            (mentions::float / NULLIF(avg_7d, 0)) AS spike,
            wsb_share, inv_share, momentum_slope, prior_30d_n,
            CASE WHEN px_5d_back > 0 THEN (px0 - px_5d_back) / px_5d_back * 100.0 END AS price_5d_pct,
            CASE WHEN px_20d_back > 0 THEN (px0 - px_20d_back) / px_20d_back * 100.0 END AS price_20d_pct,
            CASE WHEN avg_vol > 0 THEN vol_today::float / avg_vol END AS rel_volume
        FROM priced
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def _prep(df: pd.DataFrame) -> pd.DataFrame:
    """Replace NaNs in feature columns with column medians (or 0). Models
    don't see NaN as 'unknown' — they see it as a column-typed NULL that
    breaks fitting. Medians keep the row in the training set."""
    out = df.copy()
    for col in _FEATURE_COLS:
        if col not in out.columns:
            out[col] = 0.0
        else:
            med = out[col].median() if out[col].notna().any() else 0.0
            out[col] = out[col].fillna(med if pd.notna(med) else 0.0)
    return out


def _train_model(df: pd.DataFrame) -> Any | None:
    """Fit an XGB regressor on the panel. Returns None if there's not
    enough data to train responsibly."""
    df = df[df["ret_20d"].notna()].copy()
    if len(df) < _MIN_TRAIN_EVENTS:
        log.info(
            "reddit-predict: skipping training — %d matured rows < %d threshold",
            len(df), _MIN_TRAIN_EVENTS,
        )
        return None

    # Import here so the predict module doesn't drag xgboost into every
    # other cfp-jobs command's startup path.
    import xgboost as xgb  # noqa: PLC0415

    df = _prep(df)
    X = df[_FEATURE_COLS].to_numpy(dtype=np.float64)
    y = df["ret_20d"].to_numpy(dtype=np.float64)

    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=1.5,
        objective="reg:squarederror",
        verbosity=0,
        n_jobs=-1,
    )
    model.fit(X, y)
    log.info("reddit-predict: trained on %d rows", len(df))
    return model


def _predict_and_upsert(
    conn: psycopg.Connection,
    model: Any,
    today_panel: pd.DataFrame,
) -> int:
    """Score today's snapshot and upsert into reddit_predictions."""
    if today_panel.empty:
        return 0
    df = _prep(today_panel)
    X = df[_FEATURE_COLS].to_numpy(dtype=np.float64)
    preds = model.predict(X)

    # Calibrate to 0..100 score via percentile rank within this snapshot.
    # Anchors the UI badge regardless of the model's raw output scale.
    order = preds.argsort()
    ranks = np.empty_like(order)
    ranks[order] = np.arange(len(preds))
    scores = ranks / max(1, len(preds) - 1) * 100.0

    trained_at = datetime.now(UTC)
    sql = """
        INSERT INTO reddit_predictions
            (snapshot_date, ticker, model_version, pred_return_20d, pred_score, features, trained_at)
        VALUES
            (%s, %s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (snapshot_date, ticker, model_version) DO UPDATE SET
            pred_return_20d = EXCLUDED.pred_return_20d,
            pred_score = EXCLUDED.pred_score,
            features = EXCLUDED.features,
            trained_at = EXCLUDED.trained_at
    """
    n = 0
    with conn.cursor() as cur:
        for i, (_, row) in enumerate(df.iterrows()):
            feats: dict[str, Any] = {c: _to_jsonable(row[c]) for c in _FEATURE_COLS}
            cur.execute(sql, (
                row["snapshot_date"],
                row["ticker"],
                MODEL_VERSION,
                float(preds[i]),
                float(scores[i]),
                json.dumps(feats),
                trained_at,
            ))
            n += 1
    conn.commit()
    return n


def _to_jsonable(v: Any) -> Any:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, (np.floating, np.integer)):
        return v.item()
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def run(database_url: str) -> dict:
    """Entry point for `cfp-jobs reddit-predict`. Trains a model on
    matured snapshots and emits predictions for the latest one. Safe to
    run with no data — returns a calibrating-status dict."""
    with connect(database_url) as conn:
        train_panel = _load_training_panel(conn)
        n_matured = int(train_panel["ret_20d"].notna().sum()) if not train_panel.empty else 0

        if n_matured < _MIN_TRAIN_EVENTS:
            return {
                "status": "calibrating",
                "matured_events": n_matured,
                "threshold": _MIN_TRAIN_EVENTS,
                "predictions_written": 0,
                "model_version": MODEL_VERSION,
            }

        model = _train_model(train_panel)
        if model is None:
            return {
                "status": "calibrating",
                "matured_events": n_matured,
                "predictions_written": 0,
                "model_version": MODEL_VERSION,
            }

        today_panel = _load_predict_panel(conn)
        n_pred = _predict_and_upsert(conn, model, today_panel)
        return {
            "status": "ok",
            "matured_events": n_matured,
            "predictions_written": n_pred,
            "model_version": MODEL_VERSION,
        }
