"""Scriptable discovery feeds. arXiv's Atom API is the clean academic backbone;
general-web discovery happens at the skill layer (Claude WebSearch -> brain ingest).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

import httpx

from brain import config

ARXIV_API = "https://export.arxiv.org/api/query"
_ATOM = "{http://www.w3.org/2005/Atom}"


@dataclass
class PaperEntry:
    url: str
    title: str
    summary: str
    published: str
    authors: list[str]


def arxiv_search(query: str, max_results: int = 10) -> list[PaperEntry]:
    """Search arXiv (all fields + q-fin bias comes from the query terms themselves)."""
    terms = " AND ".join(f"all:{t}" for t in query.split())
    params = {
        "search_query": terms,
        "sortBy": "relevance",
        "max_results": str(max_results),
    }
    resp = httpx.get(
        ARXIV_API,
        params=params,
        timeout=30,
        headers={"User-Agent": config.USER_AGENT},
        follow_redirects=True,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.text)
    entries: list[PaperEntry] = []
    for entry in root.findall(f"{_ATOM}entry"):
        link = entry.findtext(f"{_ATOM}id", "").strip()
        title = " ".join((entry.findtext(f"{_ATOM}title") or "").split())
        summary = " ".join((entry.findtext(f"{_ATOM}summary") or "").split())
        published = (entry.findtext(f"{_ATOM}published") or "").strip()
        authors = [
            a.findtext(f"{_ATOM}name", "").strip() for a in entry.findall(f"{_ATOM}author")
        ]
        if link and title:
            entries.append(PaperEntry(link, title, summary, published, authors))
    return entries


def paper_body(entry: PaperEntry) -> str:
    """Markdown body for a paper abstract document (no PDF download needed)."""
    authors = ", ".join(entry.authors) or "unknown"
    return (
        f"# {entry.title}\n\n"
        f"**Authors:** {authors}\n\n"
        f"**Published:** {entry.published}\n\n"
        f"**Link:** {entry.url}\n\n"
        f"## Abstract\n\n{entry.summary}\n"
    )
