"""Intraday spot-GEX ingestion — migration 0028.

Pulls /stock/{ticker}/spot-exposures at 1-minute resolution and writes to
uw_spot_gex_intraday.

Two use-cases:
  - apps/gex monitor gets a verifiable UW-side second source (alongside the
    existing Heatseeker SSE feed).
  - /explosive scanner gets per-ticker GEX (not just SPY/QQQ/SPX) as a real
    confirmation signal — short-gamma at the OTM cluster = unstable regime,
    dealers chase = larger expected move on the underlying.

Per-ticker pull is one HTTP call returning today's full 1-min series. With
~80 tickers in the explosive universe that's 80 calls per ingest run. Run
once every 5 min during RTH (vs the existing apps/gex SPY/QQQ/SPX which
polls Heatseeker every few seconds).
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect
from cfp_jobs.ingestion.unusualwhales import (
    UwClient,
    _to_float,
    _to_ts,
)

log = logging.getLogger(__name__)


def _upsert_spot_gex_intraday(
    conn: psycopg.Connection,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    """One row per (ticker, minute). UW returns a list of minute-bucketed
    dicts; field names follow the existing /greek-exposure shape."""
    sql = """
        INSERT INTO uw_spot_gex_intraday (
            ticker, ts, underlying_price,
            total_gamma, total_delta, total_charm, total_vanna,
            call_gamma, put_gamma, call_delta, put_delta,
            strike_breakdown
        ) VALUES (
            %(ticker)s, %(ts)s, %(underlying_price)s,
            %(total_gamma)s, %(total_delta)s, %(total_charm)s, %(total_vanna)s,
            %(call_gamma)s, %(put_gamma)s, %(call_delta)s, %(put_delta)s,
            %(strike_breakdown)s
        ) ON CONFLICT (ticker, ts) DO UPDATE SET
            underlying_price = EXCLUDED.underlying_price,
            total_gamma = EXCLUDED.total_gamma,
            total_delta = EXCLUDED.total_delta,
            total_charm = EXCLUDED.total_charm,
            total_vanna = EXCLUDED.total_vanna,
            call_gamma = EXCLUDED.call_gamma,
            put_gamma = EXCLUDED.put_gamma,
            call_delta = EXCLUDED.call_delta,
            put_delta = EXCLUDED.put_delta,
            strike_breakdown = EXCLUDED.strike_breakdown,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("ts") or r.get("timestamp") or r.get("time"))
            if not ts:
                continue
            cur.execute(
                sql,
                {
                    "ticker": ticker,
                    "ts": ts,
                    "underlying_price": _to_float(r.get("underlying_price") or r.get("price")),
                    "total_gamma": _to_float(r.get("total_gamma") or r.get("gamma")),
                    "total_delta": _to_float(r.get("total_delta") or r.get("delta")),
                    "total_charm": _to_float(r.get("total_charm") or r.get("charm")),
                    "total_vanna": _to_float(r.get("total_vanna") or r.get("vanna")),
                    "call_gamma": _to_float(r.get("call_gamma")),
                    "put_gamma": _to_float(r.get("put_gamma")),
                    "call_delta": _to_float(r.get("call_delta")),
                    "put_delta": _to_float(r.get("put_delta")),
                    "strike_breakdown": Jsonb(r.get("strikes") or r.get("strike_breakdown") or {}),
                },
            )
            n += 1
    return n


def ingest_spot_gex_intraday(
    database_url: str,
    api_key: str,
    tickers: Iterable[str],
    target_date: date | None = None,
) -> dict[str, int]:
    """Pull today's 1-min spot-GEX series for each ticker. Idempotent on
    (ticker, ts) so safe to re-run mid-day."""
    out = {"tickers": 0, "rows": 0, "failed": 0}
    target_date = target_date or datetime.now(UTC).date()
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for ticker in tickers:
            ticker = ticker.strip().upper()
            if not ticker:
                continue
            out["tickers"] += 1
            try:
                rows = uw.spot_exposures_one_minute(ticker, target_date)
                if not rows:
                    continue
                with conn.transaction():
                    out["rows"] += _upsert_spot_gex_intraday(conn, ticker, rows)
            except Exception as e:  # noqa: BLE001
                log.warning("spot-gex ingest failed for %s: %s", ticker, e)
                out["failed"] += 1
        conn.commit()
    log.info("spot-gex intraday: %s", out)
    return out
