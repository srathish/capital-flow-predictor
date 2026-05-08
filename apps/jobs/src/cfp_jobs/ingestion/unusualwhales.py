"""Unusual Whales API client + ingestion.

Hits the seven endpoints we built tables for in 0004_unusual_whales.sql.
Field shapes were locked against live responses on 2026-05-08:
  /api/stock/{ticker}/flow-alerts
  /api/darkpool/{ticker}
  /api/stock/{ticker}/net-prem-ticks
  /api/shorts/{ticker}/data
  /api/stock/{ticker}/greek-exposure
  /api/etfs/{etf}/in-outflow
  /api/insider/transactions?ticker_symbol={ticker}
  /api/congress/recent-trades

Rate budget: 120 req/min, 80K req/day on the $200 tier — way more than
we need. One ingest pass per ticker is 7 calls.

Auth: Bearer token in Authorization header. Token comes from
settings.unusual_whales_api_key (env: UNUSUAL_WHALES_API_KEY).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

BASE_URL = "https://api.unusualwhales.com/api"


# ---------- client ----------


class UwClient:
    """Thin client. Returns parsed JSON (already unwrapped from {"data": [...]} where applicable)."""

    def __init__(self, api_key: str, timeout: float = 20.0) -> None:
        if not api_key:
            raise RuntimeError("UNUSUAL_WHALES_API_KEY not configured")
        self._client = httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
            },
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{BASE_URL}/{path.lstrip('/')}"
        r = self._client.get(url, params=params or {})
        if r.status_code == 429:
            # 120/min limit; back off and retry once.
            time.sleep(1.0)
            r = self._client.get(url, params=params or {})
        if r.status_code == 404:
            log.warning("UW 404: %s", url)
            return None
        r.raise_for_status()
        body = r.json()
        if isinstance(body, dict) and "data" in body:
            return body["data"]
        return body

    def flow_alerts(self, ticker: str, limit: int = 50) -> list[dict]:
        return self._get(f"/stock/{ticker}/flow-alerts", params={"limit": limit}) or []

    def dark_pool(self, ticker: str, limit: int = 100) -> list[dict]:
        return self._get(f"/darkpool/{ticker}", params={"limit": limit}) or []

    def net_prem_ticks(self, ticker: str, target_date: date | None = None) -> list[dict]:
        params: dict[str, Any] = {}
        if target_date:
            params["date"] = target_date.isoformat()
        return self._get(f"/stock/{ticker}/net-prem-ticks", params=params) or []

    def short_data(self, ticker: str) -> list[dict]:
        return self._get(f"/shorts/{ticker}/data") or []

    def greek_exposure(self, ticker: str) -> list[dict]:
        return self._get(f"/stock/{ticker}/greek-exposure") or []

    def etf_flow(self, etf: str) -> list[dict]:
        return self._get(f"/etfs/{etf}/in-outflow") or []

    def insider_transactions(self, ticker: str, limit: int = 50) -> list[dict]:
        return self._get(
            "/insider/transactions",
            params={"ticker_symbol": ticker, "limit": limit},
        ) or []

    def congress_trades(self, ticker: str | None = None, limit: int = 100) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if ticker:
            params["ticker"] = ticker
        return self._get("/congress/recent-trades", params=params) or []

    def info(self, ticker: str) -> dict | None:
        """Stock info (sector, industry, name, type, marketcap, next earnings).

        Returns the unwrapped object directly (UW wraps it in {"data": {...}})."""
        body = self._get(f"/stock/{ticker}/info")
        # Some _get callers unwrap "data"; this endpoint returns the dict already.
        if isinstance(body, list):
            return body[0] if body else None
        return body if isinstance(body, dict) else None

    def oi_change(self, ticker: str, limit: int = 100) -> list[dict]:
        """Daily OI delta per option strike — joins to flow alerts via option_symbol."""
        return self._get(f"/stock/{ticker}/oi-change", params={"limit": limit}) or []

    def news_headlines(self, ticker: str, limit: int = 50) -> list[dict]:
        """News with sentiment tagging. NOTE: endpoint is /news/headlines?ticker=X
        — /stock/{T}/news 404s."""
        return self._get("/news/headlines", params={"ticker": ticker, "limit": limit}) or []

    def earnings(self, ticker: str) -> list[dict]:
        """Earnings calendar + historical reactions. Endpoint is /earnings/{T}
        (no /stock/ prefix)."""
        return self._get(f"/earnings/{ticker}") or []

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> UwClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


# ---------- helpers ----------


def _to_float(v: object) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _to_int(v: object) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        try:
            return int(float(v))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None


def _to_date(v: object) -> date | None:
    if not v:
        return None
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.split("T", 1)[0]).date()
        except ValueError:
            return None
    return None


def _to_ts(v: object) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, str):
        s = v.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            return None
    return None


# ---------- per-table upserts ----------


def _upsert_flow_alerts(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_flow_alerts (
            created_at, ticker, option_chain, option_type, expiry, strike,
            underlying_price, price, volume, open_interest,
            total_premium, total_size, trade_count,
            iv_end, iv_start,
            has_sweep, has_floor, has_multileg, has_singleleg, all_opening_trades,
            alert_rule, bid_side_prem, ask_side_prem, volume_oi_ratio, payload
        ) VALUES (
            %(created_at)s, %(ticker)s, %(option_chain)s, %(option_type)s, %(expiry)s, %(strike)s,
            %(underlying_price)s, %(price)s, %(volume)s, %(open_interest)s,
            %(total_premium)s, %(total_size)s, %(trade_count)s,
            %(iv_end)s, %(iv_start)s,
            %(has_sweep)s, %(has_floor)s, %(has_multileg)s, %(has_singleleg)s, %(all_opening_trades)s,
            %(alert_rule)s, %(bid_side_prem)s, %(ask_side_prem)s, %(volume_oi_ratio)s, %(payload)s
        ) ON CONFLICT (created_at, ticker, option_chain, alert_rule) DO NOTHING
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            params = {
                "created_at": _to_ts(r.get("created_at")),
                "ticker": ticker,
                "option_chain": r.get("option_chain"),
                "option_type": r.get("type") or "",
                "expiry": _to_date(r.get("expiry")),
                "strike": _to_float(r.get("strike")),
                "underlying_price": _to_float(r.get("underlying_price")),
                "price": _to_float(r.get("price")),
                "volume": _to_int(r.get("volume")),
                "open_interest": _to_int(r.get("open_interest")),
                "total_premium": _to_float(r.get("total_premium")),
                "total_size": _to_int(r.get("total_size")),
                "trade_count": _to_int(r.get("trade_count")),
                "iv_end": _to_float(r.get("iv_end")),
                "iv_start": _to_float(r.get("iv_start")),
                "has_sweep": bool(r.get("has_sweep")),
                "has_floor": bool(r.get("has_floor")),
                "has_multileg": bool(r.get("has_multileg")),
                "has_singleleg": bool(r.get("has_singleleg")),
                "all_opening_trades": bool(r.get("all_opening_trades")),
                "alert_rule": r.get("alert_rule"),
                "bid_side_prem": _to_float(r.get("total_bid_side_prem")),
                "ask_side_prem": _to_float(r.get("total_ask_side_prem")),
                "volume_oi_ratio": _to_float(r.get("volume_oi_ratio")),
                "payload": Jsonb(r),
            }
            if not params["created_at"] or not params["option_chain"]:
                continue
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def _upsert_dark_pool(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_dark_pool_prints (
            tracking_id, executed_at, ticker, price, size, premium,
            nbbo_ask, nbbo_bid, market_center, canceled, ext_hour_sold_codes, payload
        ) VALUES (
            %(tracking_id)s, %(executed_at)s, %(ticker)s, %(price)s, %(size)s, %(premium)s,
            %(nbbo_ask)s, %(nbbo_bid)s, %(market_center)s, %(canceled)s, %(ext_hour_sold_codes)s, %(payload)s
        ) ON CONFLICT (tracking_id) DO NOTHING
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            tid = _to_int(r.get("tracking_id"))
            if tid is None:
                continue
            cur.execute(
                sql,
                {
                    "tracking_id": tid,
                    "executed_at": _to_ts(r.get("executed_at")),
                    "ticker": ticker,
                    "price": _to_float(r.get("price")),
                    "size": _to_int(r.get("size")),
                    "premium": _to_float(r.get("premium")),
                    "nbbo_ask": _to_float(r.get("nbbo_ask")),
                    "nbbo_bid": _to_float(r.get("nbbo_bid")),
                    "market_center": r.get("market_center"),
                    "canceled": bool(r.get("canceled")),
                    "ext_hour_sold_codes": r.get("ext_hour_sold_codes"),
                    "payload": Jsonb(r),
                },
            )
            n += cur.rowcount
    return n


def _upsert_net_prem_daily(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    """Aggregate the minute tape into one row per (date, ticker)."""
    by_date: dict[date, dict[str, float]] = {}
    for r in rows:
        d = _to_date(r.get("date"))
        if d is None:
            continue
        bucket = by_date.setdefault(
            d,
            {
                "call_volume": 0.0,
                "put_volume": 0.0,
                "call_volume_ask": 0.0,
                "call_volume_bid": 0.0,
                "put_volume_ask": 0.0,
                "put_volume_bid": 0.0,
                "net_call_premium": 0.0,
                "net_put_premium": 0.0,
                "net_delta": 0.0,
            },
        )
        bucket["call_volume"] += _to_int(r.get("call_volume")) or 0
        bucket["put_volume"] += _to_int(r.get("put_volume")) or 0
        bucket["call_volume_ask"] += _to_int(r.get("call_volume_ask_side")) or 0
        bucket["call_volume_bid"] += _to_int(r.get("call_volume_bid_side")) or 0
        bucket["put_volume_ask"] += _to_int(r.get("put_volume_ask_side")) or 0
        bucket["put_volume_bid"] += _to_int(r.get("put_volume_bid_side")) or 0
        bucket["net_call_premium"] += _to_float(r.get("net_call_premium")) or 0.0
        bucket["net_put_premium"] += _to_float(r.get("net_put_premium")) or 0.0
        bucket["net_delta"] += _to_float(r.get("net_delta")) or 0.0

    sql = """
        INSERT INTO uw_net_prem_daily (
            date, ticker, call_volume, put_volume,
            call_volume_ask, call_volume_bid, put_volume_ask, put_volume_bid,
            net_call_premium, net_put_premium, net_delta
        ) VALUES (
            %(date)s, %(ticker)s, %(call_volume)s, %(put_volume)s,
            %(call_volume_ask)s, %(call_volume_bid)s, %(put_volume_ask)s, %(put_volume_bid)s,
            %(net_call_premium)s, %(net_put_premium)s, %(net_delta)s
        ) ON CONFLICT (date, ticker) DO UPDATE SET
            call_volume = EXCLUDED.call_volume,
            put_volume = EXCLUDED.put_volume,
            call_volume_ask = EXCLUDED.call_volume_ask,
            call_volume_bid = EXCLUDED.call_volume_bid,
            put_volume_ask = EXCLUDED.put_volume_ask,
            put_volume_bid = EXCLUDED.put_volume_bid,
            net_call_premium = EXCLUDED.net_call_premium,
            net_put_premium = EXCLUDED.net_put_premium,
            net_delta = EXCLUDED.net_delta
    """
    n = 0
    with conn.cursor() as cur:
        for d, bucket in by_date.items():
            cur.execute(sql, {"date": d, "ticker": ticker, **bucket})
            n += 1
    return n


def _upsert_short_data(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_short_data (ts, ticker, short_shares_available, fee_rate, rebate_rate)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (ts, ticker) DO UPDATE SET
            short_shares_available = EXCLUDED.short_shares_available,
            fee_rate = EXCLUDED.fee_rate,
            rebate_rate = EXCLUDED.rebate_rate
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("timestamp"))
            if ts is None:
                continue
            cur.execute(
                sql,
                (
                    ts,
                    ticker,
                    _to_int(r.get("short_shares_available")),
                    _to_float(r.get("fee_rate")),
                    _to_float(r.get("rebate_rate")),
                ),
            )
            n += 1
    return n


def _upsert_greek_exposure(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_greek_exposure (
            date, ticker, call_delta, put_delta, call_gamma, put_gamma,
            call_charm, put_charm, call_vanna, put_vanna
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) ON CONFLICT (date, ticker) DO UPDATE SET
            call_delta = EXCLUDED.call_delta,
            put_delta = EXCLUDED.put_delta,
            call_gamma = EXCLUDED.call_gamma,
            put_gamma = EXCLUDED.put_gamma,
            call_charm = EXCLUDED.call_charm,
            put_charm = EXCLUDED.put_charm,
            call_vanna = EXCLUDED.call_vanna,
            put_vanna = EXCLUDED.put_vanna
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            d = _to_date(r.get("date"))
            if d is None:
                continue
            cur.execute(
                sql,
                (
                    d, ticker,
                    _to_float(r.get("call_delta")),
                    _to_float(r.get("put_delta")),
                    _to_float(r.get("call_gamma")),
                    _to_float(r.get("put_gamma")),
                    _to_float(r.get("call_charm")),
                    _to_float(r.get("put_charm")),
                    _to_float(r.get("call_vanna")),
                    _to_float(r.get("put_vanna")),
                ),
            )
            n += 1
    return n


def _upsert_etf_flow(conn: psycopg.Connection, etf: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_etf_flow (
            date, ticker, close, volume, change_shares, change_prem,
            expiration_cycle, is_fomc
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s
        ) ON CONFLICT (date, ticker) DO UPDATE SET
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            change_shares = EXCLUDED.change_shares,
            change_prem = EXCLUDED.change_prem,
            expiration_cycle = EXCLUDED.expiration_cycle,
            is_fomc = EXCLUDED.is_fomc
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            d = _to_date(r.get("date"))
            if d is None:
                continue
            cur.execute(
                sql,
                (
                    d, etf,
                    _to_float(r.get("close")),
                    _to_int(r.get("volume")),
                    _to_int(r.get("change")),
                    _to_float(r.get("change_prem")),
                    r.get("expiration_cycle"),
                    bool(r.get("is_fomc")),
                ),
            )
            n += 1
    return n


def _upsert_insider(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_insider_transactions (
            id, transaction_date, filing_date, ticker, owner_name,
            transaction_code, amount, transactions, price,
            is_director, is_officer, is_ten_percent_owner, is_10b5_1,
            security_title, formtype, payload
        ) VALUES (
            %(id)s, %(transaction_date)s, %(filing_date)s, %(ticker)s, %(owner_name)s,
            %(transaction_code)s, %(amount)s, %(transactions)s, %(price)s,
            %(is_director)s, %(is_officer)s, %(is_ten_percent_owner)s, %(is_10b5_1)s,
            %(security_title)s, %(formtype)s, %(payload)s
        ) ON CONFLICT (id) DO UPDATE SET
            amount = EXCLUDED.amount,
            transactions = EXCLUDED.transactions,
            price = EXCLUDED.price,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            txn_id = r.get("id")
            if not txn_id:
                continue
            cur.execute(
                sql,
                {
                    "id": txn_id,
                    "transaction_date": _to_date(r.get("transaction_date")),
                    "filing_date": _to_date(r.get("filing_date")),
                    "ticker": r.get("ticker") or ticker,
                    "owner_name": r.get("owner_name"),
                    "transaction_code": r.get("transaction_code"),
                    "amount": _to_float(r.get("amount")),
                    "transactions": _to_int(r.get("transactions")),
                    "price": _to_float(r.get("price")),
                    "is_director": bool(r.get("is_director")),
                    "is_officer": bool(r.get("is_officer")),
                    "is_ten_percent_owner": bool(r.get("is_ten_percent_owner")),
                    "is_10b5_1": bool(r.get("is_10b5_1")),
                    "security_title": r.get("security_title"),
                    "formtype": r.get("formtype"),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def _upsert_stock_info(conn: psycopg.Connection, ticker: str, info: dict | None) -> int:
    if not info:
        return 0
    sql = """
        INSERT INTO uw_stock_info (
            ticker, full_name, short_name, issue_type, sector, short_description,
            marketcap_size, beta, marketcap, outstanding, avg30_volume,
            next_earnings_date, announce_time, uw_tags,
            has_options, has_dividend, has_earnings_history, last_fetched
        ) VALUES (
            %(ticker)s, %(full_name)s, %(short_name)s, %(issue_type)s, %(sector)s, %(short_description)s,
            %(marketcap_size)s, %(beta)s, %(marketcap)s, %(outstanding)s, %(avg30_volume)s,
            %(next_earnings_date)s, %(announce_time)s, %(uw_tags)s,
            %(has_options)s, %(has_dividend)s, %(has_earnings_history)s, NOW()
        ) ON CONFLICT (ticker) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            short_name = EXCLUDED.short_name,
            issue_type = EXCLUDED.issue_type,
            sector = EXCLUDED.sector,
            short_description = EXCLUDED.short_description,
            marketcap_size = EXCLUDED.marketcap_size,
            beta = EXCLUDED.beta,
            marketcap = EXCLUDED.marketcap,
            outstanding = EXCLUDED.outstanding,
            avg30_volume = EXCLUDED.avg30_volume,
            next_earnings_date = EXCLUDED.next_earnings_date,
            announce_time = EXCLUDED.announce_time,
            uw_tags = EXCLUDED.uw_tags,
            has_options = EXCLUDED.has_options,
            has_dividend = EXCLUDED.has_dividend,
            has_earnings_history = EXCLUDED.has_earnings_history,
            last_fetched = NOW()
    """
    tags = info.get("uw_tags") or []
    with conn.cursor() as cur:
        cur.execute(
            sql,
            {
                "ticker": ticker,
                "full_name": info.get("full_name"),
                "short_name": info.get("short_name"),
                "issue_type": info.get("issue_type"),
                "sector": info.get("sector"),
                "short_description": info.get("short_description"),
                "marketcap_size": info.get("marketcap_size"),
                "beta": _to_float(info.get("beta")),
                "marketcap": _to_float(info.get("marketcap")),
                "outstanding": _to_int(info.get("outstanding")),
                "avg30_volume": _to_float(info.get("avg30_volume")),
                "next_earnings_date": _to_date(info.get("next_earnings_date")),
                "announce_time": info.get("announce_time"),
                "uw_tags": list(tags) if isinstance(tags, list) else [],
                "has_options": bool(info.get("has_options")),
                "has_dividend": bool(info.get("has_dividend")),
                "has_earnings_history": bool(info.get("has_earnings_history")),
            },
        )
    return 1


def _upsert_oi_change(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_oi_change (
            curr_date, ticker, option_symbol, last_date, volume, trades,
            avg_price, last_fill, last_ask, last_bid,
            curr_oi, last_oi, oi_diff_plain, oi_change_ratio,
            prev_ask_volume, prev_bid_volume, prev_mid_volume,
            prev_multi_leg_volume, prev_neutral_volume, prev_stock_multi_leg_volume,
            prev_total_premium, days_of_oi_increases, days_of_vol_greater_than_oi,
            percentage_of_total, rnk
        ) VALUES (
            %(curr_date)s, %(ticker)s, %(option_symbol)s, %(last_date)s, %(volume)s, %(trades)s,
            %(avg_price)s, %(last_fill)s, %(last_ask)s, %(last_bid)s,
            %(curr_oi)s, %(last_oi)s, %(oi_diff_plain)s, %(oi_change_ratio)s,
            %(prev_ask_volume)s, %(prev_bid_volume)s, %(prev_mid_volume)s,
            %(prev_multi_leg_volume)s, %(prev_neutral_volume)s, %(prev_stock_multi_leg_volume)s,
            %(prev_total_premium)s, %(days_of_oi_increases)s, %(days_of_vol_greater_than_oi)s,
            %(percentage_of_total)s, %(rnk)s
        ) ON CONFLICT (curr_date, ticker, option_symbol) DO UPDATE SET
            curr_oi = EXCLUDED.curr_oi,
            last_oi = EXCLUDED.last_oi,
            oi_diff_plain = EXCLUDED.oi_diff_plain,
            oi_change_ratio = EXCLUDED.oi_change_ratio,
            volume = EXCLUDED.volume,
            trades = EXCLUDED.trades,
            avg_price = EXCLUDED.avg_price,
            prev_total_premium = EXCLUDED.prev_total_premium,
            days_of_oi_increases = EXCLUDED.days_of_oi_increases,
            days_of_vol_greater_than_oi = EXCLUDED.days_of_vol_greater_than_oi,
            rnk = EXCLUDED.rnk
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            cd = _to_date(r.get("curr_date"))
            opt = r.get("option_symbol")
            if not cd or not opt:
                continue
            cur.execute(
                sql,
                {
                    "curr_date": cd,
                    "ticker": ticker,
                    "option_symbol": opt,
                    "last_date": _to_date(r.get("last_date")),
                    "volume": _to_int(r.get("volume")),
                    "trades": _to_int(r.get("trades")),
                    "avg_price": _to_float(r.get("avg_price")),
                    "last_fill": _to_float(r.get("last_fill")),
                    "last_ask": _to_float(r.get("last_ask")),
                    "last_bid": _to_float(r.get("last_bid")),
                    "curr_oi": _to_int(r.get("curr_oi")),
                    "last_oi": _to_int(r.get("last_oi")),
                    "oi_diff_plain": _to_int(r.get("oi_diff_plain")),
                    "oi_change_ratio": _to_float(r.get("oi_change")),
                    "prev_ask_volume": _to_int(r.get("prev_ask_volume")),
                    "prev_bid_volume": _to_int(r.get("prev_bid_volume")),
                    "prev_mid_volume": _to_int(r.get("prev_mid_volume")),
                    "prev_multi_leg_volume": _to_int(r.get("prev_multi_leg_volume")),
                    "prev_neutral_volume": _to_int(r.get("prev_neutral_volume")),
                    "prev_stock_multi_leg_volume": _to_int(r.get("prev_stock_multi_leg_volume")),
                    "prev_total_premium": _to_float(r.get("prev_total_premium")),
                    "days_of_oi_increases": _to_int(r.get("days_of_oi_increases")),
                    "days_of_vol_greater_than_oi": _to_int(r.get("days_of_vol_greater_than_oi")),
                    "percentage_of_total": _to_float(r.get("percentage_of_total")),
                    "rnk": _to_int(r.get("rnk")),
                },
            )
            n += 1
    return n


def _upsert_news(conn: psycopg.Connection, rows: Iterable[dict]) -> int:
    """News headlines are global (one row per article, multi-ticker via array)."""
    sql = """
        INSERT INTO uw_news (created_at, source, headline, is_major, sentiment, tickers, tags)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (created_at, md5(headline)) DO NOTHING
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("created_at"))
            headline = r.get("headline")
            if not ts or not headline:
                continue
            tickers = r.get("tickers") or []
            tags = r.get("tags") or []
            cur.execute(
                sql,
                (
                    ts,
                    r.get("source"),
                    headline,
                    bool(r.get("is_major")),
                    r.get("sentiment"),
                    list(tickers) if isinstance(tickers, list) else [],
                    list(tags) if isinstance(tags, list) else [],
                ),
            )
            n += cur.rowcount
    return n


def _upsert_earnings(conn: psycopg.Connection, ticker: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_earnings (
            ticker, report_date, report_time, ending_fiscal_quarter,
            expected_move, expected_move_perc, street_mean_est, actual_eps,
            post_earnings_move_1d, post_earnings_move_3d, post_earnings_move_1w, post_earnings_move_2w,
            pre_earnings_move_1d, pre_earnings_move_3d, pre_earnings_move_1w, pre_earnings_move_2w,
            short_straddle_1d, short_straddle_1w, long_straddle_1d, long_straddle_1w, source
        ) VALUES (
            %(ticker)s, %(report_date)s, %(report_time)s, %(ending_fiscal_quarter)s,
            %(expected_move)s, %(expected_move_perc)s, %(street_mean_est)s, %(actual_eps)s,
            %(p1d)s, %(p3d)s, %(p1w)s, %(p2w)s,
            %(r1d)s, %(r3d)s, %(r1w)s, %(r2w)s,
            %(ss1d)s, %(ss1w)s, %(ls1d)s, %(ls1w)s, %(source)s
        ) ON CONFLICT (ticker, report_date) DO UPDATE SET
            actual_eps = EXCLUDED.actual_eps,
            post_earnings_move_1d = EXCLUDED.post_earnings_move_1d,
            post_earnings_move_3d = EXCLUDED.post_earnings_move_3d,
            post_earnings_move_1w = EXCLUDED.post_earnings_move_1w,
            post_earnings_move_2w = EXCLUDED.post_earnings_move_2w,
            expected_move = EXCLUDED.expected_move,
            expected_move_perc = EXCLUDED.expected_move_perc,
            street_mean_est = EXCLUDED.street_mean_est
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            rd = _to_date(r.get("report_date"))
            if not rd:
                continue
            cur.execute(
                sql,
                {
                    "ticker": ticker,
                    "report_date": rd,
                    "report_time": r.get("report_time"),
                    "ending_fiscal_quarter": _to_date(r.get("ending_fiscal_quarter")),
                    "expected_move": _to_float(r.get("expected_move")),
                    "expected_move_perc": _to_float(r.get("expected_move_perc")),
                    "street_mean_est": _to_float(r.get("street_mean_est")),
                    "actual_eps": _to_float(r.get("actual_eps")),
                    "p1d": _to_float(r.get("post_earnings_move_1d")),
                    "p3d": _to_float(r.get("post_earnings_move_3d")),
                    "p1w": _to_float(r.get("post_earnings_move_1w")),
                    "p2w": _to_float(r.get("post_earnings_move_2w")),
                    "r1d": _to_float(r.get("pre_earnings_move_1d")),
                    "r3d": _to_float(r.get("pre_earnings_move_3d")),
                    "r1w": _to_float(r.get("pre_earnings_move_1w")),
                    "r2w": _to_float(r.get("pre_earnings_move_2w")),
                    "ss1d": _to_float(r.get("short_straddle_1d")),
                    "ss1w": _to_float(r.get("short_straddle_1w")),
                    "ls1d": _to_float(r.get("long_straddle_1d")),
                    "ls1w": _to_float(r.get("long_straddle_1w")),
                    "source": r.get("source"),
                },
            )
            n += 1
    return n


def _upsert_congress(conn: psycopg.Connection, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_congress_trades (
            politician_id, transaction_date, ticker, txn_type, amounts,
            name, member_type, issuer, filed_at_date, notes
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) ON CONFLICT (
            politician_id, transaction_date, COALESCE(ticker, ''),
            COALESCE(txn_type, ''), COALESCE(amounts, '')
        ) DO NOTHING
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            pid = r.get("politician_id")
            txn_date = _to_date(r.get("transaction_date"))
            if not pid or not txn_date:
                continue
            cur.execute(
                sql,
                (
                    pid, txn_date,
                    r.get("ticker"),
                    r.get("txn_type"),
                    r.get("amounts"),
                    r.get("name"),
                    r.get("member_type"),
                    r.get("issuer"),
                    _to_date(r.get("filed_at_date")),
                    r.get("notes"),
                ),
            )
            n += cur.rowcount
    return n


# ---------- ingest entrypoints ----------


def ingest_ticker(database_url: str, api_key: str, ticker: str) -> dict:
    """Pull all the per-ticker UW endpoints in one pass and upsert.

    Used by `cfp-jobs flow TICKER` and lazily by the agent runner when a
    ticker has no recent UW data and a run is requested.
    """
    ticker = ticker.upper()
    counts: dict[str, int] = {}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        # Stock info first — the instrument frame is the most load-bearing
        # piece of data the personas read.
        try:
            counts["stock_info"] = _upsert_stock_info(conn, ticker, uw.info(ticker))
        except Exception as e:
            log.warning("stock_info failed for %s: %s", ticker, e)
            counts["stock_info"] = 0
        try:
            counts["flow_alerts"] = _upsert_flow_alerts(conn, ticker, uw.flow_alerts(ticker))
        except Exception as e:
            log.warning("flow_alerts failed for %s: %s", ticker, e)
            counts["flow_alerts"] = 0
        try:
            counts["dark_pool"] = _upsert_dark_pool(conn, ticker, uw.dark_pool(ticker))
        except Exception as e:
            log.warning("dark_pool failed for %s: %s", ticker, e)
            counts["dark_pool"] = 0
        try:
            counts["net_prem"] = _upsert_net_prem_daily(conn, ticker, uw.net_prem_ticks(ticker))
        except Exception as e:
            log.warning("net_prem failed for %s: %s", ticker, e)
            counts["net_prem"] = 0
        try:
            counts["short_data"] = _upsert_short_data(conn, ticker, uw.short_data(ticker))
        except Exception as e:
            log.warning("short_data failed for %s: %s", ticker, e)
            counts["short_data"] = 0
        try:
            counts["greek_exposure"] = _upsert_greek_exposure(conn, ticker, uw.greek_exposure(ticker))
        except Exception as e:
            log.warning("greek_exposure failed for %s: %s", ticker, e)
            counts["greek_exposure"] = 0
        try:
            counts["insider"] = _upsert_insider(conn, ticker, uw.insider_transactions(ticker))
        except Exception as e:
            log.warning("insider failed for %s: %s", ticker, e)
            counts["insider"] = 0
        try:
            counts["oi_change"] = _upsert_oi_change(conn, ticker, uw.oi_change(ticker))
        except Exception as e:
            log.warning("oi_change failed for %s: %s", ticker, e)
            counts["oi_change"] = 0
        try:
            counts["news"] = _upsert_news(conn, uw.news_headlines(ticker))
        except Exception as e:
            log.warning("news failed for %s: %s", ticker, e)
            counts["news"] = 0
        try:
            counts["earnings"] = _upsert_earnings(conn, ticker, uw.earnings(ticker))
        except Exception as e:
            log.warning("earnings failed for %s: %s", ticker, e)
            counts["earnings"] = 0
        conn.commit()
    return {"ticker": ticker, **counts}


def ingest_etfs(database_url: str, api_key: str, etfs: Iterable[str]) -> dict:
    """ETF in/out flow for sector rotation. Run once per sector ETF, daily."""
    counts: dict[str, int] = {}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for etf in etfs:
            try:
                counts[etf] = _upsert_etf_flow(conn, etf.upper(), uw.etf_flow(etf.upper()))
            except Exception as e:
                log.warning("etf_flow failed for %s: %s", etf, e)
                counts[etf] = 0
        conn.commit()
    return counts


def ingest_congress(database_url: str, api_key: str, limit: int = 500) -> int:
    with UwClient(api_key) as uw, connect(database_url) as conn:
        rows = uw.congress_trades(limit=limit)
        n = _upsert_congress(conn, rows)
        conn.commit()
    return n
