"""FRED macro series ingestion.

Idempotent: upsert by (ts, series_id).
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime

import pandas as pd
from fredapi import Fred

from cfp_jobs.db import connect, upsert_macro

log = logging.getLogger(__name__)


def _normalize_ts(ts: pd.Timestamp) -> datetime:
    py = ts.to_pydatetime()
    if py.tzinfo is None:
        return py.replace(tzinfo=UTC)
    return py.astimezone(UTC)


def fetch_series(api_key: str, series_id: str, start: datetime) -> list[dict]:
    fred = Fred(api_key=api_key)
    data = fred.get_series(series_id, observation_start=start.date().isoformat())
    rows: list[dict] = []
    for ts, value in data.items():
        if value is None:
            continue
        try:
            f = float(value)
        except (TypeError, ValueError):
            continue
        if math.isnan(f):
            continue
        rows.append(
            {
                "ts": _normalize_ts(ts),
                "series_id": series_id,
                "value": f,
            }
        )
    return rows


def ingest(
    database_url: str,
    api_key: str,
    series: list[str],
    start: datetime,
) -> int:
    if not api_key:
        raise RuntimeError("FRED_API_KEY not configured")

    total = 0
    with connect(database_url) as conn:
        for series_id in series:
            rows = fetch_series(api_key, series_id, start)
            n = upsert_macro(conn, rows)
            total += n
            log.info("FRED %s: upserted %d rows", series_id, n)
        conn.commit()
    return total
