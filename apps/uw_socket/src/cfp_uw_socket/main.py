"""UW WebSocket subscriber — Phase C (revised to match UW's actual protocol).

UW exposes a *single* WebSocket connection that multiplexes channels via
JSON-encoded JOIN messages. Per UW docs (e.g. socket/trading_halts):

  Connect to:  wss://api.unusualwhales.com/socket?token=<API_TOKEN>

  After connect, send one JOIN message per channel you want to subscribe to:

      {"channel": "trading_halts", "msg_type": "join"}

  Inbound messages are JSON arrays of the form:

      ["channel_name", {<payload>}]

  Reconnect on disconnect; the server doesn't replay missed messages.

Channel subscriptions are configured via UW_SOCKET_CHANNELS (default:
flow_alerts,option_trades,gex,market_tide,trading_halts).

A separate task periodically polls /news/headlines for global news (no
WebSocket channel exposed for news).
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
from contextlib import suppress
from datetime import UTC, datetime
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


# ---------- Postgres write helpers ----------
#
# Handlers return SQL with psycopg-style named placeholders %(key)s so they
# can be reused by sync code paths. asyncpg needs $1/$2 numbered placeholders
# — we translate at exec time.


def _named_to_numbered(sql: str, params: dict[str, Any]) -> tuple[str, list[Any]]:
    import re
    seen: dict[str, int] = {}
    values: list[Any] = []

    def sub(match: "re.Match[str]") -> str:
        key = match.group(1)
        if key not in seen:
            seen[key] = len(seen) + 1
            values.append(params.get(key))
        return f"${seen[key]}"

    return re.sub(r"%\((\w+)\)s", sub, sql), values


async def _exec_with_conn(conn: asyncpg.Connection, sql_named: str, params: dict[str, Any]) -> None:
    sql, values = _named_to_numbered(sql_named, params)
    await conn.execute(sql, *values)


async def _exec(pool: asyncpg.Pool, sql: str, params: dict[str, Any]) -> None:
    async with pool.acquire() as conn:
        await _exec_with_conn(conn, sql, params)


# ---------- option_trades batcher ----------
#
# The option_trades channel is high-volume. We accumulate up to FLUSH_BATCH
# rows or FLUSH_INTERVAL seconds, whichever first, then bulk-write inside
# one acquired connection.

BATCHED_CHANNELS = {"option_trades"}
FLUSH_INTERVAL = 2.0
FLUSH_BATCH = 200


class BatchBuffer:
    """Per-channel buffer that flushes on size or time."""

    def __init__(self) -> None:
        self.sql: str | None = None
        self.rows: list[dict[str, Any]] = []
        self.last_flush = datetime.now(UTC)

    def add(self, sql: str, params: dict[str, Any]) -> None:
        self.sql = sql
        self.rows.append(params)

    def should_flush(self) -> bool:
        if not self.rows:
            return False
        if len(self.rows) >= FLUSH_BATCH:
            return True
        return (datetime.now(UTC) - self.last_flush).total_seconds() >= FLUSH_INTERVAL

    async def flush(self, pool: asyncpg.Pool) -> int:
        if not self.rows or self.sql is None:
            return 0
        sql, rows = self.sql, self.rows
        self.rows = []
        self.last_flush = datetime.now(UTC)
        async with pool.acquire() as conn:
            async with conn.transaction():
                for p in rows:
                    await _exec_with_conn(conn, sql, p)
        return len(rows)


# ---------- single multiplexed subscriber ----------


def _socket_url() -> str:
    base = settings.uw_socket_url.rstrip("/")
    # UW uses a query-param token, not a header. The base URL stays
    # configurable so we can point at staging or a mock if needed.
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}token={settings.unusual_whales_api_key}"


async def _run_socket(pool: asyncpg.Pool, channels: list[str]) -> None:
    """Connect once, JOIN N channels, route inbound messages to handlers.

    On disconnect: exponential backoff up to 60s, then reconnect + re-JOIN.
    """
    buffers: dict[str, BatchBuffer] = {ch: BatchBuffer() for ch in BATCHED_CHANNELS}
    attempt = 0
    while True:
        url = _socket_url()
        try:
            log.info("connecting to UW socket (attempt %d) channels=%s", attempt + 1, channels)
            async with websockets.connect(
                url,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=5,
                max_size=4 * 1024 * 1024,
            ) as ws:
                log.info("socket connected")
                attempt = 0
                # JOIN each channel.
                for ch in channels:
                    await ws.send(json.dumps({"channel": ch, "msg_type": "join"}))
                    log.info("[%s] join sent", ch)

                async def flush_timer() -> None:
                    while True:
                        await asyncio.sleep(FLUSH_INTERVAL / 2)
                        for ch, buf in buffers.items():
                            if buf.should_flush():
                                try:
                                    n = await buf.flush(pool)
                                    if n:
                                        log.debug("[%s] flushed %d rows", ch, n)
                                except Exception as e:
                                    log.warning("[%s] flush failed: %s", ch, e)

                timer = asyncio.create_task(flush_timer())
                try:
                    async for raw in ws:
                        await _dispatch(raw, pool, buffers)
                finally:
                    timer.cancel()
                    with suppress(asyncio.CancelledError):
                        await timer
                    # Final flush before reconnect.
                    for ch, buf in buffers.items():
                        with suppress(Exception):
                            await buf.flush(pool)
        except InvalidStatusCode as e:
            log.error("socket handshake rejected (%s) — likely subscription tier; backing off", e)
            await asyncio.sleep(300)
        except (ConnectionClosed, OSError) as e:
            log.warning("socket disconnected: %s", e)
        except asyncio.CancelledError:
            for ch, buf in buffers.items():
                with suppress(Exception):
                    await buf.flush(pool)
            raise
        except Exception as e:
            log.exception("socket unexpected error: %s", e)
        attempt += 1
        await asyncio.sleep(min(60, 2 ** min(attempt, 6)))


async def _dispatch(raw: Any, pool: asyncpg.Pool, buffers: dict[str, BatchBuffer]) -> None:
    """Parse a UW socket message and route to the channel handler.

    Expected shape:  ["channel_name", {<payload>}]
    Also handle JOIN-ack / heartbeat envelopes that may come back as dicts.
    """
    try:
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8", errors="replace")
        if isinstance(raw, str):
            msg = json.loads(raw)
        else:
            msg = raw
    except (ValueError, TypeError):
        return

    if isinstance(msg, list) and len(msg) >= 2 and isinstance(msg[0], str):
        channel = msg[0]
        payload = msg[1]
        handler = HANDLERS.get(channel)
        if handler is None:
            return
        result = handler(payload)
        if result is None:
            return
        sql, params = result
        if channel in BATCHED_CHANNELS:
            buffers[channel].add(sql, params)
        else:
            try:
                await _exec(pool, sql, params)
            except Exception as e:
                log.warning("[%s] insert failed: %s", channel, e)
        return

    # Non-tuple messages: ack / heartbeat / errors. Log at debug — useful
    # while ramping but quickly overwhelming once it's running.
    log.debug("non-tuple message: %s", str(msg)[:200])


# ---------- HTTP news poller ----------


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
    from cfp_uw_socket.handlers import _f, _ts
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

    tasks: list[asyncio.Task] = []
    if settings.channels:
        tasks.append(asyncio.create_task(_run_socket(pool, settings.channels), name="ws"))
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
    await asyncio.wait(tasks + [stopper], return_when=asyncio.FIRST_COMPLETED)
    for t in tasks:
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
