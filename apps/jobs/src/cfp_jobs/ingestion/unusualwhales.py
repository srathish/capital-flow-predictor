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
