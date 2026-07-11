"""Ingestion orchestration: fetch -> extract -> stamp -> dedupe -> place -> reindex.

Per-URL isolation: one bad URL logs a reason code and the batch continues.
Idempotent on url_sha1: re-ingesting updates the existing file in place.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from brain import config, dedupe, extract, fetch, frontmatter, search_feeds, sources, vault
from brain import index as index_mod

log = logging.getLogger(__name__)


@dataclass
class IngestResult:
    url: str
    reason: str  # ok | ok_near_dup_inbox | robots_blocked | paywall | fetch_error | empty_extract
    path: Path | None = None


def ingest_url(
    url: str,
    tier: int | None = None,
    category: str | None = None,
    to: str = "vault",
    topics: list[str] | None = None,
    ingested_by: str = "ingest",
) -> IngestResult:
    src = sources.source_for_url(url)
    tier = tier if tier is not None else (src.trust_tier if src else config.DEFAULT_TIER)
    category = category or (src.category if src else "market-structure")
    topics = topics or (src.topics if src else [])
    fetcher = src.fetcher if src else "plain"
    rate_s = src.rate_s if src else config.DEFAULT_RATE_SECONDS
    if src is None and tier == config.DEFAULT_TIER:
        log.warning("unregistered domain %s — defaulting to T4", urlparse(url).netloc)

    result = fetch.fetch(url, fetcher=fetcher, rate_s=rate_s)
    if result.reason != "ok":
        return IngestResult(url, result.reason)

    sha = dedupe.url_sha1(url)
    if result.kind == "pdf":
        _, body = extract.pdf_to_markdown(result.pdf_bytes or b"", sha)
        title = Path(urlparse(url).path).stem.replace("_", " ").replace("-", " ").title()
        category = category if category != "market-structure" or src else "papers"
    else:
        title, body = extract.html_to_markdown(result.html or "")
        title = title or url
    if not body:
        return IngestResult(url, "empty_extract")

    sim = dedupe.simhash64(body)
    existing = index_mod.known_simhashes()
    existing.pop(sha, None)  # self-update is not a near-dup
    dupe_of = dedupe.is_near_dup(sim, existing)

    meta = {
        "title": title,
        "source_url": url,
        "source_domain": urlparse(url).netloc.lower(),
        "fetched_at": frontmatter.now_iso(),
        "trust_tier": tier,
        "category": category,
        "topics": topics,
        "summary": frontmatter.summarize(body),
        "url_sha1": sha,
        "simhash": str(sim),
        "ingested_by": ingested_by,
    }
    status = to
    reason = "ok"
    if dupe_of and to == "vault":
        meta["dupe_of"] = dupe_of
        status = "inbox"
        reason = "ok_near_dup_inbox"

    prior = vault.find_by_sha(sha)
    if prior:
        prior.unlink()  # rewrite under (possibly) new title/category
    path = vault.write_doc(meta, body, status=status)
    conn = index_mod.connect()
    with conn:
        index_mod.upsert(conn, path)
    conn.close()
    return IngestResult(url, reason, path)


def ingest_batch(urls: list[str], **kwargs) -> list[IngestResult]:
    results = []
    for url in urls:
        try:
            res = ingest_url(url, **kwargs)
        except Exception:
            log.exception("ingest failed for %s", url)
            res = IngestResult(url, "fetch_error")
        log.info("%-18s %s", res.reason, url)
        results.append(res)
    return results


def learn(topic: str, max_n: int = 5) -> list[IngestResult]:
    """Scriptable discovery (arXiv) -> inbox. Web discovery happens at the skill layer."""
    results: list[IngestResult] = []
    for entry in search_feeds.arxiv_search(topic, max_results=max_n):
        results.append(_ingest_paper(entry, ingested_by="learn"))
    return results


def crawl(only: str | None = None, to: str = "vault") -> list[IngestResult]:
    """Crawl every registered source's seed URLs (Phase 2 bulk crawl)."""
    results: list[IngestResult] = []
    for src in sources.load_sources():
        if only and src.name != only:
            continue
        if src.fetcher == "api":
            for query in src.seed_urls:
                results.extend(_feed_batch(query, max_results=15, ingested_by="ingest", to=to))
            continue
        results.extend(
            ingest_batch(src.seed_urls, tier=src.trust_tier, category=src.category,
                         topics=src.topics, to=to, ingested_by="ingest")
        )
    return results


def sweep(feeds_only: bool = True) -> list[IngestResult]:
    """Scheduled discovery of new material -> inbox only, never straight to vault."""
    results: list[IngestResult] = []
    for src in sources.load_sources():
        if src.discovery != "feed":
            continue
        if src.fetcher == "api":
            for query in src.seed_urls:
                results.extend(_feed_batch(query, max_results=10, ingested_by="sweep", to="inbox"))
        elif not feeds_only:
            results.extend(
                ingest_batch(src.seed_urls, tier=src.trust_tier, category=src.category,
                             topics=src.topics, to="inbox", ingested_by="sweep")
            )
    return results


def _feed_batch(query: str, max_results: int, ingested_by: str, to: str) -> list[IngestResult]:
    """One feed query, isolated: a dead feed logs and the crawl continues."""
    try:
        entries = search_feeds.arxiv_search(query, max_results=max_results)
    except Exception:
        log.exception("feed query failed: %s", query)
        return [IngestResult(f"arxiv:{query}", "fetch_error")]
    return [_ingest_paper(e, ingested_by=ingested_by, to=to) for e in entries]


def _ingest_paper(entry: search_feeds.PaperEntry, ingested_by: str, to: str = "inbox") -> IngestResult:
    """Build a paper doc straight from the Atom entry — no page fetch needed."""
    sha = dedupe.url_sha1(entry.url)
    body = search_feeds.paper_body(entry)
    sim = dedupe.simhash64(body)
    existing = index_mod.known_simhashes()
    existing.pop(sha, None)
    if vault.find_by_sha(sha) and to != "vault":
        return IngestResult(entry.url, "ok")  # already known; don't spam the inbox
    dupe_of = dedupe.is_near_dup(sim, existing)
    meta = {
        "title": entry.title,
        "source_url": entry.url,
        "source_domain": "arxiv.org",
        "fetched_at": frontmatter.now_iso(),
        "trust_tier": config.TIER_PRIMARY,
        "category": "papers",
        "topics": ["academic"],
        "summary": frontmatter.summarize(entry.summary),
        "url_sha1": sha,
        "simhash": str(sim),
        "ingested_by": ingested_by,
    }
    status, reason = to, "ok"
    if dupe_of and to == "vault":
        meta["dupe_of"] = dupe_of
        status, reason = "inbox", "ok_near_dup_inbox"
    prior = vault.find_by_sha(sha)
    if prior:
        prior.unlink()
    path = vault.write_doc(meta, body, status=status)
    conn = index_mod.connect()
    with conn:
        index_mod.upsert(conn, path)
    conn.close()
    return IngestResult(entry.url, reason, path)


def promote(hash8: str, category: str) -> Path:
    """Move an inbox doc into the vault under a category."""
    path = _inbox_doc(hash8)
    meta, body = frontmatter.parse(path.read_text(encoding="utf-8"))
    meta["category"] = category
    path.unlink()
    new_path = vault.write_doc(meta, body, status="vault")
    conn = index_mod.connect()
    with conn:
        index_mod.upsert(conn, new_path)
    conn.close()
    return new_path


def reject(hash8: str) -> None:
    path = _inbox_doc(hash8)
    meta, _ = frontmatter.parse(path.read_text(encoding="utf-8"))
    path.unlink()
    conn = index_mod.connect()
    with conn:
        conn.execute(
            "DELETE FROM docs_fts WHERE rowid IN (SELECT id FROM documents WHERE url_sha1 = ?)",
            (meta.get("url_sha1", ""),),
        )
        conn.execute("DELETE FROM documents WHERE url_sha1 = ?", (meta.get("url_sha1", ""),))
    conn.close()


def _inbox_doc(hash8: str) -> Path:
    matches = list(config.INBOX_DIR.glob(f"*--{hash8}.md")) if config.INBOX_DIR.exists() else []
    if not matches:
        raise FileNotFoundError(f"no inbox doc with hash {hash8}")
    return matches[0]
