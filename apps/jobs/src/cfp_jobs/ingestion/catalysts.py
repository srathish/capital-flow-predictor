"""Catalyst-feeds ingestion — migration 0027.

Pulls UW's market-wide calendars and writes them to the tables created in
0027_catalysts.sql:

  /earnings/afterhours                          -> uw_earnings_calendar_daily(session='post')
  /earnings/premarket                           -> uw_earnings_calendar_daily(session='pre')
  /companies/{ticker}/dividends                 -> uw_dividends
  /companies/{ticker}/stock-splits              -> uw_stock_splits
  /screener/analyst-ratings                     -> uw_analyst_ratings
  /market/economic-calendar                     -> uw_economic_calendar

Two entrypoints:
  - ingest_market_catalysts: market-wide feeds (earnings calendars, analyst
    ratings, economic calendar) — one run covers everything.
  - ingest_per_ticker_catalysts: per-ticker feeds (dividends, splits) — call
    for the explosive universe.

Idempotent on natural keys; safe to run repeatedly.
"""

from __future__ import annotations

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
    _to_ts,
)

log = logging.getLogger(__name__)


# ---------- earnings calendar (pre/post) ----------------------------------


def _upsert_earnings_calendar(
    conn: psycopg.Connection,
    session: str,
    report_date: date,
    rows: Iterable[dict],
) -> int:
    """`session` is 'pre' or 'post' to match UW endpoint we pulled from."""
    sql = """
        INSERT INTO uw_earnings_calendar_daily (
            report_date, session, ticker, company_name,
            eps_estimate, eps_actual, revenue_estimate, revenue_actual,
            expected_move_pct, market_cap, sector, payload
        ) VALUES (
            %(report_date)s, %(session)s, %(ticker)s, %(company_name)s,
            %(eps_estimate)s, %(eps_actual)s, %(revenue_estimate)s, %(revenue_actual)s,
            %(expected_move_pct)s, %(market_cap)s, %(sector)s, %(payload)s
        ) ON CONFLICT (report_date, session, ticker) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            eps_estimate = EXCLUDED.eps_estimate,
            eps_actual = EXCLUDED.eps_actual,
            revenue_estimate = EXCLUDED.revenue_estimate,
            revenue_actual = EXCLUDED.revenue_actual,
            expected_move_pct = EXCLUDED.expected_move_pct,
            market_cap = EXCLUDED.market_cap,
            sector = EXCLUDED.sector,
            payload = EXCLUDED.payload,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ticker = (r.get("ticker") or r.get("symbol") or "").strip().upper()
            if not ticker:
                continue
            cur.execute(
                sql,
                {
                    "report_date": report_date,
                    "session": session,
                    "ticker": ticker,
                    "company_name": r.get("full_name") or r.get("company_name") or r.get("name"),
                    "eps_estimate": _to_float(r.get("eps_estimate") or r.get("street_mean_est")),
                    "eps_actual": _to_float(r.get("eps_actual")),
                    "revenue_estimate": _to_float(r.get("revenue_estimate")),
                    "revenue_actual": _to_float(r.get("revenue_actual")),
                    "expected_move_pct": _to_float(r.get("expected_move_perc") or r.get("expected_move_pct")),
                    "market_cap": _to_float(r.get("market_cap") or r.get("marketcap")),
                    "sector": r.get("sector"),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


# ---------- dividends ------------------------------------------------------


def _upsert_dividends(
    conn: psycopg.Connection,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_dividends (
            ticker, ex_date, record_date, payment_date, declared_date,
            cash_amount, frequency, dividend_type, yield_percent
        ) VALUES (
            %(ticker)s, %(ex_date)s, %(record_date)s, %(payment_date)s, %(declared_date)s,
            %(cash_amount)s, %(frequency)s, %(dividend_type)s, %(yield_percent)s
        ) ON CONFLICT (ticker, ex_date) DO UPDATE SET
            record_date = EXCLUDED.record_date,
            payment_date = EXCLUDED.payment_date,
            declared_date = EXCLUDED.declared_date,
            cash_amount = EXCLUDED.cash_amount,
            frequency = EXCLUDED.frequency,
            dividend_type = EXCLUDED.dividend_type,
            yield_percent = EXCLUDED.yield_percent,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ex_date = _to_date(r.get("ex_date") or r.get("ex_dividend_date"))
            if not ex_date:
                continue
            cur.execute(
                sql,
                {
                    "ticker": ticker,
                    "ex_date": ex_date,
                    "record_date": _to_date(r.get("record_date")),
                    "payment_date": _to_date(r.get("payment_date") or r.get("pay_date")),
                    "declared_date": _to_date(r.get("declared_date") or r.get("declaration_date")),
                    "cash_amount": _to_float(r.get("cash_amount") or r.get("amount") or r.get("dividend")),
                    "frequency": r.get("frequency"),
                    "dividend_type": r.get("type") or r.get("dividend_type"),
                    "yield_percent": _to_float(r.get("yield") or r.get("yield_percent")),
                },
            )
            n += 1
    return n


# ---------- stock splits ---------------------------------------------------


def _upsert_stock_splits(
    conn: psycopg.Connection,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_stock_splits (
            ticker, ex_date, split_from, split_to, split_ratio
        ) VALUES (
            %(ticker)s, %(ex_date)s, %(split_from)s, %(split_to)s, %(split_ratio)s
        ) ON CONFLICT (ticker, ex_date) DO UPDATE SET
            split_from = EXCLUDED.split_from,
            split_to = EXCLUDED.split_to,
            split_ratio = EXCLUDED.split_ratio,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ex_date = _to_date(r.get("ex_date") or r.get("effective_date"))
            if not ex_date:
                continue
            sf = _to_float(r.get("split_from") or r.get("from_factor") or r.get("from"))
            st = _to_float(r.get("split_to") or r.get("to_factor") or r.get("to"))
            ratio = _to_float(r.get("split_ratio") or r.get("ratio"))
            if ratio is None and sf and st and sf > 0:
                ratio = st / sf
            cur.execute(
                sql,
                {
                    "ticker": ticker,
                    "ex_date": ex_date,
                    "split_from": sf,
                    "split_to": st,
                    "split_ratio": ratio,
                },
            )
            n += 1
    return n


# ---------- analyst ratings -----------------------------------------------


def _upsert_analyst_ratings(
    conn: psycopg.Connection,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_analyst_ratings (
            ticker, event_date, firm, action,
            rating_prior, rating_new, price_target_prior, price_target_new,
            notes, payload
        ) VALUES (
            %(ticker)s, %(event_date)s, %(firm)s, %(action)s,
            %(rating_prior)s, %(rating_new)s, %(price_target_prior)s, %(price_target_new)s,
            %(notes)s, %(payload)s
        ) ON CONFLICT (ticker, event_date, firm, action) DO UPDATE SET
            rating_prior = EXCLUDED.rating_prior,
            rating_new = EXCLUDED.rating_new,
            price_target_prior = EXCLUDED.price_target_prior,
            price_target_new = EXCLUDED.price_target_new,
            notes = EXCLUDED.notes,
            payload = EXCLUDED.payload,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ticker = (r.get("ticker") or r.get("symbol") or "").strip().upper()
            ed = _to_date(r.get("event_date") or r.get("date") or r.get("notification_date"))
            firm = r.get("firm") or r.get("analyst_firm") or r.get("brokerage") or "—"
            action = r.get("action") or r.get("rating_action") or r.get("type") or "unknown"
            if not ticker or not ed:
                continue
            cur.execute(
                sql,
                {
                    "ticker": ticker,
                    "event_date": ed,
                    "firm": firm,
                    "action": action.lower(),
                    "rating_prior": r.get("rating_prior") or r.get("prior_rating"),
                    "rating_new": r.get("rating_new") or r.get("new_rating") or r.get("rating"),
                    "price_target_prior": _to_float(r.get("price_target_prior") or r.get("prior_pt")),
                    "price_target_new": _to_float(r.get("price_target_new") or r.get("new_pt") or r.get("price_target")),
                    "notes": r.get("notes") or r.get("summary"),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


# ---------- economic calendar ---------------------------------------------


def _upsert_economic_calendar(
    conn: psycopg.Connection,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_economic_calendar (
            event_ts, event_name, country, importance,
            actual, forecast, previous, payload
        ) VALUES (
            %(event_ts)s, %(event_name)s, %(country)s, %(importance)s,
            %(actual)s, %(forecast)s, %(previous)s, %(payload)s
        ) ON CONFLICT (event_ts, event_name, country) DO UPDATE SET
            importance = EXCLUDED.importance,
            actual = EXCLUDED.actual,
            forecast = EXCLUDED.forecast,
            previous = EXCLUDED.previous,
            payload = EXCLUDED.payload,
            fetched_at = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("event_ts") or r.get("datetime") or r.get("time"))
            name = r.get("event_name") or r.get("event") or r.get("name")
            if not ts or not name:
                continue
            cur.execute(
                sql,
                {
                    "event_ts": ts,
                    "event_name": name,
                    "country": r.get("country") or "",
                    "importance": (r.get("importance") or "").lower() or None,
                    "actual": str(r.get("actual")) if r.get("actual") is not None else None,
                    "forecast": str(r.get("forecast")) if r.get("forecast") is not None else None,
                    "previous": str(r.get("previous")) if r.get("previous") is not None else None,
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


# ---------- entrypoints ----------------------------------------------------


def ingest_market_catalysts(
    database_url: str,
    api_key: str,
    days_ahead: int = 7,
) -> dict[str, int]:
    """Market-wide catalyst feeds — earnings calendars (today + next N days),
    full analyst-ratings feed, economic calendar over the window.

    Cheap: 2 calls/day × (days_ahead+1) + 1 analyst + 1 econ ≈ 17 calls for a
    weeklong window. Safe to run every ~15 min from the scheduler."""
    out = {
        "earnings_pre": 0,
        "earnings_post": 0,
        "analyst_ratings": 0,
        "economic": 0,
    }
    with UwClient(api_key) as uw, connect(database_url) as conn:
        today = datetime.now(UTC).date()
        for i in range(days_ahead + 1):
            d = today + timedelta(days=i)
            pre = uw.earnings_premarket(d)
            post = uw.earnings_afterhours(d)
            with conn.transaction():
                out["earnings_pre"] += _upsert_earnings_calendar(conn, "pre", d, pre)
                out["earnings_post"] += _upsert_earnings_calendar(conn, "post", d, post)
        # Analyst ratings: pull last 7 days fresh — UW returns most-recent
        # first; we just upsert and skip dupes by PK.
        ratings = uw.analyst_ratings(limit=500, start_date=today - timedelta(days=7))
        with conn.transaction():
            out["analyst_ratings"] = _upsert_analyst_ratings(conn, ratings)
        # Economic calendar over the window
        econ = uw.economic_calendar(
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=days_ahead),
        )
        with conn.transaction():
            out["economic"] = _upsert_economic_calendar(conn, econ)
        conn.commit()
    log.info("market catalysts: %s", out)
    return out


def ingest_per_ticker_catalysts(
    database_url: str,
    api_key: str,
    tickers: Iterable[str],
) -> dict[str, int]:
    """Per-ticker catalysts — dividends + splits. Two calls per ticker.
    Run nightly; these are slow-moving so we don't need RTH cadence."""
    out = {"dividends": 0, "splits": 0, "tickers": 0}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for ticker in tickers:
            ticker = ticker.strip().upper()
            if not ticker:
                continue
            out["tickers"] += 1
            try:
                divs = uw.dividends(ticker)
                splits = uw.stock_splits(ticker)
                with conn.transaction():
                    out["dividends"] += _upsert_dividends(conn, ticker, divs)
                    out["splits"] += _upsert_stock_splits(conn, ticker, splits)
            except Exception as e:  # noqa: BLE001
                log.warning("per-ticker catalysts failed for %s: %s", ticker, e)
        conn.commit()
    log.info("per-ticker catalysts: %s", out)
    return out
