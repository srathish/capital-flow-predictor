"""Thin Unusual Whales REST client.

- Bearer auth from UW_API_KEY (falls back to UNUSUAL_WHALES_API_KEY).
- Required UW-CLIENT-API-ID header.
- Token-bucket rate limiter shared across threads.
- Exponential backoff on 429 / 5xx; honors Retry-After.
- 404 returns None (endpoint not available for that ticker / plan-gated).
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


def _get_token() -> str:
    tok = os.environ.get("UW_API_KEY") or os.environ.get("UNUSUAL_WHALES_API_KEY")
    if not tok:
        raise RuntimeError(
            "Missing UW_API_KEY (or UNUSUAL_WHALES_API_KEY) in env. "
            "Source .env before running."
        )
    return tok


class _RateLimiter:
    def __init__(self, rps: float):
        self.min_interval = 1.0 / rps
        self.lock = threading.Lock()
        self.next_allowed = 0.0

    def acquire(self) -> None:
        with self.lock:
            now = time.monotonic()
            wait = self.next_allowed - now
            if wait > 0:
                time.sleep(wait)
                now = time.monotonic()
            self.next_allowed = now + self.min_interval


class UWClient:
    def __init__(self, base_url: str, rate_limit_rps: float, max_retries: int, timeout: int):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.limiter = _RateLimiter(rate_limit_rps)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {_get_token()}",
                "Accept": "application/json",
                "User-Agent": "uw-base-breakout-screener/0.1",
                "UW-CLIENT-API-ID": "100001",
            }
        )

    def get(self, path: str, params: dict | None = None) -> Any:
        @retry(
            retry=retry_if_exception_type(
                (requests.HTTPError, requests.Timeout, requests.ConnectionError)
            ),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            stop=stop_after_attempt(self.max_retries),
            reraise=True,
        )
        def _do() -> Any:
            self.limiter.acquire()
            r = self.session.get(
                f"{self.base_url}{path}", params=params, timeout=self.timeout
            )
            if r.status_code == 429:
                retry_after = int(r.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                r.raise_for_status()
            if r.status_code in (502, 503, 504):
                r.raise_for_status()
            if r.status_code == 404:
                return None
            if r.status_code == 403:
                return {"_plan_gated": True}
            r.raise_for_status()
            return r.json()

        try:
            return _do()
        except requests.HTTPError as e:
            if e.response is not None and 400 <= e.response.status_code < 500:
                return None
            raise
