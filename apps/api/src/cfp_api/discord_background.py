"""In-process background scheduler for Discord-side jobs.

Two periodic tasks run inside the API's event loop:

  - score_discord_plays      → every 5 minutes
  - dispatch_discord_notifications → every 60 seconds

Both are blocking workloads (yfinance HTTP calls, sync psycopg connections,
httpx.post) so we offload them via ``asyncio.to_thread`` to keep the FastAPI
event loop responsive. Exceptions are caught + logged; one bad cycle never
kills the scheduler.

Why in-process instead of a separate Railway cron service:
  - jobs are short (~5-30s) and idempotent — interruption is fine
  - no extra container to deploy/pay for
  - the API already has cfp-jobs as a workspace dep, so imports are free
  - failure mode is "stops scheduling" which is recoverable by API redeploy

Disable globally via the BELLWETHER_DISCORD_BACKGROUND env var (set to '0')
if you ever want to run the workers via Railway cron instead.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress

from cfp_api.settings import settings

log = logging.getLogger(__name__)


PRICE_WORKER_INTERVAL_SECONDS = 300       # 5 minutes
NOTIFY_DISPATCHER_INTERVAL_SECONDS = 60   # 1 minute
INITIAL_DELAY_SECONDS = 30                # let the API finish startup first


def _enabled() -> bool:
    return os.environ.get("BELLWETHER_DISCORD_BACKGROUND", "1") not in ("0", "false", "False")


async def _run_price_worker_once() -> None:
    """Single tick of the mark-to-market worker. Imports lazily so an import
    failure (missing yfinance, etc.) only impacts this task, not the whole
    API boot."""
    from cfp_jobs import score_discord_plays

    def _work():
        return score_discord_plays.run(settings.database_url, days=30)

    summary = await asyncio.to_thread(_work)
    log.info(
        "discord_background price_worker tick: seen=%s updated=%s closed=%s",
        summary.get("seen"),
        summary.get("updated"),
        summary.get("closed"),
    )


async def _run_notify_dispatcher_once() -> None:
    from cfp_jobs import dispatch_discord_notifications

    def _work():
        return dispatch_discord_notifications.run(
            settings.database_url, lookback_minutes=30
        )

    summary = await asyncio.to_thread(_work)
    # Only log when something actually happened — every minute of "0/0/0" is
    # noise in the access log otherwise.
    if summary.get("seen", 0) or summary.get("dispatched", 0) or summary.get("failed", 0):
        log.info(
            "discord_background dispatcher tick: seen=%s dispatched=%s failed=%s",
            summary.get("seen"),
            summary.get("dispatched"),
            summary.get("failed"),
        )


async def _scheduled_loop(label: str, interval: int, fn) -> None:
    await asyncio.sleep(INITIAL_DELAY_SECONDS)
    while True:
        try:
            await fn()
        except Exception:
            log.exception("discord_background %s failed (will retry)", label)
        await asyncio.sleep(interval)


def start(loop: asyncio.AbstractEventLoop) -> list[asyncio.Task]:
    """Schedule both loops on the given event loop. Returns the task handles
    so the API lifespan can cancel them on shutdown."""
    if not _enabled():
        log.info("discord_background disabled via BELLWETHER_DISCORD_BACKGROUND")
        return []

    tasks = [
        loop.create_task(
            _scheduled_loop(
                "price_worker", PRICE_WORKER_INTERVAL_SECONDS, _run_price_worker_once
            ),
            name="discord_price_worker",
        ),
        loop.create_task(
            _scheduled_loop(
                "notify_dispatcher",
                NOTIFY_DISPATCHER_INTERVAL_SECONDS,
                _run_notify_dispatcher_once,
            ),
            name="discord_notify_dispatcher",
        ),
    ]
    log.info(
        "discord_background started: price_worker every %ss, notifier every %ss",
        PRICE_WORKER_INTERVAL_SECONDS,
        NOTIFY_DISPATCHER_INTERVAL_SECONDS,
    )
    return tasks


async def stop(tasks: list[asyncio.Task]) -> None:
    for t in tasks:
        t.cancel()
    for t in tasks:
        with suppress(asyncio.CancelledError, Exception):
            await t
