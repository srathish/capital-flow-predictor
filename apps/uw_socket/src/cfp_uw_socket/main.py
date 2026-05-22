"""UW WebSocket subscriber — Phase C.

Holds one outbound WebSocket per channel + one async task that polls
/news/headlines on UW_NEWS_POLL_SECONDS interval (UW doesn't expose news
on WebSocket).

Per-channel loop:
  * Connect to wss://api.unusualwhales.com/socket/<channel> with Bearer auth
  * For each inbound message: dispatch through the channel's handler
  * Handler returns (SQL, params) or None; main writes via the pool
  * On disconnect: exponential backoff (1s → 60s), then reconnect
  * Each channel is independent — one failing doesn't take the others down

Per-table batching: option_trades can be high volume, so we accumulate
rows for FLUSH_INTERVAL seconds (or FLUSH_BATCH rows, whichever first)
then bulk INSERT. The other channels write individually.

Shutdown is on SIGTERM/SIGINT: signals cancel the gather; outstanding
batches flush; pool closes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
import httpx
import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatusCode

from cfp_uw_socket.handlers import HANDLERS
from cfp_uw_socket.settings import settings

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("uw_socket")


# ---------- bounded retry/backoff ----------


async def _backoff(attempt: int) -> None:
    """Exponential backoff capped at 60s."""
    delay = min(60, 2 ** min(attempt, 6))
    await asyncio.sleep(delay)


# ---------- per-channel subscriber ----------


# Channels that are high-volume — batch writes instead of single inserts.
BATCHED_CHANNELS = {"option_trades"}
FLUSH_INTERVAL = 2.0   # seconds
FLUSH_BATCH = 200       # rows


async def _flush(pool: asyncpg.Pool, sql: str, batch: list[dict]) -> None:
    """Bulk-write a single SQL template with N parameter sets. asyncpg can't
    do executemany() with named %(...)s parameters efficiently, so we
    iterate inside one transaction (still single round trip per row, but
    one connection acquire)."""
    if not batch:
        return
    # asyncpg uses $1/$2 numbered params, not %(...)s — but the underlying
    # pool acquires raw connections that can run psycopg-style placeholders
    # if we translate. Simpler: rewrite the named template to numbered.
    # However, this subscriber writes through asyncpg directly, so we keep
    # the handlers' SQL in numbered form below in _exec(). Batching uses
    # the same _exec() in a loop inside one acquire.
    async with pool.acquire() as conn:
        async with conn.transaction():
            for params in batch:
                await _exec_with_conn(conn, sql, params)


async def _exec_with_conn(conn: asyncpg.Connection, sql_named: str, params: dict[str, Any]) -> None:
    """Translate psycopg-named placeholders %(key)s → asyncpg $1/$2 ordered,
    then execute. Keeping handlers in psycopg-style means they can be reused
    by other (sync) code paths if we ever need to."""
    sql_numbered, values = _named_to_numbered(sql_named, params)
    await conn.execute(sql_numbered, *values)


def _named_to_numbered(sql: str, params: dict[str, Any]) -> tuple[str, list[Any]]:
    """Replace %(name)s with $1, $2, ... in order of first occurrence;
    return the rewritten SQL plus the values in matching order."""
    import re
    seen: dict[str, int] = {}
    values: list[Any] = []

    def sub(match: "re.Match[str]") -> str:
        key = match.group(1)
        if key not in seen:
            seen[key] = len(seen) + 1
            values.append(params.get(key))
        return f"${seen[key]}"

    rewritten = re.sub(r"%\((\w+)\)s", sub, sql)
    return rewritten, values


async def _exec(pool: asyncpg.Pool, sql_named: str, params: dict[str, Any]) -> None:
    async with pool.acquire() as conn:
        await _exec_with_conn(conn, sql_named, params)


async def _subscribe_channel(pool: asyncpg.Pool, channel: str) -> None:
    """Long-running per-channel loop. Reconnects on disconnect with backoff.
    A 403/404 typically means the channel isn't on the current UW tier;
    we log and back off heavily rather than spin."""
    handler = HANDLERS.get(channel)
    if handler is None:
        log.error("unknown channel %s; skipping", channel)
        return

    url = f"{settings.uw_socket_url.rstrip('/')}/{channel}"
    headers = {"Authorization": f"Bearer {settings.unusual_whales_api_key}"}
    attempt = 0
    batch_buf: list[dict] = []
    batch_sql: str | None = None
    last_flush = datetime.now(UTC)

    while True:
        try:
            log.info("[%s] connecting %s (attempt %d)", channel, url, attempt + 1)
            async with websockets.connect(
                url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=5,
            ) as ws:
                log.info("[%s] connected", channel)
                attempt = 0
                async for raw in ws:
                    result = handler(raw)
                    if result is None:
                        continue
                    sql, params = result
                    if channel in BATCHED_CHANNELS:
                        batch_sql = sql
                        batch_buf.append(params)
                        now = datetime.now(UTC)
                        if (
                            len(batch_buf) >= FLUSH_BATCH
                            or (now - last_flush).total_seconds() >= FLUSH_INTERVAL
                        ):
                            await _flush(pool, batch_sql, batch_buf)
                            batch_buf = []
                            last_flush = now
                    else:
                        try:
                            await _exec(pool, sql, params)
                        except Exception as e:
                            log.warning("[%s] insert failed: %s", channel, e)
        except (ConnectionClosed, OSError) as e:
            log.warning("[%s] disconnected: %s", channel, e)
        except InvalidStatusCode as e:
            log.error("[%s] handshake rejected (%s) — likely subscription tier; backing off hard", channel, e)
            await asyncio.sleep(300)
        except asyncio.CancelledError:
            if batch_buf and batch_sql:
                with suppress(Exception):
                    await _flush(pool, batch_sql, batch_buf)
            raise
        except Exception as e:
            log.exception("[%s] unexpected error: %s", channel, e)
        attempt += 1
        await _backoff(attempt)


# ---------- news poller (UW doesn't expose news on WS) ----------


NEWS_SQL = """
    INSERT INTO uw_news_global (
        published_at, article_id, headline, source, url,
        tickers, sentiment, payload
    ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
    ) ON CONFLICT (published_at, article_id) DO UPDATE SET
        headline   = EXCLUDED.headline,
        source     = EXCLUDED.source,
        url        = EXCLUDED.url,
        tickers    = EXCLUDED.tickers,
        sentiment  = EXCLUDED.sentiment,
        payload    = EXCLUDED.payload
"""


def _parse_news_row(item: dict) -> tuple[Any, ...] | None:
    from cfp_uw_socket.handlers import _ts, _f
    published = _ts(item.get("published_at") or item.get("created_at") or item.get("ts"))
    article_id = str(
        item.get("id") or item.get("article_id") or item.get("url") or item.get("headline") or ""
    )[:255]
    if published is None or not article_id:
        return None
    tickers_raw = item.get("tickers") or item.get("symbols")
    if isinstance(tickers_raw, str):
        tickers: list[str] | None = [t.strip() for t in tickers_raw.split(",") if t.strip()]
    elif isinstance(tickers_raw, list):
        tickers = [str(t) for t in tickers_raw if t]
    else:
        tickers = None
    return (
        published,
        article_id,
        item.get("headline") or item.get("title"),
        item.get("source") or item.get("publisher"),
        item.get("url") or item.get("link"),
        tickers,
        _f(item.get("sentiment")),
        json.dumps(item),
    )


async def _poll_news(pool: asyncpg.Pool) -> None:
    """Periodic poll of /news/headlines (no WebSocket for news)."""
    base = "https://api.unusualwhales.com/api"
    headers = {
        "Authorization": f"Bearer {settings.unusual_whales_api_key}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        while True:
            try:
                r = await client.get(f"{base}/news/headlines", params={"limit": 100})
                if r.status_code == 200:
                    body = r.json()
                    rows = body.get("data") if isinstance(body, dict) and "data" in body else body
                    if isinstance(rows, list):
                        written = 0
                        async with pool.acquire() as conn:
                            for item in rows:
                                if not isinstance(item, dict):
                                    continue
                                values = _parse_news_row(item)
                                if values is None:
                                    continue
                                with suppress(Exception):
                                    await conn.execute(NEWS_SQL, *values)
                                    written += 1
                        log.info("news poll: %d rows", written)
                else:
                    log.warning("news poll: HTTP %s", r.status_code)
            except Exception as e:
                log.warning("news poll failed: %s", e)
            await asyncio.sleep(max(10, settings.uw_news_poll_seconds))


# ---------- main ----------


async def _amain() -> None:
    log.info("starting uw_socket subscriber")
    log.info("channels: %s", settings.channels)
    log.info("news poll interval: %ds", settings.uw_news_poll_seconds)

    pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=5,
    )
    assert pool is not None

    tasks = [
        asyncio.create_task(_subscribe_channel(pool, ch), name=f"ws:{ch}")
        for ch in settings.channels
    ]
    if settings.uw_news_poll_seconds > 0:
        tasks.append(asyncio.create_task(_poll_news(pool), name="news_poll"))

    stop = asyncio.Event()

    def _signal_handler() -> None:
        log.info("shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, _signal_handler)

    stopper = asyncio.create_task(stop.wait(), name="stopper")
    done, pending = await asyncio.wait(
        tasks + [stopper],
        return_when=asyncio.FIRST_COMPLETED,
    )
    # Cancel everything still running.
    for t in pending:
        t.cancel()
    for t in tasks:
        with suppress(asyncio.CancelledError, Exception):
            await t
    await pool.close()
    log.info("uw_socket subscriber stopped")


def main() -> None:
    try:
        asyncio.run(_amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
