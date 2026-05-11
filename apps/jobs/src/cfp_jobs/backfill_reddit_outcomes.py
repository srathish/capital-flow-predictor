"""Reddit outcome backfill.

Fills `realized_return_20d` (and for posts, also `_5d`) on rows whose anchor
date is far enough in the past that the forward-return window has matured.
A pred made on 2026-04-01 becomes scoreable around 2026-04-29 (~20 trading
days ≈ 28 calendar days). Until then the realized column stays NULL.

Idempotent: only rows where the column is still NULL are touched. Safe to
run multiple times per day; cheap when caught up.

Run nightly via `cfp-jobs reddit-backfill-outcomes` after the daily price
ingest so the new prices_daily rows are available for the lookup.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

# Use 28 calendar days as a stand-in for ~20 trading days, matching the
# horizon the predictor itself trains against.
_HORIZON_20D_CAL = 28
_HORIZON_5D_CAL = 7


def _backfill_predictions(conn: psycopg.Connection) -> int:
    """For every reddit_predictions row whose snapshot_date + 28 days is in
    the past, compute (px_after - px_now) / px_now * 100 and write it back.
    Returns the number of rows updated."""
    sql = """
        WITH unrealized AS (
            SELECT snapshot_date, ticker, model_version
            FROM reddit_predictions
            WHERE realized_return_20d IS NULL
              AND snapshot_date <= CURRENT_DATE - %s
        ),
        priced AS (
            SELECT u.snapshot_date, u.ticker, u.model_version,
                   p0.close AS px0,
                   pf.close AS pxf
            FROM unrealized u
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = u.ticker AND ts::date <= u.snapshot_date
                ORDER BY ts DESC LIMIT 1
            ) p0 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = u.ticker AND ts::date <= u.snapshot_date + %s
                ORDER BY ts DESC LIMIT 1
            ) pf ON true
        )
        UPDATE reddit_predictions r
        SET realized_return_20d = CASE
                WHEN p.px0 IS NOT NULL AND p.px0 > 0 AND p.pxf IS NOT NULL
                    THEN (p.pxf - p.px0) / p.px0 * 100.0
                ELSE NULL
            END,
            realized_at = %s
        FROM priced p
        WHERE r.snapshot_date = p.snapshot_date
          AND r.ticker = p.ticker
          AND r.model_version = p.model_version
          AND p.px0 IS NOT NULL
          AND p.pxf IS NOT NULL
    """
    now = datetime.now(UTC)
    with conn.cursor() as cur:
        cur.execute(sql, (_HORIZON_20D_CAL, _HORIZON_20D_CAL, now))
        n = cur.rowcount or 0
    conn.commit()
    return n


def _backfill_posts(conn: psycopg.Connection) -> int:
    """Compute 5d + 20d realized returns on each post's primary_ticker, anchored
    at the post's created_at date. Skips posts with no primary_ticker."""
    sql = """
        WITH unrealized AS (
            SELECT id, primary_ticker, created_at::date AS d0
            FROM reddit_posts
            WHERE realized_return_20d IS NULL
              AND primary_ticker IS NOT NULL
              AND created_at::date <= CURRENT_DATE - %s
        ),
        priced AS (
            SELECT u.id,
                   p0.close AS px0,
                   p5.close AS px5,
                   pf.close AS pxf
            FROM unrealized u
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = u.primary_ticker AND ts::date <= u.d0
                ORDER BY ts DESC LIMIT 1
            ) p0 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = u.primary_ticker AND ts::date <= u.d0 + %s
                ORDER BY ts DESC LIMIT 1
            ) p5 ON true
            LEFT JOIN LATERAL (
                SELECT close FROM prices_daily
                WHERE symbol = u.primary_ticker AND ts::date <= u.d0 + %s
                ORDER BY ts DESC LIMIT 1
            ) pf ON true
        )
        UPDATE reddit_posts r
        SET realized_return_5d = CASE
                WHEN p.px0 IS NOT NULL AND p.px0 > 0 AND p.px5 IS NOT NULL
                    THEN (p.px5 - p.px0) / p.px0 * 100.0
                ELSE NULL
            END,
            realized_return_20d = CASE
                WHEN p.px0 IS NOT NULL AND p.px0 > 0 AND p.pxf IS NOT NULL
                    THEN (p.pxf - p.px0) / p.px0 * 100.0
                ELSE NULL
            END,
            realized_at = %s
        FROM priced p
        WHERE r.id = p.id
          AND p.px0 IS NOT NULL
          AND p.pxf IS NOT NULL
    """
    now = datetime.now(UTC)
    with conn.cursor() as cur:
        cur.execute(sql, (_HORIZON_20D_CAL, _HORIZON_5D_CAL, _HORIZON_20D_CAL, now))
        n = cur.rowcount or 0
    conn.commit()
    return n


def _ensure_primary_tickers(conn: psycopg.Connection) -> int:
    """Newly-ingested posts may not have primary_ticker set yet — the column
    was added by migration 0013 with a one-shot UPDATE. Top it up here so new
    posts become scoreable on their first backfill pass."""
    sql = """
        UPDATE reddit_posts
        SET primary_ticker = tickers[1]
        WHERE primary_ticker IS NULL
          AND COALESCE(array_length(tickers, 1), 0) >= 1
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        n = cur.rowcount or 0
    conn.commit()
    return n


def run(database_url: str) -> dict:
    """Entry point for `cfp-jobs reddit-backfill-outcomes`."""
    with connect(database_url) as conn:
        n_primary = _ensure_primary_tickers(conn)
        n_preds = _backfill_predictions(conn)
        n_posts = _backfill_posts(conn)
        log.info(
            "reddit-backfill-outcomes: primary_ticker=%d preds=%d posts=%d",
            n_primary, n_preds, n_posts,
        )
        return {
            "primary_tickers_set": n_primary,
            "predictions_realized": n_preds,
            "posts_realized": n_posts,
        }
