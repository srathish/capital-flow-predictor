from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.types.json import Jsonb


def to_psycopg_url(url: str) -> str:
    """psycopg accepts the standard `postgresql://` URL; strip async driver suffix if present."""
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(to_psycopg_url(database_url)) as conn:
        yield conn


PRICE_UPSERT = """
INSERT INTO prices_daily (ts, symbol, open, high, low, close, volume, source)
VALUES (%(ts)s, %(symbol)s, %(open)s, %(high)s, %(low)s, %(close)s, %(volume)s, %(source)s)
ON CONFLICT (ts, symbol, source) DO UPDATE SET
    open   = EXCLUDED.open,
    high   = EXCLUDED.high,
    low    = EXCLUDED.low,
    close  = EXCLUDED.close,
    volume = EXCLUDED.volume
"""

MACRO_UPSERT = """
INSERT INTO macro_daily (ts, series_id, value)
VALUES (%(ts)s, %(series_id)s, %(value)s)
ON CONFLICT (ts, series_id) DO UPDATE SET value = EXCLUDED.value
"""


def upsert_prices(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(PRICE_UPSERT, rows)
    return len(rows)


def upsert_macro(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(MACRO_UPSERT, rows)
    return len(rows)


FEATURE_UPSERT = """
INSERT INTO features_daily (ts, symbol, feature_set, payload)
VALUES (%(ts)s, %(symbol)s, %(feature_set)s, %(payload)s)
ON CONFLICT (ts, symbol, feature_set) DO UPDATE SET payload = EXCLUDED.payload
"""

LEAD_LAG_UPSERT = """
INSERT INTO lead_lag_matrix (computed_ts, leader, follower, max_lag, p_value)
VALUES (%(computed_ts)s, %(leader)s, %(follower)s, %(max_lag)s, %(p_value)s)
ON CONFLICT (computed_ts, leader, follower, max_lag) DO UPDATE SET p_value = EXCLUDED.p_value
"""


def upsert_features(conn: psycopg.Connection, rows: list[dict]) -> int:
    """Upsert feature rows. `payload` field in each row must be a dict; wrapped as JSONB."""
    if not rows:
        return 0
    prepared = [
        {**r, "payload": Jsonb(r["payload"]) if not isinstance(r["payload"], Jsonb) else r["payload"]}
        for r in rows
    ]
    with conn.cursor() as cur:
        cur.executemany(FEATURE_UPSERT, prepared)
    return len(rows)


def upsert_lead_lag(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(LEAD_LAG_UPSERT, rows)
    return len(rows)


HOLDINGS_UPSERT = """
INSERT INTO sector_holdings (sector_etf, constituent, weight, last_updated, source)
VALUES (%(sector_etf)s, %(constituent)s, %(weight)s, %(last_updated)s, %(source)s)
ON CONFLICT (sector_etf, constituent) DO UPDATE SET
    weight = EXCLUDED.weight,
    last_updated = EXCLUDED.last_updated,
    source = EXCLUDED.source
"""

FUNDAMENTALS_UPSERT = """
INSERT INTO fundamentals
    (ticker, fiscal_period, period_type, metric, value, source, last_fetched)
VALUES
    (%(ticker)s, %(fiscal_period)s, %(period_type)s, %(metric)s, %(value)s,
     %(source)s, %(last_fetched)s)
ON CONFLICT (ticker, fiscal_period, period_type, metric, source) DO UPDATE SET
    value = EXCLUDED.value,
    last_fetched = EXCLUDED.last_fetched
"""


def upsert_holdings(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(HOLDINGS_UPSERT, rows)
    return len(rows)


ETF_BREADTH_UPSERT = """
INSERT INTO etf_breadth_snapshots (
    etf, snapshot_date, n_constituents,
    pct_up_1d, weighted_ret_1d,
    pct_within_5pct_52w_high, pct_within_5pct_52w_low, median_dist_52w_high,
    bullish_premium_share, call_put_premium_ratio,
    last_fetched
) VALUES (
    %(etf)s, %(snapshot_date)s, %(n_constituents)s,
    %(pct_up_1d)s, %(weighted_ret_1d)s,
    %(pct_within_5pct_52w_high)s, %(pct_within_5pct_52w_low)s, %(median_dist_52w_high)s,
    %(bullish_premium_share)s, %(call_put_premium_ratio)s,
    %(last_fetched)s
) ON CONFLICT (etf, snapshot_date) DO UPDATE SET
    n_constituents = EXCLUDED.n_constituents,
    pct_up_1d = EXCLUDED.pct_up_1d,
    weighted_ret_1d = EXCLUDED.weighted_ret_1d,
    pct_within_5pct_52w_high = EXCLUDED.pct_within_5pct_52w_high,
    pct_within_5pct_52w_low = EXCLUDED.pct_within_5pct_52w_low,
    median_dist_52w_high = EXCLUDED.median_dist_52w_high,
    bullish_premium_share = EXCLUDED.bullish_premium_share,
    call_put_premium_ratio = EXCLUDED.call_put_premium_ratio,
    last_fetched = EXCLUDED.last_fetched
"""


def upsert_etf_breadth(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(ETF_BREADTH_UPSERT, rows)
    return len(rows)


def upsert_fundamentals(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(FUNDAMENTALS_UPSERT, rows)
    return len(rows)


WATCHLIST_UPSERT = """
INSERT INTO watchlists
    (run_ts, sector, ticker, rank, final_signal, final_confidence, target_weight, rationale)
VALUES
    (%(run_ts)s, %(sector)s, %(ticker)s, %(rank)s, %(final_signal)s,
     %(final_confidence)s, %(target_weight)s, %(rationale)s)
ON CONFLICT (run_ts, sector, ticker) DO UPDATE SET
    rank = EXCLUDED.rank,
    final_signal = EXCLUDED.final_signal,
    final_confidence = EXCLUDED.final_confidence,
    target_weight = EXCLUDED.target_weight,
    rationale = EXCLUDED.rationale
"""


def upsert_watchlist(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    prepared = [
        {**r, "rationale": Jsonb(r["rationale"]) if not isinstance(r["rationale"], Jsonb) else r["rationale"]}
        for r in rows
    ]
    with conn.cursor() as cur:
        cur.executemany(WATCHLIST_UPSERT, prepared)
    return len(rows)
