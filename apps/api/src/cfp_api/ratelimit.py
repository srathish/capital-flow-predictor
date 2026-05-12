"""In-process sliding-window rate limiter.

Single-process implementation suitable for the single-replica Railway deploy.
If you scale to multiple workers, swap the in-memory store for Redis (the
interface is intentionally shaped like a Redis ZSET).

Two buckets per client identity:
  * ``default`` — applied to GET reads (cheap)
  * ``run``     — applied to /v1/agents/*/run + chat (LLM-cost endpoints)

Identity = API key (when set) or remote IP.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Literal

from fastapi import HTTPException, Request

from cfp_api.settings import settings

Bucket = Literal["default", "run"]


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, Bucket], deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, identity: str, bucket: Bucket, limit: int, window_seconds: float) -> tuple[bool, int, float]:
        """Returns (allowed, remaining, retry_after_seconds)."""
        now = time.monotonic()
        cutoff = now - window_seconds
        key = (identity, bucket)
        with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= limit:
                retry_after = max(0.0, q[0] + window_seconds - now)
                return False, 0, retry_after
            q.append(now)
            return True, max(0, limit - len(q)), 0.0


_limiter = SlidingWindowLimiter()


def _identity(request: Request) -> str:
    key = request.headers.get("X-API-Key")
    if key:
        return f"key:{key[:8]}"  # truncated for log/metric labels
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return f"key:{auth[7:15]}"
    # Prefer the canonical client ip; behind a proxy use X-Forwarded-For first hop.
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return f"ip:{xff.split(',')[0].strip()}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


async def rate_limit_default(request: Request) -> None:
    if not settings.rate_limit_enabled:
        return
    allowed, remaining, retry = _limiter.check(
        _identity(request), "default",
        settings.rate_limit_default_per_min, 60.0,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"rate limit exceeded (default bucket); retry in {retry:.1f}s",
            headers={"Retry-After": str(int(retry) + 1)},
        )


async def rate_limit_run(request: Request) -> None:
    if not settings.rate_limit_enabled:
        return
    allowed, remaining, retry = _limiter.check(
        _identity(request), "run",
        settings.rate_limit_run_per_hour, 3600.0,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"rate limit exceeded (run bucket); retry in {retry:.1f}s",
            headers={"Retry-After": str(int(retry) + 1)},
        )


def reset_for_tests() -> None:
    """Test hook — wipes the in-process counters between cases."""
    with _limiter._lock:
        _limiter._hits.clear()
