"""Dedupe keys: canonical-URL sha1 (exact) + 64-bit simhash (near-dup)."""

from __future__ import annotations

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "ref",
    "source",
}

_WORD_RE = re.compile(r"[a-z0-9]+")

NEAR_DUP_HAMMING = 3


def canonicalize_url(url: str) -> str:
    """Lowercase host, strip fragments and tracking params, drop trailing slash."""
    p = urlparse(url.strip())
    query = urlencode(
        [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k not in TRACKING_PARAMS]
    )
    path = p.path.rstrip("/") or "/"
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", query, ""))


def url_sha1(url: str) -> str:
    return hashlib.sha1(canonicalize_url(url).encode()).hexdigest()


def simhash64(text: str) -> int:
    """64-bit simhash over word 3-shingles of the cleaned body."""
    words = _WORD_RE.findall(text.lower())
    if not words:
        return 0
    shingles = (
        [" ".join(words[i : i + 3]) for i in range(len(words) - 2)] if len(words) >= 3 else words
    )
    v = [0] * 64
    for sh in shingles:
        h = int.from_bytes(hashlib.md5(sh.encode()).digest()[:8], "big")
        for bit in range(64):
            v[bit] += 1 if (h >> bit) & 1 else -1
    out = 0
    for bit in range(64):
        if v[bit] > 0:
            out |= 1 << bit
    return out


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def is_near_dup(sim: int, existing: dict[str, int]) -> str | None:
    """Return the url_sha1 of an existing near-duplicate document, if any."""
    if sim == 0:
        return None
    for key, other in existing.items():
        if other and hamming(sim, other) <= NEAR_DUP_HAMMING:
            return key
    return None
