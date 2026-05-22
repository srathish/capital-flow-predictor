"""Admin endpoints for the Explosive Board — manual rescore trigger.

Bypasses the GitHub Actions cron entirely by running cfp_jobs.score_explosive
directly inside the API container. Designed for the "I want to see the new
Board NOW" use case: the GHA scheduler is unreliable, this is reliable.

Endpoints:

  POST /v1/admin/explosive/rescore
      Runs score_explosive.score_all() synchronously. Returns the new
      snapshot summary (snapshot_ts, count, top). Takes ~30-90s for an
      80-ticker universe. Cooldown-gated to prevent rapid re-fires that
      would hammer UW rate limits.

  GET  /v1/admin/explosive/rescore/status
      Returns whether a rescore is currently running and seconds left in
      the cooldown. UI can use this to disable the button.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException
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
_lock = asyncio.Lock()


class RescoreResponse(BaseModel):
    status: str                              # 'completed' | 'cooldown'
    snapshot_ts: str | None = None
    count: int | None = None
    top: list[dict[str, Any]] = []
    elapsed_seconds: float | None = None
    cooldown_remaining: float | None = None


class RescoreStatusResponse(BaseModel):
    in_progress: bool
    cooldown_remaining: float
    last_finish_ts: float | None


@router.post("/rescore", response_model=RescoreResponse)
async def rescore() -> RescoreResponse:
    """Run cfp_jobs.score_explosive.score_all in a thread (it's sync code),
    write a new snapshot to explosive_scores, return the summary.

    Cooldown-gated to once per 60s so a refresh-spam click doesn't flood UW.
    """
    global _last_finish_ts, _in_progress

    # Cheap cooldown check before acquiring the lock.
    elapsed_since_last = time.monotonic() - _last_finish_ts
    if _last_finish_ts > 0 and elapsed_since_last < _COOLDOWN_SECONDS:
        remaining = _COOLDOWN_SECONDS - elapsed_since_last
        return RescoreResponse(status="cooldown", cooldown_remaining=remaining)

    # Serialize concurrent requests so a double-click doesn't fire two
    # scoring runs. The lock is held for the whole job (~30-90s).
    async with _lock:
        # Re-check cooldown after waiting for the lock — a previous run may
        # have just finished.
        elapsed_since_last = time.monotonic() - _last_finish_ts
        if _last_finish_ts > 0 and elapsed_since_last < _COOLDOWN_SECONDS:
            remaining = _COOLDOWN_SECONDS - elapsed_since_last
            return RescoreResponse(status="cooldown", cooldown_remaining=remaining)

        _in_progress = True
        started = time.monotonic()
        try:
            # Import lazily so an unrelated FastAPI import error doesn't
            # blow up at module load. score_all is sync (uses psycopg, not
            # asyncpg) — run it in a thread so the event loop stays free.
            from cfp_jobs import score_explosive

            log.info("admin rescore: starting")
            result = await asyncio.to_thread(score_explosive.score_all, settings.database_url)
            elapsed = time.monotonic() - started
            log.info("admin rescore: done count=%s elapsed=%.1fs", result.get("count"), elapsed)
            return RescoreResponse(
                status="completed",
                snapshot_ts=result.get("snapshot_ts"),
                count=result.get("count"),
                top=result.get("top", []),
                elapsed_seconds=elapsed,
            )
        except Exception as e:
            log.exception("admin rescore: failed")
            raise HTTPException(status_code=500, detail=f"rescore failed: {e}")
        finally:
            _last_finish_ts = time.monotonic()
            _in_progress = False


@router.get("/rescore/status", response_model=RescoreStatusResponse)
async def rescore_status() -> RescoreStatusResponse:
    """Lightweight status check the UI can poll to disable the button while
    a rescore is in progress or we're inside the cooldown window."""
    elapsed_since_last = time.monotonic() - _last_finish_ts
    cooldown_remaining = max(0.0, _COOLDOWN_SECONDS - elapsed_since_last) if _last_finish_ts > 0 else 0.0
    return RescoreStatusResponse(
        in_progress=_in_progress,
        cooldown_remaining=cooldown_remaining,
        last_finish_ts=_last_finish_ts if _last_finish_ts > 0 else None,
    )
