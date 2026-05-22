"""Admin endpoints for the Explosive Board — manual rescore trigger.

Bypasses the GitHub Actions cron entirely by running cfp_jobs.score_explosive
directly inside the API container. Designed for the "I want to see the new
Board NOW" use case: the GHA scheduler is unreliable, this is reliable.

Architecture: fire-and-forget. Railway's HTTP proxy times out at ~30s, and
score_all() takes 30-90s, so we kick the work onto an asyncio task and
return 202 Accepted immediately. The UI polls /rescore/status until
in_progress flips to false, then refetches /v1/explosive.

Endpoints:

  POST /v1/admin/explosive/rescore
      Kicks off score_all in the background, returns 202 immediately with
      {status: started|cooldown}. Cooldown-gated to once per 60s.

  GET  /v1/admin/explosive/rescore/status
      Returns whether a rescore is currently running, cooldown remaining,
      and the last result summary (if available). UI polls this every
      ~2s while in_progress is true.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from cfp_api.settings import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/admin/explosive", tags=["admin"])

# Module-level guards. Single-instance assumption is OK — the API runs as
# one container on Railway. If we ever scale horizontally, move state to a
# Postgres advisory lock.
_COOLDOWN_SECONDS = 60.0
_last_finish_ts: float = 0.0
_in_progress: bool = False
_last_result: dict[str, Any] | None = None
_last_error: str | None = None
_lock = asyncio.Lock()


class RescoreResponse(BaseModel):
    status: str                              # 'started' | 'cooldown' | 'already_running'
    cooldown_remaining: float | None = None
    poll_url: str | None = None


class RescoreStatusResponse(BaseModel):
    in_progress: bool
    cooldown_remaining: float
    last_finish_ts: float | None
    last_result: dict[str, Any] | None = None
    last_error: str | None = None


async def _run_score() -> None:
    """The actual scoring work, run as a background asyncio task. Updates
    module-level state so the status endpoint can report progress / result."""
    global _last_finish_ts, _in_progress, _last_result, _last_error
    started = time.monotonic()
    try:
        from cfp_jobs import score_explosive
        log.info("admin rescore: starting (background task)")
        result = await asyncio.to_thread(score_explosive.score_all, settings.database_url)
        elapsed = time.monotonic() - started
        log.info("admin rescore: done count=%s elapsed=%.1fs", result.get("count"), elapsed)
        _last_result = {
            "snapshot_ts": result.get("snapshot_ts"),
            "count": result.get("count"),
            "top": result.get("top", []),
            "elapsed_seconds": elapsed,
        }
        _last_error = None
    except Exception as e:
        log.exception("admin rescore: failed")
        _last_error = str(e)
    finally:
        _last_finish_ts = time.monotonic()
        _in_progress = False


@router.post("/rescore", response_model=RescoreResponse, status_code=202)
async def rescore() -> RescoreResponse:
    """Kick off a rescore as a background task, return 202 immediately.

    The UI should then poll /rescore/status every 2s. score_all takes
    30-90s for an 80-ticker universe — Railway's HTTP proxy times out
    sync requests at ~30s, so we can't block here.
    """
    global _in_progress

    # Cheap pre-lock cooldown check.
    elapsed_since_last = time.monotonic() - _last_finish_ts
    if _last_finish_ts > 0 and elapsed_since_last < _COOLDOWN_SECONDS:
        remaining = _COOLDOWN_SECONDS - elapsed_since_last
        return RescoreResponse(status="cooldown", cooldown_remaining=remaining)

    async with _lock:
        if _in_progress:
            return RescoreResponse(status="already_running")
        elapsed_since_last = time.monotonic() - _last_finish_ts
        if _last_finish_ts > 0 and elapsed_since_last < _COOLDOWN_SECONDS:
            remaining = _COOLDOWN_SECONDS - elapsed_since_last
            return RescoreResponse(status="cooldown", cooldown_remaining=remaining)
        _in_progress = True
        # Fire-and-forget: schedule the task; FastAPI returns immediately.
        asyncio.create_task(_run_score())
        return RescoreResponse(
            status="started",
            poll_url="/v1/admin/explosive/rescore/status",
        )


@router.get("/rescore/status", response_model=RescoreStatusResponse)
async def rescore_status() -> RescoreStatusResponse:
    """Lightweight status check the UI polls every 2s while a rescore is
    in progress. After it finishes, the last result + any error is
    exposed here for the UI to display."""
    elapsed_since_last = time.monotonic() - _last_finish_ts
    cooldown_remaining = max(0.0, _COOLDOWN_SECONDS - elapsed_since_last) if _last_finish_ts > 0 else 0.0
    return RescoreStatusResponse(
        in_progress=_in_progress,
        cooldown_remaining=cooldown_remaining,
        last_finish_ts=_last_finish_ts if _last_finish_ts > 0 else None,
        last_result=_last_result,
        last_error=_last_error,
    )
