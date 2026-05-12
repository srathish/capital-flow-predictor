"""Sliding-window rate limiter — unit tests on the limiter object itself.

Live request tests against TestClient depend on the asyncpg pool, which the
existing test infra already skips when DATABASE_URL is unset. The unit tests
below cover the algorithm in isolation.
"""

from __future__ import annotations

import time

from cfp_api.ratelimit import SlidingWindowLimiter


def test_under_limit_allows() -> None:
    lim = SlidingWindowLimiter()
    for _ in range(5):
        allowed, remaining, retry = lim.check("id1", "default", limit=5, window_seconds=60.0)
        assert allowed
        assert retry == 0.0


def test_over_limit_blocks() -> None:
    lim = SlidingWindowLimiter()
    for _ in range(3):
        assert lim.check("id1", "default", limit=3, window_seconds=60.0)[0]
    allowed, remaining, retry = lim.check("id1", "default", limit=3, window_seconds=60.0)
    assert not allowed
    assert remaining == 0
    assert retry > 0


def test_per_identity_isolation() -> None:
    lim = SlidingWindowLimiter()
    for _ in range(2):
        lim.check("a", "default", limit=2, window_seconds=60.0)
    assert lim.check("a", "default", limit=2, window_seconds=60.0)[0] is False
    # Different identity, same limits — independent counter.
    assert lim.check("b", "default", limit=2, window_seconds=60.0)[0] is True


def test_bucket_isolation() -> None:
    lim = SlidingWindowLimiter()
    for _ in range(2):
        lim.check("id1", "default", limit=2, window_seconds=60.0)
    assert lim.check("id1", "default", limit=2, window_seconds=60.0)[0] is False
    # Different bucket on the same identity has its own quota.
    assert lim.check("id1", "run", limit=2, window_seconds=60.0)[0] is True


def test_window_expiry_allows_again() -> None:
    lim = SlidingWindowLimiter()
    # Fill quota with a small window so expiry happens quickly.
    for _ in range(2):
        lim.check("id1", "default", limit=2, window_seconds=0.1)
    assert lim.check("id1", "default", limit=2, window_seconds=0.1)[0] is False
    time.sleep(0.15)
    assert lim.check("id1", "default", limit=2, window_seconds=0.1)[0] is True
