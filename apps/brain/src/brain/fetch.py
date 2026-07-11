"""Polite fetching: scrapling dispatch + robots.txt + per-domain rate limiting.

scrapling is imported lazily so `brain search`/`seed` work without browser
binaries installed (mirror of cfp_jobs' _ensure_playwright pattern).
"""

from __future__ import annotations

import random
import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urlparse

from brain import config

_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_last_hit: dict[str, float] = {}


@dataclass
class FetchResult:
    url: str
    status: int
    html: str | None
    kind: str = "html"  # html | pdf
    pdf_bytes: bytes | None = None
    reason: str = "ok"  # ok | robots_blocked | fetch_error


def _ensure_scrapling():
    try:
        from scrapling import fetchers
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "scrapling is not installed. Run `uv sync` and, for stealth sources, "
            "`uv run --package brain scrapling install`."
        ) from exc
    return fetchers


def robots_ok(url: str) -> bool:
    """Honor robots.txt. On robots fetch failure, allow (standard practice)."""
    domain = urlparse(url).netloc.lower()
    if domain not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"https://{domain}/robots.txt")
        try:
            rp.read()
            _robots_cache[domain] = rp
        except Exception:
            _robots_cache[domain] = None
    rp = _robots_cache[domain]
    if rp is None:
        return True
    return rp.can_fetch(config.USER_AGENT, url)


def _rate_limit(url: str, rate_s: float) -> None:
    domain = urlparse(url).netloc.lower()
    elapsed = time.monotonic() - _last_hit.get(domain, 0.0)
    wait = rate_s + random.uniform(0, rate_s / 2) - elapsed
    if wait > 0:
        time.sleep(wait)
    _last_hit[domain] = time.monotonic()


def fetch(url: str, fetcher: str = "plain", rate_s: float = config.DEFAULT_RATE_SECONDS) -> FetchResult:
    if not robots_ok(url):
        return FetchResult(url, 0, None, reason="robots_blocked")
    _rate_limit(url, rate_s)
    fetchers = _ensure_scrapling()
    try:
        if fetcher == "stealth":
            page = fetchers.StealthyFetcher.fetch(url, headless=True, solve_cloudflare=True)
        elif fetcher == "dynamic":
            page = fetchers.DynamicFetcher.fetch(url)
        else:
            page = fetchers.Fetcher.get(
                url, timeout=config.FETCH_TIMEOUT_SECONDS, stealthy_headers=True
            )
    except Exception:
        return FetchResult(url, 0, None, reason="fetch_error")
    status = getattr(page, "status", 200)
    if status >= 400:
        return FetchResult(url, status, None, reason="fetch_error")
    if url.lower().endswith(".pdf") or _looks_like_pdf(page):
        body = getattr(page, "body", None)
        raw = body if isinstance(body, bytes) else None
        if raw is None:
            return FetchResult(url, status, None, kind="pdf", reason="fetch_error")
        return FetchResult(url, status, None, kind="pdf", pdf_bytes=raw)
    return FetchResult(url, status, page.html_content, kind="html")


def _looks_like_pdf(page) -> bool:
    headers = getattr(page, "headers", None) or {}
    ctype = ""
    for k, v in dict(headers).items():
        if str(k).lower() == "content-type":
            ctype = str(v).lower()
    return "application/pdf" in ctype
