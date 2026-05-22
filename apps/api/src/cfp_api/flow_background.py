"""In-process background scheduler for the flow-tab UW jobs.

Mirrors `discord_background.py` (same threading model, same env-var gate).
Five periodic tasks run inside the API's event loop:

  movers           every  5 min during RTH
  sector_tide      every  5 min during RTH (11 S&P sectors per pass)
  iv_rank_history  once a day, ~22:30 UTC (after US close)
  earnings_estimates once a day, ~22:45 UTC
  correlations     once a day, ~23:00 UTC

Daily tasks pick their ticker universe from:
  * the custom watchlist (uw_stock_info ∪ custom_watchlist), plus
  * any ticker with ≥1 flow alert in the trailing 7 days
…capped at FLOW_BG_TICKER_CAP to keep the daily UW budget bounded.

Disable globally via BELLWETHER_FLOW_BACKGROUND=0. Requires
UNUSUAL_WHALES_API_KEY to be configured — otherwise all tasks no-op.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import UTC, datetime

from cfp_api.settings import settings

log = logging.getLogger(__name__)


MOVERS_INTERVAL_SECONDS = 300        # 5 min
SECTOR_TIDE_INTERVAL_SECONDS = 300   # 5 min
DAILY_TICK_INTERVAL_SECONDS = 600    # 10 min — checks if "today's daily" still owes
INITIAL_DELAY_SECONDS = 45           # let API finish startup + first migration

# Time-of-day (UTC) at which each daily task should fire. Picked just after
# the 22:00 UTC US close (= 17:00 ET / 18:00 ET DST). The daily loop checks
# every DAILY_TICK_INTERVAL_SECONDS whether the target hour has been reached
# and whether we've already run today.
IV_RANK_TARGET_HOUR_UTC = 22         # 22:30 UTC
EARNINGS_TARGET_HOUR_UTC = 22        # 22:45 UTC
CORRELATIONS_TARGET_HOUR_UTC = 23    # 23:00 UTC

# Cap the daily per-ticker tasks. UW limit is 120 req/min, 80k/day — we're
# only burning ~2N requests per pass (iv_rank + earnings_estimates per ticker)
# so 150 is a comfortable ceiling that finishes inside a 2-min window.
FLOW_BG_TICKER_CAP = 150

# Anchor tickers for the correlations basket. Sector ETFs + the megacaps that
# tend to lead. UW returns N×(N-1) pairs so 12 tickers = 132 rows per day.
CORRELATIONS_ANCHORS: tuple[str, ...] = (
    "SPY", "QQQ", "IWM",
    "XLK", "XLF", "XLE", "XLY", "XLI", "XLV",
    "NVDA", "AAPL", "MSFT",
)


def _enabled() -> bool:
    return os.environ.get("BELLWETHER_FLOW_BACKGROUND", "1") not in ("0", "false", "False")


def _have_uw_key() -> bool:
    return bool((settings.unusual_whales_api_key or "").strip())


def _is_rth_utc(now: datetime | None = None) -> bool:
    """Rough US RTH check in UTC: weekdays 13:30-20:00 UTC (= 09:30-16:00 ET
    standard time). Used to gate the 5-min movers + sector-tide jobs so we
    don't burn the API budget overnight."""
    n = now or datetime.now(UTC)
    if n.weekday() >= 5:
        return False
    minutes = n.hour * 60 + n.minute
    return 13 * 60 + 30 <= minutes < 20 * 60


# ---------- one-tick coroutines (offload sync work to threads) -------------


async def _run_movers_once() -> None:
    if not _is_rth_utc() or not _have_uw_key():
        return
    from cfp_jobs.ingestion import unusualwhales as uw

    def _work() -> int:
        return uw.ingest_market_movers(settings.database_url, settings.unusual_whales_api_key)

    n = await asyncio.to_thread(_work)
    if n:
        log.info("flow_background movers tick: %s rows", n)


async def _run_sector_tide_once() -> None:
    if not _is_rth_utc() or not _have_uw_key():
        return
    from cfp_jobs.ingestion import unusualwhales as uw

    def _work() -> dict[str, int]:
        return uw.ingest_sector_tide(settings.database_url, settings.unusual_whales_api_key)

    counts = await asyncio.to_thread(_work)
    total = sum(counts.values()) if counts else 0
    if total:
        log.info(
            "flow_background sector_tide tick: %s rows across %s sectors",
            total, len([k for k, v in counts.items() if v]),
        )


def _pick_daily_ticker_universe() -> list[str]:
    """Watchlist ∪ recently-flow-active tickers, deduped + capped. Imports
    psycopg here so a missing DB doesn't break the API boot."""
    import psycopg

    seen: set[str] = set()
    out: list[str] = []
    sql = """
        SELECT ticker FROM (
            -- Custom watchlist (manual picks)
            SELECT DISTINCT ticker FROM custom_watchlist
            UNION
            -- Anything we've ingested stock_info for (live universe)
            SELECT DISTINCT ticker FROM uw_stock_info WHERE ticker IS NOT NULL
            UNION
            -- Anything that printed an unusual flow alert in the last 7 days
            SELECT DISTINCT ticker FROM uw_flow_alerts
            WHERE created_at > NOW() - INTERVAL '7 days'
        ) u
        WHERE ticker ~ '^[A-Z][A-Z0-9.]{0,5}$'
        LIMIT %s
    """
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        # 3× the cap to leave room for dedup + filtering; we still trim below.
        cur.execute(sql, (FLOW_BG_TICKER_CAP * 3,))
        for (t,) in cur.fetchall():
            sym = (t or "").strip().upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            out.append(sym)
            if len(out) >= FLOW_BG_TICKER_CAP:
                break
    return out


async def _run_iv_rank_history_once() -> None:
    if not _have_uw_key():
        return
    from cfp_jobs.ingestion import unusualwhales as uw

    tickers = await asyncio.to_thread(_pick_daily_ticker_universe)
    if not tickers:
        return
    log.info("flow_background iv_rank: refreshing %s tickers", len(tickers))

    def _work_one(t: str) -> int:
        try:
            return uw.ingest_iv_rank_history(settings.database_url, settings.unusual_whales_api_key, t)
        except Exception as e:  # noqa: BLE001
            log.debug("iv_rank_history failed for %s: %s", t, e)
            return 0

    total = 0
    for t in tickers:
        total += await asyncio.to_thread(_work_one, t)
    log.info("flow_background iv_rank tick complete: %s rows upserted", total)


async def _run_earnings_estimates_once() -> None:
    if not _have_uw_key():
        return
    from cfp_jobs.ingestion import unusualwhales as uw

    tickers = await asyncio.to_thread(_pick_daily_ticker_universe)
    if not tickers:
        return
    log.info("flow_background earnings_estimates: refreshing %s tickers", len(tickers))

    def _work() -> dict[str, int]:
        return uw.ingest_earnings_estimates(settings.database_url, settings.unusual_whales_api_key, tickers)

    counts = await asyncio.to_thread(_work)
    total = sum(counts.values()) if counts else 0
    log.info("flow_background earnings_estimates tick complete: %s rows upserted", total)


async def _run_correlations_once() -> None:
    if not _have_uw_key():
        return
    from cfp_jobs.ingestion import unusualwhales as uw

    def _work() -> int:
        return uw.ingest_correlations(
            settings.database_url,
            settings.unusual_whales_api_key,
            list(CORRELATIONS_ANCHORS),
        )

    n = await asyncio.to_thread(_work)
    if n:
        log.info("flow_background correlations tick complete: %s rows", n)


# ---------- schedulers ------------------------------------------------------


async def _interval_loop(label: str, interval: int, fn) -> None:
    await asyncio.sleep(INITIAL_DELAY_SECONDS)
    while True:
        try:
            await fn()
        except Exception:
            log.exception("flow_background %s failed (will retry)", label)
        await asyncio.sleep(interval)


async def _daily_loop(label: str, target_hour_utc: int, fn) -> None:
    """Runs `fn` once per UTC calendar day at >= target_hour_utc. The loop
    wakes every DAILY_TICK_INTERVAL_SECONDS to check; we record the last-run
    date in memory so back-to-back restarts don't double-fire."""
    await asyncio.sleep(INITIAL_DELAY_SECONDS)
    last_run_date = None
    while True:
        try:
            now = datetime.now(UTC)
            should_run = (
                last_run_date != now.date()
                and now.hour >= target_hour_utc
                # Don't fire on weekends — most of these endpoints emit empty
                # rows for non-trading days and we'd burn calls for nothing.
                and now.weekday() < 5
            )
            if should_run:
                await fn()
                last_run_date = now.date()
        except Exception:
            log.exception("flow_background %s daily tick failed (will retry)", label)
        await asyncio.sleep(DAILY_TICK_INTERVAL_SECONDS)


def start(loop: asyncio.AbstractEventLoop) -> list[asyncio.Task]:
    if not _enabled():
        log.info("flow_background disabled via BELLWETHER_FLOW_BACKGROUND")
        return []
    if not _have_uw_key():
        log.info("flow_background not starting: UNUSUAL_WHALES_API_KEY unset")
        return []

    tasks = [
        loop.create_task(
            _interval_loop("movers", MOVERS_INTERVAL_SECONDS, _run_movers_once),
            name="flow_bg_movers",
        ),
        loop.create_task(
            _interval_loop("sector_tide", SECTOR_TIDE_INTERVAL_SECONDS, _run_sector_tide_once),
            name="flow_bg_sector_tide",
        ),
        loop.create_task(
            _daily_loop("iv_rank", IV_RANK_TARGET_HOUR_UTC, _run_iv_rank_history_once),
            name="flow_bg_iv_rank",
        ),
        loop.create_task(
            _daily_loop("earnings_estimates", EARNINGS_TARGET_HOUR_UTC, _run_earnings_estimates_once),
            name="flow_bg_earnings_estimates",
        ),
        loop.create_task(
            _daily_loop("correlations", CORRELATIONS_TARGET_HOUR_UTC, _run_correlations_once),
            name="flow_bg_correlations",
        ),
    ]
    log.info(
        "flow_background started: movers/sector-tide every %ss; iv_rank/earnings/correlations daily UTC ~22-23h",
        MOVERS_INTERVAL_SECONDS,
    )
    return tasks


async def stop(tasks: list[asyncio.Task]) -> None:
    for t in tasks:
        t.cancel()
    for t in tasks:
        with suppress(asyncio.CancelledError, Exception):
            await t
