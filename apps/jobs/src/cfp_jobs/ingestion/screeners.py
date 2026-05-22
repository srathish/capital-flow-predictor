"""Phase A ingestion: top-of-funnel UW endpoints.

Wires the new client methods on UwClient (screener_stocks, market_oi_change,
greek_exposure_strike/expiry, greek_flow, lit_flow_recent/ticker,
darkpool_recent, news_global) into the DB tables defined in
0033_uw_screeners.sql.

The intended call graph:

    cfp-jobs uw-screeners-ingest          # cron every 15m
        -> ingest_screener_stocks()       # primary universe seed
        -> ingest_market_oi_change()
        -> ingest_lit_flow_recent()
        -> ingest_darkpool_recent()
        -> ingest_news_global()

    cfp-jobs uw-gex-ingest --tickers X,Y  # post-universe, per-ticker
        -> ingest_greek_exposure_strike()
        -> ingest_greek_exposure_expiry()
        -> ingest_greek_flow()
        -> ingest_lit_flow_ticker()

Each ingest function is independently idempotent (ON CONFLICT DO UPDATE)
and returns the row count it wrote. Failures on one endpoint don't abort
the others — every block is wrapped so a 403/404/500 just gets logged.
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
    _to_date,
    _to_float,
    _to_int,
    _to_ts,
)

log = logging.getLogger(__name__)


# ---------- common helpers ----------


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _list_str(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    if isinstance(value, str):
        # UW occasionally returns comma-separated strings.
        return [t.strip() for t in value.split(",") if t.strip()]
    return None


# ---------- screener: stocks ----------


def _upsert_screener_stocks(
    conn: psycopg.Connection,
    snapshot_ts: datetime,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_screener_stocks (
            snapshot_ts, ticker, rank, last_price, pct_change,
            volume, avg_volume, market_cap, iv_rank, iv30, sector,
            call_volume, put_volume, total_premium, payload
        ) VALUES (
            %(snapshot_ts)s, %(ticker)s, %(rank)s, %(last_price)s, %(pct_change)s,
            %(volume)s, %(avg_volume)s, %(market_cap)s, %(iv_rank)s, %(iv30)s, %(sector)s,
            %(call_volume)s, %(put_volume)s, %(total_premium)s, %(payload)s
        )
        ON CONFLICT (snapshot_ts, ticker) DO UPDATE SET
            rank          = EXCLUDED.rank,
            last_price    = EXCLUDED.last_price,
            pct_change    = EXCLUDED.pct_change,
            volume        = EXCLUDED.volume,
            avg_volume    = EXCLUDED.avg_volume,
            market_cap    = EXCLUDED.market_cap,
            iv_rank       = EXCLUDED.iv_rank,
            iv30          = EXCLUDED.iv30,
            sector        = EXCLUDED.sector,
            call_volume   = EXCLUDED.call_volume,
            put_volume    = EXCLUDED.put_volume,
            total_premium = EXCLUDED.total_premium,
            payload       = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for i, r in enumerate(rows):
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            if not ticker:
                continue
            cur.execute(
                sql,
                {
                    "snapshot_ts": snapshot_ts,
                    "ticker": ticker,
                    "rank": r.get("rank") or (i + 1),
                    "last_price": _to_float(r.get("last_price") or r.get("price")),
                    "pct_change": _to_float(r.get("pct_change") or r.get("change_pct")),
                    "volume": _to_int(r.get("volume")),
                    "avg_volume": _to_int(r.get("avg_volume") or r.get("avg_30_day_volume")),
                    "market_cap": _to_float(r.get("market_cap") or r.get("marketcap")),
                    "iv_rank": _to_float(r.get("iv_rank") or r.get("iv_rank_1y_pct")),
                    "iv30": _to_float(r.get("iv30") or r.get("iv_30d")),
                    "sector": r.get("sector"),
                    "call_volume": _to_int(r.get("call_volume")),
                    "put_volume": _to_int(r.get("put_volume")),
                    "total_premium": _to_float(r.get("total_premium") or r.get("premium")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def ingest_screener_stocks(
    database_url: str,
    api_key: str,
    *,
    limit: int = 200,
    min_iv_rank: float | None = None,
    min_pct_change: float | None = None,
    min_volume: int | None = None,
) -> int:
    snapshot_ts = _utcnow()
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            rows = uw.screener_stocks(
                limit=limit,
                min_iv_rank=min_iv_rank,
                min_pct_change=min_pct_change,
                min_volume=min_volume,
            )
        except Exception as e:
            log.warning("screener_stocks fetch failed: %s", e)
            return 0
        n = _upsert_screener_stocks(conn, snapshot_ts, rows)
        conn.commit()
    return n


# ---------- market: OI change ----------


def _upsert_market_oi_change(
    conn: psycopg.Connection,
    snapshot_ts: datetime,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_market_oi_change (
            snapshot_ts, ticker, rank, oi_change, oi_change_pct,
            call_oi_change, put_oi_change, payload
        ) VALUES (
            %(snapshot_ts)s, %(ticker)s, %(rank)s, %(oi_change)s, %(oi_change_pct)s,
            %(call_oi_change)s, %(put_oi_change)s, %(payload)s
        )
        ON CONFLICT (snapshot_ts, ticker) DO UPDATE SET
            rank            = EXCLUDED.rank,
            oi_change       = EXCLUDED.oi_change,
            oi_change_pct   = EXCLUDED.oi_change_pct,
            call_oi_change  = EXCLUDED.call_oi_change,
            put_oi_change   = EXCLUDED.put_oi_change,
            payload         = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for i, r in enumerate(rows):
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            if not ticker:
                continue
            cur.execute(
                sql,
                {
                    "snapshot_ts": snapshot_ts,
                    "ticker": ticker,
                    "rank": r.get("rank") or (i + 1),
                    "oi_change": _to_int(r.get("oi_change") or r.get("delta")),
                    "oi_change_pct": _to_float(r.get("oi_change_pct") or r.get("pct")),
                    "call_oi_change": _to_int(r.get("call_oi_change")),
                    "put_oi_change": _to_int(r.get("put_oi_change")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def ingest_market_oi_change(database_url: str, api_key: str, *, limit: int = 200) -> int:
    snapshot_ts = _utcnow()
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            rows = uw.market_oi_change(limit=limit)
        except Exception as e:
            log.warning("market_oi_change fetch failed: %s", e)
            return 0
        n = _upsert_market_oi_change(conn, snapshot_ts, rows)
        conn.commit()
    return n


# ---------- per-ticker: GEX by strike + expiry + greek flow ----------


def _upsert_gex_strike(
    conn: psycopg.Connection,
    snapshot_date: date,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_greek_exposure_strike (
            snapshot_date, ticker, strike,
            call_gex, put_gex, net_gex,
            call_delta, put_delta, call_charm, put_charm,
            call_vanna, put_vanna, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(strike)s,
            %(call_gex)s, %(put_gex)s, %(net_gex)s,
            %(call_delta)s, %(put_delta)s, %(call_charm)s, %(put_charm)s,
            %(call_vanna)s, %(put_vanna)s, %(payload)s
        )
        ON CONFLICT (snapshot_date, ticker, strike) DO UPDATE SET
            call_gex   = EXCLUDED.call_gex,
            put_gex    = EXCLUDED.put_gex,
            net_gex    = EXCLUDED.net_gex,
            call_delta = EXCLUDED.call_delta,
            put_delta  = EXCLUDED.put_delta,
            call_charm = EXCLUDED.call_charm,
            put_charm  = EXCLUDED.put_charm,
            call_vanna = EXCLUDED.call_vanna,
            put_vanna  = EXCLUDED.put_vanna,
            payload    = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            strike = _to_float(r.get("strike"))
            if strike is None:
                continue
            cur.execute(
                sql,
                {
                    "snapshot_date": snapshot_date,
                    "ticker": ticker,
                    "strike": strike,
                    "call_gex": _to_float(r.get("call_gex")),
                    "put_gex": _to_float(r.get("put_gex")),
                    "net_gex": _to_float(r.get("net_gex") or r.get("gex")),
                    "call_delta": _to_float(r.get("call_delta")),
                    "put_delta": _to_float(r.get("put_delta")),
                    "call_charm": _to_float(r.get("call_charm")),
                    "put_charm": _to_float(r.get("put_charm")),
                    "call_vanna": _to_float(r.get("call_vanna")),
                    "put_vanna": _to_float(r.get("put_vanna")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def _upsert_gex_expiry(
    conn: psycopg.Connection,
    snapshot_date: date,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_greek_exposure_expiry (
            snapshot_date, ticker, expiry, dte,
            call_gex, put_gex, net_gex,
            call_delta, put_delta, payload
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(expiry)s, %(dte)s,
            %(call_gex)s, %(put_gex)s, %(net_gex)s,
            %(call_delta)s, %(put_delta)s, %(payload)s
        )
        ON CONFLICT (snapshot_date, ticker, expiry) DO UPDATE SET
            dte        = EXCLUDED.dte,
            call_gex   = EXCLUDED.call_gex,
            put_gex    = EXCLUDED.put_gex,
            net_gex    = EXCLUDED.net_gex,
            call_delta = EXCLUDED.call_delta,
            put_delta  = EXCLUDED.put_delta,
            payload    = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            exp = _to_date(r.get("expiry") or r.get("expiration"))
            if exp is None:
                continue
            cur.execute(
                sql,
                {
                    "snapshot_date": snapshot_date,
                    "ticker": ticker,
                    "expiry": exp,
                    "dte": _to_int(r.get("dte") or r.get("days_to_expiry")),
                    "call_gex": _to_float(r.get("call_gex")),
                    "put_gex": _to_float(r.get("put_gex")),
                    "net_gex": _to_float(r.get("net_gex") or r.get("gex")),
                    "call_delta": _to_float(r.get("call_delta")),
                    "put_delta": _to_float(r.get("put_delta")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def _upsert_greek_flow(
    conn: psycopg.Connection,
    ticker: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO uw_greek_flow (
            ts, ticker,
            net_delta_flow, net_gamma_flow, net_vega_flow, net_theta_flow,
            call_delta_flow, put_delta_flow, payload
        ) VALUES (
            %(ts)s, %(ticker)s,
            %(net_delta_flow)s, %(net_gamma_flow)s, %(net_vega_flow)s, %(net_theta_flow)s,
            %(call_delta_flow)s, %(put_delta_flow)s, %(payload)s
        )
        ON CONFLICT (ts, ticker) DO UPDATE SET
            net_delta_flow  = EXCLUDED.net_delta_flow,
            net_gamma_flow  = EXCLUDED.net_gamma_flow,
            net_vega_flow   = EXCLUDED.net_vega_flow,
            net_theta_flow  = EXCLUDED.net_theta_flow,
            call_delta_flow = EXCLUDED.call_delta_flow,
            put_delta_flow  = EXCLUDED.put_delta_flow,
            payload         = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("ts") or r.get("timestamp"))
            if ts is None:
                continue
            cur.execute(
                sql,
                {
                    "ts": ts,
                    "ticker": ticker,
                    "net_delta_flow": _to_float(r.get("net_delta_flow") or r.get("net_delta")),
                    "net_gamma_flow": _to_float(r.get("net_gamma_flow") or r.get("net_gamma")),
                    "net_vega_flow": _to_float(r.get("net_vega_flow") or r.get("net_vega")),
                    "net_theta_flow": _to_float(r.get("net_theta_flow") or r.get("net_theta")),
                    "call_delta_flow": _to_float(r.get("call_delta_flow")),
                    "put_delta_flow": _to_float(r.get("put_delta_flow")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def ingest_gex_for_ticker(database_url: str, api_key: str, ticker: str) -> dict[str, int]:
    """Pulls per-strike + per-expiry GEX and the intraday greek-flow stream
    for a single ticker. Returns row counts per table."""
    ticker = ticker.upper()
    today = datetime.now(UTC).date()
    counts = {"strike": 0, "expiry": 0, "flow": 0}
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            counts["strike"] = _upsert_gex_strike(
                conn, today, ticker, uw.greek_exposure_strike(ticker)
            )
        except Exception as e:
            log.warning("greek_exposure_strike(%s) failed: %s", ticker, e)
        try:
            counts["expiry"] = _upsert_gex_expiry(
                conn, today, ticker, uw.greek_exposure_expiry(ticker)
            )
        except Exception as e:
            log.warning("greek_exposure_expiry(%s) failed: %s", ticker, e)
        try:
            counts["flow"] = _upsert_greek_flow(conn, ticker, uw.greek_flow(ticker))
        except Exception as e:
            log.warning("greek_flow(%s) failed: %s", ticker, e)
        conn.commit()
    return counts


# ---------- lit flow (global + per-ticker) + dark pool global ----------


def _upsert_trade_stream(
    conn: psycopg.Connection,
    table: str,
    rows: Iterable[dict],
    *,
    has_side: bool,
    has_premium: bool = False,
) -> int:
    cols = ["ts", "ticker", "price", "size"]
    placeholders = ["%(ts)s", "%(ticker)s", "%(price)s", "%(size)s"]
    if has_side:
        cols += ["side"]
        placeholders += ["%(side)s"]
    if has_premium:
        cols += ["premium"]
        placeholders += ["%(premium)s"]
    cols += ["venue"] if has_side else []
    placeholders += ["%(venue)s"] if has_side else []
    cols += ["trade_id", "payload"]
    placeholders += ["%(trade_id)s", "%(payload)s"]
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) "
        f"VALUES ({', '.join(placeholders)}) "
        "ON CONFLICT DO NOTHING"
    )
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ts = _to_ts(r.get("ts") or r.get("timestamp") or r.get("executed_at"))
            ticker = (r.get("ticker") or r.get("symbol") or "").upper()
            if ts is None or not ticker:
                continue
            tid = str(
                r.get("trade_id")
                or r.get("id")
                or f"{ts.isoformat()}|{ticker}|{r.get('price')}|{r.get('size')}"
            )
            params = {
                "ts": ts,
                "ticker": ticker,
                "price": _to_float(r.get("price")),
                "size": _to_int(r.get("size") or r.get("volume")),
                "trade_id": tid,
                "payload": Jsonb(r),
            }
            if has_side:
                params["side"] = r.get("side") or r.get("aggressor")
                params["venue"] = r.get("venue") or r.get("exchange")
            if has_premium:
                params["premium"] = _to_float(r.get("premium"))
            cur.execute(sql, params)
            n += 1
    return n


def ingest_lit_flow_recent(database_url: str, api_key: str, *, limit: int = 200) -> int:
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            rows = uw.lit_flow_recent(limit=limit)
        except Exception as e:
            log.warning("lit_flow_recent fetch failed: %s", e)
            return 0
        n = _upsert_trade_stream(conn, "uw_lit_flow_recent", rows, has_side=True)
        conn.commit()
    return n


def ingest_lit_flow_ticker(database_url: str, api_key: str, ticker: str, *, limit: int = 200) -> int:
    ticker = ticker.upper()
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            rows = uw.lit_flow_ticker(ticker, limit=limit)
        except Exception as e:
            log.warning("lit_flow_ticker(%s) failed: %s", ticker, e)
            return 0
        # Tag rows with ticker if UW omitted it.
        rows = [{**r, "ticker": r.get("ticker") or ticker} for r in rows]
        n = _upsert_trade_stream(conn, "uw_lit_flow_ticker", rows, has_side=True)
        conn.commit()
    return n


def ingest_darkpool_recent(database_url: str, api_key: str, *, limit: int = 200) -> int:
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            rows = uw.darkpool_recent(limit=limit)
        except Exception as e:
            log.warning("darkpool_recent fetch failed: %s", e)
            return 0
        n = _upsert_trade_stream(
            conn, "uw_darkpool_recent", rows, has_side=False, has_premium=True
        )
        conn.commit()
    return n


# ---------- news (global) ----------


def _upsert_news_global(conn: psycopg.Connection, rows: Iterable[dict]) -> int:
    sql = """
        INSERT INTO uw_news_global (
            published_at, article_id, headline, source, url,
            tickers, sentiment, payload
        ) VALUES (
            %(published_at)s, %(article_id)s, %(headline)s, %(source)s, %(url)s,
            %(tickers)s, %(sentiment)s, %(payload)s
        )
        ON CONFLICT (published_at, article_id) DO UPDATE SET
            headline   = EXCLUDED.headline,
            source     = EXCLUDED.source,
            url        = EXCLUDED.url,
            tickers    = EXCLUDED.tickers,
            sentiment  = EXCLUDED.sentiment,
            payload    = EXCLUDED.payload
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            published = _to_ts(r.get("published_at") or r.get("created_at") or r.get("ts"))
            article_id = str(
                r.get("id")
                or r.get("article_id")
                or r.get("url")
                or r.get("headline")
                or ""
            )
            if published is None or not article_id:
                continue
            cur.execute(
                sql,
                {
                    "published_at": published,
                    "article_id": article_id[:255],
                    "headline": r.get("headline") or r.get("title"),
                    "source": r.get("source") or r.get("publisher"),
                    "url": r.get("url") or r.get("link"),
                    "tickers": _list_str(r.get("tickers") or r.get("symbols")),
                    "sentiment": _to_float(r.get("sentiment")),
                    "payload": Jsonb(r),
                },
            )
            n += 1
    return n


def ingest_news_global(database_url: str, api_key: str, *, limit: int = 100) -> int:
    with UwClient(api_key) as uw, connect(database_url) as conn:
        try:
            rows = uw.news_global(limit=limit)
        except Exception as e:
            log.warning("news_global fetch failed: %s", e)
            return 0
        n = _upsert_news_global(conn, rows)
        conn.commit()
    return n


# ---------- orchestrator: one job that pulls every market-level endpoint ----------


def ingest_uw_market_layer(database_url: str, api_key: str) -> dict[str, int]:
    """Run all the market-level (non per-ticker) Phase A ingests in sequence.

    Designed to be the body of `cfp-jobs uw-screeners-ingest`. Each
    sub-ingest is independent — if one endpoint 403/404/500s, the others
    still run. Returns a dict of {endpoint: row_count}.
    """
    out: dict[str, int] = {}
    out["screener_stocks"] = ingest_screener_stocks(database_url, api_key)
    out["market_oi_change"] = ingest_market_oi_change(database_url, api_key)
    out["lit_flow_recent"] = ingest_lit_flow_recent(database_url, api_key)
    out["darkpool_recent"] = ingest_darkpool_recent(database_url, api_key)
    out["news_global"] = ingest_news_global(database_url, api_key)
    return out
