"""Feature build orchestration: load prices/macro from DB, run cfp_features, upsert results.

Storage convention (DESIGN.md §5.3):
- Cross-asset features:  symbol='_MARKET_', feature_set='cross_asset_v1'
- Sector-target features: symbol=<ETF>,    feature_set='sector_v1'
- Lead-lag features per target: symbol=<ETF>, feature_set='lead_lag_v1'
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime, timedelta

import pandas as pd
import psycopg
from cfp_features import granger, panel
from cfp_features import pipeline as feat_pipeline
from cfp_shared.universe import PREDICTION_TARGETS, all_yfinance_symbols

from cfp_jobs.db import (
    connect,
    to_psycopg_url,
    upsert_features,
    upsert_lead_lag,
)

log = logging.getLogger(__name__)

MARKET_SENTINEL = "_MARKET_"
CROSS_ASSET_SET = "cross_asset_v1"
SECTOR_SET = "sector_v1"
LEAD_LAG_SET = "lead_lag_v1"


def _load_prices(conn: psycopg.Connection, since: datetime | None = None) -> pd.DataFrame:
    where = "WHERE ts >= %s" if since else ""
    args = (since,) if since else ()
    sql = f"""
        SELECT ts, symbol, open, high, low, close, volume
        FROM prices_daily
        {where}
        ORDER BY ts
    """
    with conn.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
        cols = [d.name for d in cur.description]
    return pd.DataFrame(rows, columns=cols)


def _load_macro(conn: psycopg.Connection, since: datetime | None = None) -> pd.DataFrame:
    where = "WHERE ts >= %s" if since else ""
    args = (since,) if since else ()
    sql = f"""
        SELECT ts, series_id, value
        FROM macro_daily
        {where}
        ORDER BY ts
    """
    with conn.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
        cols = [d.name for d in cur.description]
    return pd.DataFrame(rows, columns=cols)


def _row_to_payload(row: pd.Series) -> dict:
    """Drop NaN/inf and non-feature columns, return a plain dict for JSONB."""
    out: dict = {}
    for k, v in row.items():
        if k in {"ts", "symbol"}:
            continue
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isnan(f) or math.isinf(f):
            continue
        out[str(k)] = f
    return out


def _to_utc(ts: pd.Timestamp) -> datetime:
    py = ts.to_pydatetime() if isinstance(ts, pd.Timestamp) else ts
    return py if py.tzinfo else py.replace(tzinfo=UTC)


def cross_asset_to_rows(cross_df: pd.DataFrame) -> list[dict]:
    rows: list[dict] = []
    for ts, row in cross_df.iterrows():
        payload = _row_to_payload(row)
        if not payload:
            continue
        rows.append(
            {
                "ts": _to_utc(ts),
                "symbol": MARKET_SENTINEL,
                "feature_set": CROSS_ASSET_SET,
                "payload": payload,
            }
        )
    return rows


def sector_to_rows(sector_df: pd.DataFrame) -> list[dict]:
    rows: list[dict] = []
    for _, row in sector_df.iterrows():
        payload = _row_to_payload(row)
        if not payload:
            continue
        rows.append(
            {
                "ts": _to_utc(row["ts"]),
                "symbol": str(row["symbol"]),
                "feature_set": SECTOR_SET,
                "payload": payload,
            }
        )
    return rows


def build(database_url: str, since: datetime | None = None, only_recent_days: int | None = None) -> dict:
    """Compute and upsert features for the configured universe.

    Args:
        since: load DB rows from this date forward (None = full history).
            Rolling features need history, so for incremental refresh, load
            ~1 year and only upsert rows from the last `only_recent_days` days.
        only_recent_days: if set, only upsert features for ts >= now - N days.
    """
    with connect(database_url) as conn:
        prices = _load_prices(conn, since=since)
        macro = _load_macro(conn, since=since)

    if prices.empty:
        log.warning("features.build: no prices in DB; nothing to compute")
        return {"cross_asset": 0, "sector": 0}

    cross_df, sector_df = feat_pipeline.build(
        prices, macro, target_symbols=PREDICTION_TARGETS
    )

    if only_recent_days is not None:
        cutoff = datetime.now(UTC) - timedelta(days=only_recent_days)
        cross_df = cross_df.loc[cross_df.index >= pd.Timestamp(cutoff)]
        sector_df = sector_df.loc[pd.to_datetime(sector_df["ts"], utc=True) >= cutoff]

    cross_rows = cross_asset_to_rows(cross_df)
    sector_rows = sector_to_rows(sector_df)

    with connect(database_url) as conn:
        n_cross = upsert_features(conn, cross_rows)
        n_sector = upsert_features(conn, sector_rows)
        conn.commit()

    log.info(
        "features: cross_asset=%d sector=%d (latest=%s)",
        n_cross,
        n_sector,
        cross_df.index.max() if not cross_df.empty else "-",
    )
    return {"cross_asset": n_cross, "sector": n_sector}


def build_lead_lag(database_url: str, max_lag: int = 10, lookback: int = 252) -> int:
    """Compute the Granger lead-lag matrix and write to lead_lag_matrix + features_daily."""
    with connect(database_url) as conn:
        prices = _load_prices(conn)

    prices_wide = panel.prices_to_wide(prices, calendar_symbol="SPY")
    universe = all_yfinance_symbols()
    matrix = granger.compute_lead_lag(
        prices_wide,
        candidates=universe,
        targets=PREDICTION_TARGETS,
        max_lag=max_lag,
        lookback=lookback,
    )

    if matrix.empty:
        log.warning("lead_lag: no rows produced")
        return 0

    computed_ts = datetime.now(UTC)
    matrix_rows = [
        {
            "computed_ts": computed_ts,
            "leader": str(r.leader),
            "follower": str(r.follower),
            "max_lag": int(r.max_lag),
            "p_value": float(r.p_value),
        }
        for r in matrix.itertuples()
    ]

    # Also surface top-3 leaders per target into features_daily
    top = granger.top_leaders_per_target(matrix, k=3, alpha=0.05)
    feat_rows = [
        {
            "ts": computed_ts,
            "symbol": tgt,
            "feature_set": LEAD_LAG_SET,
            "payload": {"leaders": leaders, "max_lag": max_lag, "lookback": lookback},
        }
        for tgt, leaders in top.items()
        if leaders
    ]

    with connect(database_url) as conn:
        upsert_lead_lag(conn, matrix_rows)
        upsert_features(conn, feat_rows)
        conn.commit()

    log.info("lead_lag: %d pairs, %d targets with significant leaders", len(matrix_rows), len(feat_rows))
    return len(matrix_rows)


def status(database_url: str) -> pd.DataFrame:
    """Return per-feature-set row counts and freshness."""
    sql = """
        SELECT feature_set,
               COUNT(*) AS rows,
               MAX(ts)::text AS latest,
               COUNT(DISTINCT symbol) AS distinct_symbols
        FROM features_daily
        GROUP BY feature_set
        ORDER BY feature_set
    """
    with psycopg.connect(to_psycopg_url(database_url)) as conn, conn.cursor() as cur:
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)
