"""Explosive-options tab — ingestion + upserts for the 9 new UW endpoints.

Tables defined in 0024_explosive_options.sql:
  /screeners/contract-screener           -> uw_contract_screener
  /stock/{T}/flow-per-strike             -> uw_flow_per_strike
  /stock/{T}/flow-per-expiry             -> uw_flow_per_expiry
  /stock/{T}/implied-volatility-term-structure -> uw_iv_term_structure
  /stock/{T}/max-pain                    -> uw_max_pain
  /screeners/short-screener              -> uw_short_screener
  /shorts/{T}/failures-to-deliver        -> uw_failures_to_deliver
  /market/fda-calendar                   -> uw_fda_calendar
  /intel/ipo-calendar                    -> uw_ipo_calendar

Two layers:
  * _upsert_* writes one batch idempotently.
  * ingest_explosive_universe() is the orchestrator the CLI calls — it builds
    the catalyst watchlist (contract_screener ∪ FDA ∪ IPO ∪ earnings-next-10d),
    then pulls per-ticker flow/IV/max-pain/FTD for every name on it.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
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


# ---------- helpers ----------


def _occ_parse(symbol: str) -> tuple[str, date | None, str | None, float | None]:
    """Parse an OCC-style option symbol like RGTI260516C00010000.

    Returns (ticker, expiry, 'call'|'put', strike). Returns Nones on failure.
    OCC layout: <ROOT 1-6 chars><YYMMDD><C|P><strike*1000 8 digits>.
    """
    if not symbol or len(symbol) < 15:
        return symbol or "", None, None, None
    # Strike is last 8 chars; type is char before that; expiry is 6 before.
    try:
        strike_raw = symbol[-8:]
        opt_char = symbol[-9]
        expiry_raw = symbol[-15:-9]
        ticker = symbol[:-15]
        opt_type = "call" if opt_char.upper() == "C" else "put" if opt_char.upper() == "P" else None
        expiry = datetime.strptime(expiry_raw, "%y%m%d").date()
        strike = int(strike_raw) / 1000.0
        return ticker, expiry, opt_type, strike
    except (ValueError, IndexError):
        return symbol, None, None, None


# ---------- contract_screener ----------


def _upsert_contract_screener(
    conn: psycopg.Connection,
    snapshot_ts: datetime,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_contract_screener (
            snapshot_ts, option_symbol, ticker, option_type, expiry, strike,
            underlying_price, last_price, volume, open_interest, volume_oi_ratio,
            total_premium, ask_side_prem, bid_side_prem,
            iv, delta, gamma, theta, vega, payload
        ) VALUES (
            %(snapshot_ts)s, %(option_symbol)s, %(ticker)s, %(option_type)s, %(expiry)s, %(strike)s,
            %(underlying_price)s, %(last_price)s, %(volume)s, %(open_interest)s, %(volume_oi_ratio)s,
            %(total_premium)s, %(ask_side_prem)s, %(bid_side_prem)s,
            %(iv)s, %(delta)s, %(gamma)s, %(theta)s, %(vega)s, %(payload)s
        ) ON CONFLICT (snapshot_ts, option_symbol) DO NOTHING
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            sym = r.get("option_symbol") or r.get("option_chain") or r.get("symbol") or ""
            parsed_ticker, parsed_expiry, parsed_type, parsed_strike = _occ_parse(sym)
            params = {
                "snapshot_ts": snapshot_ts,
                "option_symbol": sym,
                "ticker": (r.get("ticker") or parsed_ticker or "").upper(),
                "option_type": (r.get("type") or parsed_type or "").lower(),
                "expiry": _to_date(r.get("expiry")) or parsed_expiry,
                "strike": _to_float(r.get("strike")) or parsed_strike,
                "underlying_price": _to_float(r.get("underlying_price") or r.get("stock_price")),
                "last_price": _to_float(r.get("last_price") or r.get("price")),
                "volume": _to_int(r.get("volume")),
                "open_interest": _to_int(r.get("open_interest")),
                "volume_oi_ratio": _to_float(r.get("volume_oi_ratio")),
                "total_premium": _to_float(r.get("total_premium") or r.get("premium")),
                "ask_side_prem": _to_float(r.get("total_ask_side_prem") or r.get("ask_side_prem")),
                "bid_side_prem": _to_float(r.get("total_bid_side_prem") or r.get("bid_side_prem")),
                "iv": _to_float(r.get("iv") or r.get("implied_volatility")),
                "delta": _to_float(r.get("delta")),
                "gamma": _to_float(r.get("gamma")),
                "theta": _to_float(r.get("theta")),
                "vega": _to_float(r.get("vega")),
                "payload": Jsonb(r),
            }
            if not params["option_symbol"]:
                continue
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- flow_per_strike ----------


def _upsert_flow_per_strike(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_flow_per_strike (
            snapshot_date, ticker, expiry, strike,
            call_volume, put_volume, call_premium, put_premium,
            call_ask_premium, call_bid_premium, put_ask_premium, put_bid_premium,
            call_oi, put_oi, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(expiry)s, %(strike)s,
            %(call_volume)s, %(put_volume)s, %(call_premium)s, %(put_premium)s,
            %(call_ask_premium)s, %(call_bid_premium)s, %(put_ask_premium)s, %(put_bid_premium)s,
            %(call_oi)s, %(put_oi)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, expiry, strike) DO UPDATE SET
            call_volume = EXCLUDED.call_volume,
            put_volume = EXCLUDED.put_volume,
            call_premium = EXCLUDED.call_premium,
            put_premium = EXCLUDED.put_premium,
            call_ask_premium = EXCLUDED.call_ask_premium,
            call_bid_premium = EXCLUDED.call_bid_premium,
            put_ask_premium = EXCLUDED.put_ask_premium,
            put_bid_premium = EXCLUDED.put_bid_premium,
            call_oi = EXCLUDED.call_oi,
            put_oi = EXCLUDED.put_oi,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            expiry = _to_date(r.get("expiry"))
            strike = _to_float(r.get("strike"))
            if expiry is None or strike is None:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "expiry": expiry,
                "strike": strike,
                "call_volume": _to_int(r.get("call_volume")),
                "put_volume": _to_int(r.get("put_volume")),
                "call_premium": _to_float(r.get("call_premium")),
                "put_premium": _to_float(r.get("put_premium")),
                "call_ask_premium": _to_float(r.get("call_ask_premium") or r.get("call_ask_prem")),
                "call_bid_premium": _to_float(r.get("call_bid_premium") or r.get("call_bid_prem")),
                "put_ask_premium": _to_float(r.get("put_ask_premium") or r.get("put_ask_prem")),
                "put_bid_premium": _to_float(r.get("put_bid_premium") or r.get("put_bid_prem")),
                "call_oi": _to_int(r.get("call_oi") or r.get("call_open_interest")),
                "put_oi": _to_int(r.get("put_oi") or r.get("put_open_interest")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- flow_per_expiry ----------


def _upsert_flow_per_expiry(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_flow_per_expiry (
            snapshot_date, ticker, expiry,
            call_volume, put_volume, call_premium, put_premium,
            call_ask_premium, put_ask_premium, call_oi, put_oi, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(expiry)s,
            %(call_volume)s, %(put_volume)s, %(call_premium)s, %(put_premium)s,
            %(call_ask_premium)s, %(put_ask_premium)s, %(call_oi)s, %(put_oi)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, expiry) DO UPDATE SET
            call_volume = EXCLUDED.call_volume,
            put_volume = EXCLUDED.put_volume,
            call_premium = EXCLUDED.call_premium,
            put_premium = EXCLUDED.put_premium,
            call_ask_premium = EXCLUDED.call_ask_premium,
            put_ask_premium = EXCLUDED.put_ask_premium,
            call_oi = EXCLUDED.call_oi,
            put_oi = EXCLUDED.put_oi,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            expiry = _to_date(r.get("expiry"))
            if expiry is None:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "expiry": expiry,
                "call_volume": _to_int(r.get("call_volume")),
                "put_volume": _to_int(r.get("put_volume")),
                "call_premium": _to_float(r.get("call_premium")),
                "put_premium": _to_float(r.get("put_premium")),
                "call_ask_premium": _to_float(r.get("call_ask_premium") or r.get("call_ask_prem")),
                "put_ask_premium": _to_float(r.get("put_ask_premium") or r.get("put_ask_prem")),
                "call_oi": _to_int(r.get("call_oi") or r.get("call_open_interest")),
                "put_oi": _to_int(r.get("put_oi") or r.get("put_open_interest")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- iv_term_structure ----------


def _upsert_iv_term_structure(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_iv_term_structure (
            snapshot_date, ticker, expiry, dte, iv, iv_atm, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(expiry)s, %(dte)s, %(iv)s, %(iv_atm)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, expiry) DO UPDATE SET
            dte = EXCLUDED.dte,
            iv = EXCLUDED.iv,
            iv_atm = EXCLUDED.iv_atm,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            expiry = _to_date(r.get("expiry"))
            if expiry is None:
                continue
            dte = _to_int(r.get("dte"))
            if dte is None and expiry:
                dte = (expiry - snapshot_date).days
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "expiry": expiry,
                "dte": dte,
                "iv": _to_float(r.get("iv") or r.get("implied_volatility")),
                "iv_atm": _to_float(r.get("iv_atm") or r.get("atm_iv")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- max_pain ----------


def _upsert_max_pain(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_max_pain (
            snapshot_date, ticker, expiry, max_pain_strike, underlying_price, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(expiry)s, %(max_pain_strike)s, %(underlying_price)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, expiry) DO UPDATE SET
            max_pain_strike = EXCLUDED.max_pain_strike,
            underlying_price = EXCLUDED.underlying_price,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            expiry = _to_date(r.get("expiry"))
            if expiry is None:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "expiry": expiry,
                "max_pain_strike": _to_float(r.get("max_pain") or r.get("max_pain_strike")),
                "underlying_price": _to_float(r.get("underlying_price") or r.get("stock_price")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- short_screener ----------


def _upsert_short_screener(
    conn: psycopg.Connection,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_short_screener (
            snapshot_date, ticker, short_interest, short_percent_float,
            days_to_cover, utilization, cost_to_borrow, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(short_interest)s, %(short_percent_float)s,
            %(days_to_cover)s, %(utilization)s, %(cost_to_borrow)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker) DO UPDATE SET
            short_interest = EXCLUDED.short_interest,
            short_percent_float = EXCLUDED.short_percent_float,
            days_to_cover = EXCLUDED.days_to_cover,
            utilization = EXCLUDED.utilization,
            cost_to_borrow = EXCLUDED.cost_to_borrow,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            if not ticker:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "short_interest": _to_float(r.get("short_interest")),
                "short_percent_float": _to_float(
                    r.get("short_percent_float") or r.get("short_percent_of_float")
                ),
                "days_to_cover": _to_float(r.get("days_to_cover")),
                "utilization": _to_float(r.get("utilization")),
                "cost_to_borrow": _to_float(r.get("cost_to_borrow") or r.get("ctb")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- failures_to_deliver ----------


def _upsert_failures_to_deliver(
    conn: psycopg.Connection,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_failures_to_deliver (
            settlement_date, ticker, quantity, price, payload
        ) VALUES (
            %(settlement_date)s, %(ticker)s, %(quantity)s, %(price)s, %(payload)s
        ) ON CONFLICT (settlement_date, ticker) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            price = EXCLUDED.price,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            settlement = _to_date(r.get("settlement_date") or r.get("date"))
            if settlement is None:
                continue
            params = {
                "settlement_date": settlement,
                "ticker": ticker,
                "quantity": _to_int(r.get("quantity") or r.get("ftd_quantity")),
                "price": _to_float(r.get("price")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- fda_calendar ----------


def _upsert_fda_calendar(conn: psycopg.Connection, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_fda_calendar (
            catalyst_date, ticker, drug, catalyst, indication, notes, payload
        ) VALUES (
            %(catalyst_date)s, %(ticker)s, %(drug)s, %(catalyst)s, %(indication)s, %(notes)s, %(payload)s
        ) ON CONFLICT (catalyst_date, ticker, drug) DO UPDATE SET
            catalyst = EXCLUDED.catalyst,
            indication = EXCLUDED.indication,
            notes = EXCLUDED.notes,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            cdate = _to_date(r.get("catalyst_date") or r.get("date") or r.get("pdufa_date"))
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            drug = r.get("drug") or r.get("drug_name") or ""
            if cdate is None or not ticker:
                continue
            params = {
                "catalyst_date": cdate,
                "ticker": ticker,
                "drug": drug,
                "catalyst": r.get("catalyst") or r.get("event_type"),
                "indication": r.get("indication"),
                "notes": r.get("notes") or r.get("description"),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- ipo_calendar ----------


def _upsert_ipo_calendar(conn: psycopg.Connection, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_ipo_calendar (
            ipo_date, ticker, company_name, price_low, price_high,
            shares_offered, deal_status, exchange, payload
        ) VALUES (
            %(ipo_date)s, %(ticker)s, %(company_name)s, %(price_low)s, %(price_high)s,
            %(shares_offered)s, %(deal_status)s, %(exchange)s, %(payload)s
        ) ON CONFLICT (ipo_date, ticker) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            price_low = EXCLUDED.price_low,
            price_high = EXCLUDED.price_high,
            shares_offered = EXCLUDED.shares_offered,
            deal_status = EXCLUDED.deal_status,
            exchange = EXCLUDED.exchange,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ipo_date = _to_date(r.get("ipo_date") or r.get("expected_date") or r.get("date"))
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            if ipo_date is None or not ticker:
                continue
            params = {
                "ipo_date": ipo_date,
                "ticker": ticker,
                "company_name": r.get("company_name") or r.get("name"),
                "price_low": _to_float(r.get("price_low") or r.get("expected_price_low")),
                "price_high": _to_float(r.get("price_high") or r.get("expected_price_high")),
                "shares_offered": _to_int(r.get("shares_offered")),
                "deal_status": r.get("deal_status") or r.get("status"),
                "exchange": r.get("exchange"),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- Phase 2: confirmation-signal upserts ----------


def _upsert_nope(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    payload: Any,
) -> int:
    """NOPE returns either a dict (single value) or a list of recent values.
    We store the latest snapshot only — keyed (snapshot_date, ticker)."""
    if payload is None:
        return 0
    row = payload if isinstance(payload, dict) else (payload[0] if payload else None)
    if not row:
        return 0
    sql = """
        INSERT INTO uw_nope (snapshot_date, ticker, nope, nope_z, underlying_price, payload)
        VALUES (%(snapshot_date)s, %(ticker)s, %(nope)s, %(nope_z)s, %(underlying_price)s, %(payload)s)
        ON CONFLICT (snapshot_date, ticker) DO UPDATE SET
            nope = EXCLUDED.nope,
            nope_z = EXCLUDED.nope_z,
            underlying_price = EXCLUDED.underlying_price,
            payload = EXCLUDED.payload
    """
    params = {
        "snapshot_date": snapshot_date,
        "ticker": ticker,
        "nope": _to_float(row.get("nope") or row.get("value")),
        "nope_z": _to_float(row.get("nope_z") or row.get("z_score")),
        "underlying_price": _to_float(row.get("underlying_price") or row.get("price")),
        "payload": Jsonb(row),
    }
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def _upsert_risk_reversal_skew(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_risk_reversal_skew (
            snapshot_date, ticker, dte, skew, call_iv, put_iv, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(dte)s, %(skew)s, %(call_iv)s, %(put_iv)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, dte) DO UPDATE SET
            skew = EXCLUDED.skew,
            call_iv = EXCLUDED.call_iv,
            put_iv = EXCLUDED.put_iv,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            dte = _to_int(r.get("dte") or r.get("days_to_expiration"))
            if dte is None:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "dte": dte,
                "skew": _to_float(r.get("skew") or r.get("risk_reversal")),
                "call_iv": _to_float(r.get("call_iv") or r.get("call_implied_volatility")),
                "put_iv": _to_float(r.get("put_iv") or r.get("put_implied_volatility")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def _upsert_realized_volatility(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_realized_volatility (
            snapshot_date, ticker, rv_window_days, realized_volatility, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(rv_window_days)s, %(realized_volatility)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, rv_window_days) DO UPDATE SET
            realized_volatility = EXCLUDED.realized_volatility,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            window = _to_int(r.get("window") or r.get("window_days") or r.get("days"))
            if window is None:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "rv_window_days": window,
                "realized_volatility": _to_float(
                    r.get("realized_volatility") or r.get("rv") or r.get("value")
                ),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def _upsert_volume_profile(
    conn: psycopg.Connection,
    option_symbol: str,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    ticker, _expiry, _opt_type, _strike = _occ_parse(option_symbol)
    sql = """
        INSERT INTO uw_volume_profile (
            snapshot_date, option_symbol, ticker, price_level, volume, premium, payload
        ) VALUES (
            %(snapshot_date)s, %(option_symbol)s, %(ticker)s, %(price_level)s, %(volume)s, %(premium)s, %(payload)s
        ) ON CONFLICT (snapshot_date, option_symbol, price_level) DO UPDATE SET
            volume = EXCLUDED.volume,
            premium = EXCLUDED.premium,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            price_level = _to_float(r.get("price_level") or r.get("price") or r.get("level"))
            if price_level is None:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "option_symbol": option_symbol,
                "ticker": ticker,
                "price_level": price_level,
                "volume": _to_int(r.get("volume")),
                "premium": _to_float(r.get("premium")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def _upsert_insider_ticker_flow(
    conn: psycopg.Connection,
    ticker: str,
    snapshot_date: date,
    payload: Any,
) -> int:
    """Flow endpoint may return a single dict or one row per lookback window.
    We persist whatever shape we get."""
    if payload is None:
        return 0
    rows = payload if isinstance(payload, list) else [payload]
    sql = """
        INSERT INTO uw_insider_ticker_flow (
            snapshot_date, ticker, lookback_days,
            net_buy_value, buy_count, sell_count, buy_value, sell_value, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(lookback_days)s,
            %(net_buy_value)s, %(buy_count)s, %(sell_count)s, %(buy_value)s, %(sell_value)s, %(payload)s
        ) ON CONFLICT (snapshot_date, ticker, lookback_days) DO UPDATE SET
            net_buy_value = EXCLUDED.net_buy_value,
            buy_count = EXCLUDED.buy_count,
            sell_count = EXCLUDED.sell_count,
            buy_value = EXCLUDED.buy_value,
            sell_value = EXCLUDED.sell_value,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            lookback = _to_int(r.get("lookback_days") or r.get("window") or r.get("days")) or 30
            buy_val = _to_float(r.get("buy_value") or r.get("total_buy_value"))
            sell_val = _to_float(r.get("sell_value") or r.get("total_sell_value"))
            net = _to_float(r.get("net_buy_value") or r.get("net_value"))
            if net is None and (buy_val is not None or sell_val is not None):
                net = (buy_val or 0.0) - (sell_val or 0.0)
            params = {
                "snapshot_date": snapshot_date,
                "ticker": ticker,
                "lookback_days": lookback,
                "net_buy_value": net,
                "buy_count": _to_int(r.get("buy_count")),
                "sell_count": _to_int(r.get("sell_count")),
                "buy_value": buy_val,
                "sell_value": sell_val,
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


# ---------- Phase 3: drilldown upserts ----------


def _upsert_option_contract_history(
    conn: psycopg.Connection,
    option_symbol: str,
    rows: Iterable[dict],
) -> int:
    parsed_ticker, _, _, _ = _occ_parse(option_symbol)
    sql = """
        INSERT INTO uw_option_contract_history (
            trade_date, option_symbol, ticker,
            open, high, low, close, volume, open_interest,
            iv_open, iv_close, underlying_open, underlying_close, payload
        ) VALUES (
            %(trade_date)s, %(option_symbol)s, %(ticker)s,
            %(open)s, %(high)s, %(low)s, %(close)s, %(volume)s, %(open_interest)s,
            %(iv_open)s, %(iv_close)s, %(underlying_open)s, %(underlying_close)s, %(payload)s
        ) ON CONFLICT (trade_date, option_symbol) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            open_interest = EXCLUDED.open_interest,
            iv_open = EXCLUDED.iv_open,
            iv_close = EXCLUDED.iv_close,
            underlying_open = EXCLUDED.underlying_open,
            underlying_close = EXCLUDED.underlying_close,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            trade_date = _to_date(r.get("date") or r.get("trade_date"))
            if trade_date is None:
                continue
            params = {
                "trade_date": trade_date,
                "option_symbol": option_symbol,
                "ticker": parsed_ticker,
                "open": _to_float(r.get("open")),
                "high": _to_float(r.get("high")),
                "low": _to_float(r.get("low")),
                "close": _to_float(r.get("close")),
                "volume": _to_int(r.get("volume")),
                "open_interest": _to_int(r.get("open_interest") or r.get("oi")),
                "iv_open": _to_float(r.get("iv_open")),
                "iv_close": _to_float(r.get("iv_close") or r.get("iv")),
                "underlying_open": _to_float(r.get("underlying_open") or r.get("stock_open")),
                "underlying_close": _to_float(r.get("underlying_close") or r.get("stock_close")),
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def _upsert_top_net_impact(
    conn: psycopg.Connection,
    snapshot_ts: datetime,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_top_net_impact (
            snapshot_ts, ticker, net_delta, net_gamma, net_premium, rank, payload
        ) VALUES (
            %(snapshot_ts)s, %(ticker)s, %(net_delta)s, %(net_gamma)s, %(net_premium)s, %(rank)s, %(payload)s
        ) ON CONFLICT (snapshot_ts, ticker) DO UPDATE SET
            net_delta = EXCLUDED.net_delta,
            net_gamma = EXCLUDED.net_gamma,
            net_premium = EXCLUDED.net_premium,
            rank = EXCLUDED.rank,
            payload = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for idx, r in enumerate(rows, start=1):
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            if not ticker:
                continue
            params = {
                "snapshot_ts": snapshot_ts,
                "ticker": ticker,
                "net_delta": _to_float(r.get("net_delta")),
                "net_gamma": _to_float(r.get("net_gamma")),
                "net_premium": _to_float(r.get("net_premium")),
                "rank": _to_int(r.get("rank")) or idx,
                "payload": Jsonb(r),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def _upsert_correlations(
    conn: psycopg.Connection,
    snapshot_date: date,
    rows: Iterable[dict],
) -> int:
    """UW correlations returns one row per (fst, snd) ordered pair.

    Schema lives in migration 0027 (flow-tab-additions). Columns:
    (snapshot_date, fst_ticker, snd_ticker) PK + correlation + min_date +
    max_date + sample_rows + last_fetched. We're the explosive tab and only
    care about the pair + correlation; window_days from our payload is left
    NULL since flow-tab schema doesn't have that column."""
    sql = """
        INSERT INTO uw_correlations (
            snapshot_date, fst_ticker, snd_ticker, correlation,
            min_date, max_date, sample_rows, last_fetched
        ) VALUES (
            %(snapshot_date)s, %(fst_ticker)s, %(snd_ticker)s, %(correlation)s,
            %(min_date)s, %(max_date)s, %(sample_rows)s, NOW()
        ) ON CONFLICT (snapshot_date, fst_ticker, snd_ticker) DO UPDATE SET
            correlation = EXCLUDED.correlation,
            min_date = COALESCE(EXCLUDED.min_date, uw_correlations.min_date),
            max_date = COALESCE(EXCLUDED.max_date, uw_correlations.max_date),
            sample_rows = COALESCE(EXCLUDED.sample_rows, uw_correlations.sample_rows),
            last_fetched = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            a = (r.get("fst_ticker") or r.get("fst") or r.get("ticker_a") or r.get("ticker") or "").upper()
            b = (r.get("snd_ticker") or r.get("snd") or r.get("ticker_b") or r.get("peer") or "").upper()
            if not a or not b or a == b:
                continue
            params = {
                "snapshot_date": snapshot_date,
                "fst_ticker": a,
                "snd_ticker": b,
                "correlation": _to_float(r.get("correlation") or r.get("corr")),
                "min_date": _to_date(r.get("min_date")),
                "max_date": _to_date(r.get("max_date")),
                "sample_rows": _to_int(r.get("sample_rows") or r.get("rows")),
            }
            cur.execute(sql, params)
            n += cur.rowcount
    return n


def ingest_top_net_impact(database_url: str, api_key: str) -> int:
    """Refresh market-wide dealer-impact leaderboard. Run every ~15min RTH."""
    now = datetime.now(UTC)
    with UwClient(api_key) as uw, connect(database_url) as conn:
        rows = uw.top_net_impact(limit=50)
        n = _upsert_top_net_impact(conn, now, rows)
        conn.commit()
    return n


def ingest_correlations_for_top(
    database_url: str,
    api_key: str,
    limit: int = 25,
) -> int:
    """Pull pairwise correlations for the top scored tickers. UW's correlations
    endpoint takes a basket and returns the full matrix in one call."""
    today = datetime.now(UTC).date()
    with connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT ticker
            FROM explosive_scores
            WHERE snapshot_ts = (SELECT MAX(snapshot_ts) FROM explosive_scores)
            ORDER BY score DESC
            LIMIT %s
            """,
            (limit,),
        )
        tickers = [row[0] for row in cur.fetchall() if row[0]]
    if len(tickers) < 2:
        return 0
    with UwClient(api_key) as uw, connect(database_url) as conn:
        rows = uw.correlations(tickers)
        with conn.transaction():
            n = _upsert_correlations(conn, today, rows)
        conn.commit()
    return n


def ingest_top_contract_history(
    database_url: str,
    api_key: str,
    limit: int = 40,
) -> dict[str, int]:
    """Backfill daily OHLC history for the top contracts on the latest
    explosive_scores snapshot. One UW call per contract."""
    counts: dict[str, int] = {}
    with connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT top_option_symbol
            FROM explosive_scores
            WHERE snapshot_ts = (SELECT MAX(snapshot_ts) FROM explosive_scores)
              AND top_option_symbol IS NOT NULL
            ORDER BY score DESC
            LIMIT %s
            """,
            (limit,),
        )
        symbols = [row[0] for row in cur.fetchall() if row[0]]
    if not symbols:
        return counts
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for sym in symbols:
            try:
                with conn.transaction():
                    counts[sym] = _upsert_option_contract_history(
                        conn, sym, uw.option_contract_history(sym)
                    )
            except Exception as e:
                log.warning("option_contract_history failed for %s: %s", sym, e)
                counts[sym] = 0
        conn.commit()
    return counts


# ---------- top-level ingest entry points (CLI) ----------


def ingest_market_screeners(database_url: str, api_key: str) -> dict[str, int]:
    """One-call market-wide endpoints: contract_screener, short_screener,
    fda_calendar, ipo_calendar. Run on a 5-15min cadence during RTH."""
    counts: dict[str, int] = {}
    now = datetime.now(UTC)
    today = now.date()
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            with conn.transaction():
                counts["contract_screener"] = _upsert_contract_screener(
                    conn, now, uw.contract_screener(limit=200)
                )
        except Exception as e:
            log.warning("contract_screener ingest failed: %s", e)
            counts["contract_screener"] = 0
        try:
            with conn.transaction():
                counts["short_screener"] = _upsert_short_screener(
                    conn, today, uw.short_screener(limit=200)
                )
        except Exception as e:
            log.warning("short_screener ingest failed: %s", e)
            counts["short_screener"] = 0
        try:
            with conn.transaction():
                counts["fda_calendar"] = _upsert_fda_calendar(conn, uw.fda_calendar())
        except Exception as e:
            log.warning("fda_calendar ingest failed: %s", e)
            counts["fda_calendar"] = 0
        try:
            with conn.transaction():
                counts["ipo_calendar"] = _upsert_ipo_calendar(conn, uw.ipo_calendar())
        except Exception as e:
            log.warning("ipo_calendar ingest failed: %s", e)
            counts["ipo_calendar"] = 0
        conn.commit()
    return counts


def ingest_per_ticker_explosive(
    database_url: str,
    api_key: str,
    ticker: str,
) -> dict[str, int]:
    """Per-ticker pull: flow_per_strike, flow_per_expiry, iv_term_structure,
    max_pain, failures_to_deliver. Called once per watchlist ticker."""
    ticker = ticker.upper()
    today = datetime.now(UTC).date()
    counts: dict[str, int] = {}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        fetchers = {
            "flow_per_strike":  lambda: uw.flow_per_strike(ticker),
            "flow_per_expiry":  lambda: uw.flow_per_expiry(ticker),
            "iv_term":          lambda: uw.iv_term_structure(ticker),
            "max_pain":         lambda: uw.max_pain(ticker),
            "ftd":              lambda: uw.failures_to_deliver(ticker),
            # Phase 2 confirmation signals
            "nope":             lambda: uw.nope(ticker),
            "rrs":              lambda: uw.historical_risk_reversal_skew(ticker),
            "rv":               lambda: uw.realized_volatility(ticker),
            "insider_flow":     lambda: uw.insider_ticker_flow(ticker),
        }
        results: dict[str, Any] = {}
        errors: dict[str, Exception] = {}
        with ThreadPoolExecutor(max_workers=9, thread_name_prefix=f"uw-{ticker}") as ex:
            future_to_key = {ex.submit(fn): key for key, fn in fetchers.items()}
            for fut in as_completed(future_to_key):
                key = future_to_key[fut]
                try:
                    results[key] = fut.result()
                except Exception as e:
                    errors[key] = e

        upserters = {
            "flow_per_strike":  lambda p: _upsert_flow_per_strike(conn, ticker, today, p),
            "flow_per_expiry": lambda p: _upsert_flow_per_expiry(conn, ticker, today, p),
            "iv_term":          lambda p: _upsert_iv_term_structure(conn, ticker, today, p),
            "max_pain":         lambda p: _upsert_max_pain(conn, ticker, today, p),
            "ftd":              lambda p: _upsert_failures_to_deliver(conn, ticker, p),
            "nope":             lambda p: _upsert_nope(conn, ticker, today, p),
            "rrs":              lambda p: _upsert_risk_reversal_skew(conn, ticker, today, p),
            "rv":               lambda p: _upsert_realized_volatility(conn, ticker, today, p),
            "insider_flow":     lambda p: _upsert_insider_ticker_flow(conn, ticker, today, p),
        }
        for key, payload in results.items():
            try:
                with conn.transaction():
                    counts[key] = upserters[key](payload)
            except Exception as e:
                log.warning("%s upsert failed for %s: %s", key, ticker, e)
                counts[key] = 0
        for key, e in errors.items():
            log.warning("%s fetch failed for %s: %s", key, ticker, e)
            counts[key] = 0
        conn.commit()
    return counts


# ---------- watchlist resolution ----------


def resolve_explosive_universe(
    database_url: str,
    days_ahead: int = 10,
    contract_screener_limit: int = 60,
) -> list[str]:
    """Resolve the catalyst-aware watchlist:
       contract_screener_tickers ∪ FDA(next N days) ∪ IPO(next N days)
       ∪ earnings(next N days from uw_earnings).
    De-duplicated, uppercased. Caller pulls per-ticker data for each."""
    today = datetime.now(UTC).date()
    horizon = today + timedelta(days=days_ahead)
    universe: set[str] = set()
    with connect(database_url) as conn, conn.cursor() as cur:
        # most recent contract_screener snapshot
        cur.execute(
            """
            SELECT DISTINCT ticker
            FROM uw_contract_screener
            WHERE snapshot_ts = (SELECT MAX(snapshot_ts) FROM uw_contract_screener)
            ORDER BY ticker
            LIMIT %s
            """,
            (contract_screener_limit,),
        )
        universe.update(row[0] for row in cur.fetchall() if row[0])
        # FDA catalysts in horizon
        cur.execute(
            "SELECT DISTINCT ticker FROM uw_fda_calendar WHERE catalyst_date BETWEEN %s AND %s",
            (today, horizon),
        )
        universe.update(row[0] for row in cur.fetchall() if row[0])
        # IPOs in horizon
        cur.execute(
            "SELECT DISTINCT ticker FROM uw_ipo_calendar WHERE ipo_date BETWEEN %s AND %s",
            (today, horizon),
        )
        universe.update(row[0] for row in cur.fetchall() if row[0])
        # Earnings in horizon (uses existing uw_earnings table from migration 0005)
        try:
            cur.execute(
                """
                SELECT DISTINCT ticker
                FROM uw_earnings
                WHERE report_date BETWEEN %s AND %s
                """,
                (today, horizon),
            )
            universe.update(row[0] for row in cur.fetchall() if row[0])
        except psycopg.errors.UndefinedTable:
            pass
        except psycopg.errors.UndefinedColumn:
            # column name might differ; soft-fail
            pass
    return sorted(t.upper() for t in universe if t)


def ingest_volume_profiles(
    database_url: str,
    api_key: str,
    limit: int = 40,
) -> dict[str, int]:
    """Pull volume_profile for the top contracts in the latest contract_screener
    snapshot. Runs after `ingest_market_screeners` so the screener table is
    fresh. Skips contracts already profiled today (cheap idempotency)."""
    today = datetime.now(UTC).date()
    counts: dict[str, int] = {}
    with connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT option_symbol
            FROM uw_contract_screener
            WHERE snapshot_ts = (SELECT MAX(snapshot_ts) FROM uw_contract_screener)
              AND option_type = 'call'
              AND option_symbol NOT IN (
                SELECT DISTINCT option_symbol
                FROM uw_volume_profile
                WHERE snapshot_date = %s
              )
            ORDER BY COALESCE(ask_side_prem, total_premium, 0) DESC
            LIMIT %s
            """,
            (today, limit),
        )
        symbols = [row[0] for row in cur.fetchall() if row[0]]
    if not symbols:
        return counts
    with UwClient(api_key) as uw, connect(database_url) as conn:
        for sym in symbols:
            try:
                with conn.transaction():
                    counts[sym] = _upsert_volume_profile(conn, sym, today, uw.volume_profile(sym))
            except Exception as e:
                log.warning("volume_profile failed for %s: %s", sym, e)
                counts[sym] = 0
        conn.commit()
    return counts


def ingest_explosive_universe(
    database_url: str,
    api_key: str,
    max_tickers: int = 80,
    volume_profile_limit: int = 40,
) -> dict[str, Any]:
    """One-shot pipeline:
       1. Refresh market screeners (contract_screener, short_screener, FDA, IPO)
       2. Pull volume_profile for the top contracts that just landed
       3. Resolve catalyst universe (post-screener)
       4. Pull per-ticker flow/IV/max-pain/FTD + Phase 2 confirmation signals

    Returns a summary dict with counts. Called from `cfp-jobs explosive-ingest`."""
    summary: dict[str, Any] = {"phase": {}}
    summary["phase"]["screeners"] = ingest_market_screeners(database_url, api_key)
    summary["phase"]["volume_profile"] = {
        "contracts": len(ingest_volume_profiles(database_url, api_key, limit=volume_profile_limit))
    }
    try:
        summary["phase"]["top_net_impact"] = ingest_top_net_impact(database_url, api_key)
    except Exception as e:
        log.warning("top_net_impact ingest failed: %s", e)
        summary["phase"]["top_net_impact"] = 0
    universe = resolve_explosive_universe(database_url)[:max_tickers]
    summary["universe_size"] = len(universe)
    per_ticker: dict[str, dict[str, int]] = {}
    for ticker in universe:
        try:
            per_ticker[ticker] = ingest_per_ticker_explosive(database_url, api_key, ticker)
        except Exception as e:
            log.warning("per-ticker explosive ingest failed for %s: %s", ticker, e)
            per_ticker[ticker] = {"error": str(e)}  # type: ignore[dict-item]
    summary["per_ticker"] = per_ticker
    return summary
