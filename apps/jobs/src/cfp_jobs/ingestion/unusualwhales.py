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
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect, upsert_etf_breadth

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

    def etf_holdings(self, etf: str) -> list[dict]:
        """Full constituent list with pricing + options sentiment per holding.
        Replaces the yfinance top-10 stub."""
        return self._get(f"/etfs/{etf}/holdings") or []

    def volatility_stats(self, ticker: str) -> dict | None:
        """IV regime: iv30, iv_rank, iv_percentile, rv30.

        Regime context that turns "call sweep" into either "bold bet on the
        cheap" (low IV rank) or "chasing into rich vol" (high IV rank). Returned
        as a single dict (UW wraps it in {"data": {...}})."""
        body = self._get(f"/stock/{ticker}/volatility/stats")
        if isinstance(body, list):
            return body[0] if body else None
        return body if isinstance(body, dict) else None

    def market_tide(self, target_date: date | None = None) -> list[dict]:
        """Market-wide net call/put premium tape (UW's "Market Tide").

        Used as a broad-tape direction marker: a bullish single-name bet that
        runs *against* a deeply red market tide is much louder than one that
        runs with it."""
        params: dict[str, Any] = {}
        if target_date:
            params["date"] = target_date.isoformat()
        return self._get("/market/market-tide", params=params) or []

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


def _upsert_etf_holdings(conn: psycopg.Connection, etf: str, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_etf_holdings (
            etf, ticker, short_name, sector, weight, shares,
            close, prev_price, open, high, low, volume, avg30_volume,
            week52_high, week52_low,
            call_volume, put_volume, call_premium, put_premium,
            bullish_premium, bearish_premium, has_options,
            updated, last_fetched
        ) VALUES (
            %(etf)s, %(ticker)s, %(short_name)s, %(sector)s, %(weight)s, %(shares)s,
            %(close)s, %(prev_price)s, %(open)s, %(high)s, %(low)s, %(volume)s, %(avg30_volume)s,
            %(week52_high)s, %(week52_low)s,
            %(call_volume)s, %(put_volume)s, %(call_premium)s, %(put_premium)s,
            %(bullish_premium)s, %(bearish_premium)s, %(has_options)s,
            %(updated)s, NOW()
        ) ON CONFLICT (etf, ticker) DO UPDATE SET
            short_name = EXCLUDED.short_name,
            sector = EXCLUDED.sector,
            weight = EXCLUDED.weight,
            shares = EXCLUDED.shares,
            close = EXCLUDED.close,
            prev_price = EXCLUDED.prev_price,
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            volume = EXCLUDED.volume,
            avg30_volume = EXCLUDED.avg30_volume,
            week52_high = EXCLUDED.week52_high,
            week52_low = EXCLUDED.week52_low,
            call_volume = EXCLUDED.call_volume,
            put_volume = EXCLUDED.put_volume,
            call_premium = EXCLUDED.call_premium,
            put_premium = EXCLUDED.put_premium,
            bullish_premium = EXCLUDED.bullish_premium,
            bearish_premium = EXCLUDED.bearish_premium,
            has_options = EXCLUDED.has_options,
            updated = EXCLUDED.updated,
            last_fetched = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ticker = (r.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            cur.execute(
                sql,
                {
                    "etf": etf,
                    "ticker": ticker,
                    "short_name": r.get("short_name"),
                    "sector": r.get("sector"),
                    "weight": _to_float(r.get("weight")),
                    "shares": _to_int(r.get("shares")),
                    "close": _to_float(r.get("close")),
                    "prev_price": _to_float(r.get("prev_price")),
                    "open": _to_float(r.get("open")),
                    "high": _to_float(r.get("high")),
                    "low": _to_float(r.get("low")),
                    "volume": _to_int(r.get("volume")),
                    "avg30_volume": _to_float(r.get("avg30_volume")),
                    "week52_high": _to_float(r.get("week52_high")),
                    "week52_low": _to_float(r.get("week52_low")),
                    "call_volume": _to_int(r.get("call_volume")),
                    "put_volume": _to_int(r.get("put_volume")),
                    "call_premium": _to_float(r.get("call_premium")),
                    "put_premium": _to_float(r.get("put_premium")),
                    "bullish_premium": _to_float(r.get("bullish_premium")),
                    "bearish_premium": _to_float(r.get("bearish_premium")),
                    "has_options": bool(r.get("has_options")),
                    "updated": _to_date(r.get("updated")),
                },
            )
            n += 1
    return n


def _snapshot_breadth_for_etf(conn: psycopg.Connection, etf: str) -> int:
    """Read the current uw_etf_holdings snapshot for `etf` and write one
    breadth row into etf_breadth_snapshots for today's date.

    Run after every holdings refresh so we accumulate a real time series
    that the ranker can train on.
    """
    sql = """
        SELECT weight, close, prev_price, week52_high, week52_low,
               bullish_premium, bearish_premium, call_premium, put_premium
        FROM uw_etf_holdings
        WHERE etf = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (etf,))
        rows = cur.fetchall()
    if not rows:
        return 0

    n = len(rows)
    # Build aggregates with defensive None handling — UW occasionally omits
    # week52_* on freshly-IPO'd names, etc.
    n_up = 0
    n_up_denom = 0
    weighted_num = 0.0
    weighted_denom = 0.0
    near_high = 0
    near_low = 0
    n_52w = 0
    dist_high_vals: list[float] = []
    bull_sum = 0.0
    bear_sum = 0.0
    call_sum = 0.0
    put_sum = 0.0

    for r in rows:
        weight, close, prev, hi52, lo52, bull, bear, call, put = r
        if close is not None and prev not in (None, 0):
            n_up_denom += 1
            if close > prev:
                n_up += 1
            if weight is not None and weight > 0:
                weighted_num += float(weight) * (float(close) / float(prev) - 1.0)
                weighted_denom += float(weight)
        if close is not None and hi52 not in (None, 0) and lo52 not in (None, 0):
            n_52w += 1
            if float(close) >= 0.95 * float(hi52):
                near_high += 1
            if float(close) <= 1.05 * float(lo52):
                near_low += 1
            dist_high_vals.append(float(close) / float(hi52) - 1.0)
        if bull is not None:
            bull_sum += float(bull)
        if bear is not None:
            bear_sum += float(bear)
        if call is not None:
            call_sum += float(call)
        if put is not None:
            put_sum += float(put)

    def _med(xs: list[float]) -> float | None:
        if not xs:
            return None
        s = sorted(xs)
        m = len(s) // 2
        return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0

    now = datetime.now(UTC)
    row = {
        "etf": etf,
        "snapshot_date": now.date(),
        "n_constituents": n,
        "pct_up_1d": (n_up / n_up_denom) if n_up_denom else None,
        "weighted_ret_1d": (weighted_num / weighted_denom) if weighted_denom else None,
        "pct_within_5pct_52w_high": (near_high / n_52w) if n_52w else None,
        "pct_within_5pct_52w_low": (near_low / n_52w) if n_52w else None,
        "median_dist_52w_high": _med(dist_high_vals),
        "bullish_premium_share": (bull_sum / (bull_sum + bear_sum)) if (bull_sum + bear_sum) > 0 else None,
        "call_put_premium_ratio": (call_sum / put_sum) if put_sum > 0 else None,
        "last_fetched": now,
    }
    return upsert_etf_breadth(conn, [row])


def ingest_etf_holdings(database_url: str, api_key: str | None, etfs: Iterable[str]) -> dict:
    """Refresh the full constituent list for each ETF. Run nightly.

    UW indexes the major ETFs but not all of them. For ETFs UW returns 0
    rows for (e.g. ARKK, SMH, JETS, URNM, WCLD), fall back to yfinance's
    top-10 holdings + per-name fast_info price snapshot so the sector
    detail page still renders.

    If `api_key` is falsy, skip UW entirely and use yfinance for every ETF."""
    counts: dict[str, int] = {}
    if not api_key:
        with connect(database_url) as conn:
            for etf in etfs:
                etf = etf.upper()
                try:
                    counts[etf] = _yfinance_holdings_fallback(conn, etf)
                    _snapshot_breadth_for_etf(conn, etf)
                except Exception as e:
                    log.warning("yfinance holdings failed for %s: %s", etf, e)
                    counts[etf] = 0
            conn.commit()
        return counts

    with UwClient(api_key) as uw, connect(database_url) as conn:
        for etf in etfs:
            etf = etf.upper()
            try:
                rows = uw.etf_holdings(etf)
                n = _upsert_etf_holdings(conn, etf, rows)
                if n == 0:
                    log.info("UW returned 0 holdings for %s; trying yfinance fallback", etf)
                    n = _yfinance_holdings_fallback(conn, etf)
                counts[etf] = n
                _snapshot_breadth_for_etf(conn, etf)
            except Exception as e:
                log.warning("etf_holdings failed for %s: %s", etf, e)
                counts[etf] = 0
        conn.commit()
    return counts


def _yfinance_holdings_fallback(conn: psycopg.Connection, etf: str) -> int:
    """For ETFs UW doesn't index, pull top-10 from yfinance + per-name price
    snapshot. Options-sentiment fields stay null (yfinance has no flow data)."""
    try:
        import yfinance as yf
    except ImportError:
        log.warning("yfinance not available for fallback")
        return 0

    try:
        df = yf.Ticker(etf).funds_data.top_holdings
    except Exception as e:
        log.warning("yfinance top_holdings failed for %s: %s", etf, e)
        return 0
    if df is None or df.empty:
        return 0

    fallback_rows: list[dict] = []
    for symbol, row in df.iterrows():
        ticker = str(symbol).upper()
        weight_frac = _to_float(row.get("Holding Percent"))
        weight_pct = weight_frac * 100.0 if weight_frac is not None else None
        name = row.get("Name") if "Name" in row else None

        # Per-ticker price snapshot via yfinance fast_info (one HTTP call each).
        close = prev = high = low = open_ = w52h = w52l = avg30 = None
        vol = None
        try:
            t = yf.Ticker(ticker)
            fi = t.fast_info
            close = _to_float(getattr(fi, "last_price", None))
            prev = _to_float(getattr(fi, "previous_close", None))
            open_ = _to_float(getattr(fi, "open", None))
            high = _to_float(getattr(fi, "day_high", None))
            low = _to_float(getattr(fi, "day_low", None))
            w52h = _to_float(getattr(fi, "year_high", None))
            w52l = _to_float(getattr(fi, "year_low", None))
            avg30 = _to_float(getattr(fi, "ten_day_average_volume", None))
            v = getattr(fi, "last_volume", None)
            vol = _to_int(v) if v is not None else None
        except Exception as e:
            log.debug("yfinance fast_info failed for %s: %s", ticker, e)

        fallback_rows.append({
            "ticker": ticker,
            "short_name": str(name) if name else None,
            "sector": None,
            "weight": weight_pct,
            "shares": None,
            "close": close,
            "prev_price": prev,
            "open": open_,
            "high": high,
            "low": low,
            "volume": vol,
            "avg30_volume": avg30,
            "week52_high": w52h,
            "week52_low": w52l,
            "call_volume": None,
            "put_volume": None,
            "call_premium": None,
            "put_premium": None,
            "bullish_premium": None,
            "bearish_premium": None,
            "has_options": None,
            "updated": None,
        })

    return _upsert_etf_holdings(conn, etf, fallback_rows)


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


def _upsert_volatility_stats(conn: psycopg.Connection, ticker: str, body: dict | None) -> int:
    """One row per (date, ticker). UW returns the latest snapshot."""
    if not body:
        return 0
    iv30 = _to_float(body.get("iv30"))
    rv30 = _to_float(body.get("rv30"))
    iv_rank = _to_float(body.get("iv_rank"))
    iv_pct = _to_float(body.get("iv_percentile"))
    # Some UW responses give 0-100, others 0-1; normalize to 0..1.
    if iv_rank is not None and iv_rank > 1.5:
        iv_rank /= 100.0
    if iv_pct is not None and iv_pct > 1.5:
        iv_pct /= 100.0
    iv_rv = (iv30 / rv30) if (iv30 is not None and rv30 not in (None, 0)) else None
    sql = """
        INSERT INTO uw_volatility_stats (
            snapshot_date, ticker, iv30, iv_rank, iv_percentile, rv30, iv_rv_ratio, last_fetched
        ) VALUES (
            CURRENT_DATE, %s, %s, %s, %s, %s, %s, NOW()
        ) ON CONFLICT (snapshot_date, ticker) DO UPDATE SET
            iv30 = EXCLUDED.iv30,
            iv_rank = EXCLUDED.iv_rank,
            iv_percentile = EXCLUDED.iv_percentile,
            rv30 = EXCLUDED.rv30,
            iv_rv_ratio = EXCLUDED.iv_rv_ratio,
            last_fetched = NOW()
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker, iv30, iv_rank, iv_pct, rv30, iv_rv))
    return 1


def _upsert_market_tide(conn: psycopg.Connection, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_market_tide (ts, net_call_premium, net_put_premium, net_volume)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (ts) DO UPDATE SET
            net_call_premium = EXCLUDED.net_call_premium,
            net_put_premium = EXCLUDED.net_put_premium,
            net_volume = EXCLUDED.net_volume
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("timestamp") or r.get("ts") or r.get("date"))
            if ts is None:
                continue
            cur.execute(
                sql,
                (
                    ts,
                    _to_float(r.get("net_call_premium")),
                    _to_float(r.get("net_put_premium")),
                    _to_int(r.get("net_volume")),
                ),
            )
            n += cur.rowcount
    return n


# ---------- ingest entrypoints ----------


def ingest_ticker(database_url: str, api_key: str, ticker: str) -> dict:
    """Pull all the per-ticker UW endpoints in parallel, then upsert serially.

    Used by `cfp-jobs flow TICKER` and lazily by the agent runner when a
    ticker has no recent UW data and a run is requested.

    Performance note: the 11 endpoints used to run sequentially (~30-60s on
    a cold ticker). httpx.Client is thread-safe across concurrent requests
    via its connection pool, so we fetch all 11 in parallel; the DB upserts
    stay serial because psycopg connections aren't thread-safe and the
    upserts themselves are fast (<50ms each).
    """
    ticker = ticker.upper()
    counts: dict[str, int] = {}

    # (name, fetch_callable, upsert_callable_factory)
    # The upsert factory takes the fetched payload + conn and returns the count.
    # Defining them like this lets us run fetches in parallel and upserts serially
    # without restructuring error isolation.
    with UwClient(api_key) as uw, connect(database_url) as conn:
        fetchers: dict[str, Any] = {
            "stock_info":     lambda: uw.info(ticker),
            "flow_alerts":    lambda: uw.flow_alerts(ticker),
            "dark_pool":      lambda: uw.dark_pool(ticker),
            "net_prem":       lambda: uw.net_prem_ticks(ticker),
            "short_data":     lambda: uw.short_data(ticker),
            "greek_exposure": lambda: uw.greek_exposure(ticker),
            "insider":        lambda: uw.insider_transactions(ticker),
            "oi_change":      lambda: uw.oi_change(ticker),
            "news":           lambda: uw.news_headlines(ticker),
            "earnings":       lambda: uw.earnings(ticker),
            "volatility":     lambda: uw.volatility_stats(ticker),
        }
        results: dict[str, Any] = {}
        errors: dict[str, Exception] = {}
        # 11 endpoints; UW limit is 120/min so 11 concurrent is safely under
        # the budget. Cap at 11 workers to match the call count.
        with ThreadPoolExecutor(max_workers=11, thread_name_prefix="uw") as ex:
            future_to_key = {ex.submit(fn): key for key, fn in fetchers.items()}
            for fut in future_to_key:
                key = future_to_key[fut]
                try:
                    results[key] = fut.result()
                except Exception as e:  # noqa: BLE001
                    errors[key] = e

        # Upsert serially — each in its own savepoint so a single bad payload
        # rolls back only its step (matches previous behavior).
        upserters: dict[str, Any] = {
            "stock_info":     lambda p: _upsert_stock_info(conn, ticker, p),
            "flow_alerts":    lambda p: _upsert_flow_alerts(conn, ticker, p),
            "dark_pool":      lambda p: _upsert_dark_pool(conn, ticker, p),
            "net_prem":       lambda p: _upsert_net_prem_daily(conn, ticker, p),
            "short_data":     lambda p: _upsert_short_data(conn, ticker, p),
            "greek_exposure": lambda p: _upsert_greek_exposure(conn, ticker, p),
            "insider":        lambda p: _upsert_insider(conn, ticker, p),
            "oi_change":      lambda p: _upsert_oi_change(conn, ticker, p),
            "news":           lambda p: _upsert_news(conn, p),
            "earnings":       lambda p: _upsert_earnings(conn, ticker, p),
            "volatility":     lambda p: _upsert_volatility_stats(conn, ticker, p),
        }
        for key, payload in results.items():
            try:
                with conn.transaction():
                    counts[key] = upserters[key](payload)
            except Exception as e:  # noqa: BLE001
                log.warning("%s upsert failed for %s: %s", key, ticker, e)
                counts[key] = 0
        # Any keys that errored during fetch get logged + counted as 0.
        for key, e in errors.items():
            log.warning("%s fetch failed for %s: %s", key, ticker, e)
            counts[key] = 0

        conn.commit()
    return {"ticker": ticker, **counts}


def ingest_market_tide(database_url: str, api_key: str) -> int:
    """Refresh the market-wide net premium tape. Run every ~5min during RTH.

    UW returns ~one row per 1-minute bucket for the current session; we upsert
    so a re-run inside the same minute idempotently overwrites."""
    with UwClient(api_key) as uw, connect(database_url) as conn:
        rows = uw.market_tide()
        n = _upsert_market_tide(conn, rows)
        conn.commit()
    return n


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
