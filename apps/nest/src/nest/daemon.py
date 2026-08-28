"""The resident daemon — the market-clock scheduler that makes the Nest a service
rather than a one-shot command. Long-running process; Railway (or launchd) treats
process-alive as liveness and restarts on hard crash. Per-cycle errors are swallowed
so one bad tick never kills the loop.

Daily rhythm (brief §8), all times ET:
    premarket  08:30        digest --send (the one scheduled Sonnet call)
    RTH        09:31-16:00   conviction cycle every CYCLE_MINUTES; Calls can fire
    afterhours 16:15         grade matured Calls, roll up source weights
    overnight  else          sleep (cheap; the box just idles)

All state is on disk in the event log, so a restart mid-day resumes exactly where it
left off — the loop is stateless beyond "have I already run today's digest/grade?",
which is tracked in-memory and is idempotent enough to re-run safely after a restart.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from nest import config
from nest.events.log import EventLog

log = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")

# cadence / phase boundaries (ET)
CYCLE_MINUTES = 5
DIGEST_AT = (8, 30)
RTH_OPEN = (9, 31)
RTH_CLOSE = (16, 0)
GRADE_AT = (16, 15)
IDLE_SLEEP_S = 60  # poll the clock once a minute when nothing is due


def _hm(now: datetime) -> tuple[int, int]:
    return (now.hour, now.minute)


def _in_rth(now: datetime) -> bool:
    return now.weekday() < 5 and RTH_OPEN <= _hm(now) < RTH_CLOSE


def _due(now: datetime, at: tuple[int, int]) -> bool:
    # true within the minute the task is scheduled for (loop polls every 60s)
    return now.weekday() < 5 and _hm(now) == at


def _run_cycle() -> None:
    from nest import orchestrator
    from nest.ingest.uw_client import UWClient

    log_db = EventLog()
    uw = UWClient()
    try:
        tickers = _watchlist()
        summary = orchestrator.run_cycle(log_db, uw, tickers, deliver=True)
        log.info("cycle: evaluated=%d gated=%d calls=%d",
                 summary["evaluated"], summary["gated"], len(summary["calls"]))
    finally:
        uw.close()
        log_db.close()


def _run_digest() -> None:
    from nest.delivery import digest as dg
    from nest.delivery import discord

    log_db = EventLog()
    try:
        text = dg.build(log_db, _watchlist())
        discord.send_digest(text)
        log.info("digest sent")
    finally:
        log_db.close()


def _run_grade() -> None:
    from nest.ingest.uw_client import UWClient
    from nest.tracker import grader

    log_db = EventLog()
    uw = UWClient()
    try:
        written = grader.grade_due(log_db, grader._uw_price_fn(uw))
        log.info("grade: wrote %d grades", len(written))
    finally:
        uw.close()
        log_db.close()


def _watchlist() -> list[str]:
    import yaml

    path = config.PACKAGE_ROOT / "src" / "nest" / "watchlist.yaml"
    if path.exists():
        return list((yaml.safe_load(path.read_text()) or {}).get("tickers", []))
    return []


def run() -> None:
    """Block forever on the market clock. Kill via SIGTERM (Railway) or Ctrl-C."""
    log.info("🪶 Nest daemon up — ET now %s, watchlist %s",
             datetime.now(ET).isoformat(timespec="minutes"), _watchlist())
    last_cycle_minute = -1
    done: dict[str, str] = {"digest": "", "grade": ""}  # task -> yyyy-mm-dd last run

    while True:
        now = datetime.now(ET)
        today = now.date().isoformat()
        try:
            if _due(now, DIGEST_AT) and done["digest"] != today:
                _run_digest()
                done["digest"] = today
            elif _in_rth(now) and now.minute % CYCLE_MINUTES == 0 and now.minute != last_cycle_minute:
                _run_cycle()
                last_cycle_minute = now.minute
            elif _due(now, GRADE_AT) and done["grade"] != today:
                _run_grade()
                done["grade"] = today
        except Exception:  # noqa: BLE001 — a bad tick must never kill the daemon
            log.exception("tick failed (%s) — continuing", now.isoformat(timespec="minutes"))
        time.sleep(IDLE_SLEEP_S)
