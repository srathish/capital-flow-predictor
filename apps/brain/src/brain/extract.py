"""Main-content extraction: HTML -> markdown (trafilatura), PDF -> markdown (pymupdf4llm).

No per-site CSS selectors — trafilatura's boilerplate-stripping main-content
detection is the common path (house style: don't hard-code brittle selectors).
"""

from __future__ import annotations

import re
from pathlib import Path

from brain import config

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_H1_MD_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)


def html_to_markdown(html: str) -> tuple[str | None, str | None]:
    """Return (title, markdown_body); (title, None) when extraction is thin."""
    import trafilatura

    body = trafilatura.extract(
        html,
        output_format="markdown",
        include_links=True,
        include_tables=True,
        favor_recall=True,
    )
    title = None
    try:
        meta = trafilatura.extract_metadata(html)
        title = getattr(meta, "title", None)
    except Exception:
        pass
    if not title:
        m = _TITLE_RE.search(html)
        if m:
            title = re.sub(r"\s+", " ", m.group(1)).strip()
    if body and not title:
        m = _H1_MD_RE.search(body)
        title = m.group(1).strip() if m else None
    if not body or len(body) < config.MIN_EXTRACT_CHARS:
        return title, None
    return title, body.strip()


def pdf_to_markdown(pdf_bytes: bytes, url_sha1: str) -> tuple[Path, str | None]:
    """Persist the PDF under papers/ and return (path, markdown or None)."""
    import pymupdf4llm

    config.PAPERS_DIR.mkdir(parents=True, exist_ok=True)
    path = config.PAPERS_DIR / f"{url_sha1}.pdf"
    path.write_bytes(pdf_bytes)
    try:
        body = pymupdf4llm.to_markdown(str(path))
    except Exception:
        return path, None
    if not body or len(body) < config.MIN_EXTRACT_CHARS:
        return path, None
    return path, body.strip()
