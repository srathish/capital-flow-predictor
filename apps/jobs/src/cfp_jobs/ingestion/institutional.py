"""Institutional flow ingestion — migration 0029.

Smart-money confirmation layer. Pulls:
  /institution/activity                 -> uw_institution_activity
  /institution/latest-filings           -> uw_institution_latest_filings
  /stock/{ticker}/ownership             -> uw_stock_ownership
  /market/insider-buy-sells             -> uw_market_insider_buy_sells
  /stock/{ticker}/insider-buy-sells     -> uw_stock_insider_buy_sells

(/institution/{name}/holdings is reserved for on-demand backfills; the
firehose alone is enough for the explosive scanner's purposes.)

Three entrypoints:
  - ingest_market_institutional: market-wide feeds (activity firehose, latest
    13F filings, market-wide insider buy/sell aggregates)
  - ingest_per_ticker_institutional: per-ticker ownership + insider buy/sell
    for the explosive universe
  - ingest_institution_holdings: targeted backfill for a single institution
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect
from cfp_jobs.ingestion.unusualwhales import (
    UwClient,
    _to_date,
    _to_float,
    _to_int,
)

log = logging.getLogger(__name__)


def _activity_id(r: dict) -> str | None:
    """Use UW's id if provided; otherwise hash the natural key so dedup works."""
    aid = r.get("id") or r.get("activity_id") or r.get("uid")
    if aid:
        return str(aid)
    inst = r.get("institution_name") or r.get("name")
    tic = r.get("ticker") or r.get("symbol")
    fd = r.get("filing_date") or r.get("date")
    act = r.get("action") or r.get("type")
    sh = r.get("shares") or r.get("share_count")
    if not (inst and tic and fd):
        return None
    raw = f"{inst}|{tic}|{fd}|{act}|{sh}"
    return hashlib.sha1(raw.encode()).hexdigest()


# ---------- institution activity ------------------------------------------


def _upsert_institution_activity(
    conn: psycopg.Connection,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_institution_activity (
            activity_id, institution_name, ticker, action,
            shares, shares_change, value_usd, price,
            filing_date, report_date, payload
        ) VALUES (
            %(activity_id)s, %(institution_name)s, %(ticker)s, %(action)s,
            %(shares)s, %(shares_change)s, %(value_usd)s, %(price)s,
            %(filing_date)s, %(report_date)s, %(payload)s
        ) ON CONFLICT (activity_id) DO UPDATE SET
            shares = EXCLUDED.shares,
            shares_change = EXCLUDED.shares_change,
            value_usd = EXCLUDED.value_usd,
            price = EXCLUDED.price,
            payload = EXCLUDED.payload,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            aid = _activity_id(r)
            inst = r.get("institution_name") or r.get("name")
            ticker = (r.get("ticker") or r.get("symbol") or "").strip().upper()
            if not aid or not inst or not ticker:
                continue
            action = (r.get("action") or r.get("type") or "unknown").lower()
            cur.execute(
                sql,
                {
                    "activity_id": aid,
                    "institution_name": inst,
                    "ticker": ticker,
                    "action": action,
                    "shares": _to_int(r.get("shares") or r.get("share_count")),
                    "shares_change": _to_int(r.get("shares_change") or r.get("change")),
                    "value_usd": _to_float(r.get("value") or r.get("value_usd") or r.get("market_value")),
                    "price": _to_float(r.get("price") or r.get("average_price")),
                    "filing_date": _to_date(r.get("filing_date") or r.get("date")),
                    "report_date": _to_date(r.get("report_date") or r.get("period")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


# ---------- institution latest filings ------------------------------------


def _upsert_institution_latest_filings(
    conn: psycopg.Connection,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_institution_latest_filings (
            institution_name, filing_date, report_date, filing_type,
            total_value_usd, position_count
        ) VALUES (
            %(institution_name)s, %(filing_date)s, %(report_date)s, %(filing_type)s,
            %(total_value_usd)s, %(position_count)s
        ) ON CONFLICT (institution_name, filing_date) DO UPDATE SET
            report_date = EXCLUDED.report_date,
            filing_type = EXCLUDED.filing_type,
            total_value_usd = EXCLUDED.total_value_usd,
            position_count = EXCLUDED.position_count,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            inst = r.get("institution_name") or r.get("name")
            fd = _to_date(r.get("filing_date") or r.get("date"))
            rd = _to_date(r.get("report_date") or r.get("period"))
            if not inst or not fd or not rd:
                continue
            cur.execute(
                sql,
                {
                    "institution_name": inst,
                    "filing_date": fd,
                    "report_date": rd,
                    "filing_type": r.get("filing_type") or r.get("form_type") or "13F-HR",
                    "total_value_usd": _to_float(r.get("total_value") or r.get("total_value_usd")),
                    "position_count": _to_int(r.get("position_count") or r.get("positions")),
                },
            )
            n += 1
    return n


# ---------- institution holdings ------------------------------------------


def _upsert_institution_holdings(
    conn: psycopg.Connection,
    institution_name: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_institution_holdings (
            institution_name, ticker, report_date,
            shares, value_usd, portfolio_pct,
            shares_change, shares_change_pct
        ) VALUES (
            %(institution_name)s, %(ticker)s, %(report_date)s,
            %(shares)s, %(value_usd)s, %(portfolio_pct)s,
            %(shares_change)s, %(shares_change_pct)s
        ) ON CONFLICT (institution_name, ticker, report_date) DO UPDATE SET
            shares = EXCLUDED.shares,
            value_usd = EXCLUDED.value_usd,
            portfolio_pct = EXCLUDED.portfolio_pct,
            shares_change = EXCLUDED.shares_change,
            shares_change_pct = EXCLUDED.shares_change_pct,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ticker = (r.get("ticker") or r.get("symbol") or "").strip().upper()
            rd = _to_date(r.get("report_date") or r.get("period"))
            if not ticker or not rd:
                continue
            cur.execute(
                sql,
                {
                    "institution_name": institution_name,
                    "ticker": ticker,
                    "report_date": rd,
                    "shares": _to_int(r.get("shares") or r.get("share_count")),
                    "value_usd": _to_float(r.get("value") or r.get("value_usd")),
                    "portfolio_pct": _to_float(r.get("portfolio_pct") or r.get("portfolio_percent")),
                    "shares_change": _to_int(r.get("shares_change") or r.get("change")),
                    "shares_change_pct": _to_float(r.get("shares_change_pct") or r.get("change_pct")),
                },
            )
            n += 1
    return n


# ---------- stock ownership -----------------------------------------------


def _upsert_stock_ownership(
    conn: psycopg.Connection,
    ticker: str,
    body: dict | list | None,
) -> int:
    """UW returns either a single rollup dict or a timeseries list. We
    accept both and normalize."""
    if not body:
        return 0
    rows: list[dict]
    if isinstance(body, dict):
        rows = [body]
    elif isinstance(body, list):
        rows = body
    else:
        return 0
    sql = """
        INSERT INTO uw_stock_ownership (
            ticker, snapshot_date,
            institutional_pct, insider_pct, float_pct,
            institution_count, top_holders
        ) VALUES (
            %(ticker)s, %(snapshot_date)s,
            %(institutional_pct)s, %(insider_pct)s, %(float_pct)s,
            %(institution_count)s, %(top_holders)s
        ) ON CONFLICT (ticker, snapshot_date) DO UPDATE SET
            institutional_pct = EXCLUDED.institutional_pct,
            insider_pct = EXCLUDED.insider_pct,
            float_pct = EXCLUDED.float_pct,
            institution_count = EXCLUDED.institution_count,
            top_holders = EXCLUDED.top_holders,
            fetched_at = NOW()
    """
    n = 0
    today = datetime.now(UTC).date()
    with conn.cursor() as cur:
        for r in rows:
            snap = _to_date(r.get("snapshot_date") or r.get("date")) or today
            cur.execute(
                sql,
                {
                    "ticker": ticker,
                    "snapshot_date": snap,
                    "institutional_pct": _to_float(r.get("institutional_percent") or r.get("institutional_pct")),
                    "insider_pct": _to_float(r.get("insider_percent") or r.get("insider_pct")),
                    "float_pct": _to_float(r.get("float_percent") or r.get("float_pct")),
                    "institution_count": _to_int(r.get("institution_count") or r.get("institutions")),
                    "top_holders": Jsonb(r.get("top_holders") or r.get("holders") or []),
                },
            )
            n += 1
    return n


# ---------- insider buy/sell rollups --------------------------------------


def _upsert_insider_buy_sells(
    conn: psycopg.Connection,
    table: str,
    ticker: str | None,
    rows: Iterable[dict],
) -> int:
    """Single helper covers both market-wide (table='uw_market_insider_buy_sells')
    and per-ticker (table='uw_stock_insider_buy_sells', ticker required)."""
    if table == "uw_stock_insider_buy_sells":
        sql = """
            INSERT INTO uw_stock_insider_buy_sells (
                ticker, snapshot_date, window_days,
                buy_count, sell_count, buy_value_usd, sell_value_usd, net_value_usd
            ) VALUES (
                %(ticker)s, %(snapshot_date)s, %(window_days)s,
                %(buy_count)s, %(sell_count)s, %(buy_value_usd)s, %(sell_value_usd)s, %(net_value_usd)s
            ) ON CONFLICT (ticker, snapshot_date, window_days) DO UPDATE SET
                buy_count = EXCLUDED.buy_count,
                sell_count = EXCLUDED.sell_count,
                buy_value_usd = EXCLUDED.buy_value_usd,
                sell_value_usd = EXCLUDED.sell_value_usd,
                net_value_usd = EXCLUDED.net_value_usd,
                fetched_at = NOW()
        """
    else:
        sql = """
            INSERT INTO uw_market_insider_buy_sells (
                snapshot_date, window_days,
                buy_count, sell_count, buy_value_usd, sell_value_usd, net_value_usd
            ) VALUES (
                %(snapshot_date)s, %(window_days)s,
                %(buy_count)s, %(sell_count)s, %(buy_value_usd)s, %(sell_value_usd)s, %(net_value_usd)s
            ) ON CONFLICT (snapshot_date, window_days) DO UPDATE SET
                buy_count = EXCLUDED.buy_count,
                sell_count = EXCLUDED.sell_count,
                buy_value_usd = EXCLUDED.buy_value_usd,
                sell_value_usd = EXCLUDED.sell_value_usd,
                net_value_usd = EXCLUDED.net_value_usd,
                fetched_at = NOW()
        """
    today = datetime.now(UTC).date()
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            wd = _to_int(r.get("window_days") or r.get("window") or r.get("days"))
            if wd is None:
                continue
            params = {
                "snapshot_date": _to_date(r.get("snapshot_date") or r.get("date")) or today,
                "window_days": wd,
                "buy_count": _to_int(r.get("buy_count") or r.get("buys")),
                "sell_count": _to_int(r.get("sell_count") or r.get("sells")),
                "buy_value_usd": _to_float(r.get("buy_value") or r.get("buy_value_usd")),
                "sell_value_usd": _to_float(r.get("sell_value") or r.get("sell_value_usd")),
                "net_value_usd": _to_float(r.get("net_value") or r.get("net_value_usd")),
            }
            if table == "uw_stock_insider_buy_sells":
                params["ticker"] = ticker
            cur.execute(sql, params)
            n += 1
    return n


# ---------- entrypoints ---------------------------------------------------


def ingest_market_institutional(
    database_url: str,
    api_key: str,
    activity_limit: int = 500,
) -> dict[str, int]:
    """Market-wide institutional feeds — activity firehose, latest 13Fs,
    market-wide insider rollup. 3 calls total."""
    out = {"activity": 0, "latest_filings": 0, "market_insider": 0}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        activity = uw.institution_activity(limit=activity_limit)
        with conn.transaction():
            out["activity"] = _upsert_institution_activity(conn, activity)
        filings = uw.institution_latest_filings(limit=100)
        with conn.transaction():
            out["latest_filings"] = _upsert_institution_latest_filings(conn, filings)
        market_ibs = uw.market_insider_buy_sells()
        with conn.transaction():
            out["market_insider"] = _upsert_insider_buy_sells(
                conn, "uw_market_insider_buy_sells", None, market_ibs
            )
        conn.commit()
    log.info("market institutional: %s", out)
    return out


def ingest_per_ticker_institutional(
    database_url: str,
    api_key: str,
    tickers: Iterable[str],
) -> dict[str, int]:
    """Per-ticker ownership rollup + insider buy/sell breakdown.
    2 calls per ticker; run nightly + on watchlist changes."""
    out = {"tickers": 0, "ownership": 0, "stock_insider": 0, "failed": 0}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for ticker in tickers:
            ticker = ticker.strip().upper()
            if not ticker:
                continue
            out["tickers"] += 1
            try:
                own = uw.stock_ownership(ticker)
                ibs = uw.stock_insider_buy_sells(ticker)
                with conn.transaction():
                    out["ownership"] += _upsert_stock_ownership(conn, ticker, own)
                    out["stock_insider"] += _upsert_insider_buy_sells(
                        conn, "uw_stock_insider_buy_sells", ticker, ibs
                    )
            except Exception as e:  # noqa: BLE001
                log.warning("per-ticker institutional failed for %s: %s", ticker, e)
                out["failed"] += 1
        conn.commit()
    log.info("per-ticker institutional: %s", out)
    return out


def ingest_institution_holdings(
    database_url: str,
    api_key: str,
    institutions: Iterable[str],
) -> dict[str, int]:
    """Targeted backfill for specific institutions. One call per institution
    returns their full holdings list."""
    out = {"institutions": 0, "rows": 0, "failed": 0}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for name in institutions:
            name = name.strip()
            if not name:
                continue
            out["institutions"] += 1
            try:
                rows = uw.institution_holdings(name)
                with conn.transaction():
                    out["rows"] += _upsert_institution_holdings(conn, name, rows)
            except Exception as e:  # noqa: BLE001
                log.warning("institution holdings failed for %s: %s", name, e)
                out["failed"] += 1
        conn.commit()
    log.info("institution holdings: %s", out)
    return out
